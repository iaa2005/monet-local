/**
 * What a loaded model is doing right now.
 *
 * `GET /slots?model=<id>` on the router is the only place llama.cpp says
 * this, and it says it well — measured against a real generation rather than
 * read off the documentation, because the field names do not mean what they
 * look like they mean:
 *
 *   n_prompt_tokens            everything currently in the slot's sequence,
 *                              so it keeps GROWING while tokens are produced.
 *                              It is not the length of the prompt.
 *   n_prompt_tokens_processed  prompt tokens this turn actually computed.
 *   n_prompt_tokens_cache      prompt tokens taken from the cache instead.
 *   next_token[0].n_decoded    tokens produced so far in this reply — the
 *                              counter, and the only field that separates
 *                              "still reading the prompt" from "answering".
 *   next_token[0].n_remain     how many are left before the reply's own cap.
 *
 * Checked mid-flight: with n_decoded 8, 29 and 49 the sequence stood at 74,
 * 95 and 115, and 74-8 = 95-29 = 115-49 = 66, the prompt length. That is the
 * arithmetic this file relies on.
 *
 * The prompt has no honest denominator here. During prefill both the
 * processed count and the sequence length are still climbing, so a
 * percentage would be a number divided by itself; the count is shown
 * instead, which is true at every instant.
 */

export type ActivityState = 'idle' | 'prompt' | 'generating'

export interface Activity {
  state: ActivityState
  /** Prompt tokens computed this turn. */
  promptTokens: number
  /** Prompt tokens that came from the cache and cost nothing. */
  cachedTokens: number
  /** Tokens produced so far in this reply. */
  decoded: number
  /** Tokens left before the reply hits its own limit. */
  remaining?: number
  /** Everything in the slot's sequence: prompt plus what has been produced. */
  contextTokens: number
  /** The slot's context ceiling. */
  contextMax: number
  /** Slots busy, and how many there are — `--parallel`. */
  busySlots: number
  slots: number
  /** Generation speed over the reply so far. Absent until it is known. */
  tokensPerSecond?: number
}

interface RawSlot {
  id?: number
  n_ctx?: number
  is_processing?: boolean
  n_prompt_tokens?: number
  n_prompt_tokens_processed?: number
  n_prompt_tokens_cache?: number
  next_token?: { n_decoded?: number; n_remain?: number }[]
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Fold the slot array into one answer.
 *
 * Several slots are one server as far as this screen is concerned, so the
 * counts add up and the state is the furthest along any of them has got:
 * a model answering one request while reading another's prompt is
 * generating, and saying so is more useful than picking a slot at random.
 */
export function readSlots(raw: unknown): Activity | null {
  if (!Array.isArray(raw)) return null
  const slots = raw as RawSlot[]
  if (!slots.length) return null

  let state: ActivityState = 'idle'
  let promptTokens = 0
  let cachedTokens = 0
  let decoded = 0
  let remaining: number | undefined
  let contextTokens = 0
  let contextMax = 0
  let busySlots = 0

  for (const s of slots) {
    contextMax = Math.max(contextMax, num(s.n_ctx))
    if (!s.is_processing) continue
    busySlots++
    const d = num(s.next_token?.[0]?.n_decoded)
    promptTokens += num(s.n_prompt_tokens_processed)
    cachedTokens += num(s.n_prompt_tokens_cache)
    contextTokens += num(s.n_prompt_tokens)
    decoded += d
    const left = s.next_token?.[0]?.n_remain
    if (typeof left === 'number') remaining = (remaining ?? 0) + left
    if (d > 0) state = 'generating'
    else if (state === 'idle') state = 'prompt'
  }

  return {
    state,
    promptTokens,
    cachedTokens,
    decoded,
    ...(remaining !== undefined ? { remaining } : {}),
    contextTokens,
    contextMax,
    busySlots,
    slots: slots.length,
  }
}

/** Where this reply started counting, so the next reading can be a speed. */
export interface Rate {
  /** The first sample of this reply: the anchor the average is taken from. */
  from: { decoded: number; at: number }
  decoded: number
  at: number
  /** Tokens a second, over the reply so far. Absent until it means something. */
  value?: number
}

/** Below this the average is division by noise, so nothing is published. */
const MIN_WINDOW_MS = 700

/**
 * Advance the speed estimate.
 *
 * The average over the reply, not the difference between two samples.
 * Measured: at half-second polling and three tokens a second the per-sample
 * delta alternates between one token and two, and the figure on screen
 * flickered 2.7, 3.1, 2.7 twice a second while the model ran at a perfectly
 * steady three. Anchoring at the first sample of the reply removes that
 * without smoothing away anything real: a reply that genuinely stalls does
 * lower its own average, which is what an average is for. It is anchored at
 * the first token seen rather than at the request, so the minute spent
 * reading a long prompt is not charged to the writing speed.
 *
 * A counter that went backwards is a new reply, not a slower one.
 */
export function tick(
  prev: Rate | undefined,
  decoded: number,
  at: number,
): Rate {
  if (!prev || decoded < prev.decoded) {
    return { from: { decoded, at }, decoded, at }
  }
  const dt = at - prev.from.at
  const dn = decoded - prev.from.decoded
  if (dt < MIN_WINDOW_MS || dn <= 0) return { ...prev, decoded, at }
  return { from: prev.from, decoded, at, value: dn / (dt / 1000) }
}
