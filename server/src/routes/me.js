import * as api from '../bili/api.js'
import { store } from '../util/store.js'
import { normaliseCard } from './content.js'
import { IMG, viaProxy } from '../util/images.js'
import { normaliseDynamic } from '../util/dynamic.js'

function requireMid(reply) {
  const acc = store.activeAccount()
  if (!acc) {
    reply.code(401).send({ error: '尚未登入' })
    return null
  }
  return Number(acc.mid)
}

export default async function meRoutes(app) {
  /* ---------------------------------------------------------------- following */

  app.get('/api/me/followings', async (req, reply) => {
    const mid = requireMid(reply)
    if (!mid) return
    const data = await api.getFollowings(mid, Number(req.query.page || 1))
    return {
      total: data.total,
      items: (data.list || []).map((u) => ({
        mid: u.mid,
        name: u.uname,
        face: viaProxy(u.face, 'image', IMG.avatar),
        sign: u.sign,
        // 特别关注 lives in this bitmask; worth surfacing in the UI.
        special: u.special === 1,
        followedAt: u.mtime,
      })),
    }
  })

  app.get('/api/me/followers', async (req, reply) => {
    const mid = requireMid(reply)
    if (!mid) return
    const data = await api.getFollowers(mid, Number(req.query.page || 1))
    return {
      total: data.total,
      items: (data.list || []).map((u) => ({
        mid: u.mid,
        name: u.uname,
        face: viaProxy(u.face, 'image', IMG.avatar),
        sign: u.sign,
      })),
    }
  })

  /* ------------------------------------------------------------- favourites */

  app.get('/api/me/favourites', async (req, reply) => {
    const mid = requireMid(reply)
    if (!mid) return
    const [created, collected] = await Promise.all([
      api.getFavFolders(mid).catch(() => ({ list: [] })),
      api.getCollectedFolders(mid).catch(() => ({ list: [] })),
    ])
    const map = (f) => ({
      id: f.id,
      mediaId: f.id ?? f.fid,
      title: f.title,
      count: f.media_count,
      cover: viaProxy(f.cover, 'image', IMG.folder),
      // 0 = private, 1 = public; the default folder also carries attr bit 1.
      private: Boolean(f.attr & 1),
      isDefault: (f.attr & 2) === 0,
      owner: f.upper?.name,
    })
    return {
      created: (created?.list || []).map(map),
      collected: (collected?.list || []).map(map),
    }
  })

  app.get('/api/me/favourites/:mediaId', async (req) => {
    const data = await api.getFavContents(
      req.params.mediaId,
      Number(req.query.page || 1),
      20,
      req.query.q || '',
    )
    return {
      info: data.info
        ? {
            title: data.info.title,
            count: data.info.media_count,
            cover: viaProxy(data.info.cover, 'image', IMG.folder),
            intro: data.info.intro,
          }
        : null,
      items: (data.medias || []).map((m) => ({
        ...normaliseCard(m),
        favTime: m.fav_time,
        // Deleted / privated videos stay in the folder as tombstones.
        available: m.attr === 0,
      })),
      hasMore: data.has_more,
    }
  })

  /* ---------------------------------------------------- my videos & history */

  app.get('/api/me/videos', async (req, reply) => {
    const mid = requireMid(reply)
    if (!mid) return
    const data = await api.getMyVideos(mid, Number(req.query.page || 1))
    return { items: (data.list?.vlist || []).map(normaliseCard), total: data.page?.count }
  })

  app.get('/api/me/history', async (req) => {
    const data = await api.getHistory(Number(req.query.max || 0), Number(req.query.viewAt || 0))
    return {
      items: (data.list || []).map((h) => ({
        bvid: h.history?.bvid,
        title: h.title,
        cover: viaProxy(h.cover, 'image', IMG.cover),
        author: { mid: h.author_mid, name: h.author_name },
        progress: h.progress,
        duration: h.duration,
        viewAt: h.view_at,
      })),
      cursor: data.cursor,
    }
  })

  app.get('/api/me/watchlater', async (req, reply) => {
    if (!requireMid(reply)) return
    const data = await api.getWatchLater()
    return {
      items: (data.list || []).map((w) => ({
        ...normaliseCard(w),
        // Seconds into the video; bilibili uses -1 for "watched to the end".
        progress: w.progress,
        addedAt: w.add_at,
        parts: w.videos,
        // Deleted or privated videos stay in the list as tombstones.
        available: w.state === 0 || w.state === undefined,
      })),
      count: data.count,
    }
  })

  app.post('/api/me/watchlater', async (req, reply) => {
    if (!requireMid(reply)) return
    await api.addWatchLater(Number(req.body.aid))
    return { ok: true }
  })

  app.post('/api/me/watchlater/remove', async (req, reply) => {
    if (!requireMid(reply)) return
    await api.removeWatchLater(Number(req.body.aid))
    return { ok: true }
  })

  /* ------------------------------------------------------- messages & alerts */

  app.get('/api/me/unread', async () => {
    const data = await api.getUnread().catch(() => ({}))
    return {
      at: data.at || 0,
      like: data.like || 0,
      reply: data.reply || 0,
      systemMsg: data.sys_msg || 0,
      dm: data.up || 0,
    }
  })

  app.get('/api/me/messages/replies', async (req) => {
    const data = await api.getReplyMsgs({ id: req.query.id, time: req.query.time })
    return {
      items: (data.items || []).map((m) => ({
        id: m.id,
        type: 'reply',
        user: { mid: m.user?.mid, name: m.user?.nickname, face: viaProxy(m.user?.avatar, 'image', IMG.avatar) },
        text: m.item?.source_content,
        target: m.item?.title,
        uri: m.item?.uri,
        nativeUri: m.item?.native_uri,
        time: m.reply_time,
      })),
      cursor: data.cursor,
    }
  })

  app.get('/api/me/messages/at', async (req) => {
    const data = await api.getAtMsgs({ id: req.query.id, time: req.query.time })
    return {
      items: (data.items || []).map((m) => ({
        id: m.id,
        type: 'at',
        user: { mid: m.user?.mid, name: m.user?.nickname, face: viaProxy(m.user?.avatar, 'image', IMG.avatar) },
        text: m.item?.source_content,
        target: m.item?.title,
        uri: m.item?.uri,
        time: m.at_time,
      })),
      cursor: data.cursor,
    }
  })

  app.get('/api/me/messages/likes', async () => {
    const data = await api.getLikeMsgs()
    const map = (m) => ({
      id: m.id,
      type: 'like',
      users: (m.users || []).map((u) => ({
        mid: u.mid,
        name: u.nickname,
        face: viaProxy(u.avatar, 'image', IMG.avatar),
      })),
      target: m.item?.title,
      uri: m.item?.uri,
      time: m.like_time,
    })
    return {
      latest: (data.latest?.items || []).map(map),
      total: (data.total?.items || []).map(map),
    }
  })

  app.get('/api/me/messages/system', async () => {
    const data = await api.getSysMsgs().catch(() => ({ items: [] }))
    return {
      items: (data.items || []).map((m) => ({
        id: m.id,
        title: m.title,
        text: m.content,
        time: m.time_at,
        type: 'system',
      })),
    }
  })

  app.get('/api/me/dm/sessions', async () => {
    const data = await api.getSessions().catch(() => ({ session_list: [] }))
    return {
      items: (data.session_list || []).map((s) => ({
        talkerId: s.talker_id,
        unread: s.unread_count,
        lastText: (() => {
          try {
            return JSON.parse(s.last_msg?.content || '{}').content || ''
          } catch {
            return ''
          }
        })(),
        time: Math.floor((s.session_ts || 0) / 1_000_000),
      })),
    }
  })

  app.get('/api/me/dm/:talkerId', async (req) => {
    const data = await api.getSessionMsgs(req.params.talkerId, Number(req.query.seqno || 0))
    return {
      items: (data.messages || [])
        .map((m) => ({
          seqno: m.msg_seqno,
          senderUid: m.sender_uid,
          text: (() => {
            try {
              return JSON.parse(m.content || '{}').content || ''
            } catch {
              return m.content
            }
          })(),
          time: m.timestamp,
          msgType: m.msg_type,
        }))
        .reverse(),
    }
  })

  app.post('/api/me/dm/:talkerId', async (req, reply) => {
    const mid = requireMid(reply)
    if (!mid) return
    await api.sendDirectMessage(mid, Number(req.params.talkerId), req.body.text)
    return { ok: true }
  })

  /* --------------------------------------------------------------- dynamics */

  app.get('/api/dynamics', async (req) => {
    const data = await api.getDynamics(req.query.offset || '', req.query.type || 'all')
    return {
      items: (data.items || []).map((i) => normaliseDynamic(i)).filter(Boolean),
      raw: data.items || [],
      offset: data.offset,
      hasMore: data.has_more,
    }
  })

  app.get('/api/dynamics/portal', async (req, reply) => {
    if (!requireMid(reply)) return
    const data = await api.getDynamicPortal()
    const liveItems = (data.live_users?.items || []).map((u) => ({
      mid: String(u.mid),
      name: u.uname,
      face: viaProxy(u.face, 'image', IMG.avatar),
      roomId: String(u.room_id),
      title: u.title,
      url: u.jump_url,
    }))
    const live = new Map(liveItems.map((u) => [u.mid, { roomId: u.roomId, title: u.title }]))
    return {
      me: data.my_info
        ? {
            mid: data.my_info.mid,
            name: data.my_info.name,
            face: viaProxy(data.my_info.face, 'image', IMG.avatar),
            following: Number(data.my_info.following) || 0,
          }
        : null,
      ups: (data.up_list || []).map((u) => ({
        mid: String(u.mid),
        name: u.uname,
        face: viaProxy(u.face, 'image', IMG.avatar),
        hasUpdate: Boolean(u.has_update),
        live: live.get(String(u.mid)) || null,
      })),
      liveUsers: liveItems,
      liveCount: data.live_users?.count ?? liveItems.length,
    }
  })

  app.get('/api/dynamics/space/:mid', async (req) => {
    const data = await api.getSpaceDynamics(Number(req.params.mid), req.query.offset || '')
    return {
      items: (data.items || []).map((i) => normaliseDynamic(i)).filter(Boolean),
      offset: data.offset,
      hasMore: data.has_more,
    }
  })

  app.get('/api/dynamics/:id', async (req) => ({ item: await api.getDynamicDetail(req.params.id) }))

  app.post('/api/dynamics/:id/like', async (req) => {
    await api.likeDynamic(req.params.id, req.body.on !== false)
    return { ok: true }
  })

  app.post('/api/dynamics/:id/repost', async (req) => {
    const data = await api.repostDynamic(req.params.id, req.body.text || '')
    return { ok: true, dynamicId: data?.dyn_id_str || data?.dyn_id || null }
  })
}
