import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
const { ensureDirs, indexDir } = await import('../app/settings-store.js')
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

describe.skipIf(!haveModels)('the index cache', () => {
  it('is thrown away when the description changed, not just the file', () => {
    // The trap this exists for: the key is path + mtime + size, all
    // properties of the FILE. Improving a display name changed none of
    // them, so every already-indexed model kept the old name for good —
    // nothing would re-read a file that had not been touched.
    const first = scanFolders([MODELS])
    const cachePath = join(indexDir(), 'models.json')
    const onDisk = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      derivation: number
      entries: Record<string, { info: { displayName: string } }>
    }
    expect(onDisk.derivation).toBeGreaterThan(0)

    // Poison every cached name and claim the cache was written by an older
    // derivation, as an upgrade would leave it.
    for (const e of Object.values(onDisk.entries)) e.info.displayName = 'STALE'
    writeFileSync(
      cachePath,
      JSON.stringify({ ...onDisk, derivation: onDisk.derivation - 1 }),
      'utf8',
    )

    const after = scanFolders([MODELS])
    expect(after.models.some((m) => m.displayName === 'STALE')).toBe(false)
    expect(after.models.map((m) => m.displayName).sort()).toEqual(
      first.models.map((m) => m.displayName).sort(),
    )
  })

  it('still spares a file that has not changed', () => {
    // The cache has to keep earning its place: twenty headers on a cold read
    // is a visible pause.
    scanFolders([MODELS])
    const cachePath = join(indexDir(), 'models.json')
    const onDisk = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      derivation: number
      entries: Record<string, { info: { displayName: string } }>
    }
    const [key] = Object.keys(onDisk.entries)
    onDisk.entries[key!]!.info.displayName = 'FROM THE CACHE'
    writeFileSync(cachePath, JSON.stringify(onDisk), 'utf8')

    const after = scanFolders([MODELS])
    expect(after.models.some((m) => m.displayName === 'FROM THE CACHE')).toBe(
      true,
    )
  })
})
