import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { Estimate } from '@shared/estimator.js'
import { bytes, tokens } from '@shared/format.js'
import type { StringKey } from '@shared/i18n.js'
import { Badge, StackedBar, Stat } from '@/components/ui/page'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'

const WEIGHTS = 'bg-foreground/70'
const KV = 'bg-brand'
const COMPUTE = 'bg-foreground/30'

interface Part {
  label: string
  value: number
  className: string
}

interface Budget {
  label: string
  /** For the stuck bar, where the full label costs a second line. */
  short: string
  parts: Part[]
  ceiling: number
}

/**
 * Is the card out of sight, and what is it scrolling inside of?
 *
 * The page scrolls in `<main>`, not the window: an observer rooted at the
 * viewport would answer for the wrong box, and the window's width is not the
 * width of the column's surroundings either.
 */
function useOutOfView(): [
  React.RefObject<HTMLDivElement | null>,
  boolean,
  HTMLElement | null,
] {
  const card = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState(false)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const el = card.current
    if (!el) return
    let root: HTMLElement | null = el.parentElement
    while (root) {
      const overflow = getComputedStyle(root).overflowY
      if (overflow === 'auto' || overflow === 'scroll') break
      root = root.parentElement
    }
    setScroller(root)
    const io = new IntersectionObserver(
      ([entry]) => setAway(!(entry?.isIntersecting ?? true)),
      { root },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return [card, away, scroller]
}

/**
 * Stretch a box from inside the column to the full width of the scroller.
 *
 * Measured, not reached for with `100vw`: a plate that overshoots has to be
 * clipped, and `overflow-x: clip` beside an `overflow-y: auto` computes to
 * `hidden` — which quietly makes the page horizontally scrollable by two
 * thousand pixels of nothing. Centring it with a transform does not land
 * exactly either; the offset to the scroller's edge is a number, so it is
 * used as one.
 */
function useFullWidth(
  anchor: React.RefObject<HTMLElement | null>,
  scroller: HTMLElement | null,
  on: boolean,
): { left: number; width: number } {
  const [box, setBox] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const el = anchor.current
    if (!on || !el || !scroller) return
    const measure = (): void => {
      const a = el.getBoundingClientRect()
      const s = scroller.getBoundingClientRect()
      setBox({ left: Math.round(s.left - a.left), width: scroller.clientWidth })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(scroller)
    ro.observe(el)
    return () => ro.disconnect()
  }, [anchor, scroller, on])

  return box
}

/**
 * The verdict, with its reasons and what to do about them.
 *
 * Two meters rather than one, because there are two ceilings and a
 * configuration has to clear both. Showing only the RAM budget is how a
 * "will not fit" verdict came to sit above a bar that looked comfortable:
 * RAM was fine, and the GPU — which is what the estimate actually refused
 * on — was not drawn at all.
 *
 * It sticks. The settings that move these numbers run well past the bottom
 * of the window, and an answer you have to scroll back up to read is an
 * answer you stop reading; so once it reaches the top it stays there, as one
 * line rather than a card, and the form goes on scrolling underneath.
 */
