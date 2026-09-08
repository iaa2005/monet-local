import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => mkdtempSync(join(tmpdir(), 'monet-local-bench-')) },
}))

const { buildBenchArgs, unsupportedByBench } = await import('./run.js')

describe('buildBenchArgs', () => {
  it('asks for machine-readable output', () => {
    // The alternative is scraping a table whose columns move between builds.
    expect(buildBenchArgs('m.gguf', {})).toContain('-o')
    expect(buildBenchArgs('m.gguf', {})).toContain('json')
  })

  it('carries the flags that decide the answer', () => {
    const args = buildBenchArgs('m.gguf', {
      ctxSize: 8192,
      threads: 8,
      ubatchSize: 256,
      cacheTypeK: 'q8_0',
      device: 'none',
    }).join(' ')
    expect(args).toContain('-c 8192')
    expect(args).toContain('-t 8')
    expect(args).toContain('-ub 256')
    expect(args).toContain('-ctk q8_0')
    expect(args).toContain('-dev none')
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

  it('leaves out what llama-bench does not understand', () => {
    // Passing --reasoning-effort makes it exit with a usage error rather than
    // ignore it, so the whole run fails on a setting that could not have
    // affected the number anyway.
    const args = buildBenchArgs('m.gguf', {
      ctxSize: 4096,
      reasoningEffort: 'low',
      nPredict: 64,
    }).join(' ')
    expect(args).not.toContain('reasoning')
    expect(args).not.toContain('n-predict')
    expect(args).toContain('-c 4096')
  })
})

describe('unsupportedByBench', () => {
  it('names what a comparison did not cover', () => {
    // Reported rather than swallowed: a profile whose reasoning effort was
    // ignored is not the profile the user thinks was measured.
    expect(
      unsupportedByBench({ ctxSize: 8192, reasoningEffort: 'low', mlock: true }).sort(),
    ).toEqual(['mlock', 'reasoningEffort'])
  })

  it('is empty for a profile a benchmark can honour whole', () => {
    expect(unsupportedByBench({ ctxSize: 8192, threads: 8 })).toEqual([])
  })
})
