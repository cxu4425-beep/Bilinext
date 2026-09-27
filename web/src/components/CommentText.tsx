import { parseCommentText } from '@/lib/format'

export type Emotes = Record<string, { url: string; size: number }>

/**
 * Renders one comment body: inline emote images, and timestamps turned into
 * buttons that jump the player. Everything else stays plain text -- comment
 * content is untrusted, so nothing here is ever injected as HTML.
 */
export default function CommentText({
  message,
  emotes,
  onSeek,
}: {
  message: string
  emotes?: Emotes
  onSeek?: (seconds: number) => void
}) {
  const parts = parseCommentText(message, Object.keys(emotes || {}))

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (p.kind === 'emote') {
          const e = emotes?.[p.name]
          if (!e) return <span key={i}>{p.name}</span>
          return (
            <img
              key={i}
              src={e.url}
              alt={p.name}
              title={p.name}
              loading="lazy"
              className="inline-block align-text-bottom mx-0.5"
              style={{ height: e.size > 1 ? '2.5em' : '1.35em' }}
            />
          )
        }
        if (p.kind === 'time') {
          return onSeek ? (
            <button
              key={i}
              onClick={() => onSeek(p.seconds)}
              className="text-[var(--color-cyan-brand)] hover:underline font-medium tabular-nums"
              title={`跳到 ${p.value}`}
            >
              {p.value}
            </button>
          ) : (
            <span key={i} className="text-[var(--color-cyan-brand)] tabular-nums">
              {p.value}
            </span>
          )
        }
        return <span key={i}>{p.value}</span>
      })}
    </span>
  )
}
