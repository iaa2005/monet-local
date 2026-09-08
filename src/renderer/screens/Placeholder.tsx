import type { LucideIcon } from 'lucide-react'
import { useT } from '@/stores/uiStore'
import type { StringKey } from '@shared/i18n.js'

/**
 * A screen that exists in the navigation but not yet in code.
 *
 * Deliberately not a "TODO" box: it names what the screen will do, so the
 * scaffold reads as an app with unfinished rooms rather than an empty shell.
 * Each one is replaced wholesale by its milestone.
 */
export function Placeholder({
  title,
  blurb,
  Icon,
}: {
  title: StringKey
  blurb: StringKey
  Icon: LucideIcon
}): JSX.Element {
  const t = useT()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Icon className="size-8 text-brand" strokeWidth={1.75} />
      <h1 className="font-display text-2xl font-semibold">{t(title)}</h1>
      <p className="max-w-md text-muted-foreground">{t(blurb)}</p>
      <p className="text-sm text-muted-foreground/70">{t('common.soon')}</p>
    </div>
  )
}
