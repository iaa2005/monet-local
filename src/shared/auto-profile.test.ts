import { describe, expect, it } from 'vitest'
import { backOff, recommendProfile, type AutoInput } from './auto-profile.js'
import { estimate } from './estimator.js'
import type { Hardware } from './flags/types.js'
import type { ModelGeometry } from './models/geometry.js'

/** The dev machine, exactly as estimator.test.ts has it. */
const MACHINE: Hardware = {
  totalRamBytes: 29_761_810_432,
  devices: [
    {
      id: 'Vulkan0',
      name: 'AMD Radeon 780M Graphics',
      totalBytes: 18287 * 1024 * 1024,
      freeBytes: 17373 * 1024 * 1024,
      uma: true,
    },
  ],
}

const QWEN: ModelGeometry = {
  blockCount: 65,
  kvHeads: 4,
  keyLength: 256,
  valueLength: 256,
  fullAttentionInterval: 4,
}

/** Qwen3.8-27B Q4_K_M, the real file size. */
const Q4_K_M = 16_810_714_336
/** Qwen3.8-27B UD-IQ4_XS — the one that crashed at full offload. */
const IQ4_XS = 14_252_845_984

const on = (over: Partial<AutoInput> = {}): AutoInput => ({
  fileBytes: Q4_K_M,
  geometry: QWEN,
  contextMax: 262144,
  hardware: MACHINE,
  cpuThreads: 16,
  ...over,
})

