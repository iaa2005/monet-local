import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type { StringKey } from '@shared/i18n.js'

/** Every screen opens the same way: display-face title, one line under it. */
export function PageHeader({
  title,
  blurb,
  actions,
}: {
  title: StringKey
  blurb: StringKey
  actions?: React.ReactNode
}): JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t(title)}</h1>
        <p className="mt-1 text-muted-foreground">{t(blurb)}</p>
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  )
}

export function Section({
  title,
  actions,
  children,
}: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Card({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card divide-y divide-border',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * A small fact next to a name: a quant, a MoE marker, an "untested" warning.
 * `tone` exists so a warning does not have to be spelled out in colours at
 * every call site.
 */
export function Badge({
  tone = 'muted',
  title,
  children,
}: {
  tone?: 'muted' | 'brand' | 'warn'
  title?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-[11px] leading-tight',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'brand' && 'bg-brand-wash text-foreground',
        tone === 'warn' && 'bg-warn/15 text-warn',
      )}
    >
      {children}
    </span>
  )
}
