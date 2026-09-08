import { LOCALES, type Locale } from '@shared/i18n.js'
import type { ThemeChoice } from '@shared/prefs.js'
import { Segmented } from '@/components/ui/segmented'
import { useT, useUi } from '@/stores/uiStore'

const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский' }

/**
 * The only screen with working controls in M0 — theme and language are what
 * the scaffold is for: they prove the token set, the i18n wiring and the
 * round trip to disk all hold before any of the real machinery lands.
 */
export function Settings(): JSX.Element {
  const t = useT()
  const prefs = useUi((s) => s.prefs)
  const setTheme = useUi((s) => s.setTheme)
  const setLocale = useUi((s) => s.setLocale)

  const themes: { value: ThemeChoice; label: string }[] = [
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark', label: t('settings.theme.dark') },
    { value: 'system', label: t('settings.theme.system') },
  ]

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-10">
      <h1 className="font-display text-2xl font-semibold">
        {t('settings.title')}
      </h1>
      <p className="mt-1 text-muted-foreground">{t('settings.blurb')}</p>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('settings.appearance')}
        </h2>
        <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
          <Row label={t('settings.theme')}>
            <Segmented value={prefs.theme} options={themes} onChange={setTheme} />
          </Row>
          <Row label={t('settings.language')}>
            <Segmented
              value={prefs.locale}
              options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
              onChange={setLocale}
            />
          </Row>
        </div>
      </section>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): JSX.Element {
  return (
    // Wraps rather than overflows: a segmented control with long option names
    // (Светлая / Тёмная / Системная is half again the width of the English)
    // pushed a horizontal scrollbar onto the whole screen at narrow widths.
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  )
}
