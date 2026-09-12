import { statSync } from 'node:fs'
import { cpus, freemem, totalmem } from 'node:os'
import { app, ipcMain } from 'electron'
import { recommendProfile, type AutoResult, type AutoSummary } from '@shared/auto-profile.js'
import { autoTune, type AutoAttempt, type AutoProgress } from '../server/auto-tune.js'
import { estimate } from '@shared/estimator.js'
import { publicModels } from '@shared/public-models.js'
import { buildArgs, previewCommand } from '@shared/flags/build.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import { getMainWindow } from '../app/main-window.js'
import {
  assignProfile,
  createProfile,
  ownsProfile,
  profileFor,
  readProfiles,
  removeProfile,
  renameProfile,
  setProfileValues,
  writeProfiles,
  type ProfilesFile,
} from '../app/profiles-store.js'
import { readSettings } from '../app/settings-store.js'
import { scanFolders } from '../models/library.js'
import type { ModelInfo } from '../models/describe.js'
import { listInstalled, pickDefault } from '../runtimes/manager.js'
import { measuredBandwidth } from '../app/bandwidth-store.js'
import { memorySpeed, memorySpeedNow } from '../app/memory-speed.js'
import { findStrays, killStray, ownedRssBytes } from '../server/orphans.js'
import { Gateway } from '../server/gateway.js'
import { Router, type RouterEntry } from '../server/router.js'

/** The router's own port. Internal — only Monet Local talks to it. */
const ROUTER_PORT = 17172

let router: Router | null = null
let gateway: Gateway | null = null
/** Whether this process has already subscribed to the Router it holds. */
let wired = false

/** The library as a client sees it — shape lives in shared/public-models. */
function publicModelList(): unknown[] {
  const byId = new Map(
    (statusCache?.models ?? []).map((m) => [m.id, m.status] as const),
  )
  return publicModels(
    models().map((m) => ({
      id: m.id,
      displayName: m.displayName,
      architecture: m.architecture,
      quant: m.quant,
      sizeBytes: m.sizeBytes,
      ...(m.contextMax !== undefined ? { contextMax: m.contextMax } : {}),
      ...(m.geometry ? { geometry: m.geometry } : {}),
      ...(m.mmprojPath ? { mmprojPath: m.mmprojPath } : {}),
      moe: m.moe,
      ...(m.weightBytes ? { weightBytes: m.weightBytes } : {}),
      ...(m.expertBytes ? { expertBytes: m.expertBytes } : {}),
      ...(m.expertCount ? { expertCount: m.expertCount } : {}),
      ...(m.expertUsedCount ? { expertUsedCount: m.expertUsedCount } : {}),
    })),
    byId,
    (id) => profileFor(id).values,
    hardware(),
    (id) => statusCache?.models.find((m) => m.id === id)?.args,
  )
}

/** Kept fresh by the router's own change events, for the SSE stream. */
let statusCache: Awaited<ReturnType<Router['status']>> | null = null

function activePack() {
  const installed = listInstalled()
  const chosen = readSettings().runtimeId
  return installed.find((p) => p.id === chosen) ?? pickDefault(installed)
}

/**
 * What our own llama-servers hold right now, refreshed by hardwareNow().
 *
 * Kept as a number rather than asked for on every call: the process query
 * is a PowerShell round trip, and hardware() is read from synchronous
 * places. Stale by a few seconds at worst, and zero until the first ask.
 */
let ownRssBytes = 0

export function hardware(): Hardware {
  return {
    totalRamBytes: totalmem(),
    // What is free at THIS moment — plus what our own loaded models hold,
    // because that is memory a reload gets back. Without the second term the
    // verdict for the configuration that is RUNNING read "does not fit,
    // other programs are holding 23 GB", the other program being the model.
    // A machine with a browser and a chat client open still has less to
    // give than its total minus a fixed reserve; that part stays.
    freeRamBytes: freemem() + ownRssBytes,
    ...bandwidthNow(),
    devices: activePack()?.devices ?? [],
  }
}

/**
 * The bandwidth predictions divide by, and where it came from.
 *
 * A benchmark on the active runtime beats the modules: it is what THIS
 * backend on THIS GPU delivered, efficiency included, where the modules
 * describe a bus that may be read wrong (LPDDR) and is never reached in
 * full. The theoretical figure is kept beside it for the Benchmark screen's
 * ceiling, which is a first-principles number by design.
 */
