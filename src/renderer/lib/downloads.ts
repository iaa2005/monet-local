/**
 * The download list, live, for whichever screen wants it.
 *
 * Main owns the queue and pushes the whole list on every change; this hook
 * mirrors it. Two things it also answers: whether anything is moving (the
 * sidebar shows a pill then), and when a file has just finished, so the
 * library can rescan and the new model appears without a click.
 */

import { useEffect, useRef, useState } from 'react'
import type { DownloadJob } from '@shared/downloads.js'
import { api } from '@/lib/api'

export type { DownloadJob }

export function useDownloads(onFinished?: (job: DownloadJob) => void): DownloadJob[] {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const done = useRef<Set<string>>(new Set())
  const finished = useRef(onFinished)
  finished.current = onFinished

  useEffect(() => {
    const apply = (next: DownloadJob[]): void => {
      setJobs(next)
      // A job seen as done for the first time is news; one that was done
      // when the screen opened is not.
      for (const j of next) {
        if (j.status !== 'done') {
          done.current.delete(j.id)
          continue
        }
        if (!done.current.has(j.id)) {
          const first = done.current.size === 0 && jobs.length === 0
          done.current.add(j.id)
          if (!first || j.finishedAt) finished.current?.(j)
        }
      }
    }
    void api()
      ?.hf.downloads()
      .then((list) => {
        // Seed without announcing: what was already finished is history.
        for (const j of list) if (j.status === 'done') done.current.add(j.id)
        setJobs(list)
      })
      .catch(() => undefined)
    return api()?.hf.onDownloads(apply)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return jobs
}

/** What is moving right now, summed: for the sidebar pill. */
export function activeSummary(jobs: DownloadJob[]): {
  active: number
  percent: number
  bytesPerSecond: number
} | null {
  const moving = jobs.filter((j) => j.status === 'downloading' || j.status === 'queued')
  if (moving.length === 0) return null
  const total = moving.reduce((n, j) => n + j.totalBytes, 0)
  const got = moving.reduce((n, j) => n + j.receivedBytes, 0)
  return {
    active: moving.length,
    percent: total > 0 ? Math.floor((got / total) * 100) : 0,
    bytesPerSecond: moving.reduce((n, j) => n + j.bytesPerSecond, 0),
  }
}
