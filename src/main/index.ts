import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import {
  APP_MIN_HEIGHT,
  APP_MIN_WIDTH,
  canvasFor,
  getMainWindow,
  setMainWindow,
} from './app/main-window.js'
import { readPrefs } from './app/prefs-store.js'
import { createTray, isQuitting, markQuitting, showMainWindow } from './app/tray.js'
import { registerIpc } from './ipc/index.js'
import { shutdownServer } from './ipc/server.js'

const isDev = !app.isPackaged

function iconPath(): string | undefined {
  // Packaged builds take the icon from the .exe itself; a dev launch is plain
  // Electron and shows Electron's logo unless handed one.
  return isDev ? join(app.getAppPath(), 'build', 'icon.png') : undefined
}

function createWindow(): void {
  const prefs = readPrefs()
  const dark =
    prefs.theme === 'dark' ||
    (prefs.theme === 'system' && nativeTheme.shouldUseDarkColors)

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: APP_MIN_WIDTH,
    minHeight: APP_MIN_HEIGHT,
    show: false,
    title: 'Monet Local',
    ...(iconPath() ? { icon: iconPath() } : {}),
    // Native title bar off, resizable frame on: the header and the window
    // buttons are ours, so the app looks native rather than like Electron.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 10 } }
      : {}),
    backgroundColor: canvasFor(dark),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
    },
  })

  setMainWindow(win)
  win.once('ready-to-show', () => win.show())

  // Close hides. The server, the gateway and a download in flight keep
  // going; the tray icon brings the window back or quits for real.
  win.on('close', (e) => {
    if (isQuitting()) return
    e.preventDefault()
    win.hide()
  })

  // Nothing in this app should navigate itself or open a second window; a
  // link goes to the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const notify = (): void =>
    win.webContents.send('win:maximizeChanged', win.isMaximized())
  win.on('maximize', notify)
  win.on('unmaximize', notify)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// One instance: two of them would fight over the same server port and the
// same prefs file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A second launch is someone looking for the window that is in the tray.
  app.on('second-instance', showMainWindow)

  void app.whenReady().then(() => {
    registerIpc()
    createTray()
    // Lazily: electron-updater reads app-update.yml when it loads, and a
    // dev run has none. The handlers register either way.
    void import('./app/updater.js')
      .then((m) => m.startAutoUpdater())
      .catch((err: unknown) => console.warn('[updater] not started:', err))
    createWindow()
    nativeTheme.on('updated', () => {
      const prefs = readPrefs()
      if (prefs.theme !== 'system') return
      getMainWindow()?.setBackgroundColor(
        canvasFor(nativeTheme.shouldUseDarkColors),
      )
      getMainWindow()?.webContents.send(
        'prefs:systemThemeChanged',
        nativeTheme.shouldUseDarkColors,
      )
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showMainWindow()
    })
  })

  // Never reached by a plain close (the window hides), and a real quit is
  // already on its way through before-quit; nothing to do here.
  app.on('window-all-closed', () => undefined)

  // A router left running holds 16 GB of weights and the port. Stop it
  // before the process goes, and make quitting wait for that to finish.
  let shuttingDown = false
  app.on('before-quit', (e) => {
    // Whatever asked — the tray, the OS, an updater relaunch — the window's
    // close handler must now let the window go.
    markQuitting()
    if (shuttingDown) return
    e.preventDefault()
    shuttingDown = true
    void shutdownServer().finally(() => app.quit())
  })
}
