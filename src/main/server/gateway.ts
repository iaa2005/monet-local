/**
 * The one port clients talk to.
 *
 * Monet Local puts a small Node server in front of the llama.cpp router and
 * hands out a single address. Four reasons it exists rather than pointing
 * everyone straight at llama.cpp:
 *
 *   - the address stays put. The router is restarted whenever the library or
 *     a profile changes; a client that stored `:17172` would break every time.
 *   - `/v1/models` lists only what is LOADED. A standard OpenAI client shows
 *     that list in a dropdown, and offering models that would refuse the
 *     first request is a worse experience than a short list.
 *   - the key and the network toggle are checked in one place, not two.
 *   - our own API can sit beside the standard one, so Code Monet needs to
 *     know one address rather than two ports and a convention.
 *
 * There is deliberately no just-in-time loading here. A request for a model
 * that is not loaded gets llama.cpp's own refusal, with a header saying where
 * to load it. Loading 16 GB is a decision, and it is made in the app.
 */

import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { exitMessage } from './instance-exit.js'
import type { Router } from './router.js'

export interface GatewayDeps {
  router: () => Router | null
  /** Everything in the library, with status and a memory verdict. */
  models: () => unknown
  info: () => unknown
  apiKey: () => string | undefined
  /** false = 127.0.0.1 only. */
  networkAccess: () => boolean
}

const MANAGEMENT_PREFIX = '/monet-local/v1'

export class Gateway {
  private server: Server | null = null
  private readonly sseClients = new Set<ServerResponse>()

  constructor(
    private readonly port: number,
    private readonly deps: GatewayDeps,
  ) {}

  get running(): boolean {
    return this.server !== null
  }

  async start(): Promise<void> {
    if (this.server) return
    const host = this.deps.networkAccess() ? '0.0.0.0' : '127.0.0.1'
    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })
    this.server = server
  }

  async stop(): Promise<void> {
    for (const c of this.sseClients) c.end()
    this.sseClients.clear()
    const server = this.server
    if (!server) return
    this.server = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /** Push a status change to every subscribed client. */
  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of this.sseClients) c.write(payload)
  }

  private authorised(req: IncomingMessage): boolean {
    const key = this.deps.apiKey()
    if (!key) return true
    const header = req.headers['authorization']
    const bearer = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : ''
    // `x-api-key` as well as the bearer: that is the header Anthropic clients
    // send, and this port answers the Anthropic API too.
    const xkey = req.headers['x-api-key']
    return bearer === key || xkey === key
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Local clients are browsers as often as not (a renderer on file://), and
    // the key is what actually guards this, not the origin.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', '*')
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }

    const url = req.url ?? '/'
    if (!this.authorised(req)) {
      json(res, 401, {
        error: { message: 'Invalid API key', type: 'authentication_error' },
      })
      return
    }

    if (url.startsWith(MANAGEMENT_PREFIX)) {
      await this.management(url.slice(MANAGEMENT_PREFIX.length), req, res)
      return
    }
    await this.proxy(req, res)
  }

  private async management(
    path: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const route = path.split('?')[0]
    switch (route) {
      case '/info':
        json(res, 200, this.deps.info())
        return
      case '/models':
        json(res, 200, { data: this.deps.models() })
        return
      case '/status':
        json(res, 200, (await this.deps.router()?.status()) ?? { state: 'stopped' })
        return
      case '/events':
        this.subscribe(req, res)
        return
      default:
        json(res, 404, { error: { message: 'unknown endpoint' } })
    }
  }

  private subscribe(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      // Without this a proxy in between will sit on the stream forever.
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    this.sseClients.add(res)
    req.on('close', () => this.sseClients.delete(res))
  }

  /**
   * Pass a request through to the router, byte for byte.
   *
   * Streaming matters here: a chat completion arrives as server-sent events
   * over many seconds, and buffering it would turn a model that types into
   * one that pauses and then dumps.
   */
  private async proxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const router = this.deps.router()
    if (!router || router.state !== 'ready') {
      json(res, 503, {
        error: {
          message: 'Monet Local is not running a model server',
          type: 'unavailable_error',
        },
      })
      return
    }

    // The one response we rewrite: a client's model list should hold what it
    // can actually use.
    if (req.method === 'GET' && (req.url ?? '').startsWith('/v1/models')) {
      const status = await router.status()
      const loaded = status.models.filter((m) => m.status === 'loaded')
      json(res, 200, {
        object: 'list',
        data: loaded.map((m) => ({
          id: m.id,
          object: 'model',
          owned_by: 'monet-local',
        })),
      })
      return
    }

    const upstream = request(
      {
        host: '127.0.0.1',
        port: router.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${router.port}` },
      },
      (up) => {
        const headers = { ...up.headers }
        // A refusal for a model that exists but is not loaded is actionable;
        // say where the action is rather than leaving the client to guess.
        if (up.statusCode === 400) {
          headers['x-monet-local'] = 'load the model in Monet Local'
        }
        // The router answers 500 "proxy error: Could not establish
        // connection" when a model's own server has died — which is true and
        // useless. We watched it die and know what killed it, so say that
        // instead. Only for this one shape: everything else is passed
        // through byte for byte, streaming included.
        const crash = up.statusCode === 500 ? router.lastCrash() : undefined
        if (crash) {
          up.resume()
          json(res, 503, {
            error: {
              message: exitMessage(crash),
              type: 'model_crashed',
              model: crash.id,
              code: crash.code,
            },
          })
          return
        }
        res.writeHead(up.statusCode ?? 502, headers)
        up.pipe(res)
      },
    )
    upstream.on('error', (err) => {
      json(res, 502, { error: { message: `router: ${err.message}` } })
    })
    req.pipe(upstream)
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}
