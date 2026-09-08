import { contextBridge, ipcRenderer } from 'electron'
import type { UiPrefs } from '@shared/prefs.js'
import type { ModelFolder } from '@shared/settings.js'
import type { BackendId } from '@shared/runtimes/catalog.js'
import type { Device } from '@shared/runtimes/devices.js'
import type { InstalledPack } from '@main/runtimes/manager.js'
import type { ModelInfo } from '@main/models/describe.js'

export interface RuntimeState {
  installed: InstalledPack[]
  /** What would actually launch — the choice, or pickDefault's answer. */
  activeId: string | null
  /** What the user picked, null while the default is doing the choosing. */
  chosenId: string | null
}

export interface AvailablePackRow {
  backendId: BackendId
  label: string
  note: { en: string; ru: string } | null
  untested: boolean
  bundled: boolean
  build: string
  totalBytes: number
  hasExtra: boolean
  /** Opaque: handed straight back to install(). */
  _pack: unknown
}

export interface AvailableRuntimes {
  build: string
  publishedAt: string | null
  packs: AvailablePackRow[]
}

export interface InstallEvent {
  backendId: BackendId
  stage: 'downloading' | 'extracting' | 'probing' | 'done'
  received?: number
  total?: number
  part?: number
  parts?: number
}

export interface ScanResult {
  models: ModelInfo[]
  failures: { path: string; error: string }[]
}

export type { Device, InstalledPack, ModelFolder, ModelInfo }

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

  runtimes: {
    state: (): Promise<RuntimeState> => ipcRenderer.invoke('runtimes:state'),
    available: (): Promise<AvailableRuntimes> =>
      ipcRenderer.invoke('runtimes:available'),
    install: (pack: unknown): Promise<RuntimeState> =>
      ipcRenderer.invoke('runtimes:install', pack),
    addCustom: (): Promise<RuntimeState> =>
      ipcRenderer.invoke('runtimes:addCustom'),
    choose: (id: string): Promise<RuntimeState> =>
      ipcRenderer.invoke('runtimes:choose', id),
    remove: (id: string): Promise<RuntimeState> =>
      ipcRenderer.invoke('runtimes:remove', id),
    onProgress: (cb: (p: InstallEvent) => void): (() => void) => {
      const h = (_e: unknown, p: InstallEvent): void => cb(p)
      ipcRenderer.on('runtimes:progress', h)
      return () => ipcRenderer.off('runtimes:progress', h)
    },
  },

  models: {
    folders: (): Promise<ModelFolder[]> => ipcRenderer.invoke('models:folders'),
    scan: (): Promise<ScanResult> => ipcRenderer.invoke('models:scan'),
    addFolder: (readOnly?: boolean): Promise<ModelFolder[]> =>
      ipcRenderer.invoke('models:addFolder', readOnly),
    removeFolder: (path: string): Promise<ModelFolder[]> =>
      ipcRenderer.invoke('models:removeFolder', path),
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
