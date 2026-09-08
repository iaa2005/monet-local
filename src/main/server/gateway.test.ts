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

const routerStub = {
  state: 'ready',
  port: UPSTREAM_PORT,
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
