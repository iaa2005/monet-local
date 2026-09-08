import { dialog, ipcMain } from 'electron'
import { backendsFor } from '@shared/runtimes/catalog.js'
import { packsIn, type AvailablePack } from '@shared/runtimes/release.js'
import { getMainWindow } from '../app/main-window.js'
import { readSettings, writeSettings } from '../app/settings-store.js'
import {
  addCustomPack,
  fetchLatestRelease,
  installPack,
  listInstalled,
  pickDefault,
  probe,
  removePack,
  type InstallProgress,
} from '../runtimes/manager.js'

/**
 * Everything installed, plus which one would run. The renderer never decides
 * the default — pickDefault is one rule in one place.
 */
function state(): unknown {
  const installed = listInstalled()
  const chosen = readSettings().runtimeId
  const active =
    installed.find((p) => p.id === chosen) ?? pickDefault(installed)
  return { installed, activeId: active?.id ?? null, chosenId: chosen ?? null }
}

let cache: { at: number; value: unknown } | null = null

export function registerRuntimeIpc(): void {
  ipcMain.handle('runtimes:state', () => state())

  ipcMain.handle('runtimes:available', async (_e, force = false) => {
    // Cached for an hour. Resolving a release costs one feed fetch plus a
    // ranged request per asset, and re-running that every time the screen is
    // opened is rude to GitHub and slow for the user. A new llama.cpp build
    // appears several times a day, not several times a minute.
    const now = Date.now()
    if (!force && cache && now - cache.at < 60 * 60 * 1000) return cache.value

    const backends = backendsFor(process.platform, process.arch)
    const release = await fetchLatestRelease(backends, readSettings().githubToken)
    const packs = packsIn(release, backends)
    const value = {
      build: release.tag_name,
      publishedAt: release.published_at ?? null,
      packs: packs.map((p) => ({
        backendId: p.backend.id,
        label: p.backend.label,
        note: p.backend.note ?? null,
        untested: p.backend.untested === true,
        bundled: p.backend.bundled === true,
        build: p.build,
        totalBytes: p.totalBytes,
        hasExtra: !!p.extra,
        // The renderer sends this straight back to install; it is the
        // release's own data, not something it composes.
        _pack: p as AvailablePack,
      })),
    }
    cache = { at: now, value }
    return value
  })

  ipcMain.handle('runtimes:install', async (_e, pack: AvailablePack) => {
    const win = getMainWindow()
    const send = (p: InstallProgress): void =>
      void win?.webContents.send('runtimes:progress', {
        backendId: pack.backend.id,
        ...p,
      })
    const installed = await installPack(pack, send)
    // First pack installed becomes the choice: nobody wants to pick a
    // runtime before they have two.
    if (!readSettings().runtimeId) writeSettings({ runtimeId: installed.id })
    return state()
  })

  ipcMain.handle('runtimes:addCustom', async () => {
    const win = getMainWindow()
    const picked = await dialog.showOpenDialog(win!, {
      title: 'Folder containing llama-server',
      properties: ['openDirectory'],
    })
    const dir = picked.filePaths[0]
    if (picked.canceled || !dir) return state()
    await addCustomPack(dir)
    return state()
  })

  ipcMain.handle('runtimes:choose', (_e, id: string) => {
    writeSettings({ runtimeId: id })
    return state()
  })

  ipcMain.handle('runtimes:remove', (_e, id: string) => {
    removePack(id)
    if (readSettings().runtimeId === id) writeSettings({ runtimeId: undefined })
    return state()
  })

  /** Re-run --list-devices: drivers change, and a pack can become usable. */
  ipcMain.handle('runtimes:probe', async (_e, id: string) => {
    const pack = listInstalled().find((p) => p.id === id)
    if (!pack) return state()
    return { ...(await probe(pack.dir)), id }
  })
}
