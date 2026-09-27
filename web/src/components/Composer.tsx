import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { duration } from '@/lib/format'
import * as I from './Icons'

export type Picture = { img_src: string; img_width: number; img_height: number; preview: string }

type Pack = {
  id: number
  text: string
  icon: string
  type: number
  emotes: { id: number; text: string; url: string; size: number }[]
}

/**
 * The comment box: text, bilibili emotes, image attachments and a one-tap
 * button that stamps the player's current position into the message. Bilibili
 * itself turns "mm:ss" in a comment into a seek link, so inserting the
 * timestamp as plain text is all that is needed for it to work everywhere --
 * here, on the website and in the official app.
 */
export default function Composer({
  onSubmit,
  placeholder = '發一條友善的留言',
  currentTime,
  autoFocus,
  compact,
}: {
  onSubmit: (text: string, pictures: Picture[]) => Promise<void>
  placeholder?: string
  currentTime?: () => number
  autoFocus?: boolean
  compact?: boolean
}) {
  const [text, setText] = useState('')
  const [pictures, setPictures] = useState<Picture[]>([])
  const [showEmotes, setShowEmotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { loggedIn, toast } = useApp()

  const { data: emotePacks } = useQuery<{ packages: Pack[] }>({
    queryKey: ['emotes'],
    queryFn: () => api.get('/api/emotes'),
    enabled: showEmotes && loggedIn,
    staleTime: 60 * 60 * 1000,
  })

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus()
  }, [autoFocus])

  /** Inserts at the caret rather than appending, so emotes land where expected. */
  const insert = (token: string) => {
    const el = areaRef.current
    if (!el) return setText((t) => t + token)
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + token + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + token.length
    })
  }

  const stampTime = () => {
    if (!currentTime) return
    insert(`${duration(Math.floor(currentTime()))} `)
  }

  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return
    for (const file of Array.from(files).slice(0, 4 - pictures.length)) {
      if (!file.type.startsWith('image/')) continue
      try {
        setUploading((n) => n + 1)
        const res = await api.upload('/api/upload/image', file)
        setPictures((p) => [...p, res])
      } catch (err: any) {
        toast(err.message || '圖片上傳失敗', 'error')
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const submit = async () => {
    if (busy || (!text.trim() && !pictures.length)) return
    setBusy(true)
    try {
      await onSubmit(text.trim(), pictures)
      setText('')
      setPictures([])
      setShowEmotes(false)
    } catch (err: any) {
      toast(err.message || '送出失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!loggedIn) {
    return (
      <div className="surface rounded-[var(--radius-card)] px-4 py-3 text-sm dim">登入後即可留言</div>
    )
  }

  return (
    <div className="surface rounded-[var(--radius-card)] overflow-hidden">
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length) {
            e.preventDefault()
            pickImages(e.clipboardData.files)
          }
        }}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter sends; plain Enter keeps making new lines.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
        }}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        className="w-full px-4 pt-3 bg-transparent outline-none resize-none text-sm placeholder:text-[var(--text-dim)]"
      />

      {pictures.length > 0 && (
        <div className="flex gap-2 px-4 pb-2 flex-wrap">
          {pictures.map((p, i) => (
            <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden">
              <img src={p.preview} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => setPictures((list) => list.filter((_, j) => j !== i))}
                aria-label="移除圖片"
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 grid place-items-center"
              >
                <I.Close className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
          {uploading > 0 && <div className="w-20 h-20 rounded-lg skeleton" />}
        </div>
      )}

      {showEmotes && (
        <div className="border-t border-[var(--border)] max-h-56 overflow-y-auto p-2">
          {emotePacks?.packages.map((pack) => (
            <div key={pack.id} className="mb-3">
              <div className="text-[11px] dim px-1 mb-1.5">{pack.text}</div>
              <div className="flex flex-wrap gap-1">
                {pack.emotes.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => insert(e.text)}
                    title={e.text}
                    className="p-1 rounded hover:bg-[var(--surface-2)]"
                  >
                    <img
                      src={e.url}
                      alt={e.text}
                      loading="lazy"
                      className={e.size > 1 ? 'w-11 h-11' : 'w-6 h-6'}
                    />
                  </button>
                ))}
              </div>
            </div>
          )) ?? <div className="text-xs dim p-2">載入表情中…</div>}
        </div>
      )}

      <div className="flex items-center gap-1 px-2 py-2 border-t border-[var(--border)]">
        <button
          onClick={() => setShowEmotes((s) => !s)}
          aria-label="表情"
          aria-pressed={showEmotes}
          className={`w-8 h-8 grid place-items-center rounded-lg hover:bg-[var(--surface-2)] ${
            showEmotes ? 'text-[var(--accent)]' : 'dim'
          }`}
        >
          <I.Smile />
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          aria-label="插入圖片"
          disabled={pictures.length >= 4}
          className="w-8 h-8 grid place-items-center rounded-lg hover:bg-[var(--surface-2)] dim disabled:opacity-40"
        >
          <I.Image />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            pickImages(e.target.files)
            e.target.value = ''
          }}
        />

        {currentTime && (
          <button
            onClick={stampTime}
            className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg hover:bg-[var(--surface-2)] dim text-xs"
            title="插入目前播放時間,點擊留言即可跳轉"
          >
            <I.Clock className="w-4 h-4" />
            標記時間
          </button>
        )}

        <div className="flex-1" />
        <span className="text-[11px] dim tabular-nums mr-1">{text.length}/1000</span>
        <button
          onClick={submit}
          disabled={busy || (!text.trim() && !pictures.length) || text.length > 1000}
          className="h-8 px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--color-pink-deep)] disabled:opacity-40 disabled:hover:bg-[var(--accent)] text-white text-sm font-medium transition-colors"
        >
          {busy ? '送出中…' : '送出'}
        </button>
      </div>
    </div>
  )
}
