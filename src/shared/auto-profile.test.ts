import { describe, expect, it } from 'vitest'
import { backOff, classifyFailure, recommendProfile, type AutoInput } from './auto-profile.js'
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

  it('on a full device: projector, cache, batch, layers, then the CPU', () => {
    // The run that shaped this order: every GPU attempt from 58 layers down
    // to 19 failed on the same 931 MB allocation, the projector, which no
    // number of dropped layers ever touched. So the cheapest thing goes
    // first — the projector costs nothing on the CPU but seconds per image.
    let r = recommendProfile(on({ fileBytes: IQ4_XS, mmprojBytes: 931_145_856 }))
    const seen: string[] = []
    const label = (x: typeof r): string =>
      x.summary.cpuOnly
        ? 'cpu'
        : `${x.summary.gpuLayers!.on}${x.summary.projectorOnCpu ? '+proj' : ''}${x.summary.kv.startsWith('ram') ? '+ram' : ''}${x.summary.ubatch < 256 ? '+ub64' : ''}`
    for (let i = 0; i < 12 && !r.summary.cpuOnly; i++) {
      seen.push(label(r))
      const next = backOff(r, { geometry: QWEN, mmprojBytes: 931_145_856 }, 'device')
      if (!next) break
      r = next
    }
    seen.push(label(r))
    // The starting pick already had the cache in RAM at this size, so that
    // step is skipped: nothing is "given up" twice.
    expect(seen).toEqual([
      '58+ram', '58+proj+ram', '58+proj+ram+ub64', '48+proj+ram+ub64', '39+proj+ram+ub64',
      '29+proj+ram+ub64', '19+proj+ram+ub64', 'cpu',
    ])
    // With no device left, a failure is the machine's, and the machine's
    // ladder takes over: the context comes down. That is the other wall the
    // user named — RAM, for a model that is simply too big.
    const ctxBefore = r.summary.ctxSize
    const next = backOff(r, { geometry: QWEN, mmprojBytes: 931_145_856 }, classifyFailure('exit code 1', true))
    expect(next?.summary.ctxSize).toBe(ctxBefore / 2)
  })

  it('on a full machine: quantise the cache, then the batch, then halve the context', () => {
    let r = recommendProfile(on({ contextMax: 65536, hardware: { totalRamBytes: MACHINE.totalRamBytes, devices: [] } }))
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      seen.push(`${r.summary.ctxSize / 1024}K ${r.summary.kv} ub${r.summary.ubatch}`)
      const next = backOff(r, { geometry: QWEN }, 'ram')
      if (!next) break
      r = next
    }
    // The floor is 4096 — below that a chat is not usable — and then nothing.
    expect(seen[seen.length - 1]).toBe('4K ram-quantised ub64')
    expect(seen.some((x) => x.includes('ram-f16'))).toBe(seen[0]!.includes('ram-f16'))
    expect(backOff(r, { geometry: QWEN }, 'ram')).toBeNull()
  })

  it('a device failure on a CPU-only run is a RAM failure — there is no device', () => {
    expect(classifyFailure('ggml_vulkan: Memory allocation of size 3538944 failed', true)).toBe('ram')
    expect(classifyFailure('ggml_vulkan: Memory allocation of size 3538944 failed', false)).toBe('device')
  })

  it('reads the wall off the server line', () => {
    expect(classifyFailure('vk::Device::allocateMemory: ErrorOutOfDeviceMemory', false)).toBe('device')
    expect(classifyFailure('access violation (0xC0000005)', false)).toBe('device')
    expect(classifyFailure('std::bad_alloc', false)).toBe('ram')
    expect(classifyFailure('failed to allocate buffer of size 3221225472', false)).toBe('ram')
    // Nothing recognisable: judged by where the weights were.
    expect(classifyFailure('exit code 1', false)).toBe('device')
    expect(classifyFailure('exit code 1', true)).toBe('ram')
  })

  it('moves the cache to RAM and the projector back when it falls to the CPU', () => {
    let r = recommendProfile(on({ fileBytes: IQ4_XS, contextMax: 8192, mmprojBytes: 1 }))
    for (;;) {
      const next = backOff(r, { geometry: QWEN, mmprojBytes: 1 }, 'device')
      if (!next) break
      r = next
    }
    expect(r.profile['device']).toBe('none')
    expect(r.profile['nGpuLayers']).toBeUndefined()
    expect(r.profile['noMmprojOffload']).toBeUndefined()
    expect(r.profile['noKvOffload']).toBe(true)
    expect(r.summary.kv.startsWith('ram')).toBe(true)
  })

  it('does not set a reasoning effort — the client asks per request now', () => {
    expect(recommendProfile(on()).profile['reasoningEffort']).toBeUndefined()
  })
})
