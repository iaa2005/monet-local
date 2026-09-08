import { useEffect, useState } from 'react'
import { tokens } from '@shared/format.js'
import { cn } from '@/lib/utils'

/** Where the slider starts. Below this nothing useful runs. */
const MIN = 512
/** What the slider snaps to while dragging; the box takes any number. */
const GRAIN = 256
/** How many positions the track has. Enough that dragging feels continuous. */
const STEPS = 1000

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n))

/**
 * Slider position → tokens, on a log scale.
 *
 * Linear would put 8192 at three percent of a track that reaches 262144, so
 * every context anyone actually runs would live in the first few pixels. A
 * log track gives each doubling the same width, which is also how the memory
 * cost grows.
 */
function fromPosition(p: number, min: number, max: number): number {
  const raw = min * Math.pow(max / min, p / STEPS)
  return clamp(Math.round(raw / GRAIN) * GRAIN, min, max)
}

function toPosition(v: number, min: number, max: number): number {
  const clamped = clamp(v, min, max)
  return Math.round((STEPS * Math.log(clamped / min)) / Math.log(max / min))
}

/**
 * The context length, as a slider and a number.
 *
 * It was a dropdown of eight powers of two, which is the wrong shape twice
 * over: it cannot say 12288, and it hides that this is a continuous dial
 * whose cost climbs the whole way. The slider is for finding the size, the
 * box is for saying exactly which, and the marks are the powers of two that
 * were the dropdown — still one click away, because they are still the
 * values most people want.
 */
export function ContextSlider({
  value,
  max,
  marks,
  onChange,
}: {
  value: number | undefined
  /** The model's own ceiling when it has one. */
  max: number
  /** Powers of two worth a click — the old ladder. */
  marks: number[]
  onChange: (v: number) => void
}): JSX.Element {
  const top = Math.max(max, MIN * 2)
  const current = clamp(value ?? MIN, MIN, top)
  // The box is a draft while it is being typed in: a half-typed "1" is not a
  // context of one token, and committing it would move the slider to the far
  // left under the cursor.
  const [draft, setDraft] = useState(String(current))
  useEffect(() => setDraft(String(current)), [current])

  const commit = (raw: string): void => {
    const n = Number(raw.replace(/[^\d]/g, ''))
    if (!Number.isFinite(n) || n <= 0) return setDraft(String(current))
    onChange(clamp(Math.round(n), MIN, top))
  }

  const shown = marks.filter((m) => m >= MIN && m <= top)

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={STEPS}
          step={1}
          value={toPosition(current, MIN, top)}
          onChange={(e) =>
            onChange(fromPosition(Number(e.target.value), MIN, top))
          }
          className="ctx-range h-9 min-w-0 flex-1"
          aria-label="context length"
        />
        <input
          // `text`, not `number`: the spinner arrows are a Windows widget in
          // the middle of this form, and a wheel over a number field changes
          // the value while the page scrolls past it.
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft)
            if (e.key === 'Escape') setDraft(String(current))
          }}
          className="h-9 w-24 shrink-0 rounded-lg border border-input bg-background px-3 text-right font-mono text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {shown.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors',
              m === current
                ? 'bg-brand-wash text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tokens(m)}
          </button>
        ))}
      </div>
    </div>
  )
}
