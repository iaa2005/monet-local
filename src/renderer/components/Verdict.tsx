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

/**
 * The verdict, with its reasons and what to do about them.
 *
 * Two meters rather than one, because there are two ceilings and a profile
 * has to clear both. Showing only the RAM budget is how a "will not fit"
 * verdict came to sit above a bar that looked comfortable: RAM was fine, and
 * the GPU — which is what the estimate actually refused on — was not drawn
 * at all.
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

      {/* What the profile costs, once. The ceilings it is measured against
          are on the meters below, so no number appears twice. */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label={t('verdict.total')} value={bytes(e.totalBytes)} />
        <Stat label={t('verdict.weights')} value={bytes(e.weightsBytes)} />
        <Stat label={t('verdict.kv')} value={bytes(e.kvBytes)} />
        <Stat label={t('verdict.compute')} value={bytes(e.computeBytes)} />
      </div>

      <Meter
        label={t('verdict.ram')}
        ceiling={e.ramCeiling}
        parts={[
          { label: t('verdict.weights'), value: e.weightsBytes, className: WEIGHTS },
          { label: t('verdict.kv'), value: e.kvBytes, className: KV },
          { label: t('verdict.compute'), value: e.computeBytes, className: COMPUTE },
        ]}
      />

      {/* On an integrated GPU this is a slice of the same RAM rather than
          extra capacity — a second, lower wall, and usually the one that is
          hit first. */}
      {e.deviceParts && e.deviceCeiling !== undefined ? (
        <Meter
          label={`${t('verdict.gpu')}${
            e.findings.find((f) => f.code === 'exceeds-device')?.device
              ? ` · ${e.findings.find((f) => f.code === 'exceeds-device')?.device}`
              : ''
          }`}
          ceiling={e.deviceCeiling}
          parts={[
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
          ]}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          <i className={cn('mr-1 inline-block size-2 rounded-sm align-middle', WEIGHTS)} />
          {t('verdict.weights')}
        </span>
        <span>
          <i className={cn('mr-1 inline-block size-2 rounded-sm align-middle', KV)} />
          {t('verdict.kv')}
        </span>
        <span>
          <i className={cn('mr-1 inline-block size-2 rounded-sm align-middle', COMPUTE)} />
          {t('verdict.compute')}
        </span>
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
  )
}

/**
 * One budget: what it costs, what the ceiling is, and whether it clears it.
 * The numbers on the right are the bar in words, so the answer does not
 * depend on reading pixel widths.
 */
function Meter({
  label,
  parts,
  ceiling,
}: {
  label: string
  parts: { label: string; value: number; className: string }[]
  ceiling: number
}): JSX.Element {
  const t = useT()
  const used = parts.reduce((n, p) => n + p.value, 0)
  const slack = ceiling - used
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <b className="font-display text-[15px] text-foreground">{bytes(used)}</b>
          {' / '}
          {bytes(ceiling)}
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
      <StackedBar className="mt-1.5" parts={parts} total={ceiling} />
    </div>
  )
}
