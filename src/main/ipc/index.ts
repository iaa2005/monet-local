import { ipcMain, nativeTheme } from 'electron'
import { parsePrefs, type UiPrefs } from '@shared/prefs.js'
import { canvasFor, getMainWindow } from '../app/main-window.js'
import { readPrefs, writePrefs } from '../app/prefs-store.js'
import { ensureDirs } from '../app/settings-store.js'
import { registerModelIpc } from './models.js'
import { registerRuntimeIpc } from './runtimes.js'
import { registerServerIpc } from './server.js'
import { registerBenchIpc } from './bench.js'

/**
 * Every IPC handler the app has so far. One file while it is this small; it
 * splits by namespace the moment a second domain (models, runtimes) arrives.
 */
export function registerIpc(): void {
  ensureDirs()
  registerRuntimeIpc()
  registerModelIpc()
  registerServerIpc()
  registerBenchIpc()

  ipcMain.handle('win:minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('win:close', () => getMainWindow()?.close())
  ipcMain.handle('win:isMaximized', () => getMainWindow()?.isMaximized() ?? false)

  // Synchronous on purpose, and only this one: the preload reads it as a
  // value so the renderer knows the theme before its first paint.
  ipcMain.on('prefs:sync', (e) => {
    e.returnValue = readPrefs()
  })

  ipcMain.handle('prefs:get', () => readPrefs())
  ipcMain.handle('prefs:set', (_e, raw: unknown): UiPrefs => {
    const next = writePrefs(parsePrefs(raw, readPrefs()))
    // The window paints its own background behind the page; leaving it on the
    // old theme shows as a wrong-coloured band while resizing.
    const dark =
      next.theme === 'dark' ||
      (next.theme === 'system' && nativeTheme.shouldUseDarkColors)
    getMainWindow()?.setBackgroundColor(canvasFor(dark))
    return next
  })
}
