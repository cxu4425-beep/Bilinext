import { FormData, request } from 'undici'
import * as api from '../bili/api.js'
import { BILI_HEADERS } from '../config.js'
import { csrfToken } from '../bili/client.js'
import { store } from '../util/store.js'
import { IMG, viaProxy } from '../util/images.js'

/** Comments and emotes both carry hdslb image urls that need the proxy. */
function normaliseComment(c) {
  if (!c) return null
  return {
    rpid: String(c.rpid),
    oid: String(c.oid),
    parent: String(c.parent || 0),
    root: String(c.root || 0),
    message: c.content?.message || '',
    // Bilibili returns emotes as a name -> descriptor map alongside the text.
    emotes: Object.fromEntries(
      Object.entries(c.content?.emote || {}).map(([k, v]) => [
        k,
        { url: viaProxy(v.url, 'image'), size: v.meta?.size || 1 },
      ]),
    ),
    pictures: (c.content?.pictures || []).map((p) => ({
      src: viaProxy(p.img_src, 'image'),
      width: p.img_width,
      height: p.img_height,
    })),
    jumpUrls: c.content?.jump_url || {},
    like: c.like,
    liked: c.action === 1,
    ctime: c.ctime,
    replyCount: c.rcount,
    member: {
      mid: String(c.member?.mid),
      name: c.member?.uname,
      face: viaProxy(c.member?.avatar, 'image', IMG.avatar),
      level: c.member?.level_info?.current_level,
    },
    replies: (c.replies || []).map(normaliseComment),
    isTop: Boolean(c.up_action?.like) || undefined,
  }
}

export default async function interactRoutes(app) {
  /* ---------------------------------------------------------- video reactions */

  app.post('/api/video/:bvid/like', async (req) => {
    await api.likeVideo(req.params.bvid, req.body.on !== false)
    return { ok: true }
  })

  app.post('/api/video/:bvid/dislike', async (req) => {
    await api.dislikeVideo(req.params.bvid, req.body.on !== false)
    return { ok: true }
  })

  app.post('/api/video/:bvid/coin', async (req) => {
    const n = Math.min(2, Math.max(1, Number(req.body.count || 1)))
    await api.addCoin(req.params.bvid, n, Boolean(req.body.alsoLike))
    return { ok: true, count: n }
  })

  app.post('/api/video/:bvid/triple', async (req) => ({
    ok: true,
    result: await api.triple(req.params.bvid),
  }))

  app.post('/api/video/:bvid/favourite', async (req) => {
    const { aid, add = [], remove = [] } = req.body
    await api.dealFavourite(aid, add, remove)
    return { ok: true }
  })

  app.post('/api/user/:mid/follow', async (req) => {
    await api.followUser(Number(req.params.mid), req.body.on !== false)
    return { ok: true }
  })

  /* ------------------------------------------------------------------ danmaku */

  app.post('/api/video/:bvid/danmaku', async (req) => {
    await api.sendDanmaku({ bvid: req.params.bvid, ...req.body })
    return { ok: true }
  })

  /** Account-synced danmaku preferences; null when logged out or unavailable. */
  app.get('/api/danmaku/setting', async (req) => {
    try {
      return { setting: await api.getDanmakuSetting(req.query.cid, req.query.aid) }
    } catch {
      return { setting: null }
    }
  })

  app.get('/api/danmaku/stats', async (req) => {
    const ids = String(req.query.ids || '').split(',').filter(Boolean)
    if (!ids.length) return { stats: {} }
    const data = await api.getDanmakuStats(req.query.oid, ids)
    return {
      stats: Object.fromEntries(
        Object.entries(data || {}).map(([id, v]) => [
          id,
          { likes: v.likes || 0, liked: v.user_like === 1 },
        ]),
      ),
    }
  })

  app.post('/api/danmaku/like', async (req) => {
    await api.likeDanmaku(req.body.oid, req.body.dmid, req.body.on !== false)
    return { ok: true }
  })

  /** Reporting is visible to moderators, so the UI confirms before calling. */
  app.post('/api/danmaku/report', async (req, reply) => {
    if (req.body.confirm !== true) {
      return reply.code(400).send({ error: '缺少確認旗標,拒絕檢舉' })
    }
    await api.reportDanmaku(req.body.cid, req.body.dmid, Number(req.body.reason) || 2)
    return { ok: true }
  })

  /* ----------------------------------------------------------------- comments */

  app.get('/api/comments', async (req) => {
    const data = await api.getComments(req.query.oid, {
      type: Number(req.query.type || 1),
      mode: Number(req.query.mode || 3),
      next: Number(req.query.next || 0),
    })
    return {
      items: (data.replies || []).map(normaliseComment),
      top: data.top?.upper ? normaliseComment(data.top.upper) : null,
      cursor: {
        next: data.cursor?.next,
        isEnd: data.cursor?.is_end,
        allCount: data.cursor?.all_count,
      },
    }
  })

  app.get('/api/comments/replies', async (req) => {
    const data = await api.getCommentReplies(req.query.oid, req.query.root, {
      type: Number(req.query.type || 1),
      pn: Number(req.query.page || 1),
    })
    return {
      items: (data.replies || []).map(normaliseComment),
      total: data.page?.count,
    }
  })

  app.post('/api/comments', async (req) => {
    const data = await api.addComment(req.body)
    return { ok: true, comment: normaliseComment(data.reply) }
  })

  app.post('/api/comments/like', async (req) => {
    await api.likeComment(req.body.oid, req.body.rpid, req.body.on !== false, req.body.type || 1)
    return { ok: true }
  })

  app.post('/api/comments/delete', async (req) => {
    await api.deleteComment(req.body.oid, req.body.rpid, req.body.type || 1)
    return { ok: true }
  })

  app.get('/api/emotes', async () => {
    const data = await api.getEmotePanel()
    return {
      packages: (data.packages || []).map((p) => ({
        id: p.id,
        text: p.text,
        icon: viaProxy(p.url, 'image'),
        // type 4 packs are large stickers, type 1 are inline [text] emotes.
        type: p.type,
        emotes: (p.emote || []).map((e) => ({
          id: e.id,
          text: e.text,
          url: viaProxy(e.url, 'image'),
          size: e.meta?.size || 1,
        })),
      })),
    }
  })

  /**
   * Comment and dynamic images both go to upload_bfs. We stream the browser's
   * multipart part straight through rather than staging it on disk.
   */
  app.post('/api/upload/image', async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no file' })

    const csrf = csrfToken()
    if (!csrf) return reply.code(401).send({ error: '尚未登入' })

    const buf = await file.toBuffer()
    if (buf.length > 20 * 1024 * 1024) {
      return reply.code(413).send({ error: '圖片過大(上限 20MB)' })
    }

    const form = new FormData()
    form.set('file_up', new Blob([buf], { type: file.mimetype }), file.filename)
    form.set('biz', 'new_dyn')
    form.set('category', 'daily')
    form.set('csrf', csrf)

    const acc = store.activeAccount()
    const cookie = Object.entries(acc?.cookies || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')

    const res = await request('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
      method: 'POST',
      headers: { ...BILI_HEADERS, cookie },
      body: form,
    })
    const body = await res.body.json()
    if (body.code !== 0) return reply.code(400).send({ error: body.message, code: body.code })

    return {
      img_src: body.data.image_url,
      img_width: body.data.image_width,
      img_height: body.data.image_height,
      preview: viaProxy(body.data.image_url, 'image'),
    }
  })
}
