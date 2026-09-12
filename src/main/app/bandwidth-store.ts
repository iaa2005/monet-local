/**
 * What the memory actually delivered, per runtime, kept from benchmarks.
 *
 * The speed beside every model is bandwidth divided by what a token reads.
 * The bandwidth used to come from the modules' rate alone, and on a laptop
 * with soldered LPDDR that was wrong by four (see modulesBandwidth) — and
 * even where the bus is read correctly, what a run GETS out of it depends
 * on the backend: the same Intel iGPU writes at one speed under Vulkan and
 * another under SYCL. A benchmark is the only thing that knows either, so
 * every benchmark run leaves its answer here, keyed by the pack that ran
 * it, and predictions on that pack divide by the measured figure from then
 * on rather than by a guess.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './settings-store.js'

export interface MeasuredBandwidth {
  /** Bytes per second the run delivered: generation rate × bytes per token. */
  bytesPerSecond: number
  genTps: number
  activeBytes: number
  modelId: string
  modelName: string
  runtimeLabel: string
  at: string
}

type Store = Record<string, MeasuredBandwidth>

function storePath(): string {
  return join(dataDir(), 'bandwidth.json')
}

function readStore(): Store {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf8')) as unknown
    return raw && typeof raw === 'object' ? (raw as Store) : {}
  } catch {
    return {}
  }
}

export function measuredBandwidth(runtimeId: string): MeasuredBandwidth | undefined {
  const m = readStore()[runtimeId]
  return m && m.bytesPerSecond > 0 ? m : undefined
}

/**
 * Keep the LARGER of what is known and what this run got.
 *
 * A run is a lower bound on the memory: a tiny model is latency-bound and
 * reads well under what the bus can give (a 135M model on an Arc iGPU came
 * to 34 GB/s where a 2B one reached far more), and a run deep into its
 * context spends part of every token on the cache rather than the weights.
 * The best run seen is the closest thing to the machine's own number, and
 * a worse one after it says something about that model, not the memory.
 */
export function recordBandwidth(runtimeId: string, next: MeasuredBandwidth): MeasuredBandwidth {
  const store = readStore()
  const known = store[runtimeId]
  const kept = known && known.bytesPerSecond >= next.bytesPerSecond ? known : next
  store[runtimeId] = kept
  try {
    writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8')
  } catch (err) {
    console.error('[bandwidth] could not save', err)
  }
  return kept
}
