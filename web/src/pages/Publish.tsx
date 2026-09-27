import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import Composer, { type Picture } from '@/components/Composer'
import PollCard from '@/components/PollCard'
import * as I from '@/components/Icons'

type Mode = 'video' | 'post' | 'poll'

export default function Publish() {
  const [mode, setMode] = useState<Mode>('video')
  const { loggedIn } = useApp()

  if (!loggedIn) return <div className="p-5 text-sm dim">登入後才能投稿或發文</div>

  return (
    <div className="p-3 sm:p-5 max-w-2xl">
      <h1 className="text-xl font-bold mb-4">建立內容</h1>

      <div className="flex gap-2 mb-5">
        {(
          [
            ['video', '投稿影片'],
            ['post', '發貼文'],
            ['poll', '發起投票'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`px-4 h-9 rounded-full text-sm transition-colors ${
              mode === k ? 'bg-[var(--accent)] text-white' : 'surface hover:border-[var(--accent)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'video' && <VideoUpload />}
      {mode === 'post' && <PostComposer />}
      {mode === 'poll' && <PollCreator />}
    </div>
  )
}

/* ------------------------------------------------------------------- video */

function VideoUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [sendPct, setSendPct] = useState(0)
  const [job, setJob] = useState<any>(null)
  const [cover, setCover] = useState<string>('')
  const [coverBusy, setCoverBusy] = useState(false)
  const [form, setForm] = useState({
    title: '',
    desc: '',
    tid: 122,
    tags: '',
    copyright: 1 as 1 | 2,
    source: '',
  })
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const coverRef = useRef<HTMLInputElement>(null)
  const { toast } = useApp()
  const navigate = useNavigate()

  const { data: cats } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/api/publish/categories'),
  })

  /** Poll the server-side UpOS transfer until it finishes or fails. */
  useEffect(() => {
    if (!jobId) return
    let stop = false
    const tick = async () => {
      if (stop) return
      try {
        const j = await api.get(`/api/publish/upload/${jobId}`)
        setJob(j)
        if (j.stage === 'uploaded' || j.stage === 'error') return
      } catch {
        /* transient; keep polling */
      }
      setTimeout(tick, 1200)
    }
    tick()
    return () => {
      stop = true
    }
  }, [jobId])

  const start = async (f: File) => {
    setFile(f)
    if (!form.title) setForm((s) => ({ ...s, title: f.name.replace(/\.[^.]+$/, '') }))
    try {
      const res = await api.upload('/api/publish/upload', f, setSendPct)
      setJobId(res.jobId)
    } catch (err: any) {
      toast(err.message || '上傳失敗', 'error')
    }
  }

  const uploadCover = async (f: File) => {
    setCoverBusy(true)
    try {
      const res = await api.upload('/api/publish/cover', f)
      setCover(res.url)
    } catch (err: any) {
      toast(err.message || '封面上傳失敗', 'error')
    } finally {
      setCoverBusy(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await api.post('/api/publish/submit', {
        jobId,
        confirm: true,
        title: form.title,
        desc: form.desc,
        tid: form.tid,
        tags: form.tags.split(/[,，\s]+/).filter(Boolean),
        copyright: form.copyright,
        source: form.source,
        cover,
      })
      toast(`投稿成功:${res.bvid}`, 'ok')
      navigate(`/video/${res.bvid}`)
    } catch (err: any) {
      toast(err.message || '投稿失敗', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const ready = job?.stage === 'uploaded'

  return (
    <div className="space-y-4">
      <div className="surface rounded-[var(--radius-card)] border-2 border-dashed p-6 text-center">
        {!file ? (
          <>
            <I.Upload className="w-8 h-8 mx-auto dim mb-2" />
            <p className="text-sm dim mb-3">選擇要投稿的影片檔</p>
            <label className="inline-block px-4 h-9 leading-9 rounded-full bg-[var(--accent)] text-white text-sm font-medium cursor-pointer">
              選擇檔案
              <input
                type="file"
                accept="video/*"
                hidden
                onChange={(e) => e.target.files?.[0] && start(e.target.files[0])}
              />
            </label>
          </>
        ) : (
          <div className="text-left">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs dim mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB</p>

            <div className="mt-3 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] transition-[width] duration-300"
                style={{
                  width: `${job?.stage === 'uploading' || ready ? job?.progress ?? 0 : sendPct * 0.5}%`,
                }}
              />
            </div>
            <p className="text-xs dim mt-1.5">
              {job?.stage === 'error'
                ? `失敗:${job.error}`
                : ready
                  ? '已上傳完成,可以填寫資訊送出'
                  : job?.stage === 'uploading'
                    ? `傳送到 bilibili:${job.progress ?? 0}%`
                    : sendPct < 100
                      ? `傳送到本機伺服器:${sendPct}%`
                      : '準備中…'}
            </p>
          </div>
        )}
      </div>

      <fieldset className="space-y-3 disabled:opacity-50" disabled={!ready}>
        <Field label="標題">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={80}
            className="input"
          />
        </Field>

        <Field label="封面">
          <div className="flex items-center gap-3">
            {cover ? (
              <img
                src={`/api/proxy/image?url=${encodeURIComponent(cover)}`}
                alt=""
                className="w-32 aspect-video object-cover rounded-lg"
              />
            ) : (
              <div className="w-32 aspect-video rounded-lg bg-[var(--surface-2)] grid place-items-center text-xs dim">
                未設定
              </div>
            )}
            <button
              onClick={() => coverRef.current?.click()}
              className="px-3 h-8 rounded-lg surface text-sm"
            >
              {coverBusy ? '上傳中…' : '選擇封面'}
            </button>
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])}
            />
          </div>
        </Field>

        <Field label="分區">
          <select
            value={form.tid}
            onChange={(e) => setForm({ ...form, tid: Number(e.target.value) })}
            className="input"
          >
            {cats?.categories?.map((c: any) => (
              <option key={c.tid} value={c.tid}>
                {c.parent} · {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="類型">
          <div className="flex gap-2">
            {([[1, '自製'], [2, '轉載']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setForm({ ...form, copyright: v })}
                className={`px-4 h-9 rounded-lg text-sm ${
                  form.copyright === v
                    ? 'bg-[var(--accent)] text-white'
                    : 'surface hover:border-[var(--accent)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {form.copyright === 2 && (
          <Field label="轉載來源">
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="原始連結"
              className="input"
            />
          </Field>
        )}

        <Field label="標籤">
          <input
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="用逗號分隔,例如:教學, 程式"
            className="input"
          />
        </Field>

        <Field label="簡介">
          <textarea
            value={form.desc}
            onChange={(e) => setForm({ ...form, desc: e.target.value })}
            rows={4}
            className="input resize-none"
          />
        </Field>

        {/* Publishing to a real account is irreversible, so it takes a deliberate opt-in. */}
        <label className="flex items-start gap-2 text-sm p-3 rounded-[var(--radius-card)] border border-amber-500/30 bg-amber-500/5">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            我了解這會<strong>真的發佈到我的 bilibili 帳號</strong>,且第三方投稿有帳號風險。
          </span>
        </label>

        <button
          onClick={submit}
          disabled={!ready || !confirmed || !form.title.trim() || submitting}
          className="w-full h-11 rounded-[var(--radius-card)] bg-[var(--accent)] text-white font-medium disabled:opacity-40"
        >
          {submitting ? '送出中…' : '確認投稿'}
        </button>
      </fieldset>
    </div>
  )
}

/* -------------------------------------------------------------------- post */

function PostComposer() {
  const { toast } = useApp()
  const [lastId, setLastId] = useState<string | null>(null)

  const submit = async (text: string, pictures: Picture[]) => {
    const res = await api.post('/api/dynamics', { text, pictures })
    setLastId(res.dynamicId)
    toast('貼文已發佈', 'ok')
  }

  return (
    <div className="space-y-3">
      <Composer onSubmit={submit} placeholder="有什麼想分享的?" />
      {lastId && <p className="text-xs dim">已發佈,動態 ID:{lastId}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------- poll */

function PollCreator() {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [choiceCount, setChoiceCount] = useState(1)
  const [days, setDays] = useState(7)
  const [postText, setPostText] = useState('')
  const [created, setCreated] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()

  const valid = title.trim() && options.filter((o) => o.trim()).length >= 2

  const create = async () => {
    setBusy(true)
    try {
      const res = await api.post('/api/vote', {
        title: title.trim(),
        desc: desc.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        choiceCount,
        durationDays: days,
      })
      if (!res.ok) throw new Error(res.error)
      setCreated(res.voteId)
      // A poll is only visible once it is attached to a dynamic.
      await api.post('/api/dynamics', { text: postText.trim() || title.trim(), voteId: res.voteId })
      toast('投票已發佈', 'ok')
    } catch (err: any) {
      toast(err.message || '建立投票失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <div className="space-y-3">
        <PollCard voteId={created} />
        <button
          onClick={() => {
            setCreated(null)
            setTitle('')
            setOptions(['', ''])
          }}
          className="text-sm dim hover:text-[var(--accent)]"
        >
          再建立一個投票
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Field label="投票標題">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className="input" />
      </Field>

      <Field label="說明(選填)">
        <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={100} className="input" />
      </Field>

      <Field label="選項">
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={o}
                onChange={(e) => setOptions(options.map((v, j) => (j === i ? e.target.value : v)))}
                placeholder={`選項 ${i + 1}`}
                maxLength={40}
                className="input flex-1"
              />
              {options.length > 2 && (
                <button
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  aria-label="刪除選項"
                  className="w-9 h-9 grid place-items-center rounded-lg surface hover:text-red-400"
                >
                  <I.Close className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {options.length < 20 && (
            <button
              onClick={() => setOptions([...options, ''])}
              className="text-sm text-[var(--color-cyan-brand)] hover:underline"
            >
              + 新增選項
            </button>
          )}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="可選數量">
          <select
            value={choiceCount}
            onChange={(e) => setChoiceCount(Number(e.target.value))}
            className="input"
          >
            {Array.from({ length: Math.min(options.length, 10) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '單選' : `最多 ${n} 項`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="持續天數">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input">
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} 天
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="附帶貼文內容">
        <input
          value={postText}
          onChange={(e) => setPostText(e.target.value)}
          placeholder="留空則使用投票標題"
          className="input"
        />
      </Field>

      <button
        onClick={create}
        disabled={!valid || busy}
        className="w-full h-11 rounded-[var(--radius-card)] bg-[var(--accent)] text-white font-medium disabled:opacity-40"
      >
        {busy ? '建立中…' : '發佈投票'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs dim mb-1.5">{label}</span>
      {children}
    </label>
  )
}
