import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'monet-local-e2e-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp, getVersion: () => '0.1.0' } }))

const { Router } = await import('./router.js')
const { Gateway } = await import('./gateway.js')
const { ensureDirs } = await import('../app/settings-store.js')
const { scanFolders } = await import('../models/library.js')

const LLAMA = 'D:/Colibri/llamacpp/llama-server.exe'
const MODELS = 'D:/Colibri/models'
/**
 * The whole chain, with a model actually loaded: Monet Local's port → the
 * gateway → the router → a llama.cpp child → back.
 *
 * This is the milestone's own acceptance check, and it is slow on purpose —
 * loading 16 GB and generating a few tokens at four a second is what the
 * app does for a living. `MONET_E2E=1 npm test` runs it; nothing else does,
 * because a suite that takes three minutes stops being run.
 */
const enabled =
  process.env['MONET_E2E'] === '1' && existsSync(LLAMA) && existsSync(MODELS)

// Ports derived from the process, not fixed: a run that dies in beforeAll
// can leave a listener behind, and the next run then fails with EADDRINUSE
// on something that has nothing to do with what is being tested.
const ROUTER_PORT = 17200 + (process.pid % 200) * 2
const GATEWAY_PORT = ROUTER_PORT + 1
const url = (p: string): string => `http://127.0.0.1:${GATEWAY_PORT}${p}`

describe.skipIf(!enabled)('end to end, through the gateway', () => {
  const router = new Router(LLAMA, ROUTER_PORT)
  let gateway: InstanceType<typeof Gateway>
  let modelId = ''

  beforeAll(async () => {
    ensureDirs()
    const models = scanFolders([MODELS]).models
    const model = models.find((m) => m.id.includes('q4_k_m')) ?? models[0]!
    modelId = model.id

    await router.start([
      {
        id: model.id,
        // CPU only, deliberately. The GPU path is covered by the estimator
        // and router tests; here it would make the result depend on what else
        // is using the GPU right now. That is not hypothetical: this test
        // failed on a machine where Photoshop was open, with llama.cpp unable
        // to allocate 150 MB while `--list-devices` still cheerfully reported
        // 17373 MiB free. On a shared-memory GPU that figure does not account
        // for what other applications have reserved.
        profile: {
          ctxSize: 4096,
          noRepack: true,
          // --device none, NOT -ngl 0: the latter leaves the Vulkan backend
          // selected with nothing offloaded and this model aborts the process
          // on that path (exit 0xC0000409, no message at all).
          device: 'none',
          ubatchSize: 256,
          parallel: 1,
          nPredict: 64,
          reasoningEffort: 'low',
        },
        modelPath: model.path,
      },
    ])

    gateway = new Gateway(GATEWAY_PORT, {
      router: () => router,
      models: () => [],
      info: () => ({ name: 'Monet Local', capabilities: { anthropic: true } }),
      apiKey: () => undefined,
      networkAccess: () => false,
    })
    await gateway.start()

    await router.load(modelId)
    // Loading is asynchronous; the router reports `loading` until the child
    // has the weights.
    for (let i = 0; i < 240; i++) {
      const s = await router.status()
      if (s.models.find((m) => m.id === modelId)?.status === 'loaded') return
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('model did not load')
  }, 300_000)

  afterAll(async () => {
    await gateway?.stop()
    await router.stop()
  }, 60_000)

  it('lists the loaded model on the standard endpoint', async () => {
    const body = (await (await fetch(url('/v1/models'))).json()) as {
      data: { id: string }[]
    }
    expect(body.data.map((m) => m.id)).toEqual([modelId])
  })

  it('answers an OpenAI chat completion', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 24,
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      choices: { message: { content: string } }[]
      timings?: { predicted_per_second?: number }
    }
    expect(body.choices[0]?.message.content).toBeTruthy()
    // Not an assertion about speed — just proof this ran on real weights.
    expect(body.timings?.predicted_per_second).toBeGreaterThan(0)
  }, 180_000)

  it('answers the Anthropic Messages API on the same port', async () => {
    // The reason Claude Code can point ANTHROPIC_BASE_URL here.
    const res = await fetch(url('/v1/messages'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 24,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      type?: string
      content?: { type: string; text?: string; thinking?: string }[]
    }
    expect(body.type).toBe('message')

    // The FIRST block is not the answer: a thinking model emits a proper
    // Anthropic `thinking` block and puts the reply in a later `text` one.
    // Assuming content[0] was the answer is how a client ends up rendering
    // an empty message — Claude Code gets this right because the shape is
    // the real one, and so should this test.
    const thinking = body.content?.find((c) => c.type === 'thinking')
    const text = body.content?.find((c) => c.type === 'text')
    expect(thinking?.thinking, JSON.stringify(body).slice(0, 300)).toBeTruthy()
    expect(text?.text, JSON.stringify(body).slice(0, 300)).toBeTruthy()
  }, 180_000)

  it('streams a completion in pieces', async () => {
    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Count to five.' }],
        max_tokens: 32,
        stream: true,
      }),
    })
    const reader = res.body!.getReader()
    let reads = 0
    for (;;) {
      const { done } = await reader.read()
      if (done) break
      reads++
    }
    expect(reads).toBeGreaterThan(1)
  }, 180_000)
})
