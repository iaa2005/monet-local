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

/** One populated module, as the firmware's SMBIOS table describes it. */
export interface MemoryModule {
  /** The configured transfer rate, MT/s. */
  mtPerSecond: number
  /** SMBIOS "data width" in bits, when reported. */
  dataWidthBits?: number
  /** SMBIOS type 17 "memory type": 26 DDR4, 34 DDR5, 35 LPDDR5 … */
  smbiosType?: number
}

/** The LPDDR generations, by SMBIOS memory-type code. */
const LPDDR_TYPES = new Set([27, 28, 29, 30, 35])

/**
 * The whole bus of a laptop with soldered LPDDR, in bits.
 *
 * Every x86 laptop with LPDDR5/5X this app is likely to meet — Meteor Lake,
 * Lunar Lake, Arrow Lake H, Strix Point — puts the packages on a 128-bit
 * bus. Strix Halo's 256-bit is the exception, and it will be UNDER-promised
 * here by half, which is the direction to be wrong in.
 */
const LPDDR_BUS_BITS = 128

/**
 * Theoretical bandwidth from the modules the firmware lists.
 *
 * A DIMM is 64 bits wide and the sum of the modules IS the bus. LPDDR is
 * not a DIMM: a Core Ultra 7 155H lists EIGHT modules of 2 GiB, each
 * claiming a 64-bit data width, for what is one 128-bit bus of LPDDR5X-6400.
 * Summed as DIMMs that came to 409.6 GB/s — four times the real 102.4 —
 * and every model on the screen was promised four times the speed it has
 * (≈1142 tok/s for a 135M model that llama-bench then wrote at 128). So on
 * LPDDR the sum is capped at the bus the platform actually has.
 */
export function modulesBandwidth(
  modules: MemoryModule[],
): { mtPerSecond: number; busBits: number; bytesPerSecond: number } | null {
  const rates = modules.map((m) => m.mtPerSecond).filter((v) => v > 0)
  if (rates.length === 0) return null
  // The slowest module sets the pace of every channel it shares a bus with.
  const mtPerSecond = Math.min(...rates)
  let busBits = modules.reduce(
    (n, m) => n + (m.dataWidthBits && m.dataWidthBits > 0 ? m.dataWidthBits : 64),
    0,
  )
  const lpddr = modules.some((m) => m.smbiosType !== undefined && LPDDR_TYPES.has(m.smbiosType))
  if (lpddr && busBits > LPDDR_BUS_BITS) busBits = LPDDR_BUS_BITS
  return { mtPerSecond, busBits, bytesPerSecond: (mtPerSecond * 1e6 * busBits) / 8 }
}

/**
 * What the memory ACTUALLY delivered, worked back from a benchmark.
 *
 * A generation figure from llama-bench times the bytes every token read is
 * the bandwidth the run got — efficiency, backend and driver all included.
 * It is the number to predict other models from on the same runtime, and
 * it needs no efficiency factor: it already is one.
 */
export function effectiveBandwidth(genTps: number, activeBytes: number): number {
  return genTps > 0 && activeBytes > 0 ? genTps * activeBytes : 0
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
  /** Memory bandwidth, bytes per second — theoretical unless said otherwise. */
  bandwidthBytesPerSecond: number
  /**
   * The bandwidth above was measured by a benchmark on this runtime, not
   * read off the modules, so the efficiency factor is already in it.
   */
  bandwidthIsEffective?: boolean
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
  const usable = input.bandwidthIsEffective
    ? input.bandwidthBytesPerSecond
    : input.bandwidthBytesPerSecond * EFFICIENCY
  return usable / active
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
