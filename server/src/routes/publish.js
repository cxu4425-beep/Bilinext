import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import * as api from '../bili/api.js'
import { IMG, viaProxy } from '../util/images.js'
import {
  cleanupJob,
  jobs,
  newJob,
  submitArchive,
  tempPath,
  uploadCover,
  uploadVideoFile,
} from '../bili/upload.js'

export default async function publishRoutes(app) {
  /* ------------------------------------------------------------------ polls */

  /**
   * vote_svr returns the poll under `info` and the caller's own participation
   * in a sibling `status` field (0 = has not voted, otherwise the option index
   * they picked). Option rows are `{idx, desc, cnt}` -- not the `opt_idx` /
   * `opt_desc` shape used elsewhere in bilibili's APIs.
   */
  app.get('/api/vote/:id', async (req) => {
    const data = await api.getVoteInfo(req.params.id)
    const info = data.info || data
    const endTime = Number(info.endtime) || 0
    return {
      id: info.vote_id,
      title: info.title,
      desc: info.desc || '',
      startTime: Number(info.starttime) || 0,
      endTime,
      joined: Number(info.cnt) || 0,
      choiceCount: Number(info.choice_cnt) || 1,
      creator: {
        mid: info.uid,
        name: info.name,
        face: viaProxy(info.face, 'image', IMG.avatar),
      },
      image: info.img_url ? viaProxy(info.img_url, 'image') : null,
      myVotes: Number(data.status) > 0 ? [Number(data.status)] : [],
      closed: Number(info.status) !== 1 || (endTime > 0 && endTime * 1000 < Date.now()),
      options: (info.options || []).map((o) => ({
        index: o.idx,
        text: o.desc,
        count: Number(o.cnt) || 0,
      })),
    }
  })

  app.post('/api/vote/:id', async (req) => {
    const picks = Array.isArray(req.body.options) ? req.body.options : [req.body.options]
    await api.doVote(req.params.id, picks)
    return { ok: true }
  })

  app.post('/api/vote', async (req) => {
    const { title, options, choiceCount, durationDays, desc } = req.body
    if (!title || !Array.isArray(options) || options.length < 2) {
      return { ok: false, error: '投票需要標題與至少兩個選項' }
    }
    const data = await api.createVote({
      title,
      options,
      choiceCount: Number(choiceCount || 1),
      durationDays: Number(durationDays || 7),
      desc: desc || '',
    })
    return { ok: true, voteId: data.vote_id ?? data.info?.vote_id, raw: data }
  })

  /* --------------------------------------------------------- dynamics/posts */

  app.post('/api/dynamics', async (req) => {
    const { text, pictures = [], voteId } = req.body
    if (!text?.trim() && !pictures.length) return { ok: false, error: '內容不可為空' }
    const data = await api.createDynamic({ text: text || '', pictures, voteId })
    return { ok: true, dynamicId: data.dyn_id_str || data.dyn_id, raw: data }
  })

  /* -------------------------------------------------------------- video 投稿 */

  /**
   * Receives the file and starts the UpOS transfer in the background. Nothing
   * is published by this route -- it only parks bytes in bilibili's staging
   * bucket, so it is safe to retry and safe to abandon.
   */
  app.post('/api/publish/upload', async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no file' })

    const id = newJob()
    const job = jobs.get(id)
    const dest = tempPath(id, file.filename)
    job.tmp = dest
    job.originalName = file.filename

    await pipeline(file.file, fs.createWriteStream(dest))
    if (file.file.truncated) {
      cleanupJob(id)
      jobs.delete(id)
      return reply.code(413).send({ error: '檔案超過大小上限' })
    }

    uploadVideoFile(id, dest, file.filename)
      .then(() => cleanupJob(id))
      .catch((err) => {
        job.stage = 'error'
        job.error = err.message
        cleanupJob(id)
      })

    return { jobId: id }
  })

  app.get('/api/publish/upload/:jobId', async (req, reply) => {
    const job = jobs.get(req.params.jobId)
    if (!job) return reply.code(404).send({ error: 'unknown job' })
    const { tmp, ...safe } = job
    return safe
  })

  app.post('/api/publish/cover', async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'no file' })
    const buf = await file.toBuffer()
    return { url: await uploadCover(buf, file.mimetype) }
  })

  /**
   * The one irreversible step. `confirm` must be sent explicitly so a stray or
   * replayed request can never publish to the account on its own.
   */
  app.post('/api/publish/submit', async (req, reply) => {
    const { jobId, confirm, ...meta } = req.body
    if (confirm !== true) {
      return reply.code(400).send({ error: '缺少確認旗標,拒絕投稿' })
    }
    const job = jobs.get(jobId)
    if (!job) return reply.code(404).send({ error: 'unknown job' })
    if (job.stage !== 'uploaded') {
      return reply.code(409).send({ error: `影片尚未上傳完成(目前:${job.stage})` })
    }
    if (!meta.title?.trim()) return reply.code(400).send({ error: '標題不可為空' })

    const result = await submitArchive({ ...meta, filename: job.filename, cid: job.cid })
    jobs.delete(jobId)
    return { ok: true, bvid: result.bvid, aid: result.aid }
  })

  /** Category ids for the submit form; bilibili has no public listing endpoint. */
  app.get('/api/publish/categories', async () => ({
    categories: [
      { tid: 122, name: '野生技能協會', parent: '知識' },
      { tid: 201, name: '科學科普', parent: '知識' },
      { tid: 124, name: '趣味科普人文', parent: '知識' },
      { tid: 21, name: '日常', parent: '生活' },
      { tid: 76, name: '美食製作', parent: '美食' },
      { tid: 138, name: '搞笑', parent: '生活' },
      { tid: 17, name: '單機遊戲', parent: '遊戲' },
      { tid: 171, name: '電子競技', parent: '遊戲' },
      { tid: 172, name: '手機遊戲', parent: '遊戲' },
      { tid: 27, name: '綜合', parent: '動畫' },
      { tid: 28, name: '原創音樂', parent: '音樂' },
      { tid: 31, name: '翻唱', parent: '音樂' },
      { tid: 20, name: '宅舞', parent: '舞蹈' },
      { tid: 182, name: '影視雜談', parent: '影視' },
      { tid: 95, name: '數碼', parent: '科技' },
      { tid: 231, name: '財經商業', parent: '知識' },
    ],
  }))
}
