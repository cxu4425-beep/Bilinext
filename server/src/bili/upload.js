import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { request } from 'undici'
import { BILI_HEADERS, DATA_DIR } from '../config.js'
import { csrfToken, currentAccount } from './client.js'
import { store } from '../util/store.js'

const TMP = path.join(DATA_DIR, 'uploads')
fs.mkdirSync(TMP, { recursive: true })

/** In-flight upload jobs, polled by the client for progress. */
export const jobs = new Map()

function cookieHeader() {
  return Object.entries(currentAccount()?.cookies || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

const headers = () => ({ ...BILI_HEADERS, cookie: cookieHeader() })

async function json(res) {
  const text = await res.body.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`unexpected upload response: ${text.slice(0, 200)}`)
  }
}

/**
 * Step 1: ask bilibili which UpOS bucket to write to and on what terms. The
 * response dictates chunk size and concurrency; ignoring those values is the
 * usual reason uploads get rejected halfway through.
 */
async function preupload(filename, size) {
  const url = new URL('https://member.bilibili.com/preupload')
  Object.entries({
    zone: 'cn',
    upcdn: 'bda2',
    probe_version: '20221109',
    name: filename,
    r: 'upos',
    profile: 'ugcfx/bup',
    ssl: '0',
    version: '2.14.0',
    build: '2140000',
    size: String(size),
    webVersion: '2.14.0',
  }).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await request(url, { headers: headers() })
  const body = await json(res)
  if (body.OK !== 1) throw new Error(`preupload rejected: ${JSON.stringify(body).slice(0, 200)}`)
  return body
}

async function initUpload(uploadUrl, auth, filename, size) {
  const url = `${uploadUrl}?uploads&output=json&profile=ugcfx%2Fbup&filesize=${size}&partsize=${
    10 * 1024 * 1024
  }&biz_id=`
  const res = await request(url, {
    method: 'POST',
    headers: { ...headers(), 'x-upos-auth': auth },
  })
  return json(res)
}

async function putChunk(uploadUrl, auth, uploadId, chunk, meta) {
  const url = new URL(uploadUrl)
  Object.entries({
    partNumber: meta.partNumber,
    uploadId,
    chunk: meta.index,
    chunks: meta.total,
    size: chunk.length,
    start: meta.start,
    end: meta.end,
    total: meta.fileSize,
  }).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  // Chunk PUTs are the failure-prone part of a long upload: a single dropped
  // connection on a 2GB file should retry, not restart the whole job.
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(url, {
        method: 'PUT',
        headers: { ...headers(), 'x-upos-auth': auth, 'content-type': 'application/octet-stream' },
        body: chunk,
      })
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await res.body.dump()
        return
      }
      lastErr = new Error(`chunk ${meta.partNumber} HTTP ${res.statusCode}`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
  }
  throw lastErr
}

async function finishUpload(uploadUrl, auth, uploadId, filename, bizId, parts) {
  const url = new URL(uploadUrl)
  Object.entries({
    output: 'json',
    name: filename,
    profile: 'ugcfx/bup',
    uploadId,
    biz_id: bizId,
  }).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const res = await request(url, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ parts }),
  })
  return json(res)
}

/**
 * Runs the whole UpOS dance for one local file, reporting progress into the
 * shared job map so the UI can show a real percentage rather than a spinner.
 */
