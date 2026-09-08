/**
 * Finding llama-server processes that are not ours.
 *
 * Two of them fighting over the same RAM is not a hypothetical: it happened
 * here, and the symptom was 103 MB of free memory and 300,000 page faults a
 * second while both crawled. Nothing in the log said why, because from each
 * process's point of view nothing was wrong.
 *
 * So: before starting, look. Tell the user what is already running and offer
 * to stop it, rather than adding a second claimant to 16 GB of weights.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(exec)

export interface StrayProcess {
  pid: number
  /** Resident memory, when the platform reports it. */
  rssBytes?: number
}

export async function findStrays(ownPid?: number): Promise<StrayProcess[]> {
  try {
    if (process.platform === 'win32') {
      // CSV keeps the parse honest on a localised Windows, where the table
      // headers are translated but the columns are not.
      const { stdout } = await run(
        'tasklist /FI "IMAGENAME eq llama-server.exe" /FO CSV /NH',
      )
      return stdout
        .split(/\r?\n/)
        .map((line) => line.match(/^"[^"]*","(\d+)","[^"]*","[^"]*","([^"]*)"/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({
          pid: Number(m[1]),
          rssBytes: Number((m[2] ?? '').replace(/[^\d]/g, '')) * 1024 || undefined,
        }))
        .filter((p) => p.pid !== ownPid)
    }
    const { stdout } = await run('ps -eo pid,rss,comm | grep llama-server')
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ pid: Number(m[1]), rssBytes: Number(m[2]) * 1024 }))
      .filter((p) => p.pid !== ownPid)
  } catch {
    // No matching process makes tasklist exit non-zero on some builds.
    return []
  }
}

export async function killStray(pid: number): Promise<void> {
  if (process.platform === 'win32') await run(`taskkill /PID ${pid} /F /T`)
  else process.kill(pid, 'SIGKILL')
}
