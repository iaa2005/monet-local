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
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    registerIpc()
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
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // A router left running holds 16 GB of weights and the port. Stop it
  // before the process goes, and make quitting wait for that to finish.
  let shuttingDown = false
  app.on('before-quit', (e) => {
    if (shuttingDown) return
    e.preventDefault()
    shuttingDown = true
    void shutdownServer().finally(() => app.quit())
  })
}
