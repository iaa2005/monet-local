import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type { StringKey } from '@shared/i18n.js'

/**
 * Every screen sits in the same column.
 *
 * ONE width, here and nowhere else. Screens used to pick their own
 * (max-w-2xl, 3xl, 4xl) and the content jumped sideways on every click in
 * the sidebar. `max-w` rather than `w`: above 880px of content every screen
 * is exactly this wide; below it they all shrink together, which is still
 * no jump.
 */
export function Page({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-[880px] px-8 py-10">{children}</div>
}

/**
 * The top of a screen: a display-face title, one line under it, actions on
 * the right. The title is the only large text on a page — everything else
 * earns its size by being a number.
 */
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
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">
          {t(title)}
        </h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">{t(blurb)}</p>
      </div>
      {actions ? <div className="flex shrink-0 gap-2 pt-1">{actions}</div> : null}
    </div>
  )
}

/**
 * A section label: small, quiet, spaced out. The reference dashboards say
 * "Your meetings" this way and let the card underneath carry the weight.
 */
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
    <section className="mt-9">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

/**
 * A card. `overflow-hidden` is not decoration: rows inside paint their own
 * hover and selection backgrounds, and without clipping the first and last
 * rows drew square corners over the card's round ones.
 */
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
        'overflow-hidden rounded-xl border border-border bg-card divide-y divide-border',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * A row that is a target, not a label with a target in it.
 *
 * The model list used to wrap only the NAME in a button, so clicking the
 * badge beside it — or the empty space, or the size — did nothing. If a row
 * reads as one thing it must click as one thing.
 */
export function ClickRow({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean
  onClick?: () => void
  children: React.ReactNode
  className?: string
}): JSX.Element {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors',
        onClick && 'cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:bg-accent',
        selected && 'bg-brand-wash hover:bg-brand-wash',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * A small fact next to a name: a quant, a MoE marker, an "untested" warning.
 */
export function Badge({
  tone = 'muted',
  title,
  children,
}: {
  tone?: 'muted' | 'brand' | 'warn' | 'ok' | 'bad'
  title?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'brand' && 'bg-brand-wash text-foreground',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'ok' && 'bg-green-bg text-green-text',
        tone === 'bad' && 'bg-red-bg text-red-text',
      )}
    >
      {children}
    </span>
  )
}

/**
 * A number that deserves to be large, with its label kept small above it.
 * This is how the reference dashboards make "8 h 27m" readable from across
 * the room while "Daily working hours" stays out of the way.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string
  value: string
  unit?: string
  hint?: string
  tone?: 'ok' | 'warn' | 'bad'
}): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-display text-[22px] font-semibold leading-none tracking-tight',
          tone === 'ok' && 'text-green-text',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-red-text',
        )}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-[13px] font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

/**
 * A stacked bar: parts of one whole against a ceiling. The memory budget is
 * exactly this shape — weights, cache, buffers, and how much of the machine
 * they leave — and a bar says it faster than four numbers.
 */
export function StackedBar({
  parts,
  total,
  className,
}: {
  parts: { label: string; value: number; className: string }[]
  /** What 100% means — the ceiling, not the sum. */
  total: number
  className?: string
}): JSX.Element {
  return (
    <div className={cn('flex h-2.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      {parts.map((p) => (
        <div
          key={p.label}
          title={p.label}
          className={cn('h-full', p.className)}
          style={{ width: `${Math.max(0, Math.min(100, (p.value / total) * 100))}%` }}
        />
      ))}
    </div>
  )
}
