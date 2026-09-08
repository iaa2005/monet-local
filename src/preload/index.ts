import { contextBridge, ipcRenderer } from 'electron'
import type { UiPrefs } from '@shared/prefs.js'

/**
 * The renderer's whole view of main, grouped by namespace so that
 * `window.local.win.close()` reads as what it does.
 *
 * `prefsAtStartup` is a VALUE, not a call: theme and language decide the
 * first paint, and awaiting them would show a light frame before the dark
 * one. Main reads the file synchronously before the window exists.
 */
const api = {
  platform: process.platform,
  prefsAtStartup: ipcRenderer.sendSync('prefs:sync') as UiPrefs | null,

  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: (): Promise<void> =>
      ipcRenderer.invoke('win:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
    onMaximizeChange: (cb: (v: boolean) => void): (() => void) => {
      const h = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('win:maximizeChanged', h)
      return () => ipcRenderer.off('win:maximizeChanged', h)
    },
  },

  prefs: {
    get: (): Promise<UiPrefs> => ipcRenderer.invoke('prefs:get'),
    set: (next: UiPrefs): Promise<UiPrefs> =>
      ipcRenderer.invoke('prefs:set', next),
    onSystemThemeChange: (cb: (dark: boolean) => void): (() => void) => {
      const h = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('prefs:systemThemeChanged', h)
      return () => ipcRenderer.off('prefs:systemThemeChanged', h)
    },
  },
}

export type LocalAPI = typeof api

contextBridge.exposeInMainWorld('local', api)
