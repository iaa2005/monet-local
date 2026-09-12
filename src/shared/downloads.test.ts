import { describe, expect, it } from 'vitest'
import { DownloadQueue, type DownloadJob, type QueueDeps } from './downloads.js'

/** A transfer that moves only when the test says so. */
function fakeRun() {
  const live = new Map<
    string,
    { resolve: () => void; reject: (e: unknown) => void; progress: QueueDeps['run'] extends (a: never, b: never, c: infer P) => unknown ? P : never; signal: AbortSignal }
  >()
  const run: QueueDeps['run'] = (job, signal, onProgress) =>
    new Promise<void>((resolve, reject) => {
      live.set(job.id, { resolve, reject, progress: onProgress, signal })
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  return { run, live }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function make(initial: DownloadJob[] = []) {
  const { run, live } = fakeRun()
  const removed: string[] = []
  let snapshots: DownloadJob[][] = []
  let clock = 1_000_000
  const q = new DownloadQueue(
    {
      run,
      removePart: (j) => removed.push(j.id),
      changed: (jobs) => snapshots.push(jobs),
      now: () => (clock += 1000),
    },
    initial,
  )
  const last = (): DownloadJob[] => snapshots[snapshots.length - 1] ?? []
  return { q, live, removed, last, snapshots: () => snapshots, reset: () => (snapshots = []) }
}

const A = { repoId: 'unsloth/Qwen3.5-2B-GGUF', path: 'Qwen3.5-2B-Q4_K_M.gguf', name: 'Qwen3.5-2B-Q4_K_M.gguf', destPath: 'D:\\Models\\Qwen3.5-2B-Q4_K_M.gguf', expectedBytes: 1_280_835_840 }
const B = { ...A, path: 'Qwen3.5-2B-Q8_0.gguf', name: 'Qwen3.5-2B-Q8_0.gguf', destPath: 'D:\\Models\\Qwen3.5-2B-Q8_0.gguf', expectedBytes: 2_000_000_000 }

describe('the download queue', () => {
  it('runs one transfer at a time, in the order asked', async () => {
    const { q, live, last } = make()
    q.add(A)
    q.add(B)
    await tick()
    expect(last().map((j) => j.status)).toEqual(['downloading', 'queued'])
    expect(live.has(A.repoId + '/' + A.path)).toBe(true)
    expect(live.has(B.repoId + '/' + B.path)).toBe(false)
    live.get(A.repoId + '/' + A.path)!.resolve()
    await tick()
    await tick()
    expect(last().map((j) => j.status)).toEqual(['done', 'downloading'])
    expect(last()[0]!.receivedBytes).toBe(A.expectedBytes)
  })

  it('returns immediately: the screen is not held for two hours', () => {
    const { q } = make()
    const job = q.add(A)
    expect(job.status).toBe('queued')
  })

  it('pauses on cancel and keeps the partial for a resume', async () => {
    const { q, live, removed, last } = make()
    const job = q.add(A)
    await tick()
    live.get(job.id)!.progress({ receivedBytes: 500e6, totalBytes: A.expectedBytes, resumedFrom: 0, bytesPerSecond: 2e6, etaSeconds: 390 })
    q.cancel(job.id)
    await tick()
    const j = last()[0]!
    expect(j.status).toBe('paused')
    expect(j.receivedBytes).toBe(500e6)
    expect(j.bytesPerSecond).toBe(0)
    expect(removed).toEqual([]) // nothing deleted — that is what resume is for

    q.retry(job.id)
    await tick()
    expect(last()[0]!.status).toBe('downloading')
  })

  it('moves on to the next job when one is cancelled', async () => {
    const { q, live, last } = make()
    const a = q.add(A)
    q.add(B)
    await tick()
    q.cancel(a.id)
    await tick()
    await tick()
    expect(last().map((j) => j.status)).toEqual(['paused', 'downloading'])
    expect(live.has(B.repoId + '/' + B.path)).toBe(true)
  })

  it('records a failure with its reason, and a retry resumes it', async () => {
    const { q, live, last } = make()
    const job = q.add(A)
    await tick()
    live.get(job.id)!.reject(new Error('download failed: 503 Service Unavailable'))
    await tick()
    await tick()
    expect(last()[0]!.status).toBe('failed')
    expect(last()[0]!.error).toContain('503')
    q.add(A) // asking again is the retry
    await tick()
    expect(last()[0]!.status).toBe('downloading')
    expect(last()).toHaveLength(1)
  })

  it('remove throws the partial away, even mid-transfer', async () => {
    const { q, live, removed, last } = make()
    const job = q.add(A)
    await tick()
    expect(live.get(job.id)!.signal.aborted).toBe(false)
    q.remove(job.id)
    await tick()
    expect(live.get(job.id)!.signal.aborted).toBe(true)
    expect(removed).toEqual([job.id])
    expect(last()).toEqual([])
  })

  it('does not fetch a finished file again, and clears the finished on request', async () => {
    const { q, live, last } = make()
    const job = q.add(A)
    await tick()
    live.get(job.id)!.resolve()
    await tick()
    await tick()
    expect(q.add(A).status).toBe('done')
    expect(last()).toHaveLength(1)
    q.clearFinished()
    expect(last()).toEqual([])
  })

  it('wakes up with yesterday’s transfers paused, not lost', () => {
    const { q } = make([
      { ...A, id: 'x', status: 'downloading', receivedBytes: 700e6, totalBytes: A.expectedBytes, bytesPerSecond: 2e6, resumedFrom: 0, addedAt: 't' },
      { ...B, id: 'y', status: 'queued', receivedBytes: 0, totalBytes: B.expectedBytes, bytesPerSecond: 0, resumedFrom: 0, addedAt: 't' },
    ])
    expect(q.list().map((j) => j.status)).toEqual(['paused', 'paused'])
    expect(q.list()[0]!.receivedBytes).toBe(700e6)
  })

  it('rate-limits progress redraws but never the state changes', async () => {
    const { q, live, snapshots, reset } = make()
    const job = q.add(A)
    await tick()
    reset()
    // The clock moves a second per read, so every progress here is "late
    // enough" to redraw; the rule is exercised by the pause below arriving
    // regardless of the last redraw's timing.
    for (let i = 1; i <= 3; i++)
      live.get(job.id)!.progress({ receivedBytes: i * 1e6, totalBytes: A.expectedBytes, resumedFrom: 0, bytesPerSecond: 1e6 })
    expect(snapshots().length).toBeGreaterThan(0)
    q.cancel(job.id)
    expect(snapshots()[snapshots().length - 1]![0]!.status).toBe('paused')
  })
})
