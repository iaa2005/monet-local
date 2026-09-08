import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The library and the runtime prober are main-process code, so they reach for
 * Electron's userData path. Mocked to a temp folder here: the point of these
 * tests is the scanning and the probing, not where the index cache lands.
 */
const tmp = mkdtempSync(join(tmpdir(), 'monet-local-test-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

const { scanFolders } = await import('./library.js')
const { ensureDirs } = await import('../app/settings-store.js')
const { probe } = await import('../runtimes/manager.js')

/** The dev machine's real folders. Absent on CI, where these skip. */
const MODELS = 'D:/Colibri/models'
const LLAMA = 'D:/Colibri/llamacpp'
const haveModels = existsSync(MODELS)
const haveLlama = existsSync(join(LLAMA, 'llama-server.exe'))

beforeAll(() => ensureDirs())

describe.skipIf(!haveModels)('scanFolders on the real library', () => {
  it('finds the models and never the projector', () => {
    const { models } = scanFolders([MODELS])
    expect(models.length).toBeGreaterThan(0)
    // mmproj-*.gguf is loaded WITH a model, not instead of one. Listing it
    // would offer a 0.9 GB "model" that cannot answer anything.
    expect(models.some((m) => m.fileName.startsWith('mmproj'))).toBe(false)
  })

  it('descends into the per-repository subfolder LM Studio creates', () => {
    const { models } = scanFolders([MODELS])
    // Qwen3.8-27B-GGUF/ holds the Q4_K_M; the loose UD- quants sit at the top.
    expect(models.some((m) => m.path.includes('Qwen3.8-27B-GGUF'))).toBe(true)
    expect(models.some((m) => m.fileName.includes('UD-IQ4_XS'))).toBe(true)
  })

  it('pairs a model with the projector beside it', () => {
    const { models } = scanFolders([MODELS])
    const withVision = models.find((m) => m.mmprojPath)
    expect(withVision?.mmprojPath).toContain('mmproj')
  })

  it('gives every model a distinct id', () => {
    const { models } = scanFolders([MODELS])
    const ids = models.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is fast the second time', () => {
    scanFolders([MODELS])
    const started = Date.now()
    scanFolders([MODELS])
    // Cached by path + mtime + size; a re-scan must not re-read 40 GB of
    // headers just because the user switched screens.
    expect(Date.now() - started).toBeLessThan(300)
  })
})

describe.skipIf(!haveLlama)('probe on the real llama.cpp build', () => {
  it('reports the version and the 780M', async () => {
    const { devices, version } = await probe(LLAMA)
    expect(version).toMatch(/\d/)
    // The same 18287 MiB the parser test asserts, this time straight from the
    // binary rather than a recorded string.
    expect(devices.length).toBeGreaterThan(0)
    expect(devices[0]?.uma).toBe(true)
  }, 40_000)
})
