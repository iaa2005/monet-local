import { useEffect, useState, type CSSProperties } from 'react'
import {
  STEPS,
  clamp,
  fromPosition,
  toPosition,
  wantsLog,
} from '@shared/slider.js'
import { cn } from '@/lib/utils'

/**
 * A number, as a slider and a box.
 *
 * Every numeric setting here is really a dial whose cost climbs the whole
 * way, and a bare box says nothing about where in its range a value sits.
 * The slider is for finding the size, the box is for saying exactly which,
 * and the marks are the values worth one click — powers of two for the
 * batches, whole cores for the threads.
 *
 * The marks are NOT the only legal values. That was the old dropdown's lie:
 * 12288 is a perfectly good context and it could not be typed.
 */
export function NumberSlider({
  value,
  min,
  max,
  step = 1,
  marks,
  fallback,
  allowAuto,
  autoLabel,
  format = String,
  onChange,
}: {
  value: number | undefined
  min: number
  max: number
  step?: number
  /** Values worth one click. Filtered to the range before they are drawn. */
  marks?: number[]
  /** Where the handle sits when nothing is set. */
  fallback: number
  /** Whether "let llama.cpp decide" is one of the choices. */
  allowAuto?: boolean
  autoLabel?: string
  format?: (n: number) => string
  onChange: (v: number | undefined) => void
}): JSX.Element {
  const top = Math.max(max, min + step)
  const log = wantsLog(min, top)
  const effective = clamp(value ?? fallback, min, top)
  const unset = value === undefined

  // The box is a draft while it is being typed in: a half-typed "1" is not a
  // context of one token, and committing it would move the handle to the far
  // left under the cursor.
  const [draft, setDraft] = useState(unset ? '' : String(effective))
  useEffect(() => setDraft(unset ? '' : String(effective)), [unset, effective])

  const commit = (raw: string): void => {
    const digits = raw.replace(/[^\d]/g, '')
    if (!digits) return onChange(allowAuto ? undefined : effective)
    onChange(clamp(Math.round(Number(digits)), min, top))
  }

  const position = toPosition(effective, min, top, log)
  const shown = (marks ?? []).filter((m) => m >= min && m <= top)

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={STEPS}
          step={1}
          value={position}
          onChange={(e) =>
            onChange(fromPosition(Number(e.target.value), min, top, step, log))
          }
          // Chromium cannot two-tone a track on its own; the split point is
          // handed to the stylesheet as a custom property.
          style={
            {
              '--ctx-fill': `${unset ? 0 : (position / STEPS) * 100}%`,
            } as CSSProperties
          }
          className={cn('ctx-range h-9 min-w-0 flex-1', unset && 'opacity-60')}
        />
        <input
          // `text`, not `number`: the spinner arrows are a Windows widget in
          // the middle of this form, and a wheel over a number field changes
          // the value while the page scrolls past it.
          type="text"
          inputMode="numeric"
          value={draft}
          placeholder={autoLabel}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft)
            if (e.key === 'Escape') setDraft(unset ? '' : String(effective))
          }}
          className="h-9 w-24 shrink-0 rounded-lg border border-input bg-background px-3 text-right font-mono text-sm tabular-nums placeholder:font-sans placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {shown.length || allowAuto ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {allowAuto ? (
            <Mark on={unset} onClick={() => onChange(undefined)}>
              {autoLabel}
            </Mark>
          ) : null}
          {shown.map((m) => (
            <Mark key={m} on={!unset && m === effective} onClick={() => onChange(m)}>
              {format(m)}
            </Mark>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Mark({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors',
        on
          ? 'bg-brand-wash text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
