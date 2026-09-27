import { useApp } from '@/store/app'

const tones = {
  ok: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300',
  error: 'border-red-500/40 bg-red-500/12 text-red-300',
  info: 'border-[var(--border)] bg-[var(--surface)]',
}

export default function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div
      className="fixed z-[60] bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto rise w-full px-4 py-2.5 rounded-[var(--radius-card)] border backdrop-blur-md text-sm text-left shadow-lg ${tones[t.tone]}`}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}
