/**
 * The llama.cpp router: one process, several models, loaded on command.
 *
 * `llama-server` started with no model and a `--models-preset` file runs as a
 * router. It spawns a child server per model on demand and answers
 * `POST /models/load` and `/models/unload` — so switching models is an HTTP
 * call rather than a process restart, and several can be resident at once.
 *
 * `--models-dir` is never used, even though it looks like the obvious way to
 * point at a folder: its heuristic treats a directory as ONE model and picked
 * the 22 GB Q6_K out of a folder that also held the 16 GB Q4_K_M — the one
 * quant that does not fit this machine. Monet Local writes the INI itself,
 * from the library and the profiles, so what loads is what the user chose.
 *
 * `--no-models-autoload` for the same reason: a request naming a model that
 * is not loaded gets a clean 400 rather than quietly starting a multi-minute
 * load nobody asked for. Loading is a decision made in this app.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildIni } from '@shared/flags/build.js'
import type { Profile } from '@shared/flags/types.js'
import { dataDir, logsDir } from '../app/settings-store.js'

export type RouterState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'failed'

export interface RouterModel {
  id: string
  status: 'unloaded' | 'loading' | 'loaded'
  /** The exact command llama.cpp built for the child, when it has one. */
  args?: string[]
}

export interface RouterEntry {
  id: string
  profile: Profile
  modelPath: string
  mmprojPath?: string
}

export interface RouterStatus {
  state: RouterState
  port: number
  /** Last line that looked like a reason, when the state is `failed`. */
  error?: string
  models: RouterModel[]
}

/**
 * Failure signatures worth showing verbatim. Everything else in a llama.cpp
 * log is noise until something goes wrong, and then these are the lines that
 * say what happened.
 */
const FAILURE = [
  /allocation of size \d+ failed/i,
  /ErrorOutOfDeviceMemory/i,
  /unknown model architecture/i,
  /failed to load model/i,
  /error while handling argument/i,
  /bind.*(address|port).*in use/i,
]

export class Router {
  private child: ChildProcess | null = null
  private stateValue: RouterState = 'stopped'
  private lastError: string | undefined
  private readonly listeners = new Set<(s: RouterStatus) => void>()

  constructor(
    private readonly serverPath: string,
    readonly port: number,
  ) {}

  get state(): RouterState {
    return this.stateValue
  }

  /** The llama-server we spawned, so it is not mistaken for someone else's. */
  get pid(): number | undefined {
    return this.child?.pid
  }

  onChange(cb: (s: RouterStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private async announce(): Promise<void> {
    const status = await this.status()
    for (const cb of this.listeners) cb(status)
  }

  private setState(s: RouterState, error?: string): void {
    this.stateValue = s
    this.lastError = error
    void this.announce()
  }

  /** The preset file the router is handed. Written fresh on every start. */
  private writePreset(entries: RouterEntry[]): string {
    const dir = join(dataDir(), 'router')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'models.ini')
    writeFileSync(path, buildIni(entries), 'utf8')
    return path
  }

  async start(entries: RouterEntry[]): Promise<void> {
    if (this.child) await this.stop()
    const preset = this.writePreset(entries)

    const args = [
      '--models-preset',
      preset,
      // Loading is decided here, not by whoever sends the first request.
      '--no-models-autoload',
      '--no-webui',
      // The router is internal. Only Monet Local's own port faces outward,
      // and only that one honours the API key and the network toggle.
      '--host',
      '127.0.0.1',
      '--port',
      String(this.port),
    ]

    mkdirSync(logsDir(), { recursive: true })
    const log = createWriteStream(
      join(logsDir(), `router-${Date.now()}.log`),
      { flags: 'a' },
    )

    this.setState('starting')
    const child = spawn(this.serverPath, args, { windowsHide: true })
    this.child = child

    const watch = (buf: Buffer): void => {
      const text = buf.toString()
      log.write(text)
      if (/listening on/i.test(text)) this.setState('ready')
      for (const re of FAILURE) {
        const m = re.exec(text)
        if (m) this.setState('failed', m[0])
      }
    }
    child.stdout?.on('data', watch)
    child.stderr?.on('data', watch)

    child.on('exit', (code) => {
      log.end()
      this.child = null
      if (this.stateValue !== 'stopping') {
        this.setState(
          'failed',
          this.lastError ?? `llama-server exited with code ${code}`,
        )
      } else {
        this.setState('stopped')
      }
    })

    await this.waitForReady()
  }

  private async waitForReady(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.stateValue === 'failed') throw new Error(this.lastError)
      // The log line and the health endpoint have to agree: "listening" is
      // printed before the router can actually answer.
      if (this.stateValue === 'ready' && (await this.healthy())) return
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new Error('llama-server did not become ready')
  }

  private base(): string {
    return `http://127.0.0.1:${this.port}`
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base()}/health`)
      return res.ok
    } catch {
      return false
    }
  }

  async status(): Promise<RouterStatus> {
    const base: RouterStatus = {
      state: this.stateValue,
      port: this.port,
      ...(this.lastError ? { error: this.lastError } : {}),
      models: [],
    }
    if (this.stateValue !== 'ready') return base
    try {
      const res = await fetch(`${this.base()}/models`)
      const body = (await res.json()) as {
        data?: { id: string; status?: { value?: string; args?: string[] } }[]
      }
      base.models = (body.data ?? []).map((m) => ({
        id: m.id,
        status: (m.status?.value as RouterModel['status']) ?? 'unloaded',
        ...(m.status?.args ? { args: m.status.args } : {}),
      }))
    } catch {
      // Ready but not answering yet; an empty list is the honest answer.
    }
    return base
  }

  private async command(path: string, model: string): Promise<void> {
    // A Router outlives its process: when llama-server exits, `child` goes
    // null but this object stays, and a load sent afterwards reached the UI
    // as a bare `TypeError: fetch failed` with an ECONNREFUSED buried in its
    // cause. Answer for the process before asking it anything.
    if (!this.child || this.stateValue !== 'ready') {
      throw new Error(
        this.lastError ?? 'llama-server is not running. Start the server first.',
      )
    }
    let res: Response
    try {
      res = await fetch(`${this.base()}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      })
    } catch {
      // It was up a moment ago and is not now. Correct the state as well as
      // reporting, or the screen keeps offering a button that cannot work.
      this.setState('failed', `llama-server stopped answering on port ${this.port}`)
      throw new Error(`llama-server stopped answering on port ${this.port}`)
    }
    if (!res.ok) {
      throw new Error(`${path}: ${res.status} ${await res.text()}`)
    }
    void this.announce()
  }

  /** Asynchronous: the model goes to `loading` and the status stream follows. */
  load(model: string): Promise<void> {
    return this.command('/models/load', model)
  }

  unload(model: string): Promise<void> {
    return this.command('/models/unload', model)
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.setState('stopped')
      return
    }
    this.setState('stopping')
    // The router kills its children; killing the tree ourselves would race it.
    child.kill()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 8000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.child = null
    this.setState('stopped')
  }
}
