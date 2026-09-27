import * as api from '../bili/api.js'
import { store } from '../util/store.js'
import { currentAccount } from '../bili/client.js'
import { IMG, viaProxy } from '../util/images.js'
import { normaliseDynamic } from '../util/dynamic.js'

/**
 * Normalises the several shapes bilibili uses for a video list item. The feed,
 * search, space and favourite endpoints each name the same fields differently:
 * favourites in particular nest the uploader under `upper` and the counters
 * under `cnt_info`, so reading only `owner`/`stat` silently drops the author.
 */
function normaliseCard(v) {
  const up = v.owner ?? v.upper ?? v.author_info
  return {
    bvid: v.bvid || v.bvId,
    aid: v.aid || v.id,
    cid: v.cid,
    title: (v.title || '').replace(/<[^>]+>/g, ''),
    cover: viaProxy(v.pic || v.cover || v.first_frame, 'image', IMG.cover),
    duration: typeof v.duration === 'string' ? v.duration : v.duration || v.length,
    pubdate: v.pubdate || v.pubtime || v.ctime,
    views: v.stat?.view ?? v.cnt_info?.play ?? v.play ?? v.view,
    danmaku: v.stat?.danmaku ?? v.cnt_info?.danmaku ?? v.video_review ?? v.danmaku,
    author: {
      mid: up?.mid ?? v.mid ?? v.author_id ?? null,
      name: up?.name ?? v.author ?? v.owner_name ?? null,
      face: viaProxy(up?.face ?? v.face, 'image', IMG.avatar) ?? null,
    },
  }
}

