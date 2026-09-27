import zlib from 'node:zlib'
import { ENDPOINTS } from '../config.js'
import { decodeSegment, decodeViewSetting } from './dmproto.js'
import { DM_PARAMS, bili, csrfPost, csrfToken, signedGet } from './client.js'

/* ------------------------------------------------------------------ account */

export const getNav = () => bili.get('/x/web-interface/nav')
export const getNavStat = () => bili.get('/x/web-interface/nav/stat')

/* --------------------------------------------------------------------- feed */

/**
 * The personalised home feed. It answers -400 for ps above ~14 and returns 10
 * items regardless, so the page size is fixed and volume comes from calling it
 * repeatedly with an increasing fresh_idx -- each index yields a disjoint batch.
 */
export const getRecommended = (freshIdx = 1) =>
  signedGet('/x/web-interface/wbi/index/top/rcmd', {
    web_location: '1430650',
    fresh_type: 4,
    feed_version: 'V8',
    fresh_idx: freshIdx,
    fresh_idx_1h: freshIdx,
    brush: freshIdx,
    fetch_row: 1,
    y_num: 5,
    last_y_num: 5,
    homepage_ver: 1,
    ps: 12,
  })

export const getPopular = (pn = 1, ps = 24) => bili.get('/x/web-interface/popular', { pn, ps })

export const getRanking = (rid = 0) => bili.get('/x/web-interface/ranking/v2', { rid, type: 'all' })

export const getRegionFeed = (rid, pn = 1, ps = 24) =>
  bili.get('/x/web-interface/dynamic/region', { rid, pn, ps })

/**
 * The "following" feed. `type: all` is what bilibili's own dynamics page uses;
 * `video` would silently drop text posts, image posts and forwards.
 */
export const getFollowingFeed = (offset = '', type = 'all') =>
  bili.get('/x/polymer/web-dynamic/v1/feed/all', { type, offset, timezone_offset: -480 })

/* ------------------------------------------------------------------- search */

export const search = (keyword, page = 1, type = 'video', order = '') =>
  signedGet('/x/web-interface/wbi/search/type', {
    search_type: type,
    keyword,
    page,
    order,
    page_size: 30,
    web_location: '1430654',
  })

export const searchSuggest = async (term) => {
  const res = await bili.raw(
    `https://s.search.bilibili.com/main/suggest?term=${encodeURIComponent(term)}&main_ver=v1`,
  )
  const body = await res.body.json().catch(() => ({}))
  return Object.values(body?.result?.tag || {}).map((t) => t.value)
}

/* -------------------------------------------------------------------- video */

/**
 * The unsigned /x/web-interface/view endpoints now answer 412 behind bilibili's
 * anti-crawler wall; only the WBI-signed variants the real web player uses get
 * through.
 */
export const getVideo = (bvid) => signedGet('/x/web-interface/wbi/view', { bvid })
export const getVideoDetail = (bvid) => signedGet('/x/web-interface/wbi/view/detail', { bvid })
export const getPages = (bvid) => bili.get('/x/player/pagelist', { bvid })
export const getRelated = (bvid) => bili.get('/x/web-interface/archive/related', { bvid })

/** Your like / coin / favourite / follow state for one video, in one call. */
export const getVideoRelation = (bvid) => bili.get('/x/web-interface/archive/relation', { bvid })

/**
 * fnval 4048 asks for the DASH manifest (separate video + audio tracks, incl.
 * HDR and Dolby). qn only matters for the legacy FLV path but is still
 * validated server-side, so it is always sent.
 */
export const getPlayUrl = (bvid, cid, qn = 80) =>
  signedGet('/x/player/wbi/playurl', {
    bvid,
    cid,
    qn,
    fnval: 4048,
    fnver: 0,
    fourk: 1,
    platform: 'pc',
    high_quality: 1,
  })

export const getPlayerInfo = (bvid, cid) => signedGet('/x/player/wbi/v2', { bvid, cid })

const SEGMENT_SECONDS = 360
/** Advanced (7), code (8) and BAS (9) danmaku are scripts, not text to scroll. */
const visible = (list) => list.filter((d) => d.mode >= 1 && d.mode <= 6 && d.text)

