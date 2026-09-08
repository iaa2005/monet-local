/**
 * Running llama-bench, and keeping what it said.
 *
 * `-o json` means no scraping a table whose columns move between builds. The
 * arguments are built in @shared/bench so the screen can show exactly what
 * will run before it runs, the way the server screen shows its command.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildBenchArgs,
  summarise,
  unsupportedByBench,
  type BenchOptions,
  type BenchResult,
  type BenchRow,
} from '@shared/bench.js'
import type { Profile } from '@shared/flags/types.js'
import { dataDir } from '../app/settings-store.js'

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
