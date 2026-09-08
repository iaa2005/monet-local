import { describe, expect, it } from 'vitest'
import {
  DDR5_5600_DUAL,
  bandwidthCeiling,
  buildBenchArgs,
  compare,
  summarise,
  type BenchRow,
  unsupportedByBench,
} from './bench.js'

/** Verbatim shape of `llama-bench -o json` on the dev machine, b10826. */
const ROWS = [
  {
    n_prompt: 32,
    n_gen: 0,
    avg_ts: 43.815821,
    n_depth: 0,
    stddev_ts: 0,
    backends: 'Vulkan',
    n_gpu_layers: -1,
    type_k: 'f16',
    type_v: 'f16',
    no_kv_offload: false,
    n_ubatch: 512,
    n_threads: 8,
    model_size: 16_799_719_424,
    build_number: 10826,
  },
  {
    n_prompt: 0,
    n_gen: 8,
    avg_ts: 4.453679,
    n_depth: 0,
    stddev_ts: 0,
    backends: 'Vulkan',
    n_gpu_layers: -1,
    type_k: 'f16',
    type_v: 'f16',
    no_kv_offload: false,
    n_ubatch: 512,
    n_threads: 8,
    model_size: 16_799_719_424,
    build_number: 10826,
  },
] satisfies BenchRow[]

describe('summarise', () => {
  it('tells the prompt row from the generation row', () => {
    // Both come back in one array and are distinguished only by which of
    // n_prompt / n_gen is non-zero. Averaging them would produce a number
    // that describes nothing.
    const r = summarise(ROWS, 'now')
    expect(r.promptTps).toBeCloseTo(43.82, 1)
    expect(r.genTps).toBeCloseTo(4.45, 1)
    expect(r.backend).toBe('Vulkan')
    expect(r.buildNumber).toBe(10826)
  })

  it('survives a run that produced only one of the two', () => {
    expect(summarise([ROWS[0]!]).genTps).toBeUndefined()
    expect(summarise([]).backend).toBe('unknown')
  })
})

describe('compare', () => {
  it('calls a small difference noise rather than a winner', () => {
    // Measured twice on this machine: 4.48 from llama-bench and 4.31 through
    // the server. Reporting that as "4% faster" would be inventing a result.
    const c = compare({ genTps: 4.48, backend: 'Vulkan', ran: '' }, {
      genTps: 4.31,
      backend: 'Vulkan',
      ran: '',
    })
    expect(c.fasterGen).toBeNull()
  })

  it('names the winner when the gap is real', () => {
    // CPU 2.8 against Vulkan 4.48 — the difference a runtime actually makes.
    const c = compare(
      { genTps: 2.8, backend: 'CPU', ran: '' },
      { genTps: 4.48, backend: 'Vulkan', ran: '' },
    )
    expect(c.fasterGen).toBe('b')
    expect(c.genRatio).toBeCloseTo(1.6, 1)
  })

  it('says nothing when a side has no number', () => {
    const c = compare({ backend: 'CPU', ran: '' }, { genTps: 4.4, backend: 'V', ran: '' })
    expect(c.fasterGen).toBeUndefined()
  })
})

describe('bandwidthCeiling', () => {
  it('explains the 4.3 tok/s wall', () => {
    // 16.8 GB of weights read per token against ~90 GB/s of dual-channel
    // DDR5-5600. The measured 4.48 sits just under it, which is what "this
    // is the hardware, not the profile" looks like as a number.
    const ceiling = bandwidthCeiling(16_799_719_424, DDR5_5600_DUAL)
    expect(ceiling).toBeGreaterThan(4.4)
    expect(ceiling).toBeLessThan(6)
  })

  it('rises when the model gets smaller, which is the only lever', () => {
    const q4 = bandwidthCeiling(16.8e9, DDR5_5600_DUAL)
    const q3 = bandwidthCeiling(13.2e9, DDR5_5600_DUAL)
    expect(q3 / q4).toBeCloseTo(16.8 / 13.2, 1)
  })
})