export async function uploadVideoFile(jobId, filePath, filename) {
  const job = jobs.get(jobId)
  const size = fs.statSync(filePath).size
  job.size = size
  job.stage = 'preupload'

  const pre = await preupload(filename, size)
  const endpoint = pre.endpoint.startsWith('//') ? `https:${pre.endpoint}` : pre.endpoint
  const objectKey = pre.upos_uri.replace('upos://', '')
  const uploadUrl = `${endpoint}/${objectKey}`
  const auth = pre.auth
  const chunkSize = pre.chunk_size || 10 * 1024 * 1024
  const concurrency = Math.max(1, Math.min(pre.threads || 3, 6))

  job.stage = 'init'
  const init = await initUpload(uploadUrl, auth, filename, size)
  const uploadId = init.upload_id

  const total = Math.ceil(size / chunkSize)
  const parts = new Array(total)
  let done = 0
  job.stage = 'uploading'
  job.totalChunks = total

  const fd = fs.openSync(filePath, 'r')
  try {
    let next = 0
    const worker = async () => {
      while (true) {
        const i = next++
        if (i >= total) return
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, size)
        const buf = Buffer.alloc(end - start)
        fs.readSync(fd, buf, 0, end - start, start)

        await putChunk(uploadUrl, auth, uploadId, buf, {
          partNumber: i + 1,
          index: i,
          total,
          start,
          end,
          fileSize: size,
        })
        // UpOS accepts a synthesised eTag here; it validates order, not content.
        parts[i] = { partNumber: i + 1, eTag: 'etag' }
        done++
        job.progress = Math.round((done / total) * 100)
        job.uploadedBytes = done * chunkSize
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
  } finally {
    fs.closeSync(fd)
  }

  job.stage = 'finalising'
  await finishUpload(uploadUrl, auth, uploadId, filename, pre.biz_id, parts)

  job.stage = 'uploaded'
  job.progress = 100
  // The submit step refers to the video by its object key minus the extension.
  job.filename = objectKey.split('/').pop().replace(/\.[^.]+$/, '')
  job.cid = pre.biz_id
  return job.filename
}

/** Covers are posted as a base64 data URI, not multipart. */
export async function uploadCover(buffer, mime = 'image/jpeg') {
  const csrf = csrfToken()
  const body = new URLSearchParams({
    cover: `data:${mime};base64,${buffer.toString('base64')}`,
    csrf,
  })
  const res = await request('https://member.bilibili.com/x/vu/web/cover/up', {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const out = await json(res)
  if (out.code !== 0) throw new Error(out.message || 'cover upload failed')
  return out.data.url
}

/**
 * Step 3: create the archive. Everything before this is reversible -- an
 * abandoned UpOS object simply expires. This call is the one that actually
 * publishes to the account, which is why the route behind it demands an
 * explicit confirmation flag from the UI.
 */
export async function submitArchive(meta) {
  const csrf = csrfToken()
  const payload = {
    copyright: meta.copyright === 2 ? 2 : 1,
    videos: [{ filename: meta.filename, title: meta.title, desc: '', cid: meta.cid }],
    source: meta.copyright === 2 ? meta.source || '' : '',
    tid: Number(meta.tid || 122),
    cover: meta.cover || '',
    title: meta.title,
    tag: (meta.tags || []).join(','),
    desc_format_id: 0,
    desc: meta.desc || '',
    dynamic: meta.dynamic || '',
    subtitle: { open: 0, lan: '' },
    interactive: 0,
    // 1 = publish now, 4 = scheduled (dtime required)
    ...(meta.publishAt ? { dtime: Math.floor(meta.publishAt / 1000) } : {}),
    act_reserve_create: 0,
    no_disturbance: 0,
    no_reprint: meta.noReprint ? 1 : 0,
    web_os: 2,
  }

  const res = await request(`https://member.bilibili.com/x/vu/web/add?csrf=${csrf}`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const out = await json(res)
  if (out.code !== 0) throw new Error(`${out.message} (code ${out.code})`)
  return out.data
}

export function newJob() {
  const id = randomUUID()
  jobs.set(id, { id, stage: 'queued', progress: 0, createdAt: Date.now() })
  return id
}

export function tempPath(id, name) {
  return path.join(TMP, `${id}-${path.basename(name).replace(/[^\w.\-]/g, '_')}`)
}

/** Uploads outlive a request but not the disk; clean up finished jobs. */
export function cleanupJob(id) {
  const job = jobs.get(id)
  if (job?.tmp && fs.existsSync(job.tmp)) {
    try {
      fs.unlinkSync(job.tmp)
    } catch {
      /* the OS will reclaim it on next boot at worst */
    }
  }
}
