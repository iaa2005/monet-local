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
 *
 * "Not ours" is the whole difficulty. The first version excluded only the
 * Electron process id — which is never a llama-server — so the router this
 * app had just started appeared in its own warning, under a button offering
 * to stop it. Killing that is a TerminateProcess, which is exit code 1 on
 * Windows, and the next Load then failed with "llama-server exited with code
 * 1" pointing at nothing the user had done wrong.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(exec)

export interface StrayProcess {
  pid: number
  /** Resident memory, when the platform reports it. */
  rssBytes?: number
}

/** A llama-server process and who started it. */
export interface ProcRow {
  pid: number
  ppid: number
  rssBytes?: number
}

/**
 * Which of these processes are not ours.
 *
 * Ownership is inherited: in router mode llama-server spawns a child per
 * loaded model, so a process whose parent is ours is ours as well, however
 * deep. Pure and exported so the rule can be tested without a process tree.
 */
export function strayPids(rows: ProcRow[], ours: number[]): StrayProcess[] {
  const owned = new Set(ours)
  // Repeat until nothing new is claimed: a grandchild is only recognisable
  // once its parent has been.
  for (let changed = true; changed; ) {
    changed = false
    for (const r of rows) {
      if (owned.has(r.pid) || !owned.has(r.ppid)) continue
      owned.add(r.pid)
      changed = true
    }
  }
  return rows
    .filter((r) => !owned.has(r.pid))
    .map((r) => ({ pid: r.pid, ...(r.rssBytes ? { rssBytes: r.rssBytes } : {}) }))
}

async function llamaServers(): Promise<ProcRow[]> {
  if (process.platform === 'win32') {
    // CIM rather than tasklist: tasklist does not report a parent, and
    // without parents there is no way to tell our own router's model
    // children from someone else's server. Written without nested quotes so
    // it survives the trip through cmd.
    const { stdout } = await run(
      'powershell -NoProfile -NonInteractive -Command ' +
        '"Get-CimInstance Win32_Process | Where-Object -Property Name -EQ -Value llama-server.exe ' +
        '| Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Csv -NoTypeInformation"',
    )
    return stdout
      .split(/\r?\n/)
      .slice(1) // the header
      .map((line) => line.match(/^"(\d+)","(\d+)","(\d+)"/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        rssBytes: Number(m[3]) || undefined,
      }))
  }
  const { stdout } = await run('ps -eo pid,ppid,rss,comm')
  return stdout
    .split(/\r?\n/)
    .filter((l) => l.includes('llama-server'))
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      rssBytes: Number(m[3]) * 1024 || undefined,
    }))
}

/**
 * Resident memory held by OUR llama-servers — the router and every model it
 * has loaded.
 *
 * Free RAM is measured to decide what fits, and a model that is already
 * loaded is the largest thing in that measurement. Counted as "in use" it
 * makes the verdict for the very configuration that is running read
 * "does not fit, other programs are holding 23 GB" — the other program being
 * the model itself. This is the number to add back.
 */
export async function ownedRssBytes(ours: number[]): Promise<number> {
  try {
    const rows = await llamaServers()
    const strays = new Set(strayPids(rows, ours).map((s) => s.pid))
    return rows
      .filter((r) => !strays.has(r.pid))
      .reduce((sum, r) => sum + (r.rssBytes ?? 0), 0)
  } catch {
    return 0
  }
}

/**
 * @param ours every process id this app is responsible for — itself, and the
 * router it spawned. Their descendants are worked out from the tree.
 */
export async function findStrays(ours: number[] = []): Promise<StrayProcess[]> {
  try {
    return strayPids(await llamaServers(), ours)
  } catch {
    // No matching process makes some builds exit non-zero. Nothing found is
    // the safe answer either way: it lets a start proceed rather than
    // blocking on a query that failed.
    return []
  }
}

export async function killStray(pid: number): Promise<void> {
  if (process.platform === 'win32') await run(`taskkill /PID ${pid} /F /T`)
  else process.kill(pid, 'SIGKILL')
}
