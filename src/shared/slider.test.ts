import { describe, expect, it } from 'vitest'
import { fromPosition, toPosition, wantsLog } from './slider.js'

describe('wantsLog', () => {
  it('is on for the ranges that span decades', () => {
    // Context: 512 → 262144. Linear puts 8192 at three percent of the track,
    // so everything anyone runs lives in the first few pixels.
    expect(wantsLog(512, 262144)).toBe(true)
    expect(wantsLog(16, 2048)).toBe(true)
  })

  it('is off for the small ones, and for anything starting at zero', () => {
    // Threads 1 → 16 wants an even track. Layers start at 0, where a log
    // scale has no answer at all.
    expect(wantsLog(1, 16)).toBe(false)
    expect(wantsLog(0, 64)).toBe(false)
  })
})

describe('the track maps both ways', () => {
  it('round-trips the marks it is drawn for', () => {
    // A mark has to land exactly on itself, or clicking one and then
    // dragging a pixel would jump somewhere unrelated.
    for (const v of [2048, 8192, 32768, 262144]) {
      const p = toPosition(v, 512, 262144, true)
      expect(fromPosition(p, 512, 262144, 256, true)).toBe(v)
    }
    for (const v of [1, 2, 8, 16]) {
      const p = toPosition(v, 1, 16, false)
      expect(fromPosition(p, 1, 16, 1, false)).toBe(v)
    }
  })

  it('gives each doubling the same width on a log track', () => {
    // The reason for the log track: 512→1024 must take as much of it as
    // 131072→262144.
    const p = (v: number): number => toPosition(v, 512, 262144, true)
    const first = p(1024) - p(512)
    const last = p(262144) - p(131072)
    expect(Math.abs(first - last)).toBeLessThanOrEqual(1)
  })

  it('snaps to the grain and never leaves the range', () => {
    const v = fromPosition(437, 512, 262144, 256, true)
    expect(v % 256).toBe(0)
    expect(v).toBeGreaterThanOrEqual(512)
    expect(v).toBeLessThanOrEqual(262144)

    expect(fromPosition(0, 512, 262144, 256, true)).toBe(512)
    expect(fromPosition(1000, 512, 262144, 256, true)).toBe(262144)
  })

  it('holds a value that is not a mark', () => {
    // The dropdown's lie was that only the powers of two existed. 12288 is a
    // perfectly good context and has to survive the round trip.
    const p = toPosition(12288, 512, 262144, true)
    expect(fromPosition(p, 512, 262144, 256, true)).toBe(12288)
  })

  it('clamps a value from outside the range rather than running off', () => {
    // A model whose ceiling is lower than what the configuration asks for:
    // the handle sits at the end, it does not leave the track.
    expect(toPosition(999999, 512, 262144, true)).toBe(1000)
    expect(toPosition(1, 512, 262144, true)).toBe(0)
  })
})
