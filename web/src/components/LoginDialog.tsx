import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import * as I from './Icons'

type Status = 'loading' | 'waiting' | 'scanned' | 'expired' | 'ok' | 'error'

/**
 * QR login is the only sign-in path this client offers. Your password is typed
 * into the official bilibili app and never passes through here -- the server
 * only ever receives the session cookies that the scan produces.
 */
export default function LoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')
  // Bumping this re-runs the effect, which is how "regenerate" gets a fresh code.
  const [attempt, setAttempt] = useState(0)
  const { refreshMe, toast } = useApp()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let timer: number

    const run = async () => {
      setStatus('loading')
      setMessage('')
      try {
        const { url, key } = await api.get('/api/auth/qr')
        if (cancelled) return
        await QRCode.toCanvas(canvas.current!, url, {
          width: 216,
          margin: 1,
          color: { dark: '#0b0d13', light: '#ffffff' },
        })
        setStatus('waiting')

        const poll = async () => {
          if (cancelled) return
          try {
            const res = await api.get('/api/auth/qr/poll', { params: { key } })
            if (cancelled) return
            if (res.status === 'ok') {
              setStatus('ok')
              await refreshMe()
              toast(`已登入:${res.account?.name ?? ''}`, 'ok')
              setTimeout(onClose, 700)
              return
            }
            if (res.code === 86038) {
              setStatus('expired')
              return
            }
            setStatus(res.code === 86090 ? 'scanned' : 'waiting')
            setMessage(res.message || '')
            timer = window.setTimeout(poll, 1800)
          } catch (err: any) {
            setStatus('error')
            setMessage(err.message || '連線失敗')
          }
        }
        timer = window.setTimeout(poll, 1500)
      } catch (err: any) {
        setStatus('error')
        setMessage(err.message || '無法取得 QR code')
      }
    }

    run()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, attempt, refreshMe, toast, onClose])

  if (!open) return null

  const label: Record<Status, string> = {
    loading: '產生 QR code…',
    waiting: '請用 bilibili App 掃描',
    scanned: '已掃描,請在手機上確認',
    expired: 'QR code 已過期',
    ok: '登入成功',
    error: message || '發生錯誤',
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="掃碼登入"
    >
      <div
        className="surface rounded-[10px] p-6 w-full max-w-sm rise relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="關閉"
          className="absolute top-3 right-3 w-8 h-8 grid place-items-center rounded-full hover:bg-[var(--surface-2)]"
        >
          <I.Close className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-center mb-1">掃碼登入</h2>
        <p className="text-xs dim text-center mb-5">
          密碼只輸入在官方 App,本程式僅取得登入後的憑證
        </p>

        <div className="relative mx-auto w-[216px] h-[216px] rounded-[var(--radius-card)] overflow-hidden bg-white grid place-items-center">
          <canvas ref={canvas} />
          {(status === 'expired' || status === 'scanned' || status === 'ok') && (
            <div className="absolute inset-0 bg-black/75 grid place-items-center text-white text-sm gap-3 px-4 text-center">
              <span>{label[status]}</span>
              {status === 'expired' && (
                <button
                  onClick={() => setAttempt((n) => n + 1)}
                  className="px-4 h-8 rounded-full bg-[var(--accent)] text-sm font-medium"
                >
                  重新產生
                </button>
              )}
            </div>
          )}
        </div>

        <p
          className={`mt-4 text-center text-sm ${
            status === 'error' ? 'text-red-400' : status === 'ok' ? 'text-emerald-400' : 'dim'
          }`}
        >
          {label[status]}
        </p>
      </div>
    </div>
  )
}