function bandwidthNow(): Pick<
  Hardware,
  | 'memoryBandwidthBytesPerSecond'
  | 'memoryBandwidthMeasured'
  | 'memoryBandwidthIsEffective'
  | 'memoryBandwidth'
> {
  const bus = memorySpeedNow()
  const pack = activePack()
  const run = pack ? measuredBandwidth(pack.id) : undefined
  if (run) {
    return {
      memoryBandwidthBytesPerSecond: run.bytesPerSecond,
      memoryBandwidthMeasured: true,
      memoryBandwidthIsEffective: true,
      memoryBandwidth: {
        source: 'benchmark',
        theoreticalBytesPerSecond: bus.bytesPerSecond,
        benchmark: {
          modelName: run.modelName,
          runtimeLabel: run.runtimeLabel,
          genTps: run.genTps,
          at: run.at,
        },
      },
    }
  }
  return {
    memoryBandwidthBytesPerSecond: bus.bytesPerSecond,
    memoryBandwidthMeasured: bus.measured,
    memoryBandwidthIsEffective: false,
    memoryBandwidth: {
      source: bus.measured ? 'firmware' : 'assumed',
      theoreticalBytesPerSecond: bus.bytesPerSecond,
    },
  }
}

/** hardware(), with the measured figures refreshed rather than remembered. */
export async function hardwareNow(): Promise<Hardware> {
  ownRssBytes = await ownedRssBytes(ownPids())
  // Reads the modules once per process and is cached after; see memory-speed.
  await memorySpeed()
  return hardware()
}

function models(): ModelInfo[] {
  return scanFolders(readSettings().modelFolders.map((f) => f.path)).models
}

/** The projector's size on disk — it is loaded beside the model and costs
 * its own memory, so a budget that forgets it is most of a gigabyte out. */
function mmprojBytes(m: ModelInfo): number {
  if (!m.mmprojPath) return 0
  try {
    return statSync(m.mmprojPath).size
  } catch {
    return 0
  }
}

export type { AutoAttempt, AutoProgress }

export interface AutoProfileResult {
  file: ProfilesFile
  profileId: string
  /** True when a configuration was made for this model; false when its own
   * existing one was edited in place. */
  created: boolean
  /** What was written in the end. */
  summary: AutoSummary
  /** Every arrangement tried, in order, and how each one ended. */
  attempts: AutoAttempt[]
  /** The model answered with the configuration written. */
  running: boolean
}

/**
 * Pick a model's settings, and put them where the user's rule says.
 *
 * The rule: a configuration shared by several models is not this model's
 * to rewrite — editing it would move every model on it — so one is created
 * for it and assigned. A configuration only this model uses IS its own, and
 * is edited in place rather than multiplied. The count the screen shows
 * beside a shared profile is the same count this decides by.
 */
/**
 * Where Auto writes: the model's own configuration, made if it has none.
 * Decided once, before the first attempt, so every attempt edits the same
 * one rather than leaving a configuration per try behind.
 */
function autoTarget(modelId: string, first: Profile): { profileId: string; created: boolean } {
  const model = models().find((m) => m.id === modelId)
  if (!model) throw new Error(`unknown model ${modelId}`)
  const current = profileFor(modelId)
  if (ownsProfile(modelId, models().map((m) => m.id))) {
    setProfileValues(current.id, first)
    return { profileId: current.id, created: false }
  }
  const name = `Auto · ${model.displayName} ${model.quant}`.trim()
  const made = createProfile(name, first)
  assignProfile(modelId, made.id)
  return { profileId: made.id, created: true }
}

