import { describe, expect, it } from 'vitest'
import { estimate, type EstimateInput } from './estimator.js'
import type { Hardware, Profile } from './flags/types.js'
import type { ModelGeometry } from './models/geometry.js'

/**
 * The dev machine, exactly. 2×16 GB DDR5 reported as 29,761,810,432 bytes,
 * and a Radeon 780M whose allocator hands out 18287 MiB — four of them
 * reserved by the BIOS, the rest borrowed from the same RAM.
 */
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
const FILE = 16_810_714_336

const base = (profile: Profile): EstimateInput => ({
  fileBytes: FILE,
  geometry: QWEN,
  profile,
  hardware: MACHINE,
})

const COMMON: Profile = { noRepack: true, ubatchSize: 256, threads: 8 }

describe('estimate — replaying what actually happened', () => {
  it('passes the profile that measured 4.31 tok/s', () => {
    // 8192 with the cache on the GPU: the fastest thing this machine does.
    const e = estimate(base({ ...COMMON, ctxSize: 8192 }))
    expect(e.level).toBe('fits')
    expect(e.deviceBytes!).toBeLessThan(e.deviceCeiling!)
  })

  it('refuses 16384 with the cache on the GPU, as llama.cpp did', () => {
    // The wall that cost a day to understand. Not the RAM — there is plenty —
    // the device allocator: weights plus buffers already fill the shared pool
    // and llama.cpp dies on a 549 MB allocation.
    const e = estimate(base({ ...COMMON, ctxSize: 16384 }))
    expect(e.level).toBe('wont_fit')
    expect(e.findings.map((f) => f.code)).toContain('exceeds-device')
    expect(e.headroomBytes).toBeGreaterThan(0) // RAM was never the problem
    expect(e.suggestions.map((s) => s.code)).toContain('enable-no-kv-offload')
  })

  it('says quantising the cache does not open the device wall', () => {
    // Measured: 65536 and 131072 failed at q4_0 exactly as they did at f16.
    for (const [k, v] of [
      ['q8_0', 'q8_0'],
      ['q4_0', 'q4_0'],
    ] as const) {
      const e = estimate(
        base({ ...COMMON, ctxSize: 65536, cacheTypeK: k, cacheTypeV: v }),
      )
      expect(e.findings.map((f) => f.code)).toContain('exceeds-device')
    }
  })

  it('accepts 32768 once the cache moves to system RAM', () => {
    const e = estimate(base({ ...COMMON, ctxSize: 32768, noKvOffload: true }))
    expect(e.level).toBe('fits')
  })

  it('rejects the full 262144 at f16, and says the cache is why', () => {
    // 16 GiB of cache against 15.65 GiB of weights: the arithmetic behind the
    // five-hour answer.
    const e = estimate(base({ ...COMMON, ctxSize: 262144, noKvOffload: true }))
    expect(e.level).toBe('wont_fit')
    expect(e.findings.map((f) => f.code)).toContain('exceeds-ram')
    expect(e.findings.map((f) => f.code)).toContain('kv-dominates')
    expect(e.kvBytes).toBe(16 * 1024 ** 3)
    expect(e.suggestions.map((s) => s.code)).toContain('quantise-kv')
  })

  it('lets the full 262144 through once K and V are quantised, but calls it tight', () => {
    // The profile that ran and left 3.2 GB free — real, and not something to
    // describe as comfortable.
    const e = estimate(
      base({
        ...COMMON,
        ctxSize: 262144,
        noKvOffload: true,
        flashAttn: 'on',
        cacheTypeK: 'q8_0',
        cacheTypeV: 'q4_0',
      }),
    )
    expect(e.level).toBe('tight')
  })

  it('bills repack every time, and can be the thing that tips a profile over', () => {
    const on = base({ ctxSize: 8192, ubatchSize: 256, noRepack: false })
    const off = base({ ...COMMON, ctxSize: 8192 })
    const e = estimate(on)
    expect(e.findings.map((f) => f.code)).toContain('repack-cost')
    expect(e.suggestions.map((s) => s.code)).toContain('enable-no-repack')
    // The second copy of the weights, in bytes the user can see.
    expect(e.totalBytes - estimate(off).totalBytes).toBeCloseTo(
      FILE * 0.3,
      -6,
    )

    // And at a context that fits comfortably without it, repack is the
    // difference between room to spare and none.
    const roomy = { ...COMMON, ctxSize: 32768, noKvOffload: true }
    expect(estimate(base(roomy)).level).toBe('fits')
    expect(estimate(base({ ...roomy, noRepack: false })).level).toBe('tight')
  })

  it('offers a context that would actually fit', () => {
    const e = estimate(base({ ...COMMON, ctxSize: 262144, noKvOffload: true }))
    const lower = e.suggestions.find((s) => s.code === 'lower-context')
    expect(lower?.value).toBeGreaterThan(0)
    // And the offer has to be true: re-estimating at it must not fail.
    const retry = estimate(
      base({ ...COMMON, ctxSize: lower!.value!, noKvOffload: true }),
    )
    expect(retry.level).not.toBe('wont_fit')
  })
})

describe('estimate — honesty about what it does not know', () => {
  it('says so when the header carried no head counts', () => {
    const e = estimate({
      fileBytes: FILE,
      profile: { ...COMMON, ctxSize: 8192 },
      hardware: MACHINE,
    })
    expect(e.findings.map((f) => f.code)).toContain('no-geometry')
    expect(e.kvBytes).toBe(0)
  })

  it('counts the projector, which is loaded alongside', () => {
    const withVision = estimate({
      ...base({ ...COMMON, ctxSize: 8192 }),
      mmprojBytes: 931_145_856,
    })
    const without = estimate(base({ ...COMMON, ctxSize: 8192 }))
    expect(withVision.totalBytes - without.totalBytes).toBe(931_145_856)
  })

  it('drops the device ceiling when nothing is on the GPU', () => {
    const e = estimate(base({ ...COMMON, ctxSize: 65536, nGpuLayers: 0 }))
    expect(e.deviceBytes).toBeUndefined()
    expect(e.level).toBe('fits')
  })
})
