import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useApp } from '@/store/app'

type Folder = {
  id: number
  mediaId: number
  title: string
  count: number
  private: boolean
  isDefault: boolean
}

/**
 * Bilibili's favourite API takes the full add/remove delta in one call, so the
 * dialog tracks the checkbox state and diffs it against what was selected when
 * it opened.
 */
export default function FavouriteDialog({
  aid,
  bvid,
  alreadyFavoured,
  onClose,
  onDone,
}: {
  aid: number
  bvid: string
  alreadyFavoured: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [initial, setInitial] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()

  const { data } = useQuery<{ created: Folder[] }>({
    queryKey: ['favFolders'],
    queryFn: () => api.get('/api/me/favourites'),
  })

  /**
   * The folder listing does not say which folders already contain this video,
   * so an already-favourited video starts with the default folder ticked. That
   * matches what bilibili's own dialog does and makes un-favouriting work.
   */
  useEffect(() => {
    if (!data?.created?.length) return
    const preset = new Set<number>(
      alreadyFavoured ? [data.created.find((f) => f.isDefault)?.mediaId ?? data.created[0].mediaId] : [],
    )
    setInitial(preset)
    setSelected(new Set(preset))
  }, [data, alreadyFavoured])

  const save = async () => {
    const add = [...selected].filter((id) => !initial.has(id))
    const remove = [...initial].filter((id) => !selected.has(id))
    if (!add.length && !remove.length) return onClose()
    setBusy(true)
    try {
      await api.post(`/api/video/${bvid}/favourite`, { aid, add, remove })
      toast(add.length ? '已加入收藏夾' : '已移出收藏夾', 'ok')
      onDone()
    } catch (err: any) {
      toast(err.message || '收藏失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="surface rounded-[10px] p-5 w-full max-w-sm rise"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold mb-3">加入收藏夾</h3>

        <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1">
          {data?.created?.map((f) => (
            <label
              key={f.id}
              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--surface-2)] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(f.mediaId)}
                onChange={(e) => {
                  const next = new Set(selected)
                  e.target.checked ? next.add(f.mediaId) : next.delete(f.mediaId)
                  setSelected(next)
                }}
                className="accent-[var(--accent)]"
              />
              <span className="flex-1 text-sm truncate">{f.title}</span>
              <span className="text-xs dim">{f.count}</span>
              {f.private && <span className="text-[10px] dim">私密</span>}
            </label>
          )) ?? <div className="skeleton h-10 rounded" />}
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg surface text-sm">
            取消
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 h-9 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-40"
          >
            {busy ? '處理中…' : '確定'}
          </button>
        </div>
      </div>
    </div>
  )
}
