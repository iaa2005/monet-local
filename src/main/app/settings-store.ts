/**
 * App settings on disk, and the folders the app owns underneath userData.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type AppSettings,
} from '@shared/settings.js'

export function dataDir(): string {
  return app.getPath('userData')
}

/**
 * Runtime packs live here and NOT inside app.asar — an archive cannot spawn
 * an executable, and the bundled packs are copied out here on first run for
 * the same reason.
 */
export function runtimesDir(): string {
  return join(dataDir(), 'runtimes')
}

/**
 * Downloads land here first and only move into a model folder once complete.
 * The llama.cpp router cheerfully tried to load a half-downloaded GGUF that
 * was sitting in a models folder; a partial file must never be visible to it.
 */
export function downloadsDir(): string {
  return join(dataDir(), 'downloads')
}

export function indexDir(): string {
  return join(dataDir(), 'index')
}

export function logsDir(): string {
  return join(dataDir(), 'logs')
}

function settingsPath(): string {
  return join(dataDir(), 'settings.json')
}

let cached: AppSettings | null = null

export function readSettings(): AppSettings {
  if (cached) return cached
  try {
    cached = parseSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    cached = { ...DEFAULT_SETTINGS }
  }
  return cached
}

export function writeSettings(next: Partial<AppSettings>): AppSettings {
  cached = parseSettings({ ...readSettings(), ...next })
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(cached, null, 2), 'utf8')
  } catch (err) {
    console.error('[settings] could not save', err)
  }
  return cached
}

export function ensureDirs(): void {
  for (const d of [runtimesDir(), downloadsDir(), indexDir(), logsDir()]) {
    mkdirSync(d, { recursive: true })
  }
}
