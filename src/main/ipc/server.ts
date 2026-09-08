import { totalmem } from 'node:os'
import { app, ipcMain } from 'electron'
import { estimate } from '@shared/estimator.js'
import { publicModels } from '@shared/public-models.js'
import { buildArgs, previewCommand } from '@shared/flags/build.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import { getMainWindow } from '../app/main-window.js'
import {
  profileFor,
  readProfiles,
  writeProfiles,
  type ProfilesFile,
} from '../app/profiles-store.js'
import { readSettings } from '../app/settings-store.js'
import { scanFolders } from '../models/library.js'
import type { ModelInfo } from '../models/describe.js'
import { listInstalled, pickDefault } from '../runtimes/manager.js'
import { findStrays, killStray } from '../server/orphans.js'
import { Gateway } from '../server/gateway.js'
import { Router, type RouterEntry } from '../server/router.js'

/** The router's own port. Internal — only Monet Local talks to it. */
const ROUTER_PORT = 17172

let router: Router | null = null
let gateway: Gateway | null = null

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
    })),
    byId,
    (id) => profileFor(id).values,
    hardware(),
  )
}

/** Kept fresh by the router's own change events, for the SSE stream. */
let statusCache: Awaited<ReturnType<Router['status']>> | null = null

function activePack() {
  const installed = listInstalled()
  const chosen = readSettings().runtimeId
  return installed.find((p) => p.id === chosen) ?? pickDefault(installed)
}

export function hardware(): Hardware {
  return {
    totalRamBytes: totalmem(),
    devices: activePack()?.devices ?? [],
  }
}

function models(): ModelInfo[] {
  return scanFolders(readSettings().modelFolders.map((f) => f.path)).models
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

  ipcMain.handle('server:hardware', () => hardware())

  // Ours: this process, and the router it spawned. Without the second the
  // app reports its own server as someone else's and offers to kill it.
  const ownPids = (): number[] =>
    [process.pid, router?.pid].filter((p): p is number => p !== undefined)

  ipcMain.handle('server:strays', () => findStrays(ownPids()))
  ipcMain.handle('server:killStray', (_e, pid: number) => killStray(pid))

  ipcMain.handle('server:start', async () => {
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
    router.onChange((s) => {
      statusCache = s
      getMainWindow()?.webContents.send('server:status', s)
      gateway?.broadcast('status', s)
    })
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
  })

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
    (_e, modelId: string, values: Profile) => {
      const model = models().find((m) => m.id === modelId)
      if (!model) throw new Error(`unknown model ${modelId}`)
      const pack = activePack()
      return {
        estimate: estimate({
          fileBytes: model.sizeBytes,
          ...(model.geometry ? { geometry: model.geometry } : {}),
          ...(model.mmprojPath ? { mmprojBytes: 0 } : {}),
          profile: values,
          hardware: hardware(),
        }),
        command: previewCommand(
          pack?.serverPath ?? 'llama-server',
          buildArgs(values, { modelPath: model.path }),
        ),
      }
    },
  )

  ipcMain.handle('profiles:get', () => readProfiles())
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
}
