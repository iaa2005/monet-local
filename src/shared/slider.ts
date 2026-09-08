/**
 * The arithmetic behind a slider: where a value sits on a track, and what a
 * position on that track means.
 *
 * Here rather than beside the component because it is the part that can be
 * wrong in a way nobody sees — a handle that lands two pixels off is invisible
 * until it snaps to the wrong number under a click.
 */

/** How many positions a track has. Enough that dragging feels continuous. */
export const STEPS = 1000

export const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n))

/**
 * A range this wide is worth drawing on a log track.
 *
 * Context runs 512 → 262144. Linear would put 8192 at three percent of it,
 * so every value anyone actually runs would live in the first few pixels. A
 * log track gives each doubling the same width, which is also how the memory
 * cost grows. Threads run 1 → 16 and want none of that; a range starting at
 * zero cannot have it at all.
 */
export function wantsLog(min: number, max: number): boolean {
  return min > 0 && max / min >= 64
}

export function fromPosition(
  p: number,
  min: number,
  max: number,
  step: number,
  log: boolean,
): number {
  const raw = log
    ? min * Math.pow(max / min, p / STEPS)
    : min + ((max - min) * p) / STEPS
  return clamp(Math.round(raw / step) * step, min, max)
}

export function toPosition(
  v: number,
  min: number,
  max: number,
  log: boolean,
): number {
  const c = clamp(v, min, max)
  const f = log
    ? Math.log(c / min) / Math.log(max / min)
    : (c - min) / (max - min)
  return Math.round(STEPS * f)
}
