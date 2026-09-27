import { ApiError } from '@/api/client'

/**
 * Feed pages previously rendered an empty grid whenever a query failed, which
 * is indistinguishable from "this feed is genuinely empty". This turns both
 * cases into something a person can act on.
 */
export default function QueryState({
  error,
  isLoading,
  isEmpty,
  onRetry,
  emptyText = '這裡目前沒有內容',
}: {
  error?: unknown
  isLoading?: boolean
  isEmpty?: boolean
  onRetry?: () => void
  emptyText?: string
}) {
  if (isLoading) return null

  if (error) {
    const e = error as ApiError
    const offline = e?.offline
    return (
      <div className="py-14 text-center">
        <p className="text-sm font-medium mb-1">
          {offline ? '連不上本機伺服器' : '載入失敗'}
        </p>
        <p className="text-xs dim mb-4 max-w-sm mx-auto">
          {offline
            ? '後端沒在跑。執行 start-bilinext.cmd 或 npm start 後再試一次。'
            : e?.message || '未知錯誤'}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-5 h-9 rounded-full surface hover:border-[var(--accent)] text-sm transition-colors"
          >
            重試
          </button>
        )}
      </div>
    )
  }

  if (isEmpty) return <p className="py-14 text-center text-sm dim">{emptyText}</p>
  return null
}
