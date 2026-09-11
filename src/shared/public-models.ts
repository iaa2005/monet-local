/**
 * The library, in the shape a client sees it.
 *
 * Its own module because it is a CONTRACT: Code Monet reads these field names
 * to fill in a model's context window, its modalities and its display name.
 * Renaming one here silently gives every model in that app a guessed context
 * and no vision, so the shape is built in one pure function and asserted
 * against a real server in the end-to-end test.
 */

import { estimate } from './estimator.js'
import { FLAGS } from './flags/registry.js'
import { activeWeightBytes, generationTps } from './models/speed.js'
import type { Hardware, Profile } from './flags/types.js'
import type { ModelGeometry } from './models/geometry.js'

export type ModelStatus = 'unloaded' | 'loading' | 'loaded'

/** What the library knows about one file, trimmed to what this needs. */
export interface PublicModelInput {
  id: string
  displayName: string
  architecture: string
  quant: string
  sizeBytes: number
  contextMax?: number
  geometry?: ModelGeometry
  mmprojPath?: string
  moe: boolean
  /** Every weight in the file, from the tensor table. */
  weightBytes?: number
  /** Of those, the ones in expert tensors — zero on a dense model. */
  expertBytes?: number
  expertCount?: number
  expertUsedCount?: number
}

export interface PublicModel {
  id: string
  object: 'model'
  owned_by: 'monet-local'
  status: ModelStatus
  display_name: string
  architecture: string
  quantisation: string
  size_bytes: number
  /** What the model advertises. */
  context_max: number | null
  /**
   * What its profile actually gives it, which is the number that matters: a
   * 262144-token model running at 8192 refuses anything longer, and a client
   * budgeting against the advertised figure walks straight into that.
   */
  context_configured: number | null
  /**
   * Most tokens this model may spend on ONE answer — `--n-predict`, as the
   * profile sets it. Null when it is unlimited (-1) or unset.
   *
   * Published for the same reason as the context: a client that guesses is a
   * client that guesses wrong. Code Monet asks for `max_tokens` on every
   * request and defaulted to 16000 of them, so a profile raised to 32000 did
   * nothing at all — the ceiling that applied was the one the caller had
   * never been told about.
   */
  predict_configured: number | null
  /**
   * The reasoning-effort steps this server accepts, weakest first.
   *
   * Published because a client cannot know them and must not guess: the set
   * is neither universal nor the same size everywhere — llama.cpp takes four
   * (low…xhigh) and has no "minimal" or "max", while an OpenAI-compatible
   * cloud takes a different four and Anthropic has none at all, only a token
   * budget. A client that hardcodes one ladder offers steps that do nothing
   * on half the models it can reach.
   */
  effort_levels: string[]
  /**
   * What ONE token reads, in bytes, and the tokens per second that implies
   * on this machine.
   *
   * Generation is memory bandwidth divided by this and nothing else, so it
   * is the number that decides whether a model is usable in a chat — and the
   * one a client cannot work out for itself, because it needs the tensor
   * table and the machine's memory rate. Measured here: 3.2 GB per token and
   * 26 tok/s for a mixture of experts, 14.2 GB and 4 tok/s for the larger
   * dense model beside it. Null when the file could not be weighed.
   */
  active_bytes_per_token: number | null
  generation_tps: number | null
  modalities: ('text' | 'image')[]
  moe: boolean
  /** Whether this machine could run it as configured. */
  verdict: 'fits' | 'tight' | 'wont_fit'
}

/**
 * The value after a flag in a command line llama.cpp reports for a loaded
 * model, e.g. `--ctx-size 8192`. Either spelling; the last one wins, as it
 * does for llama.cpp itself.
 */
export function argValue(args: string[], names: string[]): number | undefined {
  let found: number | undefined
  for (let i = 0; i + 1 < args.length; i++) {
    if (!names.includes(args[i]!)) continue
    const n = Number(args[i + 1])
    if (Number.isFinite(n)) found = n
  }
  return found
}

export function publicModels(
  models: PublicModelInput[],
  statuses: Map<string, ModelStatus>,
  profileFor: (id: string) => Profile,
  hardware: Hardware,
  /**
   * The command line the model's server is ACTUALLY running with, for a
   * loaded model. llama.cpp fixes a model's settings when it loads it; a
   * profile edited afterwards describes the next load, not this one. A
   * client planning a request against the edited figure walks into the
   * refusal this shape exists to prevent — seen: profile at 32768, server
   * at 8192, an 11713-token prompt bounced with "exceeds the available
   * context size".
   */
  runningArgs?: (id: string) => string[] | undefined,
): PublicModel[] {
  return models.map((m) => {
    const profile = profileFor(m.id)
    const verdict = estimate({
      fileBytes: m.sizeBytes,
      ...(m.geometry ? { geometry: m.geometry } : {}),
      profile,
      hardware,
    })
    const status = statuses.get(m.id) ?? 'unloaded'
    const args = status === 'loaded' ? runningArgs?.(m.id) : undefined
    // What is running beats what is written down, whenever the two differ.
    const ctx = (args && argValue(args, ['--ctx-size', '-c'])) ?? profile['ctxSize']
    // -1 is llama.cpp's "until the context runs out". There is no number to
    // publish for that, and null is how this shape says "no limit set".
    const predict = (args && argValue(args, ['--n-predict', '-n'])) ?? profile['nPredict']
    // Straight from the flag's own definition — the same list the profile
    // screen offers — so the two cannot drift.
    const effortFlag = FLAGS['reasoningEffort']
    const effortLevels =
      effortFlag?.type === 'enum' ? effortFlag.options.map((o) => o.value) : []

    // Bandwidth ÷ what a token reads. Both halves have to be known: without
    // the tensor table there is no active figure, and without the machine's
    // memory rate there is no speed — and a made-up one would be worse than
    // none, because a client would show it as fact.
    const bandwidth = hardware.memoryBandwidthBytesPerSecond
    const speedInput =
      m.weightBytes && bandwidth
        ? {
            weightBytes: m.weightBytes,
            ...(m.expertBytes ? { expertBytes: m.expertBytes } : {}),
            ...(m.expertCount ? { expertCount: m.expertCount } : {}),
            ...(m.expertUsedCount ? { expertUsedCount: m.expertUsedCount } : {}),
            bandwidthBytesPerSecond: bandwidth,
          }
        : null
    const active = speedInput ? Math.round(activeWeightBytes(speedInput)) : null
    const tps = speedInput ? Math.round(generationTps(speedInput) * 10) / 10 : null
    return {
      id: m.id,
      object: 'model',
      owned_by: 'monet-local',
      status,
      display_name: m.displayName,
      architecture: m.architecture,
      quantisation: m.quant,
      size_bytes: m.sizeBytes,
      context_max: m.contextMax ?? null,
      context_configured: typeof ctx === 'number' ? ctx : null,
      predict_configured: typeof predict === 'number' && predict > 0 ? predict : null,
      effort_levels: effortLevels,
      active_bytes_per_token: active,
      generation_tps: tps,
      modalities: m.mmprojPath ? ['text', 'image'] : ['text'],
      moe: m.moe,
      verdict: verdict.level,
    }
  })
}
