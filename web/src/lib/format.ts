/** 12345 -> "1.2萬", matching how bilibili itself abbreviates counts. */
export function count(n?: number): string {
  if (n === undefined || n === null) return '0'
  if (n < 10_000) return String(n)
  if (n < 100_000_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}萬`
  return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}億`
}

export function duration(seconds?: number | string): string {
  if (typeof seconds === 'string') return seconds
  if (!seconds || seconds < 0) return '0:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const pad = (v: number) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function timeAgo(unixSeconds?: number): string {
  if (!unixSeconds) return ''
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return '剛剛'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  const d = new Date(unixSeconds * 1000)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return sameYear
    ? `${d.getMonth() + 1}-${d.getDate()}`
    : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * Finds video timestamps inside comment text. Bilibili users write these with
 * either an ASCII or a fullwidth colon, and both forms appear constantly in
 * real comment threads, so both are matched.
 */
const TIMESTAMP = /(?<![\d:：])(\d{1,2})[:：](\d{1,2})(?:[:：](\d{1,2}))?(?![\d:：])/g

export type TextPart =
  | { kind: 'text'; value: string }
  | { kind: 'time'; value: string; seconds: number }
  | { kind: 'emote'; name: string }

/** Splits a comment into plain text, [emote] tokens and seekable timestamps. */
export function parseCommentText(message: string, emoteNames: string[] = []): TextPart[] {
  const parts: TextPart[] = []
  const emoteSet = new Set(emoteNames)

  // Emotes are delimited tokens like [doge]; split on them first so a timestamp
  // inside an emote name can never be misread.
  const chunks = message.split(/(\[[^\[\]]{1,30}\])/g)

  for (const chunk of chunks) {
    if (!chunk) continue
    if (emoteSet.has(chunk)) {
      parts.push({ kind: 'emote', name: chunk })
      continue
    }
    let last = 0
    TIMESTAMP.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TIMESTAMP.exec(chunk))) {
      const [full, a, b, c] = m
      const seconds = c
        ? Number(a) * 3600 + Number(b) * 60 + Number(c)
        : Number(a) * 60 + Number(b)
      // A "timestamp" past 24h is almost certainly a score or a date.
      if (seconds > 86_400) continue
      if (m.index > last) parts.push({ kind: 'text', value: chunk.slice(last, m.index) })
      parts.push({ kind: 'time', value: full, seconds })
      last = m.index + full.length
    }
    if (last < chunk.length) parts.push({ kind: 'text', value: chunk.slice(last) })
  }
  return parts
}

export const bvUrl = (bvid: string) => `/video/${bvid}`
