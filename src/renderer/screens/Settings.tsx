import { LOCALES, type Locale } from '@shared/i18n.js'
import type { ThemeChoice } from '@shared/prefs.js'
import { Card, Page, PageHeader, Section } from '@/components/ui/page'
import { Segmented } from '@/components/ui/segmented'
import { useT, useUi } from '@/stores/uiStore'

const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский' }

/**
 * Appearance and language. Everything with a machine behind it — folders,
 * runtimes, the port and the key — lives on the screen that uses it, so
 * this one stays short.
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
    <Page>
      <PageHeader title="settings.title" blurb="settings.blurb" />

      <Section title={t('settings.appearance')}>
        <Card>
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
        </Card>
      </Section>
    </Page>
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
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  )
}
