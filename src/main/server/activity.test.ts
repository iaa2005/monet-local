import { describe, expect, it } from 'vitest'
import { readSlots, tick } from './activity.js'

/**
 * Captured from `GET /slots?model=…` on a real router while Qwen3.8-27B
 * Q4_K_M answered, three samples six seconds apart. `params` is trimmed —
 * it is forty sampler fields this file never reads.
 */
const IDLE = [{ id: 0, n_ctx: 36352, speculative: false, is_processing: false }]

const BUSY = [74, 95, 115].map((n, i) => ({
  id: 0,
  n_ctx: 36352,
  speculative: false,
  is_processing: true,
  id_task: 339,
  n_prompt_tokens: n,
  n_prompt_tokens_processed: 4,
  n_prompt_tokens_cache: 62,
  next_token: [
    {
      has_next_token: true,
      has_new_line: false,
      n_remain: [192, 171, 151][i]!,
      n_decoded: [8, 29, 49][i]!,
    },
  ],
}))

describe('readSlots', () => {
  it('reads an idle slot as ready', () => {
    const a = readSlots(IDLE)!
    expect(a.state).toBe('idle')
    expect(a.decoded).toBe(0)
    expect(a.busySlots).toBe(0)
    // The ceiling is known even with nothing running, which is the whole
    // reason it is read off the slot rather than off the profile.
    expect(a.contextMax).toBe(36352)
  })

  it('reads a generating slot', () => {
    const a = readSlots([BUSY[1]!])!
    expect(a.state).toBe('generating')
    expect(a.decoded).toBe(29)
    expect(a.promptTokens).toBe(4)
    expect(a.cachedTokens).toBe(62)
    expect(a.contextTokens).toBe(95)
    expect(a.remaining).toBe(171)
    expect(a.busySlots).toBe(1)
  })

  it('holds the arithmetic the file is built on', () => {
    // n_prompt_tokens is the whole sequence, not the prompt: subtract what
    // has been produced and the prompt length falls out, the same in all
    // three samples. If a future llama.cpp changes this, this is the test
    // that says so rather than a counter quietly reading wrong.
    for (const raw of BUSY) {
      const a = readSlots([raw])!
      expect(a.contextTokens - a.decoded).toBe(a.cachedTokens + a.promptTokens)
    }
  })

  it('calls a slot with nothing decoded yet a prompt', () => {
    const a = readSlots([
      { ...BUSY[0]!, next_token: [{ n_decoded: 0, n_remain: 200 }] },
    ])!
    expect(a.state).toBe('prompt')
    expect(a.decoded).toBe(0)
  })

  it('folds several slots into one answer', () => {
    const a = readSlots([
      { ...BUSY[1]! },
      { ...BUSY[0]!, next_token: [{ n_decoded: 0, n_remain: 200 }] },
    ])!
    // Generating wins: a server writing one answer while reading another
    // prompt is generating, and saying so beats picking a slot at random.
    expect(a.state).toBe('generating')
    expect(a.decoded).toBe(29)
    expect(a.busySlots).toBe(2)
    expect(a.slots).toBe(2)
  })

  it('says nothing rather than guessing', () => {
    expect(readSlots(null)).toBeNull()
    expect(readSlots([])).toBeNull()
    expect(readSlots({ error: 'no' })).toBeNull()
  })

  it('survives a slot missing the fields it wants', () => {
    const a = readSlots([{ is_processing: true }])!
    expect(a.state).toBe('prompt')
    expect(a.decoded).toBe(0)
    expect(a.contextMax).toBe(0)
  })
})

describe('tick', () => {
  it('has no speed from one sample', () => {
    expect(tick(undefined, 8, 1000).value).toBeUndefined()
  })

  it('averages over the reply', () => {
    // Seven tokens in two seconds, the rate this model actually ran at.
    const a = tick(undefined, 8, 1000)
    expect(tick(a, 15, 3000).value).toBeCloseTo(3.5, 6)
  })

  it('does not flicker with the sampling', () => {
    // The measured pathology: at half-second polling and three tokens a
    // second the per-sample delta alternates 1, 2, 1, 2, so a rate taken
    // between samples reads 2, 4, 2, 4 — twice a second, on screen, while
    // the model runs at a perfectly steady three.
    const at = (i: number): number => i * 500
    const decoded = (i: number): number => Math.round(i * 1.5)

    let r = tick(undefined, 0, 0)
    const anchored: number[] = []
    const between: number[] = []
    for (let i = 1; i <= 12; i++) {
      between.push((decoded(i) - decoded(i - 1)) / 0.5)
      r = tick(r, decoded(i), at(i))
      if (r.value !== undefined) anchored.push(r.value)
    }

    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs)
    expect(spread(between)).toBe(2)
    // Widest early, when the anchor is only a token or two back, and it
    // settles from there. Both halves are checked so a change that made it
    // steady by making it wrong would still fail.
    expect(spread(anchored)).toBeLessThan(0.4)
    expect(spread(anchored.slice(4))).toBeLessThan(0.15)
    for (const v of anchored) expect(v).toBeCloseTo(3, 0)
  })

  it('waits for a window worth dividing by', () => {
    const a = tick(undefined, 0, 0)
    expect(tick(a, 2, 400).value).toBeUndefined()
    expect(tick(a, 2, 1000).value).toBeCloseTo(2, 6)
  })

  it('starts over when the counter does', () => {
    const a = tick(tick(undefined, 0, 0), 40, 1000)
    const b = tick(a, 3, 2000)
    expect(b.value).toBeUndefined()
    expect(b.decoded).toBe(3)
    expect(b.from.decoded).toBe(3)
  })

  it('counts the waiting, because it is an average', () => {
    // Four tokens in the first second, then half a second of nothing: the
    // reply really has averaged 2.7 a second by then, and saying 4 would be
    // reporting the good part only.
    const a = tick(tick(undefined, 0, 0), 4, 1000)
    expect(a.value).toBeCloseTo(4, 6)
    const b = tick(a, 4, 1500)
    expect(b.value).toBeCloseTo(4 / 1.5, 6)
    expect(b.from).toEqual(a.from)
  })
})
