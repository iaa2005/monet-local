/**
 * Running llama-bench, and keeping what it said.
 *
 * `-o json` means no scraping a table whose columns move between builds. The
 * flags come from the same registry the server uses, so a benchmark measures
 * the profile you would actually run rather than an approximation of it —
 * llama-bench accepts a subset, and BENCH_FLAGS is that subset.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { summarise, type BenchResult, type BenchRow } from '@shared/bench.js'
import type { Profile } from '@shared/flags/types.js'
import { dataDir } from '../app/settings-store.js'

/**
 * Which profile settings llama-bench understands.
 *
 * It is a different binary with a smaller argument set: it has no idea about
 * reasoning effort or answer limits, and passing one makes it exit with a
 * usage error rather than ignoring it. Anything not listed here is left out
 * of the run, and the UI says so rather than pretending the comparison
 * covered it.
 */
const BENCH_FLAGS: Record<string, string> = {
  ctxSize: '-c',
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
}

/** Settings a profile may carry that a benchmark cannot honour. */
export function unsupportedByBench(profile: Profile): string[] {
  return Object.keys(profile).filter(
    (k) => profile[k] !== undefined && !(k in BENCH_FLAGS) && k !== 'extraArgs',
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
  args.push('-p', String(opts.promptTokens ?? 256))
  args.push('-n', String(opts.genTokens ?? 32))
  args.push('-r', String(opts.repetitions ?? 1))
  return args
}

function historyDir(): string {
  const dir = join(dataDir(), 'bench')
  mkdirSync(dir, { recursive: true })
  return dir
}

export interface StoredRun {
  id: string
  modelId: string
  profileName: string
  args: string[]
  result: BenchResult
  /** Profile settings the benchmark could not apply. */
  ignored: string[]
}

export async function runBench(
  benchPath: string,
  modelId: string,
  modelPath: string,
  profileName: string,
  profile: Profile,
  opts: BenchOptions = {},
): Promise<StoredRun> {
  const args = buildBenchArgs(modelPath, profile, opts)

  const out = await new Promise<string>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(benchPath, args, { windowsHide: true })
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      // llama-bench prints its own reason; passing it through is more use
      // than "exited with 1".
      else reject(new Error(stderr.trim().split('\n').slice(-3).join('\n') || `exit ${code}`))
    })
  })

  // The JSON array is the last thing printed; backend banners come first.
  const start = out.indexOf('[')
  if (start < 0) throw new Error('llama-bench printed no JSON')
  const rows = JSON.parse(out.slice(start)) as BenchRow[]

  const run: StoredRun = {
    id: `${Date.now()}`,
    modelId,
    profileName,
    args,
    result: summarise(rows),
    ignored: unsupportedByBench(profile),
  }
  writeFileSync(join(historyDir(), `${run.id}.json`), JSON.stringify(run, null, 2))
  return run
}

export function benchHistory(): StoredRun[] {
  const dir = historyDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredRun
      } catch {
        return null
      }
    })
    .filter((r): r is StoredRun => r !== null)
    .sort((a, b) => b.id.localeCompare(a.id))
}
