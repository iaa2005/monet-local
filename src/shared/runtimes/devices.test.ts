import { describe, expect, it } from 'vitest'
import { hasUsableDevice, parseDevices } from './devices.js'

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

  it('reports nothing usable when a pack finds no hardware', () => {
    const cpuOnly = `load_backend: loaded CPU backend from ggml-cpu.dll
Available devices:`
    expect(parseDevices(cpuOnly)).toEqual([])
    expect(hasUsableDevice(parseDevices(cpuOnly))).toBe(false)
    expect(hasUsableDevice(parseDevices(VULKAN_780M))).toBe(true)
  })
})
