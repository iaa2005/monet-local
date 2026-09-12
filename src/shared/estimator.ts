/**
 * Will this profile run on this machine, and if not, why not.
 *
 * The verdict LM Studio does not give. Everything here is calibrated against
 * measurements on one machine (Ryzen 7840HS, 2×16 GB DDR5, Radeon 780M — see
 * Appendix A of docs/PLAN.md) and the tests replay those cases, so a change
 * that would have let the five-hour configuration through fails the suite.
 *
 * Two ceilings, and they catch different failures:
 *
 *   RAM — everything must fit, or the machine swaps and a 4 tok/s model
 *   becomes an answer measured in hours.
 *
 *   DEVICE — what the GPU's allocator will hand out. On an integrated GPU
 *   this is a slice of the same RAM, so it is not extra capacity, it is a
 *   second, lower wall. It is the one that explains why context could not
 *   pass 8192 here no matter how hard the cache was quantised: the weights
 *   plus the compute buffers already filled the pool, and llama.cpp died on a
 *   549 MB allocation.
 */

import { kvCacheBytes, type ModelGeometry } from './models/geometry.js'
import type { Hardware, Profile } from './flags/types.js'
import { isCpuOnly, withDefaults } from './flags/build.js'

const GiB = 1024 ** 3

/**
 * What the OS and everything else on the machine need. Measured, not chosen:
 * this box idles at about 6 GB used, and leaving 3 GiB is what makes the
 * verdicts below match what actually happened.
 */
const OS_RESERVE = 3 * GiB

/** Below this much slack, "it fits" is not a useful thing to tell someone. */
const TIGHT_MARGIN = 2 * GiB

/**
 * What is free at the moment of asking is a ceiling of its own.
 *
 * The fixed reserve above is what this box needs at idle. It is not what
 * the box is using while a chat client, a browser and an editor are open —
 * measured at 7 GB the evening Auto picked a 128K context for the Q4_K_M
 * and the projector could not get 3.5 MB of device memory. On a shared-
 * memory GPU the "device" heap is this same RAM, so the two ceilings are one
 * ceiling, and the lower of them is the real one.
 *
 * The live figure is used AS IT IS, with the tight band below it rather
 * than a second margin taken off it. The first version kept two gigabytes
 * back from what was free, and on a 16 GB laptop running a browser, a
 * chat client and WSL — 2.0 GiB free of 15.5 — that left a ceiling of
 * zero bytes: every file on the download screen, an 84 MiB one included,
 * read "will not fit", while the 258 MiB model it was said of was loaded
 * and writing at a hundred tokens a second. The cache and the buffers are
 * already in the total; there is nothing left for the margin to protect
 * against that "tight" does not already say.
 */

/**
 * Repacking keeps a second, SIMD-friendly copy of the quantised weights.
 * Measured at roughly a third more resident memory on a Q4_K_M model; it is
 * the difference between 17-18 GB working set and 20.6 GB with nothing left.
 */
const REPACK_FACTOR = 1.3

/**
 * Compute buffers: a fixed base plus a part that scales with the physical
 * batch. Lowering `--ubatch-size` is the cheapest way to claw back device
 * memory, and this is the term that says so.
 */
function computeBytes(ubatch: number): number {
  return 0.35 * GiB + (ubatch / 256) * 0.25 * GiB
}

/**
 * A KV cache on the device costs more device memory than its nominal size:
 * llama.cpp allocates it per layer and keeps a graph workspace that addresses
 * it. 1.7× is not derived, it is fitted to the wall this machine actually
 * has — 8192 loads, 16384 dies on a 549 MB allocation, and 32768 loads again
 * the moment the cache moves to system RAM. Without this term the estimate
 * cheerfully approves the configuration that fails.
 */
const DEVICE_KV_OVERHEAD = 1.7

export type VerdictLevel = 'fits' | 'tight' | 'wont_fit'

/** Machine-readable so the UI can say it in either language. */
export interface Finding {
  code:
    | 'exceeds-ram'
    | 'ram-in-use'
    | 'exceeds-device'
    | 'repack-cost'
    | 'kv-dominates'
    | 'tight'
    | 'no-geometry'
  /** Bytes the message quotes, if any. */
  bytes?: number
  /** A device id, when the finding is about one. */
  device?: string
}

