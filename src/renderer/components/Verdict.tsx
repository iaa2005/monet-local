import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { Estimate } from '@shared/estimator.js'
import { bytes, tokens } from '@shared/format.js'
import type { StringKey } from '@shared/i18n.js'
import { Badge, StackedBar, Stat } from '@/components/ui/page'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'

/**
 * The verdict, with its reasons and what to do about them.
 *
 * Laid out like a dashboard tile rather than a sentence: the two numbers
 * that matter (total, headroom) are large, the parts are a bar against the
 * machine's ceiling, and the findings sit under them. A red badge on its own
 * would be no better than what we already had.
 */
export function Verdict({
  estimate: e,
  onApply,
}: {
  estimate: Estimate
  onApply?: (fix: Estimate['suggestions'][number]) => void
}): JSX.Element {
  const t = useT()
  const tone = e.level === 'fits' ? 'ok' : e.level === 'tight' ? 'warn' : 'bad'
  const Icon =
    e.level === 'fits' ? CheckCircle2 : e.level === 'tight' ? AlertTriangle : XCircle

  return (
    <div
      className={cn(
        'rounded-xl border p-5',
        tone === 'ok' && 'border-green-border bg-green-bg/60',
        tone === 'warn' && 'border-warn/40 bg-warn/10',
        tone === 'bad' && 'border-red-border bg-red-bg/60',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            'size-5',
            tone === 'ok' && 'text-green-text',
            tone === 'warn' && 'text-warn',
            tone === 'bad' && 'text-red-text',
          )}
        />
        <span className="font-display text-lg font-semibold">
          {t(`verdict.${e.level}` as StringKey)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label={t('verdict.total')} value={bytes(e.totalBytes)} />
        <Stat
          label={t('verdict.headroom')}
          value={bytes(Math.max(0, e.headroomBytes))}
          tone={tone}
        />
        <Stat label={t('verdict.weights')} value={bytes(e.weightsBytes)} />
        <Stat label={t('verdict.kv')} value={bytes(e.kvBytes)} />
      </div>

      {/* Parts against the ceiling: the bar says "the cache is most of it"
          before anyone reads the numbers. */}
      <StackedBar
        className="mt-4"
        total={e.ramCeiling}
        parts={[
          { label: t('verdict.weights'), value: e.weightsBytes, className: 'bg-foreground/70' },
          { label: t('verdict.kv'), value: e.kvBytes, className: 'bg-brand' },
          { label: t('verdict.compute'), value: e.computeBytes, className: 'bg-foreground/30' },
        ]}
      />
      <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
        <span>
          <i className="mr-1 inline-block size-2 rounded-sm bg-foreground/70 align-middle" />
          {t('verdict.weights')}
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-sm bg-brand align-middle" />
          {t('verdict.kv')}
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-sm bg-foreground/30 align-middle" />
          {t('verdict.compute')} {bytes(e.computeBytes)}
        </span>
        {e.deviceBytes !== undefined ? (
          <span className="ml-auto">
            {t('verdict.deviceUse')}: <b>{bytes(e.deviceBytes)}</b> / {bytes(e.deviceCeiling)}
          </span>
        ) : null}
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
              className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
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
  )
}
