import { totalmem } from 'node:os'
import { ipcMain } from 'electron'
import { estimate } from '@shared/estimator.js'
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
import { Router, type RouterEntry } from '../server/router.js'

/** The router's own port. Internal — only Monet Local talks to it. */
const ROUTER_PORT = 17172

let router: Router | null = null

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
    getMainWindow()?.webContents.send('server:status', s)
  })
}

export function registerServerIpc(): void {
  ipcMain.handle('server:status', async () => {
    if (!router) return { state: 'stopped', port: ROUTER_PORT, models: [] }
    return router.status()
  })

  ipcMain.handle('server:hardware', () => hardware())

  ipcMain.handle('server:strays', () => findStrays(process.pid))
  ipcMain.handle('server:killStray', (_e, pid: number) => killStray(pid))

  ipcMain.handle('server:start', async () => {
    const pack = activePack()
    if (!pack) throw new Error('no runtime installed')
    // Two llama-servers over one set of weights is how a machine ends up with
    // 103 MB free and 300k page faults a second. Refuse rather than join in.
    const strays = await findStrays(process.pid)
    if (strays.length && !router) {
      throw new Error(
        `llama-server is already running (pid ${strays.map((s) => s.pid).join(', ')})`,
      )
    }
    router ??= new Router(pack.serverPath, ROUTER_PORT)
    router.onChange((s) => getMainWindow()?.webContents.send('server:status', s))
    await router.start(entries())
    return router.status()
  })

  ipcMain.handle('server:stop', async () => {
    await router?.stop()
    return router?.status() ?? { state: 'stopped', port: ROUTER_PORT, models: [] }
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
  await router?.stop()
  router = null
}