describe('what auto picks on the machine it was calibrated on', () => {
  it('never hands back something the estimator refuses', () => {
    // The whole contract: "auto" is the estimator walked systematically, so
    // its answer must survive the estimator asked about it directly.
    const r = recommendProfile(on())
    const again = estimate({
      fileBytes: Q4_K_M,
      geometry: QWEN,
      profile: r.profile,
      hardware: MACHINE,
    })
    expect(again.level).not.toBe('wont_fit')
    expect(r.summary.level).toBe(again.level)
  })

  it('prefers a context that FITS over a larger one that is merely tight', () => {
    // 262144 with a quantised cache in RAM is real — it ran, with 3 GB to
    // spare — and the estimator calls it tight for exactly that reason. Auto
    // must not pick it while something comfortable exists.
    const r = recommendProfile(on())
    expect(r.summary.level).toBe('fits')
    expect(r.summary.ctxSize).toBeLessThan(262144)
  })

  it('still reaches for the largest context that does fit', () => {
    const r = recommendProfile(on())
    // One rung up must NOT fit at any arrangement, or auto stopped early.
    const rung = [262144, 131072, 65536, 32768, 16384, 8192, 4096]
    const next = rung[rung.indexOf(r.summary.ctxSize) - 1]
    expect(next).toBeDefined()
    const up = recommendProfile(on({ contextMax: next }))
    expect(up.summary.ctxSize === next && up.summary.level === 'fits').toBe(false)
  })

  it('keeps a tenth of the layers OFF a shared-memory GPU', () => {
    // Measured: every layer offloaded → 0xC0000005 on the first token for
    // the IQ4_XS; 62 of 64 runs; prefill did not slow from 56 up. Not a byte
    // ceiling, so not the estimator's to predict — a rule here.
    const r = recommendProfile(on({ fileBytes: IQ4_XS }))
    expect(r.profile['nGpuLayers']).toBe(58)
    expect(r.summary.gpuLayers).toEqual({ on: 58, of: 65 })
    expect(r.profile['device']).toBeUndefined()
  })

  it('gives a discrete card every layer', () => {
    const discrete: Hardware = {
      totalRamBytes: MACHINE.totalRamBytes,
      devices: [{ id: 'CUDA0', name: 'RTX', totalBytes: 24e9, freeBytes: 23e9, uma: false }],
    }
    const r = recommendProfile(on({ hardware: discrete }))
    expect(r.profile['nGpuLayers']).toBeUndefined()
    expect(r.summary.gpuLayers).toBeUndefined()
  })

  it('runs on the CPU when there is no GPU, with --device none and not -ngl 0', () => {
    // -ngl 0 leaves the backend selected with nothing on it, which on this
    // model aborts the process — see the device flag's help.
    const r = recommendProfile(on({ hardware: { totalRamBytes: MACHINE.totalRamBytes, devices: [] } }))
    expect(r.profile['device']).toBe('none')
    expect(r.profile['nGpuLayers']).toBeUndefined()
    expect(r.summary.cpuOnly).toBe(true)
    expect(r.summary.kv.startsWith('ram')).toBe(true)
  })

  it('carries the measured constants, not llama.cpp defaults', () => {
    const r = recommendProfile(on())
    // Repack on is how a working model became a swap storm.
    expect(r.profile['noRepack']).toBe(true)
    expect(r.profile['flashAttn']).toBe('on')
    expect(r.profile['ubatchSize']).toBe(256)
    expect(r.profile['threads']).toBe(16)
    expect(r.profile['parallel']).toBe(1)
  })

  it('caps the answer length at the context, and the context at what the header claims', () => {
    const small = recommendProfile(on({ contextMax: 8192 }))
    expect(small.summary.ctxSize).toBeLessThanOrEqual(8192)
    expect(small.profile['nPredict']).toBeLessThanOrEqual(8192)
    const big = recommendProfile(on())
    expect(big.profile['nPredict']).toBeLessThanOrEqual(32768)
  })

  it('says so, rather than loading blind, when nothing fits at all', () => {
    // A 60 GB file on a 28 GB machine.
    const r = recommendProfile(on({ fileBytes: 60e9 }))
    expect(r.summary.level).toBe('wont_fit')
    expect(r.summary.ctxSize).toBe(4096)
    expect(r.estimate.findings.map((f) => f.code)).toContain('exceeds-ram')
  })

  it('backs off when the machine is busy, rather than picking what would fit on an idle one', () => {
    // The first Auto on this machine chose 128K for the Q4_K_M with 20.6 GB
    // free, and the server could not start. Measured free RAM is a second
    // ceiling now, and the pick has to respect it.
    const idle = recommendProfile(on())
    const busy = recommendProfile(on({ hardware: { ...MACHINE, freeRamBytes: 20.6e9 } }))
    expect(busy.summary.ctxSize).toBeLessThan(idle.summary.ctxSize)
    expect(busy.summary.level).not.toBe('wont_fit')
  })

  it('backs off a quarter of the layers at a time, then to the CPU, then gives up', () => {
    // Measured rather than predicted: the device wall on this hardware
    // moved between 13.4 and 15.8 GiB the same evening, so Auto tries,
    // watches, and steps down.
    let r = recommendProfile(on({ fileBytes: IQ4_XS }))
    const seen: (number | 'cpu')[] = []
    for (let i = 0; i < 10; i++) {
      seen.push(r.summary.cpuOnly ? 'cpu' : r.summary.gpuLayers!.on)
      const next = backOff(r, QWEN)
      if (!next) break
      r = next
    }
    expect(seen).toEqual([58, 48, 39, 29, 19, 'cpu'])
    expect(backOff(r, QWEN)).toBeNull()
  })

  it('moves the cache to RAM when it falls back to the CPU', () => {
    // A cache "on the device" with --device none is a contradiction llama.cpp
    // resolves by ignoring it; say what will actually happen instead.
    const first = recommendProfile(on({ fileBytes: IQ4_XS, contextMax: 8192 }))
    let r = first
    for (;;) {
      const next = backOff(r, QWEN)
      if (!next) break
      r = next
    }
    expect(r.profile['device']).toBe('none')
    expect(r.profile['nGpuLayers']).toBeUndefined()
    expect(r.profile['noKvOffload']).toBe(true)
    expect(r.summary.kv.startsWith('ram')).toBe(true)
    // And the context it was chosen with is untouched: RAM is not what a
    // device failure is about.
    expect(r.profile['ctxSize']).toBe(first.profile['ctxSize'])
  })

  it('does not set a reasoning effort — the client asks per request now', () => {
    expect(recommendProfile(on()).profile['reasoningEffort']).toBeUndefined()
  })
})
