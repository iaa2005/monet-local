/**
 * How fast a model will run here — before loading it.
 *
 * The question this answers is the one that cost an evening: "why does my
 * model write at three tokens a second, and what would be fast?" Nothing in
 * the app could say. The estimator answers whether a model FITS; fitting and
 * being usable are different questions, and a 27B that fits at four tokens a
 * second is not usable for a chat.
 *
 * Generation is memory-bandwidth-bound and nothing else. Every token reads
 * the weights the router selected for it, so:
 *
 *     tokens per second  ≈  usable bandwidth ÷ bytes read per token
 *
 * That is the whole model. It has no free parameters except the efficiency
 * factor below, and it was checked against llama-bench on this machine
 * before being written down:
 *
 *   model                     active/token   predicted   MEASURED
 *   gpt-oss-20b MXFP4 (MoE)       3.19 GB      27 t/s     26.3 t/s
 *   Qwen3.8-27B IQ4_XS           14.24 GB       6 t/s      4.2 t/s
 *   Qwen3.8-27B Q4_K_M           16.80 GB       5 t/s      4.3 t/s
 *
 * The MoE is seven times faster than the dense model beside it, on the same
 * hardware, at two thirds of its size — because it reads 3 GB per token
 * instead of 14. That is the finding this module exists to make visible.
 *
 * PREFILL (reading the prompt) is compute-bound instead, and the app has no
 * model of the GPU's throughput worth trusting, so this does not guess at
 * one: prefill is reported only when a benchmark has measured it.
 */

/** Bytes per second a dual-channel DDR5 kit moves, in theory. */
export function ddrBandwidth(mtPerSecond: number, channels = 2): number {
  return channels * 8 * mtPerSecond * 1e6
}

/**
 * The share of theoretical bandwidth a real inference run reaches.
 *
 * Measured, not assumed. Three runs on this machine (89.6 GB/s theoretical,
 * DDR5-5600 dual channel) came back at 0.93, 0.67 and 0.80 of it — the
 * spread is the quantisation format, and i-quants are the slow end because
 * unpacking their codebooks costs arithmetic the simpler formats do not
 * spend. 0.75 sits in the middle: close enough to tell four tokens a second
 * from twenty-six, which is the decision this number is for, and honest
 * about being an estimate rather than a promise.
 */
const EFFICIENCY = 0.75

/** What a model must read per token, and what that costs in speed. */
export interface SpeedInput {
  /** Every weight in the file. */
  weightBytes: number
  /** Of those, the ones in expert tensors. Zero on a dense model. */
  expertBytes?: number
  /** `{arch}.expert_count` and `.expert_used_count`, when the model is MoE. */
  expertCount?: number
  expertUsedCount?: number
  /** Theoretical memory bandwidth, bytes per second. */
  bandwidthBytesPerSecond: number
}

/**
 * The weights ONE token reads.
 *
 * On a dense model, all of them. On a mixture of experts, everything outside
 * the expert tensors plus the fraction of experts the router picks —
 * gpt-oss-20b keeps 32 experts and uses 4, so it reads an eighth of the ten
 * gigabytes they occupy.
 *
 * A model that says it has experts but names no expert tensors (or the other
 * way round) is treated as dense: the honest answer when the two signals
 * disagree is the slower one.
 */
export function activeWeightBytes(input: SpeedInput): number {
  const { weightBytes, expertBytes = 0, expertCount = 0, expertUsedCount = 0 } = input
  if (expertBytes <= 0 || expertCount <= 0 || expertUsedCount <= 0) return weightBytes
  const used = Math.min(expertUsedCount, expertCount)
  return weightBytes - expertBytes + expertBytes * (used / expertCount)
}

/** Tokens per second this machine can generate, at best. */
export function generationTps(input: SpeedInput): number {
  const active = activeWeightBytes(input)
  if (active <= 0) return 0
  return (input.bandwidthBytesPerSecond * EFFICIENCY) / active
}

/**
 * The verdict a person can act on.
 *
 * Three bands, and the boundaries are about what a chat FEELS like rather
 * than anything in the hardware: faster than reading aloud, slower than
 * reading aloud but still a conversation, and slow enough that a paragraph
 * is a coffee break.
 */
export type SpeedBand = 'fast' | 'usable' | 'slow'

export function speedBand(tps: number): SpeedBand {
  if (tps >= 15) return 'fast'
  if (tps >= 6) return 'usable'
  return 'slow'
}

/** A short, honest label: "≈26 tok/s". */
export function formatTps(tps: number): string {
  return `${tps >= 10 ? Math.round(tps) : tps.toFixed(1)} tok/s`
}
