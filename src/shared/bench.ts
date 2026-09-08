/**
 * Benchmark results: what `llama-bench` reported, and what it means.
 *
 * The parsing is trivial because llama-bench takes `-o json` — no scraping a
 * table whose columns move between builds. What this module is really for is
 * the comparison: two profiles side by side, with the difference stated as a
 * number rather than left for the reader to divide in their head.
 *
 * Two numbers, and they answer different questions. Prompt throughput is how
 * fast the model READS — it decides whether a long context is usable at all
 * (at 28 tok/s, filling 262144 tokens is three hours). Generation throughput
 * is how fast it WRITES, and on a dense model it is pinned to memory
 * bandwidth: nothing in a profile moves it much except using fewer bytes per
 * token.
 */

import type { Profile } from './flags/types.js'

export interface BenchRow {
  /** Prompt tokens for this row; 0 on a generation row. */
  n_prompt: number
  /** Generated tokens for this row; 0 on a prompt row. */
  n_gen: number
  /** Tokens already in the cache — what this app sets from the context. */
  n_depth: number
  avg_ts: number
  stddev_ts: number
  backends: string
  n_gpu_layers: number
  type_k: string
  type_v: string
  no_kv_offload: boolean
  n_ubatch: number
  n_threads: number
  model_size: number
  build_number: number
}

export interface BenchResult {
  /** Prompt processing, tokens per second. */
  promptTps?: number
  /** Generation, tokens per second. */
  genTps?: number
  backend: string
  buildNumber?: number
  /**
   * The context this was measured at. Kept because two runs at different
   * depths are not comparable: generation slows as the cache fills, so a
   * ratio across depths measures the depth, not the profile.
   */
  depth?: number
  ran: string
}

/**
 * llama-bench emits one row per test: a prompt row and a generation row, told
 * apart by which of n_prompt / n_gen is non-zero. Anything else in the array
 * is a test we did not ask for and is ignored rather than averaged in.
 */
export function summarise(rows: BenchRow[], ran = new Date().toISOString()): BenchResult {
  const prompt = rows.find((r) => r.n_prompt > 0 && r.n_gen === 0)
  const gen = rows.find((r) => r.n_gen > 0 && r.n_prompt === 0)
  const first = rows[0]
  return {
    ...(prompt ? { promptTps: prompt.avg_ts } : {}),
    ...(gen ? { genTps: gen.avg_ts } : {}),
    backend: first?.backends ?? 'unknown',
    ...(first?.n_depth !== undefined ? { depth: first.n_depth } : {}),
    ...(first?.build_number !== undefined
      ? { buildNumber: first.build_number }
      : {}),
    ran,
  }
}

export interface BenchRun {
  id: string
  modelId: string
  profileName: string
  result: BenchResult
}

export interface Comparison {
  promptRatio?: number
  genRatio?: number
  /** Which side won on generation, or null when they are within noise. */
  fasterGen?: 'a' | 'b' | null
}

/** Below this, a difference is the machine breathing, not the profile. */
const NOISE = 0.05

export function compare(a: BenchResult, b: BenchResult): Comparison {
  const ratio = (x?: number, y?: number): number | undefined =>
    x && y ? y / x : undefined
  const genRatio = ratio(a.genTps, b.genTps)
  return {
    ...(ratio(a.promptTps, b.promptTps) !== undefined
      ? { promptRatio: ratio(a.promptTps, b.promptTps)! }
      : {}),
    ...(genRatio !== undefined ? { genRatio } : {}),
    fasterGen:
      genRatio === undefined
        ? undefined
        : Math.abs(genRatio - 1) < NOISE
          ? null
          : genRatio > 1
            ? 'b'
            : 'a',
  }
}

/**
 * The ceiling generation can reach on this machine, from first principles.
 *
 * A dense model reads every weight for every token, so tokens per second
 * cannot exceed memory bandwidth divided by the size of the weights. Worth
 * showing next to a measurement: it is the difference between "this profile
 * is slow" and "this is what the hardware does", and it is what makes clear
 * that more RAM buys capacity, not speed.
 */
