import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useApp } from '@/store/app'

export default function DirectMessage() {
  const { talkerId = '' } = useParams()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const { account, toast } = useApp()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['dm', talkerId],
    queryFn: () => api.get(`/api/me/dm/${talkerId}`),
    refetchInterval: 15_000,
  })

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [data])

  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await api.post(`/api/me/dm/${talkerId}`, { text: text.trim() })
      setText('')
      qc.invalidateQueries({ queryKey: ['dm', talkerId] })
    } catch (err: any) {
      toast(err.message || '傳送失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="px-4 py-3 border-b border-[var(--border)] font-medium text-sm">
        與 UID {talkerId} 的對話
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && <div className="skeleton h-16 rounded-[var(--radius-card)]" />}
        {data?.items?.map((m: any) => {
          const mine = String(m.senderUid) === String(account?.mid)
          return (
            <div key={m.seqno} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] px-3.5 py-2 rounded-[10px] text-sm break-words ${
                  mine
                    ? 'bg-[var(--accent)] text-white rounded-br-sm'
                    : 'surface rounded-bl-sm'
                }`}
              >
                {/* Non-text message types (images, cards) are not rendered here. */}
                {m.msgType === 1 ? m.text : <span className="opacity-70">[非文字訊息]</span>}
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      <div className="p-3 border-t border-[var(--border)] flex gap-2 safe-bottom">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="輸入訊息"
          className="input flex-1"
        />
        <button
          onClick={send}
          disabled={!text.trim() || busy}
          className="px-4 h-9 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-40 shrink-0"
        >
          傳送
        </button>
      </div>
    </div>
  )
}
