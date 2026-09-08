/**
 * The handful of settings that must be known before the first paint, and the
 * shape they cross IPC in.
 *
 * Kept apart from the (much larger) app settings that arrive in M1: theme and
 * language decide what the window looks like the instant it opens, so main
 * reads them from disk synchronously and hands them to the renderer through
 * the preload bridge rather than over an async channel that would flash.
 */

import type { Locale } from './i18n.js'

export type ThemeChoice = 'light' | 'dark' | 'system'

export interface UiPrefs {
  theme: ThemeChoice
  locale: Locale
}

export const DEFAULT_PREFS: UiPrefs = { theme: 'system', locale: 'en' }

/** Narrow whatever was on disk; a hand-edited file must not crash the app. */
export function parsePrefs(raw: unknown, fallback: UiPrefs): UiPrefs {
  const o = (raw ?? {}) as Partial<UiPrefs>
  const theme: ThemeChoice =
    o.theme === 'light' || o.theme === 'dark' || o.theme === 'system'
      ? o.theme
      : fallback.theme
  const locale: Locale =
    o.locale === 'en' || o.locale === 'ru' ? o.locale : fallback.locale
  return { theme, locale }
}
