import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Gateway } from './gateway.js'
import type { Router } from './router.js'

/**
 * A stand-in for llama.cpp, so the gateway's own behaviour is tested without
 * 16 GB of weights: the parts that matter here are the key check, the model
 * filter and whether a stream really streams.
 */
let upstream: Server
const UPSTREAM_PORT = 17182
const GATEWAY_PORT = 17181

/** Set by the crash test; the real Router fills this from the log it watches. */
let crash: { id: string; code: number; label: string; crashed: boolean; at: number } | undefined

const routerStub = {
  state: 'ready',
  port: UPSTREAM_PORT,
  lastCrash: () => crash,
  status: async () => ({
    state: 'ready' as const,
    port: UPSTREAM_PORT,
    models: [
      { id: 'loaded-one', status: 'loaded' as const },
      { id: 'sitting-there', status: 'unloaded' as const },
    ],
  }),
} as unknown as Router

let apiKey: string | undefined
/** Set when the stub upstream noticed the gateway dropping its request. */
let upstreamSawHangup = false

const gateway = new Gateway(GATEWAY_PORT, {
  router: () => routerStub,
  models: () => [{ id: 'loaded-one' }, { id: 'sitting-there' }],
  info: () => ({ name: 'Monet Local', capabilities: { anthropic: true } }),
  apiKey: () => apiKey,
  networkAccess: () => false,
})

const url = (p: string): string => `http://127.0.0.1:${GATEWAY_PORT}${p}`

beforeAll(async () => {
  upstream = createServer((req, res) => {
    if (req.url === '/v1/chat/completions') {
      // Three chunks with gaps, the shape of a real completion.
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      let n = 0
      const timer = setInterval(() => {
        res.write(`data: {"n":${n++}}\n\n`)
        if (n === 3) {
          clearInterval(timer)
          res.end('data: [DONE]\n\n')
        }
      }, 40)
      return
    }
    if (req.url === '/v1/forever') {
      // A model that would answer for minutes. The test hangs up on it.
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const timer = setInterval(() => res.write('data: {"n":1}\n\n'), 20)
      req.on('close', () => {
        clearInterval(timer)
        upstreamSawHangup = true
      })
      return
    }
    if (req.url === '/v1/dead') {
      // Word for word what llama.cpp's router answers once a model's own
      // server has died under it.
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { message: 'proxy error: Could not establish connection' },
        }),
      )
      return
    }
    if (req.url === '/v1/messages') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'model is not loaded' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ echo: req.url }))
  })
  await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r))
  await gateway.start()
})

afterAll(async () => {
  await gateway.stop()
  await new Promise<void>((r) => upstream.close(() => r()))
})

describe('gateway — the management side', () => {
  it('answers /info with what this build can do', async () => {
    const body = (await (await fetch(url('/monet-local/v1/info'))).json()) as {
      capabilities: { anthropic: boolean }
    }
    expect(body.capabilities.anthropic).toBe(true)
  })

  it('lists the whole library, loaded or not', async () => {
    const body = (await (
      await fetch(url('/monet-local/v1/models'))
    ).json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('streams status events', async () => {
    const res = await fetch(url('/monet-local/v1/events'))
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    gateway.broadcast('models-changed', { models: [] })
    const chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toContain('connected')
    await reader.cancel()
  })
})

describe('gateway — the OpenAI and Anthropic side', () => {
  it('shows a client only the models it can actually use', async () => {
    // A dropdown full of models whose first request would be refused is
    // worse than a short list.
    const body = (await (await fetch(url('/v1/models'))).json()) as {
      data: { id: string }[]
    }
    expect(body.data.map((m) => m.id)).toEqual(['loaded-one'])
  })

  it('passes a stream through in pieces, not in one lump', async () => {
    const res = await fetch(url('/v1/chat/completions'), { method: 'POST' })
    const reader = res.body!.getReader()
    const reads: number[] = []
    for (;;) {
      const { done } = await reader.read()
      if (done) break
      reads.push(Date.now())
    }
    // Buffering would collapse this to one read and turn a model that types
    // into one that pauses and then dumps.
    expect(reads.length).toBeGreaterThan(1)
  })

  it('answers a dead model with what killed it, not "could not connect"', async () => {
    // The whole point. The router's own 500 is true and useless; we watched
    // the child die and know the model, the fault and the fix.
    crash = {
      id: 'qwen3.8-27b-ud-iq4_xs',
      code: -1073741819,
      label: 'access violation (0xC0000005)',
      crashed: true,
      at: Date.now(),
    }
    const res = await fetch(url('/v1/dead'), { method: 'POST' })
    const body = (await res.json()) as {
      error: { message: string; type: string; model: string }
    }
    expect(res.status).toBe(503)
    expect(body.error.type).toBe('model_crashed')
    expect(body.error.model).toBe('qwen3.8-27b-ud-iq4_xs')
    expect(body.error.message).toContain('access violation')
    expect(body.error.message).not.toContain('Could not establish')
  })

  it('leaves an ordinary 500 alone when nothing died', async () => {
    // Rewriting every 500 would hide real errors behind a stale diagnosis.
    crash = undefined
    const res = await fetch(url('/v1/dead'), { method: 'POST' })
    const body = (await res.json()) as { error: { message: string } }
    expect(res.status).toBe(500)
    expect(body.error.message).toContain('Could not establish connection')
  })

  it('hangs up on the router when the client hangs up — Stop must stop the model', async () => {
    // Reported: Stop pressed, the model kept generating. The gateway piped
    // bytes downstream and never told the router the reader had gone.
    upstreamSawHangup = false
    const ac = new AbortController()
    const res = await fetch(url('/v1/forever'), { method: 'POST', signal: ac.signal })
    const reader = res.body!.getReader()
    await reader.read()
    ac.abort()
    await new Promise((r) => setTimeout(r, 150))
    expect(upstreamSawHangup).toBe(true)
  })

  it('tells a client where to act when a model is not loaded', async () => {
    const res = await fetch(url('/v1/messages'), { method: 'POST' })
    expect(res.status).toBe(400)
    expect(res.headers.get('x-monet-local')).toMatch(/Monet Local/i)
  })
})

describe('gateway — the key', () => {
  it('lets everything through while no key is set', async () => {
    apiKey = undefined
    expect((await fetch(url('/monet-local/v1/info'))).status).toBe(200)
  })

  it('refuses without one, and accepts either header once set', async () => {
    apiKey = 'secret'
    expect((await fetch(url('/monet-local/v1/info'))).status).toBe(401)
    expect(
      (
        await fetch(url('/monet-local/v1/info'), {
          headers: { authorization: 'Bearer secret' },
        })
      ).status,
    ).toBe(200)
    // x-api-key as well: this port answers the Anthropic API, and that is
    // the header those clients send.
    expect(
      (
        await fetch(url('/monet-local/v1/info'), {
          headers: { 'x-api-key': 'secret' },
        })
      ).status,
    ).toBe(200)
    apiKey = undefined
  })
})
