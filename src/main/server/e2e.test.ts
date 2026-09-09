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
const { publicModels } = await import('@shared/public-models.js')
import type { Activity } from './activity.js'

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
  let library: Awaited<ReturnType<typeof scanFolders>>['models'] = []

  beforeAll(async () => {
    ensureDirs()
    const models = scanFolders([MODELS]).models
    library = models
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
      // The real payload, through the real builder: this is the contract
      // Code Monet reads, so a stub here would test nothing.
      models: () =>
        publicModels(
          library.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            architecture: m.architecture,
            quant: m.quant,
            sizeBytes: m.sizeBytes,
            ...(m.contextMax !== undefined ? { contextMax: m.contextMax } : {}),
            ...(m.geometry ? { geometry: m.geometry } : {}),
            ...(m.mmprojPath ? { mmprojPath: m.mmprojPath } : {}),
            moe: m.moe,
          })),
          new Map(),
          () => ({ ctxSize: 4096, noRepack: true }),
          { totalRamBytes: 32e9, devices: [] },
        ),
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
        // Room for the thinking AND the answer. This model reasons before
        // it replies, and a cap that only fits the reasoning returns an
        // empty `content` with the words in `reasoning_content` — which is
        // correct behaviour and a flaky test. Measured: the thinking for
        // this prompt runs to about eighty tokens.
        max_tokens: 200,
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
  }, 300_000)

  it('answers the Anthropic Messages API on the same port', async () => {
    // The reason Claude Code can point ANTHROPIC_BASE_URL here.
    const res = await fetch(url('/v1/messages'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        // As above: the reply has to survive the thinking, or the `text`
        // block this test is about never gets written.
        max_tokens: 200,
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
  }, 300_000)

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

  it('publishes the fields Code Monet reads off a model', async () => {
    // The contract between the two apps. Code Monet fills a model's context
    // window, its modalities and its display name from exactly these names;
    // renaming one here would silently give every model over there a guessed
    // context and no vision.
    const body = (await (
      await fetch(url('/monet-local/v1/models'))
    ).json()) as { data: Record<string, unknown>[] }

    const model = body.data.find((m) => m['id'] === modelId)
    expect(model).toBeDefined()
    for (const field of [
      'id',
      'status',
      'display_name',
      'context_max',
      'context_configured',
      'predict_configured',
      'modalities',
      'verdict',
    ]) {
      expect(model, field).toHaveProperty(field)
    }
    expect(model!['modalities']).toContain('text')
  })

  it('reports the model unloaded once unload returns', async () => {
    // The bug this is for: llama.cpp answers 200 on /models/unload about two
    // seconds before it stops reporting the model as loaded. Returning on
    // the 200 left the screen offering Unload for a model that was already
    // gone, and the second click came back 400 "model is not running".
    await router.unload(modelId)

    const after = await router.status()
    expect(after.models.find((m) => m.id === modelId)?.status).toBe('unloaded')

    // And the state the screen reads is settled enough that acting on it is
    // not a race: a second unload is refused, which is what the button must
    // no longer be able to ask for.
    await expect(router.unload(modelId)).rejects.toThrow()
  })

  it('loads it again, and the poll reports the change', async () => {
    const seen: string[] = []
    const off = router.onChange((s) => {
      const v = s.models.find((m) => m.id === modelId)?.status
      if (v && seen[seen.length - 1] !== v) seen.push(v)
    })
    await router.load(modelId)
    // load() returns as soon as the router accepts it; nothing but the poll
    // moves the screen on from there.
    for (let i = 0; i < 300; i++) {
      const v = (await router.status()).models.find((m) => m.id === modelId)
      if (v?.status === 'loaded') break
      await new Promise((r) => setTimeout(r, 400))
    }
    off()
    expect(seen).toContain('loaded')
  }, 180_000)

  it('reports what the model is doing while it does it', async () => {
    // The whole path the Server screen watches: the router's own timer, a
    // `/slots` call per loaded model, the fold in activity.ts and the rate.
    // Unit tests cover the parsing against captured JSON; this is the part
    // that would break if llama.cpp renamed a field or the router stopped
    // proxying the endpoint, and neither would show up anywhere else.
    const seen: Activity[] = []
    const off = router.onActivity((a) => {
      const mine = a[modelId]
      if (mine) seen.push(mine)
    })

    const res = await fetch(url('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'user', content: 'Explain what a matrix is, at length.' },
        ],
        max_tokens: 64,
        stream: true,
      }),
    })
    const reader = res.body!.getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    // One more beat, so the last sample is the finished state.
    await new Promise((r) => setTimeout(r, 1500))
    off()

    const busy = seen.filter((a) => a.state === 'generating')
    expect(busy.length).toBeGreaterThan(1)
    // A counter, not a flag: it has to go up.
    const counts = busy.map((a) => a.decoded)
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts))
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!)
    }
    // A speed appears once there is a window to divide by, and it is a
    // speed rather than a stuck constant.
    const rates = busy.map((a) => a.tokensPerSecond).filter((v) => v !== undefined)
    expect(rates.length).toBeGreaterThan(0)
    for (const r of rates) expect(r).toBeGreaterThan(0)
    // And it stops: the last thing the screen is told is that it is idle.
    expect(seen[seen.length - 1]?.state).toBe('idle')
  }, 300_000)
})
