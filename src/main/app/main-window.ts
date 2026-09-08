/**
 * The app's one window, as a leaf module any IPC handler can import.
 *
 * A leaf with a setter rather than an export from index.ts: index.ts imports
 * the IPC registrars, so importing back would cycle. Code Monet learned the
 * other half of this lesson the hard way — `BrowserWindow.getAllWindows()[0]`
 * stopped meaning "the app window" the moment a second window existed.
 */

import type { BrowserWindow } from 'electron'

export const APP_MIN_WIDTH = 900
export const APP_MIN_HEIGHT = 620

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/**
 * The window's own background, painted before the renderer draws anything.
 * These are `--bg-100` from globals.css; a mismatch shows as a white flash
 * on launch in dark mode.
 */
export function canvasFor(dark: boolean): string {
  return dark ? '#181818' : '#f6f6f6'
}
