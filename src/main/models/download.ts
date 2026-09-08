/**
 * Downloading a model, on a connection that will drop.
 *
 * Two rules, both learned the hard way on this machine at 2 MB/s:
 *
 *   RESUME. A 14 GB file takes two hours here. Starting over because a
 *   laptop slept is not a rounding error, so the partial is kept and the next
 *   attempt asks for the rest with a Range header.
 *
 *   NEVER LAND A PARTIAL IN A MODELS FOLDER. A GGUF header is complete long
 *   before the weights are, so a half-downloaded file looks like a perfectly
 *   good model: it was listed in the library, written into the router's
 *   preset, and died at load time with something unhelpful. The download
 *   lives in `downloads/*.part` and moves only once it is whole.
 */

import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { downloadsDir } from '../app/settings-store.js'

export interface DownloadProgress {
  receivedBytes: number
  totalBytes: number
  /** Bytes already on disk when this attempt started. */
  resumedFrom: number
  bytesPerSecond: number
  /** Seconds left at the current rate, or undefined before one is known. */
  etaSeconds?: number
}

export interface DownloadRequest {
  url: string
  /** Where the finished file goes. */
  destPath: string
  /** Expected size from the catalogue; used to know when it is whole. */
  expectedBytes?: number
  /** LFS sha256, when the repository published one. */
  sha256?: string
  /** For gated repositories. */
  token?: string
  onProgress?: (p: DownloadProgress) => void
  signal?: AbortSignal
}

export class ChecksumError extends Error {
  constructor(expected: string, actual: string) {
    super(`checksum mismatch: expected ${expected}, got ${actual}`)
    this.name = 'ChecksumError'
  }
}

function partPathFor(destPath: string): string {
  mkdirSync(downloadsDir(), { recursive: true })
  return join(downloadsDir(), `${basename(destPath)}.part`)
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * Move the finished file into place.
 *
 * `rename` is atomic and instant, and fails across volumes — the downloads
 * folder is under the user profile on C: while models usually live on another
 * drive, so the copy path is the normal one here, not the exception.
 */
function moveInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to)
    unlinkSync(from)
  }
}

export interface DownloadResult {
  path: string
  bytes: number
  /** Nothing was fetched because the file was already complete. */
  alreadyComplete?: boolean
}

export async function downloadModel(
  req: DownloadRequest,
): Promise<DownloadResult> {
  const { url, destPath, expectedBytes, sha256, token, onProgress, signal } = req

  if (existsSync(destPath) && (!expectedBytes || sizeOf(destPath) === expectedBytes)) {
    return { path: destPath, bytes: sizeOf(destPath), alreadyComplete: true }
  }

  const part = partPathFor(destPath)
  const have = sizeOf(part)

  const headers: Record<string, string> = {}
  if (token) headers['authorization'] = `Bearer ${token}`
  if (have > 0) headers['range'] = `bytes=${have}-`

  const res = await fetch(url, {
    headers,
    ...(signal ? { signal } : {}),
  })

  // 206 means the server honoured the range; 200 means it ignored it and is
  // sending the whole file, so whatever was on disk has to be thrown away
  // rather than appended to.
  const resuming = res.status === 206
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`)
  }
  const startAt = resuming ? have : 0
  const remaining = Number(res.headers.get('content-length') ?? 0)
  const totalBytes = expectedBytes ?? startAt + remaining

  const out = createWriteStream(part, resuming ? { flags: 'a' } : { flags: 'w' })
  const started = Date.now()
  let received = startAt

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk)) {
        // Back-pressure: without this a fast link outruns the disk and the
        // whole 14 GB queues in memory.
        await new Promise<void>((r) => out.once('drain', () => r()))
      }
      received += chunk.length
      const elapsed = (Date.now() - started) / 1000
      const rate = elapsed > 0 ? (received - startAt) / elapsed : 0
      onProgress?.({
        receivedBytes: received,
        totalBytes,
        resumedFrom: startAt,
        bytesPerSecond: rate,
        ...(rate > 0 && totalBytes > received
          ? { etaSeconds: (totalBytes - received) / rate }
          : {}),
      })
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }

  // An interrupted transfer leaves a short file, which is exactly what the
  // next attempt resumes from — so this is a reason to stop, not to delete.
  if (expectedBytes && sizeOf(part) !== expectedBytes) {
    throw new Error(
      `incomplete: ${sizeOf(part)} of ${expectedBytes} bytes — run it again to resume`,
    )
  }

  if (sha256) {
    const actual = await hashFile(part)
    if (actual !== sha256) {
      // A corrupt file must not be resumable: appending to it would never
      // converge. Start clean next time.
      unlinkSync(part)
      throw new ChecksumError(sha256, actual)
    }
  }

  moveInto(part, destPath)
  return { path: destPath, bytes: sizeOf(destPath) }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return hash.digest('hex')
}

/** Partial downloads on disk, so a queue can be resumed after a restart. */
export function pendingDownloads(): { name: string; bytes: number }[] {
  const dir = downloadsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.part'))
    .map((f) => ({ name: f.replace(/\.part$/, ''), bytes: sizeOf(join(dir, f)) }))
}
