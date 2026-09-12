import { describe, expect, it } from 'vitest'
import { hasUsableDevice, integratedByName, parseDevices } from './devices.js'

/** Verbatim from this machine, b10826 Vulkan. */
const VULKAN_780M = `load_backend: loaded RPC backend from D:\\Colibri\\llamacpp\\ggml-rpc.dll
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon 780M Graphics (AMD proprietary driver) | uma: 1 | fp16: 1 | bf16: 1 | fp4: 0 | warp size: 64 | shared memory: 32768 | int dot: 1 | matrix cores: KHR_coopmat
load_backend: loaded Vulkan backend from D:\\Colibri\\llamacpp\\ggml-vulkan.dll
load_backend: loaded CPU backend from D:\\Colibri\\llamacpp\\ggml-cpu-zen4.dll
Available devices:
  Vulkan0: AMD Radeon 780M Graphics (18287 MiB, 17373 MiB free)`

/**
 * A discrete card, in the shape the CUDA backend prints. No hardware here to
 * produce it, so it is a fixture — see docs/PLAN.md §6 on why every backend
 * goes through this one parser.
 */
const CUDA_TWO_CARDS = `ggml_cuda_init: found 2 CUDA devices:
  Device 0: NVIDIA GeForce RTX 4090, compute capability 8.9, VMM: yes
  Device 1: NVIDIA GeForce RTX 3090, compute capability 8.6, VMM: yes
Available devices:
  CUDA0: NVIDIA GeForce RTX 4090 (24564 MiB, 23875 MiB free)
  CUDA1: NVIDIA GeForce RTX 3090 (24576 MiB, 24100 MiB free)`

describe('parseDevices', () => {
  it('reads the 780M, memory and all', () => {
    const [d] = parseDevices(VULKAN_780M)
    expect(d?.id).toBe('Vulkan0')
    expect(d?.name).toBe('AMD Radeon 780M Graphics')
    // 18287 MiB — the number that proves the "4 GB" in Device Manager is a
    // BIOS reservation, not a ceiling.
    expect(d?.totalBytes).toBe(18287 * 1024 * 1024)
    expect(d?.freeBytes).toBe(17373 * 1024 * 1024)
  })

  it('picks up uma from the banner line, not the device list', () => {
    // The whole reason the two-pass parse exists: this bit decides whether
    // the device's memory is added to the budget or taken out of it.
    expect(parseDevices(VULKAN_780M)[0]?.uma).toBe(true)
  })

  it('handles several discrete devices', () => {
    const d = parseDevices(CUDA_TWO_CARDS)
    expect(d.map((x) => x.id)).toEqual(['CUDA0', 'CUDA1'])
    expect(d[0]?.totalBytes).toBe(24564 * 1024 * 1024)
    // No uma field printed — left undefined rather than guessed false, so a
    // future backend that omits it is visible instead of silently discrete.
    expect(d[0]?.uma).toBeUndefined()
  })

  it('knows Metal is unified memory without being told', () => {
    // llama-bench on a Mac prints the device and no `uma` banner line. The
    // GPU's memory IS the RAM there; counting it twice would promise a
    // 32 GB laptop 64.
    const [d] = parseDevices(`Available devices:
  MTL0: Apple M2 Pro (32768 MiB, 32768 MiB free)`)
    expect(d?.id).toBe('MTL0')
    expect(d?.uma).toBe(true)
    expect(d?.totalBytes).toBe(32768 * 1024 * 1024)
  })

  it('reports nothing usable when a pack finds no hardware', () => {
    const cpuOnly = `load_backend: loaded CPU backend from ggml-cpu.dll
Available devices:`
    expect(parseDevices(cpuOnly)).toEqual([])
    expect(hasUsableDevice(parseDevices(cpuOnly))).toBe(false)
    expect(hasUsableDevice(parseDevices(VULKAN_780M))).toBe(true)
  })
})

/**
 * Verbatim from a Core Ultra 7 155H, b10924 SYCL. No banner line, no `uma`
 * field — the same Intel Arc iGPU that the Vulkan pack calls `uma: 1`.
 */
const SYCL_ARC_IGPU = `Warning: zesInit failed [ggml_check_sycl] with code 2013265921. Sysman free-memory query may be unavailable.
Available devices:
Warning: zesInit failed with code 2013265921. Sysman free-memory query may be unavailable.
  SYCL0: Intel(R) Arc(TM) Graphics (9023 MiB, 7730 MiB free)`

describe('integrated GPUs that do not say so', () => {
  it('reads the SYCL pack on an Intel laptop as shared memory', () => {
    // Without this the SYCL pack showed no UMA badge beside a 9 GiB
    // "card" that is a slice of the 16 GB the laptop has.
    const [d] = parseDevices(SYCL_ARC_IGPU)
    expect(d?.id).toBe('SYCL0')
    expect(d?.uma).toBe(true)
    expect(d?.totalBytes).toBe(9023 * 1024 * 1024)
  })

  it('knows the integrated names and leaves the discrete ones alone', () => {
    for (const name of [
      'Intel(R) Arc(TM) Graphics',
      'Intel(R) Arc(TM) 140V GPU (16GB)',
      'Intel(R) Iris(R) Xe Graphics',
      'Intel(R) UHD Graphics 770',
      'AMD Radeon 780M Graphics',
      'AMD Radeon(TM) Graphics',
      'AMD Radeon 8060S Graphics',
    ])
      expect(integratedByName(name), name).toBe(true)
    for (const name of [
      'Intel(R) Arc(TM) A770 Graphics',
      'Intel(R) Arc(TM) B580 Graphics',
      'Intel(R) Arc(TM) Pro B70 Graphics',
      'AMD Radeon RX 7900 XTX',
      'NVIDIA GeForce RTX 4090',
    ])
      expect(integratedByName(name), name).toBe(false)
    // The banner, when there is one, wins: a Vulkan line saying `uma: 0`
    // is not overruled by a name.
    const d = parseDevices(`ggml_vulkan: 0 = Intel(R) Arc(TM) Graphics (Intel Corporation) | uma: 0 | fp16: 1
Available devices:
  Vulkan0: Intel(R) Arc(TM) Graphics (9023 MiB, 8316 MiB free)`)
    expect(d[0]?.uma).toBe(false)
  })
})
