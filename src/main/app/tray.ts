/**
 * The tray: closing the window does not stop the server.
 *
 * A model server that quits when its window is closed is a chat, not a
 * server. Closing the window hides it; the icon in the tray brings it back
 * or quits for real, and the router, the gateway and any download in
 * flight carry on in between. Quit — from the tray, from the menu, from
 * the OS — still goes through `before-quit`, which stops the router first.
 */

import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { en, ru } from '@shared/i18n.js'
import { getMainWindow } from './main-window.js'
import { readPrefs } from './prefs-store.js'

let tray: Tray | null = null
/** True once a real quit has started: the close handler then lets go. */
let quitting = false

export function isQuitting(): boolean {
  return quitting
}

export function markQuitting(): void {
  quitting = true
}

function strings(): typeof en {
  return readPrefs().locale === 'ru' ? (ru as typeof en) : en
}

export function showMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function iconPath(): string {
  // build/icon.png ships inside the asar (electron-builder.yml `files`), so
  // the same path holds in dev and in the installed app.
  return join(app.getAppPath(), 'build', 'icon.png')
}

export function createTray(): void {
  if (tray) return
  const image = nativeImage.createFromPath(iconPath())
  // Windows draws the tray at 16px and scales anything else badly.
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('Monet Local')
  refreshTrayMenu()
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

/** Rebuilt on demand: the labels follow the app's language. */
export function refreshTrayMenu(): void {
  if (!tray) return
  const t = strings()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t['tray.open'], click: showMainWindow },
      { type: 'separator' },
      {
        label: t['tray.quit'],
        click: () => {
          markQuitting()
          app.quit()
        },
      },
    ]),
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
