import { describe, expect, it } from 'vitest'
import {
  attentionLayers,
  kvBytesPerToken,
  kvCacheBytes,
  type ModelGeometry,
} from './geometry.js'

/**
 * Qwen3.8-27B, read from the real header on the dev machine. Every number
 * below was measured against llama.cpp's own behaviour before it was written
 * down — see Appendix A of docs/PLAN.md.
 */
const QWEN38_27B: ModelGeometry = {
  blockCount: 65,
  kvHeads: 4,
  keyLength: 256,
  valueLength: 256,
  fullAttentionInterval: 4,
}

/** An ordinary transformer, for the branch where every block caches. */
const DENSE: ModelGeometry = {
  blockCount: 32,
  kvHeads: 8,
  keyLength: 128,
  valueLength: 128,
}

describe('attentionLayers', () => {
  it('counts only the full-attention blocks of a hybrid', () => {
    // 65 blocks, every 4th is attention. Counting all 65 would over-state the
    // cache four-fold and call a working configuration impossible.
    expect(attentionLayers(QWEN38_27B)).toBe(16)
  })

  it('counts every block when there is no interval', () => {
    expect(attentionLayers(DENSE)).toBe(32)
  })
})

describe('kvBytesPerToken', () => {
  it('matches the 64 KB/token measured for Qwen3.8-27B at f16', () => {
    expect(kvBytesPerToken(QWEN38_27B)).toBe(64 * 1024)
  })

  it('reproduces the 16 GiB that made 262144 impossible', () => {
    // This is the number that explains the five-hour answer: 16 GiB of cache
    // plus 15.65 GiB of weights against 27.7 GB of RAM.
    expect(kvCacheBytes(QWEN38_27B, 262144)).toBe(16 * 1024 ** 3)
  })

  it('shows why q8_0/q4_0 is what makes the full context fit', () => {
    // The combination the app ships as the long-context profile: ~6 GiB
    // instead of 16, which measured 3.2 GB of RAM still free.
    const bytes = kvCacheBytes(QWEN38_27B, 262144, 'q8_0', 'q4_0')
    expect(bytes / 1024 ** 3).toBeCloseTo(6.5, 1)
  })

  it('halves with q8_0 on both halves', () => {
    expect(kvBytesPerToken(QWEN38_27B, 'q8_0', 'q8_0')).toBeCloseTo(
      (64 * 1024 * 1.0625) / 2,
      0,
    )
  })
})
