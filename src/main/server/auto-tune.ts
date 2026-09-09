/**
 * Auto, the half that measures.
 *
 * recommendProfile picks a starting point from the estimator. This takes it
 * to the machine: write the configuration, restart the router so llama.cpp
 * reads it, load the model, and ask it for a handful of tokens. Only a
 * model that has ANSWERED counts as running — the failure this exists for is
 * a model that loads, reads a prompt for four minutes, and dies on its first
 * generated token, which no verdict at load time can see.
 *
 * On failure it backs off (fewer layers on the GPU, then none) and tries
 * again, and reports every attempt, because "58 of 65 layers died, 48 ran"
 * is the only honest answer there is on hardware whose device wall moved by
 * two gigabytes in one evening.
 *
 * Kept apart from the IPC file so the loop can be read on its own. It is
 * handed the router and the profile store as functions rather than reaching
 * for them, for the same reason.
 */

import {
  backOff,
  classifyFailure,
  type AutoInput,
  type AutoResult,
  type AutoSummary,
} from '@shared/auto-profile.js'
import type { Profile } from '@shared/flags/types.js'
import type { Router } from './router.js'

export interface AutoAttempt {
  summary: AutoSummary
  ok: boolean
  /** Why it did not run, in the server's own words where it had any. */
  reason?: string
}

export type AutoPhase = 'loading' | 'probing' | 'failed' | 'ok' | 'gave-up'

export interface AutoProgress {
  modelId: string
  attempt: number
  summary: AutoSummary
  phase: AutoPhase
  reason?: string
}

export interface AutoTuneDeps {
  router: () => Router
  /** Write the candidate into the model's own configuration. */
  write: (profile: Profile) => void
  /** The router entries with that configuration in effect. */
  entries: () => Parameters<Router['start']>[0]
  probe: (modelId: string) => Promise<void>
  onProgress?: (p: AutoProgress) => void
  /** Attempts before giving up, counting the first. */
  maxAttempts?: number
}

/**
 * The ladder is eight deep at most on a GPU machine with a projector
 * (projector, cache, batch, four layer steps, CPU) before the context starts
 * coming down. Each attempt is a model load, so this is minutes, not hours.
 */
const MAX_ATTEMPTS = 10

/** Loads a model with a candidate and asks it to speak; the verdict is a token. */
async function tryCandidate(
  modelId: string,
  deps: AutoTuneDeps,
): Promise<string | null> {
  const router = deps.router()
  try {
    await router.start(deps.entries())
    await router.loadAndWait(modelId)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  try {
    await deps.probe(modelId)
  } catch (e) {
    // The child that died mid-answer has been recorded by the router's log
    // watcher; that record names the fault better than a socket error does.
    const crash = router.lastCrash(30_000)
    if (crash && crash.id === modelId) return crash.label
    return e instanceof Error ? e.message : String(e)
  }
  return null
}

export async function autoTune(
  modelId: string,
  first: AutoResult,
  input: Pick<AutoInput, 'geometry' | 'mmprojBytes'>,
  deps: AutoTuneDeps,
): Promise<{ result: AutoResult; attempts: AutoAttempt[] }> {
  const attempts: AutoAttempt[] = []
  let candidate: AutoResult | null = first
  const limit = deps.maxAttempts ?? MAX_ATTEMPTS
  while (candidate && attempts.length < limit) {
    const n = attempts.length + 1
    const report = (phase: AutoPhase, reason?: string): void =>
      deps.onProgress?.({
        modelId,
        attempt: n,
        summary: candidate!.summary,
        phase,
        ...(reason ? { reason } : {}),
      })
    deps.write(candidate.profile)
    report('loading')
    const failure = await tryCandidate(modelId, {
      ...deps,
      probe: async (id) => {
        report('probing')
        await deps.probe(id)
      },
    })
    if (failure === null) {
      attempts.push({ summary: candidate.summary, ok: true })
      report('ok')
      return { result: candidate, attempts }
    }
    attempts.push({ summary: candidate.summary, ok: false, reason: failure })
    report('failed', failure)
    // Which wall it hit decides what is given up next — see backOff.
    candidate = backOff(candidate, input, classifyFailure(failure, candidate.summary.cpuOnly))
  }
  // Every arrangement failed, down to the CPU. The last one written stays
  // written — it is the most conservative thing tried, and the note says
  // that even it did not run.
  const last = attempts[attempts.length - 1]
  deps.onProgress?.({
    modelId,
    attempt: attempts.length,
    summary: last?.summary ?? first.summary,
    phase: 'gave-up',
    ...(last?.reason ? { reason: last.reason } : {}),
  })
  return { result: first, attempts }
}