/**
 * Every danmaku on a part, read from the protobuf segments the official client
 * uses (six minutes per segment). The XML endpoint is only a fallback: it is a
 * capped sample -- 600 of 4,823 on a real video -- which is why the screen
 * looked sparse next to bilibili's own player.
 */
export async function getDanmaku(cid, durationHint = 0) {
  try {
    const items = visible(await getDanmakuSegments(cid, durationHint))
    if (items.length) return items
  } catch {
    // Fall through: a thin screen is better than an empty one.
  }
  return visible(await getDanmakuXml(cid))
}

async function fetchSegment(cid, index) {
  const res = await bili.raw(
    `${ENDPOINTS.api}/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=${index}`,
  )
  const buf = Buffer.from(await res.body.arrayBuffer())
  // Errors come back as JSON rather than protobuf.
  if (buf[0] === 0x7b) throw new Error(`segment ${index}: ${buf.toString('utf8', 0, 120)}`)
  return decodeSegment(buf)
}

async function getDanmakuSegments(cid, durationHint) {
  const all = []
  if (durationHint > 0) {
    const count = Math.ceil(durationHint / SEGMENT_SECONDS)
    // A few at a time: a four-hour stream is 40 segments, and firing them all
    // at once is an easy way to trip rate limiting.
    for (let i = 1; i <= count; i += 4) {
      const batch = []
      for (let j = i; j < i + 4 && j <= count; j++) batch.push(fetchSegment(cid, j))
      for (const seg of await Promise.all(batch)) all.push(...seg)
    }
  } else {
    // No length known: read until a segment comes back empty.
    for (let i = 1; i <= 40; i++) {
      const seg = await fetchSegment(cid, i)
      if (!seg.length) break
      all.push(...seg)
    }
  }
  return all.sort((a, b) => a.time - b.time)
}

