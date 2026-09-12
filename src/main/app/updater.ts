/**
 * Auto-update — GitHub Releases as the feed, electron-updater as the engine.
 *
 * Ported from Code Monet, lessons included. The download is the USER's
 * call: nothing is fetched until they ask, and every step is a state the
 * renderer can see —
 *
 *   idle → checking → available (a version, and how big) → downloading
 *   (percent) → ready (relaunch now, or it installs on the next quit)
 *   …and error, which is a state like any other, carrying WHY.
 *
 * Until 0.1.2 this app had electron-updater in package.json and nothing
 * calling it: the release feed was published on every tag and no installed
 * copy ever looked at it. The manual check on the Settings screen exists so
 * "is it still looking?" has an answer either way.
 *
 * Dev builds have no update feed (app-update.yml exists only in packaged
 * apps), so everything but the IPC is gated on app.isPackaged — the handlers
 * stay registered so the renderer can always ask and simply hear "idle".
 */

import { app, ipcMain } from 'electron'
import { getMainWindow } from './main-window.js'

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; bytes?: number }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string; version?: string }

let state: UpdateState = { status: 'idle' }

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/** The state as it is NOW — read it through this after an await: a direct
 * `state.status` there is narrowed from before the await, and by then the
 * engine's events have usually moved it on. */
function current(): UpdateState {
  return state
}

function setState(next: UpdateState): void {
  state = next
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('update:state', next)
}

/**
 * The error as a sentence, with the cause chain: an updater failure is a
 * network error wrapped twice, and the outer layers say nothing.
 */
export function describeError(err: unknown): string {
  const parts: string[] = []
  let cur: unknown = err
  for (let hops = 0; cur != null && hops < 4; hops++) {
    const msg = cur instanceof Error ? cur.message : String(cur)
    const code = (cur as { code?: string }).code
    parts.push(code && !msg.includes(code) ? `${msg} (${code})` : msg)
    cur = cur instanceof Error ? cur.cause : undefined
  }
  const seen = new Set<string>()
  const unique = parts.filter((p) => !seen.has(p) && (seen.add(p), true))
  if (unique.length > 1 && unique[0] === 'fetch failed') unique.shift()
  return unique.join(' — ')
}

/**
 * The engine, loaded lazily — it reads app-update.yml at import time.
 *
 * Reached through `default` as well as the named export: electron-updater is
 * CommonJS and publishes `autoUpdater` through a defined getter that
 * cjs-module-lexer cannot see. In dev the named import resolves; in the
 * packaged app the namespace's only real member is `default`, and a bare
 * `const { autoUpdater } = …` was undefined — measured in Code Monet on an
 * installed build, where no check ever ran because of it.
 */
async function updater(): Promise<typeof import('electron-updater').autoUpdater> {
  const mod = (await import('electron-updater')) as unknown as {
    autoUpdater?: typeof import('electron-updater').autoUpdater
    default?: { autoUpdater?: typeof import('electron-updater').autoUpdater }
  }
  const au = mod.autoUpdater ?? mod.default?.autoUpdater
  if (!au)
    throw new Error('electron-updater loaded without an autoUpdater — the app cannot check for updates')
  return au
}

export function startAutoUpdater(): void {
  ipcMain.handle('update:state', () => state)
  ipcMain.handle('update:current', () => app.getVersion())

  ipcMain.handle('update:check', async (): Promise<UpdateState> => {
    if (!app.isPackaged) return state
    // A check while something is already happening would throw away a
    // download in flight; the state IS the answer in that case.
    if (state.status === 'downloading' || state.status === 'ready') return state
    setState({ status: 'checking' })
    try {
      const au = await updater()
      const result = await au.checkForUpdates()
      // The 'update-available' event has already set the state when there is
      // one; this only closes the case the events left open.
      if (current().status === 'checking') {
        const found = result?.updateInfo?.version
        setState(
          found && found !== app.getVersion()
            ? { status: 'available', version: found }
            : { status: 'idle' },
        )
      }
    } catch (err) {
      setState({ status: 'error', message: describeError(err) })
    }
    return state
  })

  ipcMain.handle('update:download', async (): Promise<UpdateState> => {
    if (!app.isPackaged) return state
    if (state.status !== 'available' && state.status !== 'error') return state
    const version = state.version
    if (!version) return state
    setState({ status: 'downloading', version, percent: 0 })
    try {
      const au = await updater()
      await au.downloadUpdate()
      // 'update-downloaded' sets `ready`; if the engine resolved without it
      // (a cached download), say ready anyway rather than spin forever.
      if (current().status === 'downloading') setState({ status: 'ready', version })
    } catch (err) {
      setState({ status: 'error', message: describeError(err), version })
    }
    return state
  })

  ipcMain.handle('update:install', async () => {
    if (!app.isPackaged || state.status !== 'ready') return
    const au = await updater()
    // setImmediate: let the invoke resolve before the app starts tearing
    // itself down, or the renderer dies waiting on a reply.
    setImmediate(() => au.quitAndInstall())
  })

  if (!app.isPackaged) return

  void (async () => {
    try {
      const au = await updater()
      au.autoDownload = false
      au.autoInstallOnAppQuit = true
      au.on('update-available', (info) =>
        setState({
          status: 'available',
          version: info.version,
          ...(info.files?.[0]?.size ? { bytes: info.files[0].size } : {}),
        }),
      )
      au.on('update-not-available', () => {
        if (state.status === 'checking') setState({ status: 'idle' })
      })
      au.on('download-progress', (p) => {
        if (state.status !== 'downloading' && state.status !== 'available') return
        setState({
          status: 'downloading',
          version: state.version,
          percent: Math.max(0, Math.min(100, Math.round(p.percent))),
        })
      })
      au.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }))
      // An offline check is Tuesday, not an incident — but a failure DURING
      // a download the user started is news, and it reaches them as one.
      au.on('error', (err) => {
        console.warn('[updater]', err instanceof Error ? err.message : err)
        if (state.status === 'downloading' || state.status === 'checking')
          setState({
            status: 'error',
            message: describeError(err),
            ...(state.status === 'downloading' ? { version: state.version } : {}),
          })
      })
      const check = (): void => void au.checkForUpdates().catch(() => {})
      check()
      setInterval(check, CHECK_EVERY_MS)
    } catch (err) {
      // When the engine itself cannot be reached the app can never offer an
      // update in this run, and the pill is the one place that would say so.
      console.warn('[updater] unavailable:', err instanceof Error ? err.message : err)
      setState({ status: 'error', message: describeError(err) })
    }
  })()
}
