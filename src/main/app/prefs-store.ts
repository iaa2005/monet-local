/**
 * Theme and language on disk.
 *
 * Read SYNCHRONOUSLY at startup and injected through the preload bridge: the
 * window's background colour and the `dark` class both depend on the answer,
 * and fetching it over an async IPC channel means the app paints light for a
 * frame and then snaps. Everything else the app stores will be async and
 * arrive in M1 — this is the one thing the first paint needs.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_PREFS, parsePrefs, type UiPrefs } from '@shared/prefs.js'
import { localeFromSystem } from '@shared/i18n.js'

function prefsPath(): string {
  return join(app.getPath('userData'), 'ui-prefs.json')
}

let cached: UiPrefs | null = null

export function readPrefs(): UiPrefs {
  if (cached) return cached
  // A fresh install follows the OS rather than defaulting everyone to English.
  const fallback: UiPrefs = {
    ...DEFAULT_PREFS,
    locale: localeFromSystem(app.getLocale()),
  }
  try {
    cached = parsePrefs(JSON.parse(readFileSync(prefsPath(), 'utf8')), fallback)
  } catch {
    cached = fallback
  }
  return cached
}

export function writePrefs(next: UiPrefs): UiPrefs {
  cached = parsePrefs(next, readPrefs())
  try {
    mkdirSync(dirname(prefsPath()), { recursive: true })
    writeFileSync(prefsPath(), JSON.stringify(cached, null, 2), 'utf8')
  } catch (err) {
    console.error('[prefs] could not save', err)
  }
  return cached
}
