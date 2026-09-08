import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'monet-local-router-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

const { Router } = await import('./router.js')
const { ensureDirs } = await import('../app/settings-store.js')
const { scanFolders } = await import('../models/library.js')
const { SEED } = await import('../app/profiles-store.js')

const LLAMA = 'D:/Colibri/llamacpp/llama-server.exe'
const MODELS = 'D:/Colibri/models'
const canRun = existsSync(LLAMA) && existsSync(MODELS)

/**
 * A real llama.cpp router, started against the real library.
 *
 * Nothing is LOADED: the point is the contract around loading — that the INI
 * is generated from our own library rather than `--models-dir` guessing, that
 * every model shows up as a section, and that a request for a model nobody
 * loaded is refused cleanly instead of quietly starting a multi-minute load.
 * Loading 16 GB in a unit test would be a different kind of test.
 *
 * Port 17173, not the 17172 the app uses, so running the suite while the app
 * is open does not collide.
 */
describe.skipIf(!canRun)('Router against real llama.cpp', () => {
  const router = new Router(LLAMA, 17173)

  beforeAll(async () => {
    ensureDirs()
    const models = scanFolders([MODELS]).models
    await router.start(
      models.map((m) => ({
        id: m.id,
        profile: SEED.values,
        modelPath: m.path,
        ...(m.mmprojPath ? { mmprojPath: m.mmprojPath } : {}),
      })),
    )
  }, 90_000)

  afterAll(async () => {
    await router.stop()
  }, 30_000)

  it('reaches ready', () => {
    expect(router.state).toBe('ready')
  })

  it('lists every model from our library, none of them loaded', async () => {
    const s = await router.status()
    expect(s.models.length).toBeGreaterThan(0)
    expect(s.models.every((m) => m.status === 'unloaded')).toBe(true)
    // Ids are our slugs, which is what a client will send in `model`.
    expect(s.models.map((m) => m.id)).toContain('qwen3.8-27b-q4_k_m')
  })

  it('wrote an INI carrying our flags, not llama.cpp defaults', () => {
    const ini = readFileSync(join(tmp, 'router', 'models.ini'), 'utf8')
    expect(ini).toContain('[qwen3.8-27b-q4_k_m]')
    // The flag whose absence turned a working model into a swap storm.
    expect(ini).toContain('repack = 0')
    expect(ini).toContain('webui = 0')
    expect(ini).toContain('c = 8192')
  })

  it('picked the right file out of a folder holding several quants', () => {
    // What `--models-dir` gets wrong: it treats the folder as one model and
    // chose the 22 GB Q6_K, the only quant that does not fit this machine.
    const ini = readFileSync(join(tmp, 'router', 'models.ini'), 'utf8')
    const section = ini
      .split('[')
      .find((s) => s.startsWith('qwen3.8-27b-q4_k_m]'))
    expect(section).toContain('Qwen3.8-27B-Q4_K_M.gguf')
    expect(section).not.toContain('Q6_K.gguf')
  })

  it('refuses a request for a model nobody loaded', async () => {
    const ask = async (model: string): Promise<{ status: number; message: string }> => {
      const res = await fetch('http://127.0.0.1:17173/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      })
      const body = (await res.json()) as { error?: { message?: string } }
      return { status: res.status, message: body.error?.message ?? '' }
    }

    // Two different refusals, and the difference matters for the proxy that
    // fronts this in M3: one means "load it in Monet Local", the other means
    // "that model is not in your library at all".
    const notLoaded = await ask('qwen3.8-27b-q4_k_m')
    expect(notLoaded.status).toBe(400)
    expect(notLoaded.message).toMatch(/not loaded/i)

    const unknown = await ask('no-such-model')
    expect(unknown.status).toBe(400)
    expect(unknown.message).toMatch(/not found/i)
  })

  it('serves the Anthropic shape as well as the OpenAI one', async () => {
    // Both APIs come from llama.cpp itself; this is the check that the build
    // in use actually carries the Anthropic routes.
    const res = await fetch(
      'http://127.0.0.1:17173/v1/messages/count_tokens',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3.8-27b-q4_k_m',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      },
    )
    // 400 because the model is not loaded — not 404, which would mean the
    // route does not exist.
    expect(res.status).not.toBe(404)
  })
})
