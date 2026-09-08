import { create } from 'zustand'
import { DEFAULT_PREFS, type ThemeChoice, type UiPrefs } from '@shared/prefs.js'
import { translate, type Locale, type StringKey } from '@shared/i18n.js'
import { api } from '@/lib/api'

export type ScreenId =
  | 'server'
  | 'models'
  | 'runtimes'
  | 'benchmark'
  | 'integrations'
  | 'settings'
  | 'handbook'

interface UiState {
  screen: ScreenId
  prefs: UiPrefs
  /** Whether the OS is in dark mode — only consulted when theme is 'system'. */
  systemDark: boolean
  go: (screen: ScreenId) => void
  setTheme: (theme: ThemeChoice) => void
  setLocale: (locale: Locale) => void
  setSystemDark: (dark: boolean) => void
}

/** The theme actually in effect, once 'system' is resolved. */
export function isDark(prefs: UiPrefs, systemDark: boolean): boolean {
  return prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark)
}

/**
 * The `dark` class is what every token in globals.css keys off, so it is
 * applied to <html> imperatively rather than through a React tree — the
 * first paint happens before React mounts.
 */
export function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark)
}

const startup: UiPrefs = api()?.prefsAtStartup ?? DEFAULT_PREFS

export const useUi = create<UiState>((set, get) => ({
  screen: 'server',
  prefs: startup,
  systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,

  go: (screen) => set({ screen }),

  setTheme: (theme) => {
    const prefs = { ...get().prefs, theme }
    set({ prefs })
    applyTheme(isDark(prefs, get().systemDark))
    void api()?.prefs.set(prefs)
  },

  setLocale: (locale) => {
    const prefs = { ...get().prefs, locale }
    set({ prefs })
    document.documentElement.lang = locale
    void api()?.prefs.set(prefs)
  },

  setSystemDark: (systemDark) => {
    set({ systemDark })
    applyTheme(isDark(get().prefs, systemDark))
  },
}))

/** `t('nav.server')` in a component; re-renders when the language changes. */
export function useT(): (key: StringKey) => string {
  const locale = useUi((s) => s.prefs.locale)
  return (key) => translate(locale, key)
}
