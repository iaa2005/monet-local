import { useEffect, useRef, useState } from 'react'
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
 * Is the sticky element currently stuck?
 *
 * A sentinel just above it, watched inside the element that actually
 * scrolls. `position: sticky` gives no event of its own, and the window is
 * the wrong thing to watch here — the page scrolls inside `<main>`, so an
 * observer rooted at the viewport would answer for the wrong box.
 */
function useStuck(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    let root: HTMLElement | null = el.parentElement
    while (root) {
      const overflow = getComputedStyle(root).overflowY
      if (overflow === 'auto' || overflow === 'scroll') break
      root = root.parentElement
    }
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!(entry?.isIntersecting ?? true)),
      { root },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return [sentinel, stuck]
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
  const [sentinel, stuck] = useStuck()
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
      <div ref={sentinel} aria-hidden className="h-px" />
      <div
        className={cn(
          'sticky top-0 z-30 mt-5 rounded-xl border',
          stuck ? 'px-4 py-2.5' : 'p-5',
          tone === 'ok' && 'border-green-border',
          tone === 'warn' && 'border-warn/40',
          tone === 'bad' && 'border-red-border',
          // The tone wash is translucent by design. Stuck, it has the form
          // scrolling underneath it, so it swaps for an opaque card rather
          // than layering — two `bg-*` utilities on one element are settled
          // by the order they happen to land in the stylesheet, not by the
          // order they are written here.
          !stuck && tone === 'ok' && 'bg-green-bg/60',
          !stuck && tone === 'warn' && 'bg-warn/10',
          !stuck && tone === 'bad' && 'bg-red-bg/60',
          stuck && 'bg-card shadow-lg',
        )}
      >
        <div className={cn('flex items-center gap-2', stuck && 'flex-wrap gap-x-4')}>
          <Icon
            className={cn(
              'shrink-0',
              stuck ? 'size-4' : 'size-5',
              tone === 'ok' && 'text-green-text',
              tone === 'warn' && 'text-warn',
              tone === 'bad' && 'text-red-text',
            )}
          />
          <span
            className={cn(
              'font-display font-semibold',
              stuck ? 'text-sm' : 'text-lg',
            )}
          >
            {t(`verdict.${e.level}` as StringKey)}
          </span>

          {/* Stuck, the meters come up onto the one line that is left. */}
          {stuck
            ? budgets.map((b) => <Inline key={b.label} budget={b} />)
            : null}
        </div>

        {stuck ? null : (
          <>
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
          </>
        )}
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