export function Verdict({
  estimate: e,
  onApply,
}: {
  estimate: Estimate
  onApply?: (fix: Estimate['suggestions'][number]) => void
}): JSX.Element {
  const t = useT()
  const [card, away, scroller] = useOutOfView()
  const rail = useRef<HTMLDivElement>(null)
  const plate = useFullWidth(rail, scroller, away)
  const tone = e.level === 'fits' ? 'ok' : e.level === 'tight' ? 'warn' : 'bad'
  const Icon =
    e.level === 'fits' ? CheckCircle2 : e.level === 'tight' ? AlertTriangle : XCircle

  const device = e.findings.find((f) => f.code === 'exceeds-device')?.device
  const budgets: Budget[] = [
    {
      label: t('verdict.ram'),
      short: t('verdict.ramShort'),
      ceiling: e.ramCeiling,
      parts: [
        { label: t('verdict.weights'), value: e.weightsBytes, className: WEIGHTS },
        { label: t('verdict.kv'), value: e.kvBytes, className: KV },
        { label: t('verdict.compute'), value: e.computeBytes, className: COMPUTE },
      ],
    },
    // On an integrated GPU this is a slice of the same RAM rather than extra
    // capacity — a second, lower wall, and usually the one hit first.
    ...(e.deviceParts && e.deviceCeiling !== undefined
      ? [
          {
            label: `${t('verdict.gpu')}${device ? ` · ${device}` : ''}`,
            short: t('verdict.gpuShort'),
            ceiling: e.deviceCeiling,
            parts: [
              {
                label: t('verdict.weights'),
                value: e.deviceParts.weightsBytes,
                className: WEIGHTS,
              },
              { label: t('verdict.kv'), value: e.deviceParts.kvBytes, className: KV },
              {
                label: t('verdict.compute'),
                value: e.deviceParts.computeBytes,
                className: COMPUTE,
              },
            ],
          },
        ]
      : []),
  ]

  return (
    <>
      {/* A SECOND, compact copy — not this card collapsed.
          Collapsing it in place changed the page's height, which moved the
          scroll, which changed what was on screen, which collapsed or
          expanded it again: the page shook. Nothing in the flow moves now.
          The rail is zero-height and the bar hangs off it, so the form
          below is laid out as if neither existed. */}
      <div className="sticky top-0 z-30 h-0">
        {away ? (
          // Stacked in normal flow inside an absolutely positioned box, so
          // the fade always starts exactly where the bar ends however tall
          // the bar turns out to be — it wraps to two lines at narrow
          // widths, and a fade pinned to the rail instead would have hidden
          // its own strongest part behind it.
          <div ref={rail} className="absolute inset-x-0 top-0">
            {/* One plate behind the whole thing, reaching past the column on
                both sides. It covers the bar and the 40px under it, and
                fades out over that last stretch. */}
            <div
              className="glass-plate pointer-events-none absolute inset-y-0"
              style={{ left: plate.left, width: plate.width || '100%' }}
              aria-hidden
            />
            <div
              className={cn(
                'relative z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card/70 px-4 py-2.5',
                tone === 'ok' && 'border-green-border',
                tone === 'warn' && 'border-warn/40',
                tone === 'bad' && 'border-red-border',
              )}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  tone === 'ok' && 'text-green-text',
                  tone === 'warn' && 'text-warn',
                  tone === 'bad' && 'text-red-text',
                )}
              />
              <span className="font-display text-sm font-semibold">
                {t(`verdict.${e.level}` as StringKey)}
              </span>
              {budgets.map((b) => (
                <Inline key={b.label} budget={b} />
              ))}
            </div>
            {/* The stretch the plate fades out over. Empty: the plate is
                what paints, this only gives it the height to do it in. */}
            <div className="h-10" aria-hidden />
          </div>
        ) : null}
      </div>

      <div
        ref={card}
        className={cn(
          'mt-5 rounded-xl border p-5',
          tone === 'ok' && 'border-green-border bg-green-bg/60',
          tone === 'warn' && 'border-warn/40 bg-warn/10',
          tone === 'bad' && 'border-red-border bg-red-bg/60',
        )}
      >
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'size-5 shrink-0',
              tone === 'ok' && 'text-green-text',
              tone === 'warn' && 'text-warn',
              tone === 'bad' && 'text-red-text',
            )}
          />
          <span className="font-display text-lg font-semibold">
            {t(`verdict.${e.level}` as StringKey)}
          </span>
        </div>

        {/* What the configuration costs, once. The ceilings it is
            measured against are on the meters below, so no number
            appears twice. */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label={t('verdict.total')} value={bytes(e.totalBytes)} />
          <Stat label={t('verdict.weights')} value={bytes(e.weightsBytes)} />
          <Stat label={t('verdict.kv')} value={bytes(e.kvBytes)} />
          <Stat label={t('verdict.compute')} value={bytes(e.computeBytes)} />
        </div>

        {budgets.map((b) => (
          <Meter key={b.label} budget={b} />
        ))}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <Key className={WEIGHTS}>{t('verdict.weights')}</Key>
          <Key className={KV}>{t('verdict.kv')}</Key>
          <Key className={COMPUTE}>{t('verdict.compute')}</Key>
        </div>

        {e.findings.length ? (
          <ul className="mt-4 space-y-1 text-sm">
            {e.findings.map((f, i) => (
              <li key={`${f.code}-${i}`} className="flex gap-2">
                <span className="text-muted-foreground">·</span>
                <span>
                  {t(`finding.${f.code}` as StringKey)}
                  {f.bytes !== undefined ? <b> {bytes(f.bytes)}</b> : null}
                  {f.device ? ` (${f.device})` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {e.suggestions.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {e.suggestions.map((s) => (
              <button
                key={s.code}
                type="button"
                disabled={!onApply}
                onClick={() => onApply?.(s)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
              >
                {t(`fix.${s.code}` as StringKey)}
                {s.value !== undefined ? (
                  <Badge tone="brand">{tokens(s.value)}</Badge>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}

function Key({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <span>
      <i className={cn('mr-1 inline-block size-2 rounded-sm align-middle', className)} />
      {children}
    </span>
  )
}

/**
 * One budget: what it costs, what the ceiling is, and whether it clears it.
 * The numbers on the right are the bar in words, so the answer does not
 * depend on reading pixel widths.
 */
function Meter({ budget }: { budget: Budget }): JSX.Element {
  const t = useT()
  const used = budget.parts.reduce((n, p) => n + p.value, 0)
  const slack = budget.ceiling - used
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
        <span className="font-medium">{budget.label}</span>
        <span className="tabular-nums text-muted-foreground">
          <b className="font-display text-[15px] text-foreground">{bytes(used)}</b>
          {' / '}
          {bytes(budget.ceiling)}
          {slack < 0 ? (
            <b className="ml-2 text-red-text">
              {t('verdict.overBy')} {bytes(-slack)}
            </b>
          ) : (
            <span className="ml-2">
              {bytes(slack)} {t('verdict.free')}
            </span>
          )}
        </span>
      </div>
      <StackedBar className="mt-1.5" parts={budget.parts} total={budget.ceiling} />
    </div>
  )
}

/** The same budget with only what fits on one line. */
function Inline({ budget }: { budget: Budget }): JSX.Element {
  const used = budget.parts.reduce((n, p) => n + p.value, 0)
  const over = used > budget.ceiling
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs tabular-nums">
      <span className="text-muted-foreground">{budget.short}</span>
      <b className={cn('font-display text-[13px]', over && 'text-red-text')}>
        {bytes(used)}
      </b>
      <span className="text-muted-foreground">/ {bytes(budget.ceiling)}</span>
      <StackedBar
        className="w-16 shrink-0"
        parts={budget.parts}
        total={budget.ceiling}
      />
    </span>
  )
}
