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
import { readSlots, tick, type Activity, type Rate } from './activity.js'

export type { Activity } from './activity.js'

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

/** The poll's own beat. `/models` runs on every second one. */
const TICK_MS = 500

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
  private poll: NodeJS.Timeout | null = null
  private modelsKey = ''
  private startedEntries: RouterEntry[] = []
  private readonly activityListeners = new Set<
    (a: Record<string, Activity>) => void
  >()
  /** Last known status, so the fast tick knows what to ask about. */
  private lastModels: RouterModel[] = []
  private readonly rates = new Map<string, Rate>()
  private lastActivity: Record<string, Activity> = {}
  private activityKey = ''
  private ticks = 0
  /** One poll of each kind at a time: a slow answer must not stack them up. */
  private polling = false
  private pollingActivity = false

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

  /**
   * The entries this router was started with — which is what it is actually
   * running. llama.cpp reads the preset file once, at startup, so a profile
   * edited afterwards is not what is loaded, and this is what says so.
   */
  get running(): RouterEntry[] {
    return this.startedEntries
  }

  onChange(cb: (s: RouterStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /**
   * What each loaded model is doing, several times a second.
   *
   * Deliberately its own channel. This changes on every token, and the
   * status stream is also what the gateway broadcasts to clients over SSE —
   * putting a token counter on it would turn a "the model list changed"
   * event into a firehose for everyone subscribed.
   */
  onActivity(cb: (a: Record<string, Activity>) => void): () => void {
    this.activityListeners.add(cb)
    return () => this.activityListeners.delete(cb)
  }

  /**
   * The last thing the poll saw.
   *
   * A screen only hears about CHANGES, so one that mounts while a model sits
   * idle would hear nothing at all until something happened. This is what it
   * asks on the way in.
   */
  get activity(): Record<string, Activity> {
    return this.lastActivity
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
    this.startedEntries = entries

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
      this.stopPolling()
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
    this.startPolling()
  }

  /**
   * Ask what is loaded, repeatedly.
   *
   * llama.cpp's router has no event stream, and both commands answer 200
   * before anything has happened: measured here, a load reports `loading`
   * for about ten seconds on an 8 GB model, and an unload keeps reporting
   * `loaded` for about two. Without this the screen went on offering Unload
   * for a model that was already gone, and the second click came back with
   * "model is not running".
   */
  private startPolling(): void {
    this.stopPolling()
    // Two rates from one timer. What is loaded changes on the scale of a
    // minute and costs a `/models` round trip; what a model is doing changes
    // on the scale of a token, and asking a busy server twice a second is
    // what makes the counter read like a counter rather than a log.
    this.poll = setInterval(() => {
      this.ticks++
      if (this.ticks % 2 === 0) void this.pollOnce()
      void this.pollActivity()
    }, TICK_MS)
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    this.modelsKey = ''
    this.activityKey = ''
    this.lastActivity = {}
    this.lastModels = []
    this.rates.clear()
  }

  private async pollOnce(): Promise<void> {
    if (this.stateValue !== 'ready' || this.polling) return
    this.polling = true
    try {
      await this.pollModels()
    } finally {
      this.polling = false
    }
  }

  private async pollModels(): Promise<void> {
    const s = await this.status()
    this.lastModels = s.models
    // Only when something actually moved: a status push per second would
    // re-render the screen for no reason.
    const key = s.models.map((m) => `${m.id}:${m.status}`).join(',')
    if (key === this.modelsKey) return
    this.modelsKey = key
    for (const cb of this.listeners) cb(s)
  }

  /**
   * Ask every loaded model what it is doing.
   *
   * Nothing loaded means nothing asked — the whole tick costs nothing on an
   * idle machine, which is the state it spends most of its time in.
   */
  private async pollActivity(): Promise<void> {
    if (this.stateValue !== 'ready' || !this.activityListeners.size) return
    if (this.pollingActivity) return
    this.pollingActivity = true
    try {
      await this.readActivity()
    } finally {
      this.pollingActivity = false
    }
  }

  private async readActivity(): Promise<void> {
    const loaded = this.lastModels.filter((m) => m.status === 'loaded')
    for (const id of [...this.rates.keys()]) {
      if (!loaded.some((m) => m.id === id)) this.rates.delete(id)
    }
    if (!loaded.length) {
      this.lastActivity = {}
      if (this.activityKey === '') return
      this.activityKey = ''
      for (const cb of this.activityListeners) cb({})
      return
    }

    const now = Date.now()
    const out: Record<string, Activity> = {}
    await Promise.all(
      loaded.map(async (m) => {
        const a = await this.slotsFor(m.id)
        if (!a) return
        // The speed belongs to the reply, not to the model: a slot that has
        // gone idle keeps no figure to show next time.
        if (a.state === 'generating') {
          const r = tick(this.rates.get(m.id), a.decoded, now)
          this.rates.set(m.id, r)
          if (r.value !== undefined) a.tokensPerSecond = r.value
        } else {
          this.rates.delete(m.id)
        }
        out[m.id] = a
      }),
    )

    this.lastActivity = out
    const key = JSON.stringify(out)
    if (key === this.activityKey) return
    this.activityKey = key
    for (const cb of this.activityListeners) cb(out)
  }

  /** One model's slots, or nothing if the child is not answering. */
  private async slotsFor(model: string): Promise<Activity | null> {
    try {
      const res = await fetch(
        `${this.base()}/slots?model=${encodeURIComponent(model)}`,
        // A model deep in a long prefill still answers this promptly; if it
        // does not, the tick is skipped rather than queued behind it.
        { signal: AbortSignal.timeout(2000) },
      )
      if (!res.ok) return null
      return readSlots(await res.json())
    } catch {
      return null
    }
  }

  /** Wait for a model to reach a settled state, or say why it did not. */
  private async settle(
    model: string,
    want: 'loaded' | 'unloaded',
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let moved = false
    while (Date.now() < deadline) {
      const v = (await this.status()).models.find((m) => m.id === model)?.status
      if (v === want) return
      // `loading` is the only transitional value llama.cpp reports; an
      // unload simply keeps saying `loaded` until it does not.
      if (v === 'loading') moved = true
      else if (moved) throw new Error(`${model} ended up ${v}, not ${want}`)
      await new Promise((r) => setTimeout(r, 400))
    }
    throw new Error(`${model} did not become ${want} in time`)
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

  /**
   * Returns as soon as the router has accepted it. Loading a large model
   * takes minutes; the poll above is what moves the screen from `loading`
   * to `loaded`.
   */
  load(model: string): Promise<void> {
    return this.command('/models/load', model)
  }

  /**
   * Waits, unlike load. It is quick (about two seconds), and returning
   * early is what let a second click reach a model that was already gone.
   */
  async unload(model: string): Promise<void> {
    await this.command('/models/unload', model)
    await this.settle(model, 'unloaded', 60_000)
  }

  async stop(): Promise<void> {
    this.stopPolling()
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
