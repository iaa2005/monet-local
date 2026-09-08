import { describe, expect, it } from 'vitest'
import { strayPids, type ProcRow } from './orphans.js'

/** Electron main is 100; the router it spawned is 200. */
const ELECTRON = 100
const ROUTER = 200

describe('strayPids', () => {
  it('does not report the router this app started', () => {
    // The bug this exists for: the old filter excluded only the Electron pid,
    // which is never a llama-server, so the app listed its own router as
    // someone else's and offered a button to kill it. Killing it is a
    // TerminateProcess — exit code 1 — and the next Load then failed with
    // "llama-server exited with code 1".
    const rows: ProcRow[] = [{ pid: ROUTER, ppid: ELECTRON }]
    expect(strayPids(rows, [ELECTRON, ROUTER])).toEqual([])
  })

  it('does not report the model servers the router spawns', () => {
    // Router mode starts a child llama-server per loaded model. They are
    // ours by descent, not by being named.
    const rows: ProcRow[] = [
      { pid: ROUTER, ppid: ELECTRON },
      { pid: 300, ppid: ROUTER },
      { pid: 400, ppid: 300 },
    ]
    expect(strayPids(rows, [ELECTRON, ROUTER])).toEqual([])
  })

  it('still reports a server nobody here started', () => {
    // The case the warning exists for: LM Studio, or a leftover from a
    // previous run of this app whose parent is gone.
    const rows: ProcRow[] = [
      { pid: ROUTER, ppid: ELECTRON },
      { pid: 900, ppid: 1, rssBytes: 16_000_000_000 },
    ]
    expect(strayPids(rows, [ELECTRON, ROUTER])).toEqual([
      { pid: 900, rssBytes: 16_000_000_000 },
    ])
  })

  it('reports an orphan of our own from before a restart', () => {
    // After the dev server restarts main, the old router really is a stray:
    // nothing in this process owns it, and starting a second one over the
    // same weights is the failure this check is for.
    const rows: ProcRow[] = [{ pid: ROUTER, ppid: ELECTRON }]
    expect(strayPids(rows, [999])).toEqual([{ pid: ROUTER }])
  })

  it('claims a grandchild whose parent is claimed later in the list', () => {
    // Order is not guaranteed by the process table, so ownership has to
    // settle rather than be decided in one pass.
    const rows: ProcRow[] = [
      { pid: 400, ppid: 300 },
      { pid: 300, ppid: ROUTER },
    ]
    expect(strayPids(rows, [ROUTER])).toEqual([])
  })
})
