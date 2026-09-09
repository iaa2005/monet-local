import { contextBridge, ipcRenderer } from 'electron'
import type { UiPrefs } from '@shared/prefs.js'
import type { AppSettings, ModelFolder } from '@shared/settings.js'
import type { BackendId } from '@shared/runtimes/catalog.js'
import type { Device } from '@shared/runtimes/devices.js'
import type { InstalledPack } from '@main/runtimes/manager.js'
import type { ModelInfo } from '@main/models/describe.js'
import type { Estimate } from '@shared/estimator.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import type { ProfilesFile } from '@main/app/profiles-store.js'
import type { AutoAttempt, AutoProfileResult, AutoProgress } from '@main/ipc/server.js'
import type { Activity, RouterStatus } from '@main/server/router.js'
import type { StrayProcess } from '@main/server/orphans.js'
import type { StoredRun } from '@main/bench/run.js'
import type { HfFile, HfRepo } from '@shared/hf.js'
import type { DownloadProgress, DownloadResult } from '@main/models/download.js'

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

export interface EndpointInfo {
  port: number
  networkAccess: boolean
  hasKey: boolean
  apiKey: string | null
  running: boolean
}

export interface EstimateResult {
  estimate: Estimate
  /** The exact command this profile would run, from the same registry. */
  command: string
}

export interface RepoContents {
  repoId: string
  models: HfFile[]
  projectors: HfFile[]
  /** Split archives, listed so their absence from `models` is explicable. */
  split: string[]
}

/** A download's progress, tagged with the file it belongs to. */
export type DownloadEvent = DownloadProgress & { path: string }

export type {
  AppSettings,
  AutoAttempt,
  AutoProfileResult,
  AutoProgress,
  Device,
  DownloadResult,
  HfFile,
  HfRepo,
  StoredRun,
  Activity,
  Estimate,
  Hardware,
  InstalledPack,
  ModelFolder,
  ModelInfo,
  Profile,
  ProfilesFile,
  RouterStatus,
  StrayProcess,
}

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

  server: {
    status: (): Promise<RouterStatus> => ipcRenderer.invoke('server:status'),
    hardware: (): Promise<Hardware> => ipcRenderer.invoke('server:hardware'),
    activity: (): Promise<Record<string, Activity>> =>
      ipcRenderer.invoke('server:activity'),
    start: (): Promise<RouterStatus> => ipcRenderer.invoke('server:start'),
    stop: (): Promise<RouterStatus> => ipcRenderer.invoke('server:stop'),
    pending: (): Promise<string[]> => ipcRenderer.invoke('server:pending'),
    apply: (): Promise<RouterStatus> => ipcRenderer.invoke('server:apply'),
    load: (id: string): Promise<void> => ipcRenderer.invoke('server:load', id),
    unload: (id: string): Promise<void> =>
      ipcRenderer.invoke('server:unload', id),
    strays: (): Promise<StrayProcess[]> => ipcRenderer.invoke('server:strays'),
    killStray: (pid: number): Promise<void> =>
      ipcRenderer.invoke('server:killStray', pid),
    endpoint: (): Promise<EndpointInfo> => ipcRenderer.invoke('server:endpoint'),
    estimate: (modelId: string, values: Profile): Promise<EstimateResult> =>
      ipcRenderer.invoke('server:estimate', modelId, values),
    /** Auto's attempts as they happen: loading, probing, failed, ok. */
    onAutoProgress: (cb: (p: AutoProgress) => void): (() => void) => {
      const h = (_e: unknown, p: AutoProgress): void => cb(p)
      ipcRenderer.on('server:autoProgress', h)
      return () => ipcRenderer.off('server:autoProgress', h)
    },
    onStatus: (cb: (s: RouterStatus) => void): (() => void) => {
      const h = (_e: unknown, s: RouterStatus): void => cb(s)
      ipcRenderer.on('server:status', h)
      return () => ipcRenderer.off('server:status', h)
    },
    onActivity: (
      cb: (a: Record<string, Activity>) => void,
    ): (() => void) => {
      const h = (_e: unknown, a: Record<string, Activity>): void => cb(a)
      ipcRenderer.on('server:activity', h)
      return () => ipcRenderer.off('server:activity', h)
    },
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set', patch),
  },

  bench: {
    history: (): Promise<StoredRun[]> => ipcRenderer.invoke('bench:history'),
    run: (
      modelId: string,
      profileName: string,
      profile: Profile,
      opts?: { promptTokens?: number; genTokens?: number },
    ): Promise<StoredRun> =>
      ipcRenderer.invoke('bench:run', modelId, profileName, profile, opts),
  },

  hf: {
    search: (query: string): Promise<HfRepo[]> =>
      ipcRenderer.invoke('hf:search', query),
    repo: (repoId: string): Promise<RepoContents> =>
      ipcRenderer.invoke('hf:repo', repoId),
    download: (
      repoId: string,
      path: string,
      expectedBytes: number,
      sha256?: string,
    ): Promise<DownloadResult> =>
      ipcRenderer.invoke('hf:download', repoId, path, expectedBytes, sha256),
    pending: (): Promise<{ name: string; bytes: number }[]> =>
      ipcRenderer.invoke('hf:pending'),
    onProgress: (cb: (p: DownloadEvent) => void): (() => void) => {
      const h = (_e: unknown, p: DownloadEvent): void => cb(p)
      ipcRenderer.on('hf:progress', h)
      return () => ipcRenderer.off('hf:progress', h)
    },
  },

  profiles: {
    get: (): Promise<ProfilesFile> => ipcRenderer.invoke('profiles:get'),
    set: (next: ProfilesFile): Promise<ProfilesFile> =>
      ipcRenderer.invoke('profiles:set', next),
    create: (
      name: string,
      values?: Profile,
    ): Promise<{ file: ProfilesFile; id: string }> =>
      ipcRenderer.invoke('profiles:create', name, values),
    rename: (id: string, name: string): Promise<ProfilesFile> =>
      ipcRenderer.invoke('profiles:rename', id, name),
    remove: (id: string): Promise<ProfilesFile> =>
      ipcRenderer.invoke('profiles:remove', id),
    /** Change what a profile does — every model assigned to it feels it. */
    setValues: (id: string, values: Profile): Promise<ProfilesFile> =>
      ipcRenderer.invoke('profiles:setValues', id, values),
    assign: (modelId: string, profileId: string): Promise<ProfilesFile> =>
      ipcRenderer.invoke('profiles:assign', modelId, profileId),
    /** Pick a model's settings and write them into its own configuration —
     * a new one if it shares one, the existing one if it is its own. */
    auto: (modelId: string): Promise<AutoProfileResult> =>
      ipcRenderer.invoke('profiles:auto', modelId),
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
