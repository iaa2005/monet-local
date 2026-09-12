import { Download, RotateCw } from 'lucide-react'
import { LOCALES, type Locale } from '@shared/i18n.js'
import type { ThemeChoice } from '@shared/prefs.js'
import { bytes } from '@shared/format.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, Page, PageHeader, Section } from '@/components/ui/page'
import { Segmented } from '@/components/ui/segmented'
import { useUpdateState } from '@/lib/updates'
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

      <Section title={t('about.title')}>
        <Card>
          <UpdateRow />
        </Card>
      </Section>
    </Page>
  )
}

/**
 * The version, and a way to ask about updates.
 *
 * The automatic check says nothing when it finds nothing — right for a pill
 * that exists to interrupt, useless to someone wondering whether the app
 * still checks at all. Here the question can be asked out loud, and every
 * answer is an answer: up to date, a version to download, or why not.
 */
function UpdateRow(): JSX.Element {
  const t = useT()
  const { state, current, checking, checked, check, download, install } = useUpdateState()
  const dev = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV

  const action = (): JSX.Element => {
    switch (state.status) {
      case 'available':
        return (
          <Button size="sm" variant="brand" onClick={download}>
            <Download className="mr-2 size-3.5" />
            {t('update.download')} v{state.version}
            {state.bytes ? ` · ${bytes(state.bytes, 0)}` : ''}
          </Button>
        )
      case 'downloading':
        return (
          <span className="text-sm tabular-nums text-muted-foreground">
            {t('update.downloading')} v{state.version} — {state.percent}%
          </span>
        )
      case 'ready':
        return (
          <Button size="sm" variant="brand" onClick={install}>
            <RotateCw className="mr-2 size-3.5" />
            {t('update.ready')} · v{state.version}
          </Button>
        )
      case 'error':
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-warn">{state.message}</span>
            <Button size="sm" variant="outline" onClick={() => (state.version ? download() : void check())}>
              {t('update.retry')}
            </Button>
          </span>
        )
      default:
        return (
          <span className="flex items-center gap-2">
            {checked ? <Badge tone="ok">{t('update.upToDate')}</Badge> : null}
            <Button size="sm" variant="outline" disabled={checking || dev} onClick={() => void check()}>
              {checking ? t('update.checking') : t('update.check')}
            </Button>
          </span>
        )
    }
  }

  return (
    <Row label={`${t('about.version')} ${current || '…'}`}>
      <span className="flex flex-wrap items-center gap-2">
        {action()}
        {dev ? <span className="text-xs text-muted-foreground">{t('update.devHint')}</span> : null}
      </span>
    </Row>
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