export interface Suggestion {
  code:
    | 'lower-context'
    | 'enable-no-kv-offload'
    | 'quantise-kv'
    | 'enable-no-repack'
    | 'smaller-quant'
    | 'lower-ubatch'
    | 'disable-mlock'
  /** The context that would fit, for `lower-context`. */
  value?: number
}

export interface Estimate {
  level: VerdictLevel
  weightsBytes: number
  kvBytes: number
  computeBytes: number
  totalBytes: number
  ramCeiling: number
  /**
   * How the RAM ceiling was arrived at, so the bar can say it in words.
   *
   * "18.8 GiB" on its own reads as a mystery on a 28 GB machine. The parts
   * are what make it an arithmetic anyone can check against the task
   * manager: the total, what other programs are holding right now (absent
   * when nobody measured), and the margin kept back.
   */
  ramBudget: {
    totalBytes: number
    /** Held by everything that is not this app's own model server. */
    othersBytes?: number
    /** Zero when the ceiling is what is free right now: nothing else is kept back. */
    reserveBytes: number
  }
  headroomBytes: number
  /** The GPU allocator's own limit, when a device is in play. */
  deviceCeiling?: number
  /** What would sit on the device with this profile. */
  deviceBytes?: number
  /**
   * The parts of that figure. Published rather than left for the UI to
   * recompute: the device budget is not the RAM budget with a different
   * ceiling — the weights are the file rather than its repacked copy, and
   * the cache carries the allocator's overhead — and a bar that redid the
   * arithmetic itself would drift from the verdict beside it.
   */
  deviceParts?: {
    weightsBytes: number
    kvBytes: number
    computeBytes: number
  }
  findings: Finding[]
  suggestions: Suggestion[]
}

export interface EstimateInput {
  fileBytes: number
  geometry?: ModelGeometry
  /** The projector, which is loaded alongside and costs its own memory. */
  mmprojBytes?: number
  profile: Profile
  hardware: Hardware
}

/** The largest context from the offered ladder that would fit. */
function largestFittingContext(
  input: EstimateInput,
  ladder = [262144, 131072, 65536, 32768, 16384, 8192, 4096, 2048],
): number | undefined {
  for (const ctx of ladder) {
    if (ctx >= Number(input.profile['ctxSize'] ?? 0)) continue
    const e = estimate({ ...input, profile: { ...input.profile, ctxSize: ctx } })
    if (e.level !== 'wont_fit') return ctx
  }
  return undefined
}

