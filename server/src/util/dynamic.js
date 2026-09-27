import { IMG, viaProxy } from './images.js'

/**
 * Bilibili describes post text as a list of typed nodes rather than a string,
 * which is what makes topics, @mentions and inline emoji clickable. Flattening
 * it to `desc.text` would lose all of that, so the node list is carried through
 * to the client in a shape it can render directly.
 */
function richNodes(desc) {
  const nodes = desc?.rich_text_nodes?.length
    ? desc.rich_text_nodes
    : desc?.text
      ? [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', text: desc.text }]
      : []

  return nodes.map((n) => {
    switch (n.type) {
      case 'RICH_TEXT_NODE_TYPE_TOPIC':
        return { kind: 'topic', text: n.text, url: n.jump_url }
      case 'RICH_TEXT_NODE_TYPE_AT':
        return { kind: 'at', text: n.text, mid: n.rid }
      case 'RICH_TEXT_NODE_TYPE_EMOJI':
        return {
          kind: 'emoji',
          text: n.text,
          url: viaProxy(n.emoji?.icon_url, 'image'),
          size: n.emoji?.size || 1,
        }
      case 'RICH_TEXT_NODE_TYPE_BV':
      case 'RICH_TEXT_NODE_TYPE_WEB':
      case 'RICH_TEXT_NODE_TYPE_VOTE':
      case 'RICH_TEXT_NODE_TYPE_LOTTERY':
      case 'RICH_TEXT_NODE_TYPE_GOODS':
        return { kind: 'link', text: n.text, url: n.jump_url || '' }
      default:
        return { kind: 'text', text: n.text }
    }
  })
}

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0)

/** live_rcmd hides the useful fields inside a JSON string. */
function parseLiveRcmd(major) {
  const raw = major?.live_rcmd?.content
  if (!raw) return null
  try {
    const info = JSON.parse(raw)?.live_play_info
    if (!info) return null
    return {
      roomId: info.room_id,
      title: info.title,
      cover: viaProxy(info.cover, 'image', IMG.cover),
      areaName: info.area_name,
      watching: num(info.watched_show?.num),
      live: info.live_status === 1,
    }
  } catch {
    return null
  }
}

/**
 * Flattens one dynamic into the fields the feed actually renders. `orig` is
 * followed once: a forward of a forward is displayed by bilibili as a single
 * nested card, and unbounded recursion here would be a denial-of-service on
 * our own renderer.
 */
export function normaliseDynamic(item, depth = 0) {
  if (!item) return null
  const m = item.modules || {}
  const dyn = m.module_dynamic || {}
  const major = dyn.major || {}
  const author = m.module_author || {}
  const stat = m.module_stat || {}

  const archive = major.archive || major.pgc || major.ugc_season
  const draw = major.draw
  const opus = major.opus
  const liveInfo = parseLiveRcmd(major) || (major.live ? { title: major.live?.title } : null)

  return {
    id: item.id_str,
    type: item.type,
    author: {
      mid: author.mid ? String(author.mid) : null,
      name: author.name || '',
      face: viaProxy(author.face, 'image', IMG.avatar),
      pubTime: author.pub_time || '',
      pubTs: num(author.pub_ts),
      // "投稿了视频" / "转发动态" -- shown next to the timestamp, as bilibili does.
      pubAction: author.pub_action || '',
      following: author.following,
    },
    text: richNodes(dyn.desc || opus?.summary),
    title: opus?.title || null,
    video: archive
      ? {
          bvid: archive.bvid,
          cover: viaProxy(archive.cover, 'image', IMG.cover),
          title: archive.title,
          durationText: archive.duration_text || '',
          play: archive.stat?.play || '',
          danmaku: archive.stat?.danmaku || '',
          badge: archive.badge?.text || '',
        }
      : null,
    images: (draw?.items || opus?.pics || []).map((p) => ({
      src: viaProxy(p.src, 'image'),
      width: num(p.width),
      height: num(p.height),
    })),
    live: liveInfo,
    stat: {
      forward: num(stat.forward?.count),
      comment: num(stat.comment?.count),
      like: num(stat.like?.count),
      liked: Boolean(stat.like?.status),
    },
    // Where this post's comment thread lives; the type differs per post kind.
    commentId: item.basic?.comment_id_str || null,
    commentType: item.basic?.comment_type ?? null,
    // A poll attached to the post, so the feed can render it inline.
    voteId: dyn.additional?.type === 'ADDITIONAL_TYPE_VOTE'
      ? dyn.additional.vote?.vote_id ?? null
      : null,
    orig: depth < 1 ? normaliseDynamic(item.orig, depth + 1) : null,
  }
}
