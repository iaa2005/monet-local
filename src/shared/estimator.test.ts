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

describe('estimate — the machine as it is right now', () => {
  it('takes the lower of the fixed reserve and what is actually free', () => {
    // The evening this was found: 20.6 GB free of 27.7. The fixed reserve
    // allowed 24.7 GB; the machine had 20.6. Auto picked 128K for the Q4_K_M
    // on the first number, and the projector could not get 3.5 MB.
    const busy: Hardware = { ...MACHINE, freeRamBytes: 20.6e9 }
    const p: Profile = {
      ...COMMON,
      ctxSize: 131072,
      noKvOffload: true,
      flashAttn: 'on',
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q4_0',
      nGpuLayers: 58,
    }
    expect(estimate(base(p)).level).not.toBe('wont_fit')
    const live = estimate({ ...base(p), hardware: busy })
    expect(live.level).toBe('wont_fit')
    expect(live.findings.map((f) => f.code)).toContain('ram-in-use')
  })

  it('says how the ceiling was arrived at, in the parts a person can check', () => {
    const busy: Hardware = { ...MACHINE, freeRamBytes: 20.6e9 }
    const live = estimate({ ...base({ ...COMMON, ctxSize: 8192 }), hardware: busy })
    expect(live.ramBudget.othersBytes).toBeCloseTo(MACHINE.totalRamBytes - 20.6e9, -6)
    // What is free IS the ceiling; nothing further is kept back from it.
    expect(live.ramBudget.reserveBytes).toBe(0)
    expect(live.ramCeiling).toBeCloseTo(20.6e9, -6)
    // Idle: the fixed reserve, and no "others" figure to show.
    const idle = estimate(base({ ...COMMON, ctxSize: 8192 }))
    expect(idle.ramBudget.othersBytes).toBeUndefined()
    expect(idle.ramBudget.reserveBytes).toBe(3 * 1024 ** 3)
  })

  it('calls a small model on a full laptop tight, not impossible', () => {
    // A Core Ultra 7 155H with 16 GB: 15.46 GiB reported, 2.03 GiB free with
    // a browser, a chat client and WSL open. SmolLM2-135M F16 (258 MiB) at
    // 8192 loaded and wrote at 128 tok/s on the Arc iGPU — while the screen
    // said "will not fit" of it and of every 84 MiB file on the download
    // list, because a two-gigabyte margin off 2.03 GiB free is a ceiling of
    // nothing.
    const laptop: Hardware = {
      totalRamBytes: 16_599_281_664,
      freeRamBytes: 2_181_820_416,
      devices: [
        {
          id: 'Vulkan0',
          name: 'Intel(R) Arc(TM) Graphics',
          totalBytes: 9023 * 1024 * 1024,
          freeBytes: 8316 * 1024 * 1024,
          uma: true,
        },
      ],
    }
    const smol: ModelGeometry = { blockCount: 30, kvHeads: 3, keyLength: 64, valueLength: 64 }
    const e = estimate({
      fileBytes: 270_885_952,
      geometry: smol,
      profile: { ...COMMON, ctxSize: 8192 },
      hardware: laptop,
    })
    expect(e.level).toBe('tight')
    expect(e.ramCeiling).toBe(2_181_820_416)
    expect(e.findings.map((f) => f.code)).toContain('ram-in-use')
    expect(e.findings.map((f) => f.code)).not.toContain('exceeds-ram')

    // And a 2.7 GB Qwen3.5-4B on the same afternoon is refused, with the
    // browser named as the reason rather than the machine.
    const qwen = estimate({
      fileBytes: 2_900_000_000,
      geometry: { blockCount: 32, kvHeads: 4, keyLength: 256, valueLength: 256, fullAttentionInterval: 4 },
      profile: { ...COMMON, ctxSize: 8192 },
      hardware: laptop,
    })
    expect(qwen.level).toBe('wont_fit')
    expect(qwen.findings.map((f) => f.code)).toContain('ram-in-use')
  })

  it('changes nothing when nobody measured', () => {
    const p: Profile = { ...COMMON, ctxSize: 8192 }
    expect(estimate(base(p)).ramCeiling).toBe(
      estimate({ ...base(p), hardware: { ...MACHINE } }).ramCeiling,
    )
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

  it('drops the device ceiling when nothing is on the device', () => {
    const cpu = estimate(base({ ...COMMON, ctxSize: 65536, device: 'none' }))
    expect(cpu.deviceBytes).toBeUndefined()
    expect(cpu.level).toBe('fits')

    // -ngl 0 used to be a different and fatal thing — the backend stayed
    // selected with nothing offloaded and llama.cpp aborted. The build now
    // rewrites it into --device none before it can reach the binary, so the
    // estimate has to agree: there is no device in this run to budget for.
    const ngl0 = estimate(base({ ...COMMON, ctxSize: 65536, nGpuLayers: 0 }))
    expect(ngl0.deviceBytes).toBeUndefined()
    expect(ngl0.level).toBe(cpu.level)
  })
})

describe('the two budgets are different sums', () => {
  it('publishes the device parts, and they add up to the device figure', () => {
    const e = estimate(base({ ...COMMON, ctxSize: 8192 }))
    const parts = e.deviceParts!
    expect(
      parts.weightsBytes + parts.kvBytes + parts.computeBytes,
    ).toBeCloseTo(e.deviceBytes!, 0)
  })

  it('costs more on the GPU than in RAM at the same context', () => {
    // The reason one bar could not answer for both: the device holds the
    // file rather than its repacked copy, and its cache carries the
    // allocator's overhead. A UI that drew the RAM parts against the device
    // ceiling would be drawing neither budget.
    const e = estimate(base({ ...COMMON, ctxSize: 16384 }))
    expect(e.deviceParts!.kvBytes).toBeGreaterThan(e.kvBytes)
    expect(e.deviceBytes!).toBeGreaterThan(e.deviceCeiling!)
    // ...while RAM has room to spare. Both are true at once, which is
    // exactly what the verdict has to show.
    expect(e.totalBytes).toBeLessThan(e.ramCeiling)
  })

  it('drops the device budget entirely when the cache is not offloaded', () => {
    const e = estimate(base({ ...COMMON, ctxSize: 32768, noKvOffload: true }))
    expect(e.deviceParts!.kvBytes).toBe(0)
  })
})