describe('buildBenchArgs — the flags llama-bench actually has', () => {
  it('asks for machine-readable output', () => {
    // The alternative is scraping a table whose columns move between builds.
    expect(buildBenchArgs('m.gguf', {})).toContain('-o')
    expect(buildBenchArgs('m.gguf', {})).toContain('json')
  })

  it('spells context as depth, because -c does not exist here', () => {
    // Checked against the binary: `llama-bench -c 8192` exits with
    // "invalid parameter for argument: -c", which is how a run died. Depth
    // is the real equivalent — the cache is sized from prompt + gen + depth.
    const args = buildBenchArgs('m.gguf', { ctxSize: 8192 }).join(' ')
    expect(args).toContain('-d 8192')
    expect(args).not.toContain('-c 8192')
  })

  it('carries the flags that decide the answer', () => {
    const args = buildBenchArgs('m.gguf', {
      threads: 8,
      ubatchSize: 256,
      cacheTypeK: 'q8_0',
      device: 'none',
      flashAttn: 'on',
    }).join(' ')
    expect(args).toContain('-t 8')
    expect(args).toContain('-ub 256')
    expect(args).toContain('-ctk q8_0')
    expect(args).toContain('-dev none')
    expect(args).toContain('-fa on')
  })

  it('spells --no-kv-offload the way llama-bench wants it', () => {
    // The server takes a bare flag; llama-bench takes -nkvo with a 0/1. Get
    // this wrong and the run measures a different configuration from the one
    // being compared.
    expect(buildBenchArgs('m.gguf', { noKvOffload: true }).join(' ')).toContain(
      '-nkvo 1',
    )
    expect(buildBenchArgs('m.gguf', { noKvOffload: false }).join(' ')).not.toContain(
      '-nkvo',
    )
  })

  it('folds mlock and mmap into the one --load-mode argument', () => {
    expect(buildBenchArgs('m.gguf', { mlock: true }).join(' ')).toContain(
      '-lm mmap+mlock',
    )
    expect(
      buildBenchArgs('m.gguf', { mlock: true, noMmap: true }).join(' '),
    ).toContain('-lm mlock')
    expect(buildBenchArgs('m.gguf', { noMmap: true }).join(' ')).toContain('-lm none')
    // Saying nothing is not the same as passing the default explicitly.
    expect(buildBenchArgs('m.gguf', {}).join(' ')).not.toContain('-lm')
  })

  it('leaves out what llama-bench does not understand', () => {
    // Passing --reasoning-effort makes it exit with a usage error rather than
    // ignore it, so the whole run fails on a setting that could not have
    // affected the number anyway.
    const args = buildBenchArgs('m.gguf', {
      ctxSize: 4096,
      reasoningEffort: 'low',
      nPredict: 64,
      noRepack: true,
    }).join(' ')
    expect(args).not.toContain('reasoning')
    expect(args).not.toContain('n-predict')
    expect(args).not.toContain('repack')
    expect(args).toContain('-d 4096')
  })
})

describe('unsupportedByBench', () => {
  it('names what a comparison did not cover', () => {
    // Reported rather than swallowed: a profile whose reasoning effort was
    // ignored is not the profile the user thinks was measured. --no-repack
    // has no llama-bench equivalent at all, which matters more here than
    // anywhere else — it is the setting this app exists to get right.
    expect(
      unsupportedByBench({
        ctxSize: 8192,
        reasoningEffort: 'low',
        noRepack: true,
      }).sort(),
    ).toEqual(['noRepack', 'reasoningEffort'])
  })

  it('does not count the settings it translates', () => {
    // mlock, mmap and kv-offload all reach llama-bench under other names.
    expect(
      unsupportedByBench({ mlock: true, noMmap: true, noKvOffload: true }),
    ).toEqual([])
  })

  it('is empty for a profile a benchmark can honour whole', () => {
    expect(unsupportedByBench({ ctxSize: 8192, threads: 8 })).toEqual([])
  })
})

describe('summarise keeps the depth', () => {
  it('records what context the numbers were measured at', () => {
    // Two runs at different depths are not comparable, so the depth has to
    // survive into the stored result rather than being an argument that
    // vanished after the run.
    expect(summarise(ROWS).depth).toBe(0)
    expect(
      summarise(ROWS.map((r) => ({ ...r, n_depth: 8192 }))).depth,
    ).toBe(8192)
  })
})
