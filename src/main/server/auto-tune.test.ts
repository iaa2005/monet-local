import { describe, expect, it } from 'vitest'
import { recommendProfile } from '@shared/auto-profile.js'
import type { Hardware } from '@shared/flags/types.js'
import type { ModelGeometry } from '@shared/models/geometry.js'
import { autoTune, type AutoProgress } from './auto-tune.js'
import type { Router } from './router.js'

/**
 * The loop, against a router that behaves the way this machine did: a
 * candidate with too many layers on the GPU loads fine and then dies on its
 * first token, and one with fewer answers. No llama.cpp here — what is
 * being checked is the order of operations and that every attempt is
 * reported, not the model.
 */

const MACHINE: Hardware = {
  totalRamBytes: 29_761_810_432,
  devices: [
    { id: 'Vulkan0', name: '780M', totalBytes: 18287 * 1024 * 1024, freeBytes: 17373 * 1024 * 1024, uma: true },
  ],
}
const QWEN: ModelGeometry = { blockCount: 65, kvHeads: 4, keyLength: 256, valueLength: 256, fullAttentionInterval: 4 }

function first() {
  return recommendProfile({
    fileBytes: 14_252_845_984,
    geometry: QWEN,
    contextMax: 262144,
    hardware: MACHINE,
    cpuThreads: 16,
  })
}

/** A router whose verdict on a candidate is a function of its layer count. */
function fakeRouter(diesAbove: number, loadFailsAbove = Infinity) {
  const log: string[] = []
  let layers = 0
  const router = {
    port: 1,
    start: async (entries: { profile: Record<string, unknown> }[]) => {
      layers = Number(entries[0]?.profile['nGpuLayers'] ?? 0)
      log.push(`start ngl=${entries[0]?.profile['nGpuLayers'] ?? 'all'} dev=${entries[0]?.profile['device'] ?? 'gpu'}`)
    },
    loadAndWait: async () => {
      log.push('load')
      if (layers > loadFailsAbove) throw new Error('ErrorOutOfDeviceMemory')
    },
    lastCrash: () =>
      layers > diesAbove
        ? { id: 'm', code: -1073741819, label: 'access violation (0xC0000005)', crashed: true, at: Date.now() }
        : undefined,
  } as unknown as Router
  const probe = async (): Promise<void> => {
    log.push('probe')
    if (layers > diesAbove) throw new Error('read ECONNRESET')
  }
  return { router, probe, log }
}

describe('autoTune — try, watch, back off', () => {
  it('writes before it starts, starts before it loads, loads before it asks', async () => {
    const { router, probe, log } = fakeRouter(Infinity)
    const written: unknown[] = []
    const r = await autoTune('m', first(), QWEN, {
      router: () => router,
      write: (p) => void written.push(p),
      entries: () => [{ id: 'm', profile: written[written.length - 1] as never, modelPath: 'x' }],
      probe,
    })
    expect(log).toEqual(['start ngl=58 dev=gpu', 'load', 'probe'])
    expect(r.attempts).toEqual([{ summary: r.result.summary, ok: true }])
    expect(written).toHaveLength(1)
  })

  it('backs off when the model dies on its first token, and names the fault', async () => {
    // What happened here: 58 of 65 loads and crashes; 48 runs. The socket
    // error the probe sees is not the reason — the crash record is.
    const { router, probe, log } = fakeRouter(50)
    const progress: AutoProgress[] = []
    let current: Record<string, unknown> = {}
    const r = await autoTune('m', first(), QWEN, {
      router: () => router,
      write: (p) => void (current = p),
      entries: () => [{ id: 'm', profile: current as never, modelPath: 'x' }],
      probe,
      onProgress: (p) => void progress.push(p),
    })
    expect(r.attempts.map((a) => [a.summary.gpuLayers?.on, a.ok])).toEqual([[58, false], [48, true]])
    expect(r.attempts[0]?.reason).toBe('access violation (0xC0000005)')
    expect(log).toEqual(['start ngl=58 dev=gpu', 'load', 'probe', 'start ngl=48 dev=gpu', 'load', 'probe'])
    expect(progress.map((p) => `${p.attempt}:${p.phase}`)).toEqual([
      '1:loading', '1:probing', '1:failed', '2:loading', '2:probing', '2:ok',
    ])
    // The configuration left behind is the one that ran.
    expect(current['nGpuLayers']).toBe(48)
  })

  it('a refused load is a failed attempt too, with the server’s own reason', async () => {
    const { router, probe } = fakeRouter(Infinity, 50)
    let current: Record<string, unknown> = {}
    const r = await autoTune('m', first(), QWEN, {
      router: () => router,
      write: (p) => void (current = p),
      entries: () => [{ id: 'm', profile: current as never, modelPath: 'x' }],
      probe,
    })
    expect(r.attempts[0]).toMatchObject({ ok: false, reason: 'ErrorOutOfDeviceMemory' })
    expect(r.attempts[1]?.ok).toBe(true)
  })

  it('goes all the way down to the CPU, and says when even that failed', async () => {
    const { router, probe, log } = fakeRouter(-1)
    const progress: AutoProgress[] = []
    let current: Record<string, unknown> = {}
    const r = await autoTune('m', first(), QWEN, {
      router: () => router,
      write: (p) => void (current = p),
      entries: () => [{ id: 'm', profile: current as never, modelPath: 'x' }],
      probe,
      onProgress: (p) => void progress.push(p),
    })
    expect(r.attempts.map((a) => (a.summary.cpuOnly ? 'cpu' : a.summary.gpuLayers?.on))).toEqual([
      58, 48, 39, 29, 19, 'cpu',
    ])
    expect(r.attempts.every((a) => !a.ok)).toBe(true)
    expect(log[log.length - 3]).toBe('start ngl=all dev=none')
    expect(progress[progress.length - 1]?.phase).toBe('gave-up')
  })

  it('stops at the attempt limit rather than trying every rung', async () => {
    const { router, probe } = fakeRouter(-1)
    let current: Record<string, unknown> = {}
    const r = await autoTune('m', first(), QWEN, {
      router: () => router,
      write: (p) => void (current = p),
      entries: () => [{ id: 'm', profile: current as never, modelPath: 'x' }],
      probe,
      maxAttempts: 2,
    })
    expect(r.attempts).toHaveLength(2)
  })
})