export function estimate(input: EstimateInput): Estimate {
  const p = withDefaults(input.profile)
  const { hardware: hw } = input

  const repack = p['noRepack'] !== true
  const weightsBytes =
    input.fileBytes * (repack ? REPACK_FACTOR : 1) + (input.mmprojBytes ?? 0)

  const ctx = Number(p['ctxSize'] ?? 0)
  const kvBytes = input.geometry
    ? kvCacheBytes(
        input.geometry,
        ctx,
        String(p['cacheTypeK'] ?? 'f16'),
        String(p['cacheTypeV'] ?? 'f16'),
      )
    : 0
  const compute = computeBytes(Number(p['ubatchSize'] ?? 256))

  const totalBytes = weightsBytes + kvBytes + compute
  const fixedCeiling = Math.max(0, hw.totalRamBytes - OS_RESERVE)
  const liveCeiling =
    hw.freeRamBytes !== undefined ? Math.max(0, hw.freeRamBytes) : undefined
  const busy = liveCeiling !== undefined && liveCeiling < fixedCeiling
  const ramCeiling = busy ? liveCeiling : fixedCeiling
  // Which of the two ceilings applied decides what the bar spells out: the
  // idle reserve when the machine is idle, what others hold when it is not.
  const ramBudget: Estimate['ramBudget'] = busy
    ? {
        totalBytes: hw.totalRamBytes,
        othersBytes: Math.max(0, hw.totalRamBytes - (hw.freeRamBytes ?? hw.totalRamBytes)),
        reserveBytes: 0,
      }
    : { totalBytes: hw.totalRamBytes, reserveBytes: OS_RESERVE }
  const headroomBytes = ramCeiling - totalBytes

  const findings: Finding[] = []
  const suggestions: Suggestion[] = []
  let level: VerdictLevel = 'fits'

  if (!input.geometry) {
    // Without head counts there is no cache figure, and a verdict that
    // ignores the cache is worse than admitting the gap.
    findings.push({ code: 'no-geometry' })
  }

  if (headroomBytes < 0) {
    level = 'wont_fit'
    findings.push({ code: 'exceeds-ram', bytes: -headroomBytes })
  } else if (headroomBytes < TIGHT_MARGIN) {
    level = 'tight'
    findings.push({ code: 'tight', bytes: headroomBytes })
  }
  // Say WHICH wall it was. "Exceeds RAM" on a machine with room to spare
  // sends someone to buy memory; "other programs are using it" sends them
  // to close a browser. Said for "tight" as well: on the full laptop above
  // the slack is whatever the browser left, and that is worth knowing.
  if (level !== 'fits' && busy) {
    findings.push({
      code: 'ram-in-use',
      bytes: hw.totalRamBytes - (hw.freeRamBytes ?? hw.totalRamBytes),
    })
  }

  // The device wall. Only meaningful while something is actually on the GPU:
  // with the cache in system RAM only the weights and buffers are.
  const device = hw.devices[0]
  let deviceCeiling: number | undefined
  let deviceBytes: number | undefined
  let deviceParts: Estimate['deviceParts']
  // `--device none` is what actually takes the GPU out of play. `-ngl 0`
  // leaves the backend selected with nothing offloaded, which is a different
  // (and on some models, fatal) thing — see the device flag's help. The
  // build rewrites one into the other, so the estimate has to read them the
  // same way or it would budget device memory for a run that has no device.
  const cpuOnly = isCpuOnly(p)
  if (device && !cpuOnly) {
    deviceCeiling = device.totalBytes
    const kvOnDevice =
      p['noKvOffload'] === true ? 0 : kvBytes * DEVICE_KV_OVERHEAD
    // Repack's second copy is a CPU-side layout; the device holds the
    // original weights.
    deviceParts = {
      weightsBytes: input.fileBytes,
      kvBytes: kvOnDevice,
      computeBytes: compute,
    }
    deviceBytes = input.fileBytes + kvOnDevice + compute
    if (deviceBytes > deviceCeiling) {
      level = 'wont_fit'
      findings.push({
        code: 'exceeds-device',
        bytes: deviceBytes - deviceCeiling,
        device: device.id,
      })
      if (kvOnDevice > 0) suggestions.push({ code: 'enable-no-kv-offload' })
      suggestions.push({ code: 'lower-ubatch' })
    }
  }

  if (kvBytes > weightsBytes) {
    findings.push({ code: 'kv-dominates', bytes: kvBytes })
  }
  if (repack) {
    // Always reported, always suggested against. Repack is off by default in
    // this app for one reason: leaving it on is how a working model became a
    // swap storm with no tokens at all. Someone who turns it back on should
    // see the bill every time.
    findings.push({
      code: 'repack-cost',
      bytes: input.fileBytes * (REPACK_FACTOR - 1),
    })
    suggestions.push({ code: 'enable-no-repack' })
  }
  if (p['mlock'] === true && level !== 'fits') {
    suggestions.push({ code: 'disable-mlock' })
  }

  if (level === 'wont_fit') {
    if (kvBytes > 0 && String(p['cacheTypeK'] ?? 'f16') === 'f16') {
      suggestions.push({ code: 'quantise-kv' })
    }
    const fitting = largestFittingContext(input)
    if (fitting) suggestions.push({ code: 'lower-context', value: fitting })
    else suggestions.push({ code: 'smaller-quant' })
  }

  return {
    level,
    weightsBytes,
    kvBytes,
    computeBytes: compute,
    totalBytes,
    ramCeiling,
    ramBudget,
    headroomBytes,
    ...(deviceCeiling !== undefined ? { deviceCeiling } : {}),
    ...(deviceBytes !== undefined ? { deviceBytes } : {}),
    ...(deviceParts !== undefined ? { deviceParts } : {}),
    findings,
    // The same suggestion can arrive from two branches; the user needs it once.
    suggestions: suggestions.filter(
      (s, i, all) => all.findIndex((x) => x.code === s.code) === i,
    ),
  }
}
