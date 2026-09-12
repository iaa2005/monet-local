/**
 * The download queue: what is being fetched, what is waiting, what stopped.
 *
 * The first downloader was one IPC call that returned when the file was
 * whole. At 2 MB/s that is two hours during which the screen was disabled,
 * a second model could not be queued, and leaving the screen threw away the
 * only view of the progress — the transfer itself carried on in main, with
 * nobody able to see or stop it. So the queue lives in main and is a LIST:
 * every job has a state, the list is pushed to the renderer on every change,
 * and any screen can show it.
 *
 * One transfer at a time. Two would share the same link and each take twice
 * as long; a queue finishes the first model sooner, which is the one that
 * was wanted first.
 *
 * Pure: the fetching, the disk and the window are handed in, so the states
 * can be tested with a fake transfer that resolves when told to.
 */

import type { DownloadProgress } from '../main/models/download.js'

export type DownloadStatus =
  /** Waiting for its turn. */
  | 'queued'
  | 'downloading'
  /** In a model folder, whole. */
  | 'done'
  /** Stopped by the user or by a restart; the partial is kept and resumes. */
  | 'paused'
  /** Stopped by an error; the reason is in `error`. Retry resumes. */
  | 'failed'

export interface DownloadJob {
  /** `repoId/path` — one job per file, however many times it is asked for. */
  id: string
  repoId: string
  path: string
  /** The file name, which is what the row shows. */
  name: string
  destPath: string
  expectedBytes: number
  sha256?: string
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number
  bytesPerSecond: number
  etaSeconds?: number
  resumedFrom: number
  error?: string
  addedAt: string
  finishedAt?: string
}

export type DownloadInput = Pick<
  DownloadJob,
  'repoId' | 'path' | 'name' | 'destPath' | 'expectedBytes' | 'sha256'
>

export interface QueueDeps {
  /** Fetch the file; reject to fail, or reject after `signal` fires to pause. */
  run: (
    job: DownloadJob,
    signal: AbortSignal,
    onProgress: (p: DownloadProgress) => void,
  ) => Promise<void>
  /** Delete the partial file, if any. */
  removePart: (job: DownloadJob) => void
  /** The list, every time it changes. Progress is rate-limited to a few a second. */
  changed: (jobs: DownloadJob[]) => void
  now?: () => number
}

/** How often a moving transfer is allowed to redraw the list. */
const PROGRESS_EVERY_MS = 250

export function jobId(repoId: string, path: string): string {
  return `${repoId}/${path}`
}

export class DownloadQueue {
  private jobs: DownloadJob[]
  private readonly controllers = new Map<string, AbortController>()
  private running = false
  private lastProgressAt = 0

  constructor(
    private readonly deps: QueueDeps,
    initial: DownloadJob[] = [],
  ) {
    // A restart ends every transfer it does not remember starting: whatever
    // was queued or moving is paused, resumable from its partial.
    this.jobs = initial.map((j) =>
      j.status === 'queued' || j.status === 'downloading'
        ? { ...j, status: 'paused', bytesPerSecond: 0 }
        : { ...j },
    )
  }

  list(): DownloadJob[] {
    return this.jobs.map((j) => ({ ...j }))
  }

  /**
   * Queue a file. Asking twice does not fetch twice: a job that is done
   * stays done, one that is moving keeps moving, and a stopped one starts
   * again from where it stopped.
   */
  add(input: DownloadInput): DownloadJob {
    const id = jobId(input.repoId, input.path)
    const existing = this.jobs.find((j) => j.id === id)
    if (existing) {
      if (existing.status === 'paused' || existing.status === 'failed') this.retry(id)
      return { ...this.find(id) }
    }
    const job: DownloadJob = {
      ...input,
      id,
      status: 'queued',
      receivedBytes: 0,
      totalBytes: input.expectedBytes,
      bytesPerSecond: 0,
      resumedFrom: 0,
      addedAt: new Date(this.now()).toISOString(),
    }
    this.jobs.push(job)
    this.emit()
    this.pump()
    return { ...job }
  }

  /** Stop a transfer and keep the partial. Nothing is lost; retry resumes. */
  cancel(id: string): void {
    const job = this.find(id)
    if (job.status === 'downloading') {
      this.controllers.get(id)?.abort()
      // The runner's rejection turns it into `paused`; the state flips here
      // as well so the row answers the click before the stream unwinds.
      this.set(id, { status: 'paused', bytesPerSecond: 0, etaSeconds: undefined })
    } else if (job.status === 'queued') {
      this.set(id, { status: 'paused' })
    }
  }

  retry(id: string): void {
    const job = this.find(id)
    if (job.status !== 'paused' && job.status !== 'failed') return
    this.set(id, { status: 'queued', error: undefined, bytesPerSecond: 0, etaSeconds: undefined })
    this.pump()
  }

  /** Forget the job and throw its partial away. A finished file stays. */
  remove(id: string): void {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return
    if (job.status === 'downloading') this.controllers.get(id)?.abort()
    if (job.status !== 'done') this.deps.removePart(job)
    this.jobs = this.jobs.filter((j) => j.id !== id)
    this.emit()
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.status !== 'done')
    this.emit()
  }

  private find(id: string): DownloadJob {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) throw new Error(`unknown download ${id}`)
    return job
  }

  private set(id: string, patch: Partial<DownloadJob>): void {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j))
    this.emit()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private emit(): void {
    this.lastProgressAt = this.now()
    this.deps.changed(this.list())
  }

  private pump(): void {
    if (this.running) return
    const next = this.jobs.find((j) => j.status === 'queued')
    if (!next) return
    this.running = true
    const controller = new AbortController()
    this.controllers.set(next.id, controller)
    this.set(next.id, { status: 'downloading', error: undefined })
    void this.deps
      .run(this.find(next.id), controller.signal, (p) => {
        // A cancelled transfer still drains a chunk or two; those must not
        // pull the row back to "downloading".
        if (controller.signal.aborted) return
        const patch: Partial<DownloadJob> = {
          receivedBytes: p.receivedBytes,
          totalBytes: p.totalBytes,
          bytesPerSecond: p.bytesPerSecond,
          resumedFrom: p.resumedFrom,
          etaSeconds: p.etaSeconds,
        }
        if (this.now() - this.lastProgressAt < PROGRESS_EVERY_MS) {
          this.jobs = this.jobs.map((j) => (j.id === next.id ? { ...j, ...patch } : j))
        } else {
          this.set(next.id, patch)
        }
      })
      .then(() => {
        this.set(next.id, {
          status: 'done',
          receivedBytes: this.find(next.id).totalBytes,
          bytesPerSecond: 0,
          etaSeconds: undefined,
          finishedAt: new Date(this.now()).toISOString(),
        })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          // Cancelled or removed. Removed: the job is gone already.
          if (this.jobs.some((j) => j.id === next.id))
            this.set(next.id, { status: 'paused', bytesPerSecond: 0, etaSeconds: undefined })
          return
        }
        this.set(next.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          bytesPerSecond: 0,
          etaSeconds: undefined,
        })
      })
      .finally(() => {
        this.controllers.delete(next.id)
        this.running = false
        this.pump()
      })
  }
}