/** Four tokens through the router: the only proof a configuration runs. */
async function probeModel(modelId: string): Promise<void> {
  if (!router) throw new Error('server is not running')
  const res = await fetch(`http://127.0.0.1:${router.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 4,
      messages: [{ role: 'user', content: 'Say OK.' }],
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  await res.json()
}

async function autoProfile(modelId: string): Promise<AutoProfileResult> {
  const model = models().find((m) => m.id === modelId)
  if (!model) throw new Error(`unknown model ${modelId}`)
  const input = {
    ...(model.geometry ? { geometry: model.geometry } : {}),
    ...(model.mmprojPath ? { mmprojBytes: mmprojBytes(model) } : {}),
    ...(model.mtp ? { mtp: true } : {}),
  }
  const first: AutoResult = recommendProfile({
    fileBytes: model.sizeBytes,
    ...input,
    ...(model.contextMax ? { contextMax: model.contextMax } : {}),
    hardware: await hardwareNow(),
    cpuThreads: cpus().length,
  })
  const target = autoTarget(modelId, first.profile)

  // Written and shown, not tried: the estimator says even the smallest
  // arrangement does not fit, and the note says what is in the way. Loading
  // it would only turn that verdict into a crash a minute later.
  if (first.summary.level === 'wont_fit') {
    return {
      file: readProfiles(),
      ...target,
      summary: first.summary,
      attempts: [],
      running: false,
    }
  }

  if (!router) await startServer()
  const { result, attempts } = await autoTune(modelId, first, input, {
    router: () => router!,
    write: (p) => void setProfileValues(target.profileId, p),
    entries,
    probe: probeModel,
    onProgress: (p) => getMainWindow()?.webContents.send('server:autoProgress', p),
  })
  push()
  return {
    file: readProfiles(),
    ...target,
    summary: result.summary,
    attempts,
    running: attempts.some((a) => a.ok),
  }
}

/**
 * Start the router and the gateway. Its own function because Auto needs
 * it too: a model cannot be tried on a server that is not up, and the
 * gateway has to be there for the client that asked in the first place.
 */
// Ours: this process, and the router it spawned. Without the second the
// app reports its own server as someone else's and offers to kill it.
const ownPids = (): number[] =>
  [process.pid, router?.pid].filter((p): p is number => p !== undefined)

async function startServer(): Promise<NonNullable<typeof statusCache>> {
    const pack = activePack()
    if (!pack) throw new Error('no runtime installed')
    // Two llama-servers over one set of weights is how a machine ends up with
    // 103 MB free and 300k page faults a second. Refuse rather than join in.
    const strays = await findStrays(ownPids())
    if (strays.length && !router) {
      throw new Error(
        `llama-server is already running (pid ${strays.map((s) => s.pid).join(', ')})`,
      )
    }
    router ??= new Router(pack.serverPath, ROUTER_PORT)
    // Once per Router, not once per Start: the object outlives a stop, and
    // subscribing again on the second start would send every status twice.
    if (!wired) {
      wired = true
      router.onChange((s) => {
        statusCache = s
        getMainWindow()?.webContents.send('server:status', s)
        gateway?.broadcast('status', s)
      })
      // Its own channel, and the window only. This moves on every token; the
      // gateway's SSE stream is for clients watching the model list, and a
      // token counter has no business on it.
      router.onActivity((a) => {
        getMainWindow()?.webContents.send('server:activity', a)
      })
    }
    await router.start(entries())

    const settings = readSettings()
    gateway ??= new Gateway(settings.port, {
      router: () => router,
      models: () => publicModelList(),
      info: () => ({
        name: 'Monet Local',
        version: app.getVersion(),
        llama_build: pack.build,
        backend: pack.backendId,
        capabilities: { openai: true, anthropic: true },
        management_api: '/monet-local/v1',
      }),
      apiKey: () => readSettings().apiKey,
      networkAccess: () => readSettings().networkAccess,
    })
    await gateway.start()
    statusCache = await router.status()
    return statusCache
}

/** Every model in the library becomes an INI section; none is auto-loaded. */
function entries(): RouterEntry[] {
  return models().map((m) => ({
    id: m.id,
    profile: profileFor(m.id).values,
    modelPath: m.path,
    ...(m.mmprojPath ? { mmprojPath: m.mmprojPath } : {}),
  }))
}

/**
 * Which models are configured differently from what the router is running.
 *
 * llama.cpp reads its preset file once, at startup, and ignores arguments
 * passed to /models/load — measured: it answers 200 and loads the old ones.
 * So an edited profile changes nothing until the router is restarted, and
 * this is what lets the screen say so instead of pretending otherwise.
 */
function pendingModels(): string[] {
  if (!router) return []
  const running = new Map(router.running.map((e) => [e.id, e.profile]))
  return entries()
    .filter((e) => {
      const was = running.get(e.id)
      // A model added since the router started is not "changed"; it simply
      // is not in the preset the router read, which is the same problem.
      return was === undefined || JSON.stringify(was) !== JSON.stringify(e.profile)
    })
    .map((e) => e.id)
}

function push(): void {
  void router?.status().then((s) => {
    statusCache = s
    getMainWindow()?.webContents.send('server:status', s)
    // Clients subscribed to /events find out at the same moment the UI does,
    // so a model list in Code Monet does not need polling.
    gateway?.broadcast('models-changed', { models: s.models })
  })
}

export function registerServerIpc(): void {
  ipcMain.handle('server:status', async () => {
    if (!router) return { state: 'stopped', port: ROUTER_PORT, models: [] }
    return router.status()
  })

  ipcMain.handle('server:activity', () => router?.activity ?? {})

  ipcMain.handle('server:hardware', () => hardware())

  ipcMain.handle('server:strays', () => findStrays(ownPids()))
  ipcMain.handle('server:killStray', (_e, pid: number) => killStray(pid))

  ipcMain.handle('server:start', () => startServer())

  ipcMain.handle('server:stop', async () => {
    await gateway?.stop()
    gateway = null
    await router?.stop()
    statusCache = (await router?.status()) ?? null
    return statusCache ?? { state: 'stopped', port: ROUTER_PORT, models: [] }
  })

  /** What the Integrations screen shows, and what a client is told to use. */
  ipcMain.handle('server:endpoint', () => {
    const s = readSettings()
    return {
      port: s.port,
      networkAccess: s.networkAccess,
      hasKey: !!s.apiKey,
      apiKey: s.apiKey ?? null,
      running: gateway?.running ?? false,
    }
  })

  ipcMain.handle('server:load', async (_e, id: string) => {
    if (!router) throw new Error('server is not running')
    await router.load(id)
    push()
  })

  ipcMain.handle('server:unload', async (_e, id: string) => {
    if (!router) throw new Error('server is not running')
    await router.unload(id)
    push()
  })

  /**
   * The verdict, plus the exact command the profile would produce. Both come
   * from the same registry, so what the panel shows is what would run.
   */
  ipcMain.handle(
    'server:estimate',
    async (_e, modelId: string, values: Profile) => {
      const model = models().find((m) => m.id === modelId)
      if (!model) throw new Error(`unknown model ${modelId}`)
      const pack = activePack()
      return {
        estimate: estimate({
          fileBytes: model.sizeBytes,
          ...(model.geometry ? { geometry: model.geometry } : {}),
          ...(model.mmprojPath ? { mmprojBytes: mmprojBytes(model) } : {}),
          profile: values,
          hardware: await hardwareNow(),
        }),
        command: previewCommand(
          pack?.serverPath ?? 'llama-server',
          buildArgs(values, { modelPath: model.path }),
        ),
      }
    },
  )

  ipcMain.handle('server:pending', () => pendingModels())

  /**
   * Put the edited settings into effect, when the user asks and not before.
   *
   * Deliberately manual: settings are edited a keystroke at a time, and a
   * server that reloaded a 16 GB model on each one would be unusable. The
   * restart is the only mechanism there is — the preset file is read at
   * startup — so it reloads whatever was loaded before, and says as much.
   */
  ipcMain.handle('server:apply', async () => {
    if (!router) throw new Error('server is not running')
    const before = (await router.status()).models
      .filter((m) => m.status === 'loaded')
      .map((m) => m.id)
    await router.start(entries())
    for (const id of before) await router.load(id)
    push()
    statusCache = await router.status()
    return statusCache
  })

  ipcMain.handle('profiles:get', () => readProfiles())
  ipcMain.handle('profiles:auto', (_e, modelId: string) => autoProfile(modelId))
  ipcMain.handle('profiles:create', (_e, name: string, values?: Profile) =>
    createProfile(name, values ?? {}),
  )
  ipcMain.handle('profiles:rename', (_e, id: string, name: string) =>
    renameProfile(id, name),
  )
  ipcMain.handle('profiles:remove', (_e, id: string) => removeProfile(id))
  ipcMain.handle('profiles:setValues', (_e, id: string, values: Profile) =>
    setProfileValues(id, values),
  )
  ipcMain.handle('profiles:assign', (_e, modelId: string, profileId: string) =>
    assignProfile(modelId, profileId),
  )
  ipcMain.handle('profiles:set', (_e, next: ProfilesFile) =>
    writeProfiles(next),
  )
}

/** Called on quit: a router left behind holds the weights and the port. */
export async function shutdownServer(): Promise<void> {
  await gateway?.stop()
  gateway = null
  await router?.stop()
  router = null
  wired = false
}
