/**
 * A profile picked for a model, rather than guessed at by hand.
 *
 * The complaint this answers: "I cannot guess the settings and get a model
 * to run properly." Fair — the settings interact. The context decides the
 * cache, the cache decides whether the device wall is hit, the device wall
 * decides whether the cache has to move to RAM, and where the cache lives
 * decides how fast the prompt is read. Nobody should have to hold that in
 * their head to press Load.
 *
 * So this walks it. It is the estimator, asked systematically: for each
 * context from the top of the ladder down, for each way of holding the
 * cache from fastest to slowest, does it fit? The first "fits" wins — the
 * largest context the machine can hold at the fastest arrangement that
 * holds it. Only if nothing fits is "tight" accepted, and only if nothing is
 * even tight does it hand back the smallest thing with the verdict attached
 * rather than pretending.
 *
 * What it does NOT do is measure. A benchmark is the honest way to know
 * tokens per second, and it costs minutes per candidate; this costs
 * nothing and is right whenever the estimator is, which on the machine it
 * was calibrated on is every case in estimator.test.ts. The two facts below
 * that are not from the estimator are from measurement, and say so.
 */

import { estimate, type Estimate, type VerdictLevel } from './estimator.js'
import type { Hardware, Profile } from './flags/types.js'
import type { ModelGeometry } from './models/geometry.js'

export interface AutoInput {
  fileBytes: number
  geometry?: ModelGeometry
  /** `{arch}.context_length` — the ladder is cut at it. */
  contextMax?: number
  /** The projector beside the model, which costs its own memory. */
  mmprojBytes?: number
  hardware: Hardware
  /** Logical cores. */
  cpuThreads: number
}

/** Where the cache sits, and how it is stored — the two speed levers. */
export type KvPlacement = 'device-f16' | 'device-quantised' | 'ram-f16' | 'ram-quantised'

export interface AutoSummary {
  ctxSize: number
  kv: KvPlacement
  /** Set when some layers were deliberately kept off the GPU. */
  gpuLayers?: { on: number; of: number }
  cpuOnly: boolean
  threads: number
  level: VerdictLevel
}

export interface AutoResult {
  profile: Profile
  summary: AutoSummary
  estimate: Estimate
}

/**
 * Contexts worth offering, largest first. Below 4096 a chat is not usable;
 * above 262144 nothing this app has seen fits on a machine it would run on.
 */
const LADDER = [262144, 131072, 65536, 32768, 16384, 8192, 4096] as const

/**
 * The share of layers to put on a shared-memory GPU.
 *
 * MEASURED, not derived — and not something the estimator can predict, which
 * is why it lives here as a rule rather than there as a ceiling. On a Radeon
 * 780M, Qwen3.8-27B UD-IQ4_XS loads with every layer offloaded, reads a
 * 12,000-token prompt at 47 tok/s, and dies with an access violation on the
 * first generated token. At 62 of 64 layers it runs; at 63 it dies. A LARGER
 * quant of the same model runs with everything offloaded, so the wall is not
 * a number of bytes and cannot be computed. What can be said is that keeping
 * a tenth of the layers on the CPU cost nothing measurable — prefill held at
 * 47 tok/s from 56 layers up — and turned a crash into a working model.
 *
 * A discrete card gets all its layers: its memory is its own, the estimator's
 * device ceiling is the real one there, and every layer left behind is a
 * layer read over the bus per token.
 */
const UMA_LAYER_SHARE = 0.9

/**
 * The physical batch. Measured on the same machine as irrelevant to prompt
 * speed between 128 and 512, and the smallest of those is the one that
 * leaves the most device memory for the cache.
 */
const UBATCH = 256

/** Most tokens one answer may use. Capped by the context, obviously. */
const PREDICT = 32768

function withKv(p: Profile, kv: KvPlacement): Profile {
  const quantised = kv.endsWith('quantised')
  const inRam = kv.startsWith('ram')
  return {
    ...p,
    ...(quantised ? { cacheTypeK: 'q8_0', cacheTypeV: 'q4_0' } : {}),
    ...(inRam ? { noKvOffload: true } : {}),
  }
}

/**
 * The arrangements to try at a given context, fastest first.
 *
 * On the device, unquantised, is the fastest thing a machine does. Quantising
 * the cache costs a little accuracy and buys a lot of room; moving it to RAM
 * costs prompt speed and buys the whole context. Without a GPU the first two
 * do not exist.
 */
function placements(cpuOnly: boolean): KvPlacement[] {
  return cpuOnly
    ? ['ram-f16', 'ram-quantised']
    : ['device-f16', 'device-quantised', 'ram-f16', 'ram-quantised']
}

export function recommendProfile(input: AutoInput): AutoResult {
  const { hardware, geometry } = input
  const device = hardware.devices[0]
  const cpuOnly = !device

  const base: Profile = {
    noRepack: true,
    flashAttn: 'on',
    ubatchSize: UBATCH,
    parallel: 1,
    threads: Math.max(1, input.cpuThreads),
  }
  if (cpuOnly) base['device'] = 'none'

  // The measured rule above. Only when the layer count is known: a cap
  // invented without one would be a number, not a rule.
  let gpuLayers: AutoSummary['gpuLayers']
  if (device?.uma && geometry?.blockCount) {
    const of = geometry.blockCount
    const on = Math.max(1, Math.floor(of * UMA_LAYER_SHARE))
    base['nGpuLayers'] = on
    gpuLayers = { on, of }
  }

  const ladder = LADDER.filter(
    (c) => !input.contextMax || c <= input.contextMax,
  )
  // A model whose header claims less than 4096: offer what it claims.
  if (ladder.length === 0 && input.contextMax) {
    ladder.push(input.contextMax as (typeof LADDER)[number])
  }

  const attempt = (ctxSize: number, kv: KvPlacement): AutoResult => {
    const profile = withKv(
      { ...base, ctxSize, nPredict: Math.min(PREDICT, ctxSize) },
      kv,
    )
    const e = estimate({
      fileBytes: input.fileBytes,
      ...(geometry ? { geometry } : {}),
      ...(input.mmprojBytes ? { mmprojBytes: input.mmprojBytes } : {}),
      profile,
      hardware,
    })
    return {
      profile,
      estimate: e,
      summary: {
        ctxSize,
        kv,
        ...(gpuLayers ? { gpuLayers } : {}),
        cpuOnly,
        threads: base['threads'] as number,
        level: e.level,
      },
    }
  }

  // Two passes with a different bar, rather than one pass with a lower one:
  // a configuration that FITS at a smaller context beats one that is merely
  // tight at a larger one. Tight was the honest word for the profile that
  // ran with 3 GB to spare, and "auto" should not pick that while something
  // comfortable exists.
  for (const bar of ['fits', 'tight'] as const) {
    for (const ctx of ladder) {
      for (const kv of placements(cpuOnly)) {
        const r = attempt(ctx, kv)
        if (r.estimate.level === bar || (bar === 'tight' && r.estimate.level === 'fits'))
          return r
      }
    }
  }

  // Nothing fits. The smallest, most frugal arrangement, with its verdict
  // attached — the caller shows the finding rather than loading it blind.
  const smallest = ladder[ladder.length - 1] ?? 4096
  return attempt(smallest, cpuOnly ? 'ram-quantised' : 'ram-quantised')
}
