import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { Estimate } from '@shared/estimator.js'
import { bytes, tokens } from '@shared/format.js'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type { StringKey } from '@shared/i18n.js'

/**
 * The verdict, with its reasons and what to do about them.
 *
 * The whole reason this app exists rather than a slider and a shrug. Every
 * finding names a number, and every suggestion is something the panel above
 * can actually change — a red badge on its own would be no better than what
 * we already had.
 */
export function Verdict({
  estimate: e,
  onApply,
}: {
  estimate: Estimate
  onApply?: (fix: Estimate['suggestions'][number]) => void
}): JSX.Element {
  const t = useT()
  const Icon =
    e.level === 'fits' ? CheckCircle2 : e.level === 'tight' ? AlertTriangle : XCircle

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        e.level === 'fits' && 'border-green-border bg-green-bg',
        e.level === 'tight' && 'border-warn/40 bg-warn/10',
        e.level === 'wont_fit' && 'border-red-border bg-red-bg',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            'size-4',
            e.level === 'fits' && 'text-green-text',
            e.level === 'tight' && 'text-warn',
            e.level === 'wont_fit' && 'text-red-text',
          )}
        />
        <span className="font-medium">{t(`verdict.${e.level}` as StringKey)}</span>
        <span className="text-sm text-muted-foreground">
          {t('verdict.total')} {bytes(e.totalBytes)} · {t('verdict.headroom')}{' '}
          {bytes(Math.max(0, e.headroomBytes))}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
        <Cell label={t('verdict.weights')} value={bytes(e.weightsBytes)} />
        <Cell label={t('verdict.kv')} value={bytes(e.kvBytes)} />
        <Cell label={t('verdict.compute')} value={bytes(e.computeBytes)} />
        {e.deviceBytes !== undefined ? (
          <Cell
            label={t('verdict.deviceUse')}
            value={`${bytes(e.deviceBytes)} / ${bytes(e.deviceCeiling)}`}
          />
        ) : null}
      </dl>

      {e.findings.length ? (
        <ul className="mt-2 space-y-0.5 text-sm">
          {e.findings.map((f, i) => (
            <li key={`${f.code}-${i}`}>
              {t(`finding.${f.code}` as StringKey)}
              {f.bytes !== undefined ? ` ${bytes(f.bytes)}` : ''}
              {f.device ? ` (${f.device})` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {e.suggestions.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {e.suggestions.map((s) => (
            <button
              key={s.code}
              type="button"
              disabled={!onApply}
              onClick={() => onApply?.(s)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-60"
            >
              {t(`fix.${s.code}` as StringKey)}
              {s.value !== undefined ? `: ${tokens(s.value)}` : ''}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="inline">{label}: </dt>
      <dd className="inline font-medium text-foreground">{value}</dd>
    </div>
  )
}