export default async function contentRoutes(app) {
  app.get('/api/feed/recommended', async (req, reply) => {
    const page = Math.max(1, Number(req.query.page || 1))
    // Each fresh_idx returns a disjoint batch of ~10, so two per page gives a
    // grid comparable to the other feeds without a second round trip client-side.
    const indexes = [page * 2 - 1, page * 2]

    try {
      const batches = []
      for (const idx of indexes) batches.push(await api.getRecommended(idx))

      const seen = new Set()
      const items = []
      for (const batch of batches) {
        for (const it of batch.item || []) {
          if (!it.bvid || seen.has(it.bvid)) continue
          seen.add(it.bvid)
          items.push(normaliseCard(it))
        }
      }
      if (items.length) return { items, personalised: true }
      reply.log.warn('rcmd returned no usable items; falling back to popular')
    } catch (err) {
      // A genuine outage should not blank the home page, but it must be visible
      // rather than silently masquerading as "you are not logged in".
      reply.log.warn({ code: err.code }, `rcmd failed, falling back to popular: ${err.message}`)
    }

    const popular = await api.getPopular(page)
    return { items: (popular.list || []).map(normaliseCard), personalised: false }
  })

  app.get('/api/feed/popular', async (req) => {
    const data = await api.getPopular(Number(req.query.page || 1))
    return { items: (data.list || []).map(normaliseCard), noMore: data.no_more }
  })

  app.get('/api/feed/ranking', async (req) => {
    const data = await api.getRanking(Number(req.query.rid || 0))
    return { items: (data.list || []).map(normaliseCard) }
  })

  app.get('/api/feed/region', async (req) => {
    const data = await api.getRegionFeed(Number(req.query.rid), Number(req.query.page || 1))
    return { items: (data.archives || []).map(normaliseCard) }
  })

  app.get('/api/feed/following', async (req) => {
    const data = await api.getFollowingFeed(req.query.offset || '', req.query.type || 'all')
    return {
      items: (data.items || []).map((i) => normaliseDynamic(i)).filter(Boolean),
      offset: data.offset,
      hasMore: data.has_more,
    }
  })

  app.get('/api/search', async (req) => {
    const data = await api.search(
      req.query.q,
      Number(req.query.page || 1),
      req.query.type || 'video',
      req.query.order || '',
    )
    return {
      items: (data.result || []).map(normaliseCard),
      total: data.numResults,
      pages: data.numPages,
    }
  })

  app.get('/api/search/suggest', async (req) => ({
    suggestions: await api.searchSuggest(req.query.q || ''),
  }))

  app.get('/api/video/:bvid', async (req) => {
    const { bvid } = req.params
    const loggedIn = Boolean(currentAccount())
    const [detail, relation, coins, watchLater] = await Promise.all([
      api.getVideoDetail(bvid),
      api.getVideoRelation(bvid).catch(() => null),
      api.getCoinState(bvid).catch(() => null),
      // The relation call has no watch-later flag, so membership comes from
      // the list itself. It is short (bilibili caps it), so this stays cheap.
      loggedIn ? api.getWatchLater().catch(() => null) : null,
    ])

    const view = detail.View || detail
    const related = detail.Related || []
    return {
      bvid: view.bvid,
      aid: view.aid,
      cid: view.cid,
      title: view.title,
      desc: view.desc,
      cover: viaProxy(view.pic, 'image', IMG.cover),
      pubdate: view.pubdate,
      duration: view.duration,
      stat: view.stat,
      pages: (view.pages || []).map((p) => ({
        cid: p.cid,
        page: p.page,
        title: p.part,
        duration: p.duration,
      })),
      owner: {
        mid: view.owner?.mid,
        name: view.owner?.name,
        face: viaProxy(view.owner?.face, 'image', IMG.avatar),
        following: detail.Card?.following,
        fans: detail.Card?.card?.fans,
      },
      /** Your own reaction state, so the UI can render it pre-filled. */
      me: {
        liked: Boolean(relation?.like),
        disliked: Boolean(relation?.dislike),
        favoured: Boolean(relation?.favorite),
        coined: coins?.multiply || 0,
        following: Boolean(relation?.attention),
        watchLater: Boolean(watchLater?.list?.some((w) => w.bvid === view.bvid)),
      },
      related: related.map(normaliseCard),
    }
  })

  /**
   * Where the account last stopped in this video, from the same player-info
   * call bilibili's web player makes. last_play_cid says which part that was:
   * a position is only meaningful for the part it was recorded on.
   */
  app.get('/api/video/:bvid/resume', async (req) => {
    if (!currentAccount()) return { cid: null, seconds: 0 }
    const info = await api.getPlayerInfo(req.params.bvid, req.query.cid)
    return {
      cid: info.last_play_cid || null,
      seconds: Math.max(0, (info.last_play_time || 0) / 1000),
    }
  })

  // Keyed on aid + cid in the body rather than a bvid in the path: the player
  // reports a part after navigation may already have moved to another video.
  app.post('/api/history/progress', async (req) => {
    const { aid, cid, progress } = req.body || {}
    if (!aid || !cid || !Number.isFinite(Number(progress))) {
      const err = new Error('aid, cid and progress are required')
      err.statusCode = 400
      throw err
    }
    await api.reportProgress(Number(aid), Number(cid), Number(progress))
    return { ok: true }
  })

  app.get('/api/video/:bvid/playurl', async (req) => {
    const { bvid } = req.params
    const cid = req.query.cid
    const qn = Number(req.query.qn || store.settings.preferredQuality || 80)
    const data = await api.getPlayUrl(bvid, cid, qn)

    // Hand the client proxied urls only; the raw CDN links are useless to it.
    const dash = data.dash
      ? {
          duration: data.dash.duration,
          video: data.dash.video.map((v) => ({
            id: v.id,
            codecs: v.codecs,
            width: v.width,
            height: v.height,
            frameRate: v.frameRate,
            bandwidth: v.bandwidth,
            url: viaProxy(v.baseUrl || v.base_url),
          })),
          audio: (data.dash.audio || []).map((a) => ({
            id: a.id,
            codecs: a.codecs,
            bandwidth: a.bandwidth,
            url: viaProxy(a.baseUrl || a.base_url),
          })),
        }
      : null

    return {
      dash,
      // Fallback for the handful of videos still served as progressive MP4.
      durl: (data.durl || []).map((d) => ({ url: viaProxy(d.url), size: d.size, length: d.length })),
      acceptQuality: data.accept_quality,
      acceptDescription: data.accept_description,
      quality: data.quality,
    }
  })

  app.get('/api/video/:bvid/danmaku', async (req) => ({
    items: await api.getDanmaku(req.query.cid, Number(req.query.duration) || 0),
  }))

  app.get('/api/user/:mid', async (req) => {
    const mid = Number(req.params.mid)
    const [space, card] = await Promise.all([
      api.getUserSpace(mid).catch(() => null),
      api.getUserCard(mid).catch(() => null),
    ])
    return {
      mid,
      name: space?.name || card?.card?.name,
      face: viaProxy(space?.face || card?.card?.face, 'image', IMG.avatar),
      sign: space?.sign || card?.card?.sign,
      level: space?.level,
      fans: card?.follower,
      following: card?.card?.friend,
      archives: card?.archive_count,
    }
  })

  app.get('/api/user/:mid/videos', async (req) => {
    const data = await api.getMyVideos(Number(req.params.mid), Number(req.query.page || 1))
    return {
      items: (data.list?.vlist || []).map(normaliseCard),
      total: data.page?.count,
    }
  })
}

export { normaliseCard }
