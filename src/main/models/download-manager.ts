/**
 * The download queue, wired to the disk, the network and the window.
 *
 * One queue for the process. Its list is written to `downloads/queue.json`
 * on every state change so a restart knows what was in flight — the
 * partial files alone say how many bytes there are, not which repository
 * they came from or where they were going.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { downloadUrl } from '@shared/hf.js'
import { DownloadQueue, type DownloadInput, type DownloadJob } from '@shared/downloads.js'
import { getMainWindow } from '../app/main-window.js'
import { downloadsDir } from '../app/settings-store.js'
import { readSettings } from '../app/settings-store.js'
import { downloadModel } from './download.js'

function queuePath(): string {
  return join(downloadsDir(), 'queue.json')
}

function readQueue(): DownloadJob[] {
  try {
    const raw = JSON.parse(readFileSync(queuePath(), 'utf8')) as unknown
    return Array.isArray(raw) ? (raw as DownloadJob[]) : []
  } catch {
    return []
  }
}

function writeQueue(jobs: DownloadJob[]): void {
  try {
    mkdirSync(downloadsDir(), { recursive: true })
    writeFileSync(queuePath(), JSON.stringify(jobs, null, 2), 'utf8')
  } catch (err) {
    console.error('[downloads] could not save the queue', err)
  }
}

function partPath(job: DownloadJob): string {
  return join(downloadsDir(), `${basename(job.destPath)}.part`)
}

let queue: DownloadQueue | null = null
let lastPersisted = ''

export function downloads(): DownloadQueue {
  queue ??= new DownloadQueue(
    {
      run: (job, signal, onProgress) => {
        const token = readSettings().hfToken
        return downloadModel({
          url: downloadUrl(job.repoId, job.path),
          destPath: job.destPath,
          expectedBytes: job.expectedBytes,
          ...(job.sha256 ? { sha256: job.sha256 } : {}),
          ...(token ? { token } : {}),
          onProgress,
          signal,
        }).then(() => undefined)
      },
      removePart: (job) => {
        const p = partPath(job)
        if (existsSync(p)) unlinkSync(p)
      },
      changed: (jobs) => {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) win.webContents.send('hf:downloads', jobs)
        // Progress moves several times a second; the file is for states.
        const key = jobs.map((j) => `${j.id}:${j.status}`).join('|')
        if (key !== lastPersisted) {
          lastPersisted = key
          writeQueue(jobs)
        }
      },
    },
    readQueue(),
  )
  return queue
}

export function enqueueDownload(input: DownloadInput): DownloadJob {
  return downloads().add(input)
}