/** Legacy XML danmaku -- a capped sample, used only when the segments fail. */
async function getDanmakuXml(cid) {
  const res = await bili.raw(`${ENDPOINTS.api}/x/v1/dm/list.so?oid=${cid}`)
  const buf = Buffer.from(await res.body.arrayBuffer())
  let xml
  try {
    xml = zlib.inflateRawSync(buf).toString('utf8')
  } catch {
    xml = buf.toString('utf8')
  }
  const out = []
  const re = /<d p="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g
  let m
  while ((m = re.exec(xml))) {
    const p = m[1].split(',')
    out.push({
      time: Number(p[0]),
      mode: Number(p[1]),
      size: Number(p[2]),
      color: Number(p[3]),
      sentAt: Number(p[4]) || 0,
      // Field 7 is the danmaku id, needed to like or report an individual one.
      dmid: p[7] || '',
      text: m[2]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"'),
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

/**
 * Danmaku preferences bilibili syncs with the account (font size, opacity,
 * area, full-screen sync), so BiliNext can start out matching the official
 * client. The endpoint is per video, but the setting it carries is not.
 */
export async function getDanmakuSetting(cid, aid) {
  const res = await bili.raw(`${ENDPOINTS.api}/x/v2/dm/web/view?type=1&oid=${cid}&pid=${aid}`)
  const buf = Buffer.from(await res.body.arrayBuffer())
  if (buf[0] === 0x7b) throw new Error(buf.toString('utf8', 0, 120))
  return decodeViewSetting(buf)
}

/**
 * Like counts are not part of the danmaku stream; they come from a separate
 * endpoint keyed by danmaku id, so the player only asks for the handful it is
 * actually showing a menu for.
 */
export const getDanmakuStats = (oid, ids) =>
  bili.get('/x/v2/dm/thumbup/stats', { oid, ids: ids.join(',') })

export const likeDanmaku = (oid, dmid, on = true) =>
  csrfPost('/x/v2/dm/thumbup/add', { oid, dmid, op: on ? 1 : 2 })

export const reportDanmaku = (cid, dmid, reason = 2) =>
  csrfPost('/x/dm/report/add', { cid, dmid, reason })

export const sendDanmaku = ({ bvid, cid, aid, message, progress, color = 16777215, mode = 1 }) =>
  csrfPost('/x/v2/dm/post', {
    type: 1,
    oid: cid,
    bvid,
    aid,
    msg: message,
    progress: Math.round(progress * 1000),
    color,
    fontsize: 25,
    pool: 0,
    mode,
    rnd: Date.now() * 1000,
    plat: 1,
  })

/* ---------------------------------------------------------------- reactions */

export const likeVideo = (bvid, like = true) =>
  csrfPost('/x/web-interface/archive/like', { bvid, like: like ? 1 : 2 })

/**
 * The thumbs-down endpoint is the least stable of the reaction set: bilibili
 * treats it as recommendation feedback rather than a public counter, and it has
 * moved between paths before. Failures are surfaced to the UI, not swallowed,
 * so a break is visible rather than silently pretending to have registered.
 */
export const dislikeVideo = (bvid, dislike = true) =>
  csrfPost('/x/web-interface/archive/dislike', { bvid, dislike: dislike ? 1 : 2 })

export const addCoin = (bvid, multiply = 1, alsoLike = false) =>
  csrfPost('/x/web-interface/coin/add', {
    bvid,
    multiply,
    select_like: alsoLike ? 1 : 0,
    source: 'web_normal',
  })

export const getCoinState = (bvid) => bili.get('/x/web-interface/archive/coins', { bvid })

export const triple = (bvid) => csrfPost('/x/web-interface/archive/like/triple', { bvid })

export const dealFavourite = (aid, addIds = [], delIds = []) =>
  csrfPost('/x/v3/fav/resource/deal', {
    rid: aid,
    type: 2,
    add_media_ids: addIds.join(','),
    del_media_ids: delIds.join(','),
    platform: 'web',
  })

export const followUser = (mid, follow = true) =>
  csrfPost('/x/relation/modify', { fid: mid, act: follow ? 1 : 2, re_src: 11 })

/* ----------------------------------------------------------------- comments */

/** mode 3 = hot ordering, 2 = newest first. */
export const getComments = (oid, { type = 1, mode = 3, next = 0 } = {}) =>
  signedGet('/x/v2/reply/wbi/main', {
    oid,
    type,
    mode,
    next,
    ps: 20,
    plat: 1,
    web_location: 1315875,
  })

export const getCommentReplies = (oid, root, { type = 1, pn = 1 } = {}) =>
  bili.get('/x/v2/reply/reply', { oid, type, root, pn, ps: 20 })

export const addComment = ({ oid, type = 1, message, root, parent, pictures }) =>
  csrfPost('/x/v2/reply/add', {
    oid,
    type,
    message,
    root: root || undefined,
    parent: parent || undefined,
    // pictures is a JSON array of {img_src,img_width,img_height} from upload_bfs
    pictures: pictures?.length ? JSON.stringify(pictures) : undefined,
    plat: 1,
    ordering: 'heat',
  })

export const likeComment = (oid, rpid, on = true, type = 1) =>
  csrfPost('/x/v2/reply/action', { oid, type, rpid, action: on ? 1 : 0 })

export const deleteComment = (oid, rpid, type = 1) =>
  csrfPost('/x/v2/reply/del', { oid, type, rpid })

export const getEmotePanel = () => bili.get('/x/emote/user/panel/web', { business: 'reply' })

/* ---------------------------------------------------------- my account data */

export const getFollowings = (mid, pn = 1, ps = 50) =>
  bili.get('/x/relation/followings', { vmid: mid, pn, ps, order: 'desc' })

export const getFollowers = (mid, pn = 1, ps = 50) =>
  bili.get('/x/relation/followers', { vmid: mid, pn, ps })

export const getFavFolders = (mid) => bili.get('/x/v3/fav/folder/created/list-all', { up_mid: mid })

export const getCollectedFolders = (mid, pn = 1, ps = 20) =>
  bili.get('/x/v3/fav/folder/collected/list', { up_mid: mid, pn, ps, platform: 'web' })

export const getFavContents = (mediaId, pn = 1, ps = 20, keyword = '') =>
  bili.get('/x/v3/fav/resource/list', {
    media_id: mediaId,
    pn,
    ps,
    keyword,
    order: 'mtime',
    type: 0,
    tid: 0,
    platform: 'web',
  })

/** The space listing is risk-controlled; it needs the fingerprint params too. */
export const getMyVideos = (mid, pn = 1, ps = 30) =>
  signedGet('/x/space/wbi/arc/search', {
    mid,
    pn,
    ps,
    order: 'pubdate',
    index: 1,
    platform: 'web',
    web_location: 1550101,
    ...DM_PARAMS,
  })

export const getHistory = (max = 0, viewAt = 0) =>
  bili.get('/x/web-interface/history/cursor', { max, view_at: viewAt, business: 'archive', ps: 20 })

export const getWatchLater = () => bili.get('/x/v2/history/toview')

/**
 * Watch-later writes. Both answer code 0 at once, but the list read lags them
 * by a few seconds: straight after an add, toview can still report the old
 * count, and straight after a delete the video can still be listed. Callers
 * must not re-read to confirm; the UI trusts the write.
 */
export const addWatchLater = (aid) => csrfPost('/x/v2/history/toview/add', { aid })
export const removeWatchLater = (aid) => csrfPost('/x/v2/history/toview/del', { aid })

/**
 * Records how far into a part the user got. This is what makes the official
 * apps list the video in 歷史紀錄 and resume it at the same spot; playing in
 * BiliNext without it leaves no trace on the account at all. Verified against
 * the history read: progress comes back unchanged, view_at moves to now.
 */
export const reportProgress = (aid, cid, progress) =>
  csrfPost('/x/v2/history/report', {
    aid,
    cid,
    progress: Math.max(0, Math.floor(progress)),
    platform: 'web',
  })

export const getUserCard = (mid) => bili.get('/x/web-interface/card', { mid, photo: true })

export const getUserSpace = (mid) => signedGet('/x/space/wbi/acc/info', { mid })

/* ------------------------------------------------- messages & notifications */

export const getUnread = () => bili.get('/x/msgfeed/unread')

export const getReplyMsgs = (cursor = {}) =>
  bili.get('/x/msgfeed/reply', {
    id: cursor.id,
    reply_time: cursor.time,
    platform: 'web',
    build: 0,
    mobi_app: 'web',
  })

export const getAtMsgs = (cursor = {}) =>
  bili.get('/x/msgfeed/at', {
    id: cursor.id,
    at_time: cursor.time,
    platform: 'web',
    build: 0,
    mobi_app: 'web',
  })

export const getLikeMsgs = () =>
  bili.get('/x/msgfeed/like', { platform: 'web', build: 0, mobi_app: 'web' })

export const getSysMsgs = () =>
  bili.get('/x/msgfeed/sysmsg', { platform: 'web', build: 0, mobi_app: 'web' })

export const getSessions = () =>
  bili.get(`${ENDPOINTS.vc}/session_svr/v1/session_svr/get_sessions`, {
    session_type: 1,
    size: 20,
    build: 0,
    mobi_app: 'web',
  })

export const getSessionMsgs = (talkerId, seqno = 0) =>
  bili.get(`${ENDPOINTS.vc}/svr_sync/v1/svr_sync/fetch_session_msgs`, {
    talker_id: talkerId,
    session_type: 1,
    size: 30,
    begin_seqno: seqno,
    build: 0,
    mobi_app: 'web',
  })

export const sendDirectMessage = (senderUid, receiverId, text) =>
  csrfPost(`${ENDPOINTS.vc}/web_im/v1/web_im/send_msg`, {
    'msg[sender_uid]': senderUid,
    'msg[receiver_id]': receiverId,
    'msg[receiver_type]': 1,
    'msg[msg_type]': 1,
    'msg[msg_status]': 0,
    'msg[content]': JSON.stringify({ content: text }),
    'msg[timestamp]': Math.floor(Date.now() / 1000),
    'msg[new_face_version]': 0,
    'msg[dev_id]': 'B9A37BF5-4E17-4F5F-9C1F-6E4B9B0F5E11',
    build: 0,
    mobi_app: 'web',
  })

/* -------------------------------------------------- dynamics (posts) & polls */

export const getDynamics = (offset = '', type = 'all') =>
  bili.get('/x/polymer/web-dynamic/v1/feed/all', {
    type,
    offset,
    timezone_offset: -480,
    page: 1,
  })

/**
 * Backs the dynamics sidebar: the UP list bilibili itself shows, already in
 * "most recently active first" order, with a per-UP `has_update` flag and the
 * subset that are currently live streaming.
 */
export const getDynamicPortal = () => bili.get('/x/polymer/web-dynamic/v1/portal')

export const getSpaceDynamics = (hostMid, offset = '') =>
  bili.get('/x/polymer/web-dynamic/v1/feed/space', {
    host_mid: hostMid,
    offset,
    timezone_offset: -480,
  })

export const getDynamicDetail = (id) =>
  bili.get('/x/polymer/web-dynamic/v1/detail', { id, timezone_offset: -480 })

/**
 * Dynamics go through the newer polymer endpoint, which wants a JSON body and
 * the CSRF token in the query string rather than in the form.
 */
export function createDynamic({ text, pictures = [], voteId }) {
  const csrf = csrfToken()
  const payload = {
    dyn_req: {
      content: { contents: [{ raw_text: text, type: 1, biz_id: '' }] },
      scene: pictures.length ? 2 : 1,
      ...(pictures.length
        ? {
            pics: pictures.map((p) => ({
              img_src: p.img_src,
              img_width: p.img_width,
              img_height: p.img_height,
            })),
          }
        : {}),
      ...(voteId
        ? { attach_card: { common_card: null, vote_card: String(voteId), type: 'VOTE' } }
        : {}),
      option: { up_choose_comment: 0, close_comment: 0 },
      meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
    },
  }
  return bili.postJson(`/x/dynamic/feed/create/dyn?platform=web&csrf=${csrf}`, payload)
}

/** Like a dynamic. `up` is 1 to like and 2 to undo. */
export const likeDynamic = (dynIdStr, on = true) =>
  csrfPost('/x/dynamic/feed/dyn/thumb', { dyn_id_str: dynIdStr, up: on ? 1 : 2 })

/**
 * Reposting reuses the create endpoint; `web_repost_src` is what turns it into
 * a forward rather than a new standalone post.
 */
export function repostDynamic(dynIdStr, text) {
  const csrf = csrfToken()
  return bili.postJson(`/x/dynamic/feed/create/dyn?platform=web&csrf=${csrf}`, {
    dyn_req: {
      content: { contents: [{ raw_text: text || '轉發動態', type: 1, biz_id: '' }] },
      scene: 4,
      option: { up_choose_comment: 0, close_comment: 0 },
      meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
    },
    web_repost_src: { dyn_id_str: String(dynIdStr) },
  })
}

export const getVoteInfo = (voteId) =>
  bili.get(`${ENDPOINTS.vc}/vote_svr/v1/vote_svr/vote_info`, {
    vote_id: voteId,
    build: 0,
    mobi_app: 'web',
  })

export const doVote = (voteId, optionIndexes) =>
  csrfPost(`${ENDPOINTS.vc}/vote_svr/v1/vote_svr/do_vote`, {
    vote_id: voteId,
    votes: optionIndexes.join(','),
    build: 0,
    mobi_app: 'web',
  })

export function createVote({ title, options, choiceCount = 1, durationDays = 7, desc = '' }) {
  const form = {
    info: JSON.stringify({
      title,
      desc,
      type: 0,
      choice_cnt: choiceCount,
      duration: durationDays * 86400,
    }),
    build: 0,
    mobi_app: 'web',
  }
  options.forEach((opt, i) => {
    form[`options[${i}][idx]`] = i + 1
    form[`options[${i}][desc]`] = opt
  })
  return csrfPost(`${ENDPOINTS.vc}/vote_svr/v1/vote_svr/create_vote`, form)
}