export function bandwidthCeiling(
  weightsBytes: number,
  bytesPerSecond: number,
): number {
  return weightsBytes > 0 ? bytesPerSecond / weightsBytes : 0
}

/** Dual-channel DDR5-5600, the dev machine: 2 channels × 8 bytes × 5600 MT/s. */
export const DDR5_5600_DUAL = 2 * 8 * 5600e6

/**
 * How a profile setting is spelled for llama-bench — when it can be spelled
 * at all.
 *
 * Verified against the binary, not assumed from the server's flags. They are
 * different programs with different argument sets, and llama-bench EXITS on
 * an argument it does not know rather than ignoring it, so a wrong entry
 * here does not degrade a measurement — it kills the run. Two that look
 * obvious and are not:
 *
 *   `-c` does not exist. Context is expressed as DEPTH: llama-bench sizes
 *   the cache from prompt + generation + depth, so `-d 8192` is what
 *   "measure this at 8192 tokens of context" means here. Passing `-c` is
 *   what produced `invalid parameter for argument: -c`.
 *
 *   `--no-repack` does not exist either, and there is no equivalent. The one
 *   setting this app was built around is the one a benchmark cannot vary, so
 *   it is reported as uncovered rather than quietly assumed.
 */
const BENCH_FLAGS: Record<string, string> = {
  ctxSize: '-d',
  nGpuLayers: '-ngl',
  ubatchSize: '-ub',
  batchSize: '-b',
  threads: '-t',
  cacheTypeK: '-ctk',
  cacheTypeV: '-ctv',
  splitMode: '-sm',
  mainGpu: '-mg',
  tensorSplit: '-ts',
  device: '-dev',
  flashAttn: '-fa',
}

/**
 * Settings that do reach llama-bench, but under a different shape — so they
 * must not be counted as uncovered.
 */
const TRANSLATED = new Set(['noKvOffload', 'mlock', 'noMmap'])

/**
 * mlock and mmap are one argument here (`--load-mode`) where the server
 * takes two independent flags. Undefined means "leave llama-bench alone",
 * which is not the same as passing its default explicitly.
 */
function loadMode(profile: Profile): string | undefined {
  const mlock = profile['mlock'] === true
  const mmap = profile['noMmap'] !== true
  if (mlock && mmap) return 'mmap+mlock'
  if (mlock) return 'mlock'
  if (!mmap) return 'none'
  return undefined
}

/** Settings a profile may carry that a benchmark cannot honour. */
export function unsupportedByBench(profile: Profile): string[] {
  return Object.keys(profile).filter(
    (k) =>
      profile[k] !== undefined &&
      !(k in BENCH_FLAGS) &&
      !TRANSLATED.has(k) &&
      k !== 'extraArgs',
  )
}

export interface BenchOptions {
  /** Prompt tokens to process; the "how fast does it read" number. */
  promptTokens?: number
  /** Tokens to generate; the "how fast does it write" number. */
  genTokens?: number
  repetitions?: number
}

export function buildBenchArgs(
  modelPath: string,
  profile: Profile,
  opts: BenchOptions = {},
): string[] {
  const args = ['-m', modelPath, '-o', 'json']
  for (const [id, flag] of Object.entries(BENCH_FLAGS)) {
    const v = profile[id]
    if (v === undefined || v === '') continue
    // llama-bench takes 0/1 where the server takes a bare flag.
    args.push(flag, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  // --no-kv-offload has its own spelling here, and it is the flag that makes
  // a long context possible at all, so it is worth carrying across.
  if (profile['noKvOffload'] === true) args.push('-nkvo', '1')
  const lm = loadMode(profile)
  if (lm) args.push('-lm', lm)
  args.push('-p', String(opts.promptTokens ?? 256))
  args.push('-n', String(opts.genTokens ?? 32))
  args.push('-r', String(opts.repetitions ?? 1))
  return args
}

