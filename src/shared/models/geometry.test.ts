import { describe, expect, it } from 'vitest'
import {
  attentionLayers,
  kvBytesPerToken,
  kvCacheBytes,
  slidingWindowLayers,
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

/**
 * Gemma 4 E4B, read from the real header on this machine.
 *
 * 42 blocks in a pattern of five windowed then one full; the window is 512
 * tokens and its heads are 256 elements against the full layers' 512. It
 * stores 18 shared KV layers, so llama.cpp gives a cache to the first 24
 * blocks only (`n_layer_kv_from_start`) and lets the rest reuse one.
 *
 * Measured: at 128k the process held ~8.5 GiB in total with the projector —
 * weights 5.0, projector 0.9, compute buffers ~0.7, and the cache below.
 */
const GEMMA4_E4B: ModelGeometry = {
  blockCount: 42,
  kvHeads: 2,
  keyLength: 512,
  valueLength: 512,
  slidingWindow: 512,
  slidingWindowPattern: Array.from({ length: 42 }, (_, il) => il % 6 < 5),
  keyLengthSwa: 256,
  valueLengthSwa: 256,
  kvLayers: 24,
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

  it('separates the windowed blocks of a Gemma 4 model', () => {
    // Only the first 24 blocks own a cache, and in that run every sixth is
    // full attention: four of them. The other twenty stop growing at 512
    // tokens. Counting all 42 as full over-stated the 128k cache sixfold.
    expect(attentionLayers(GEMMA4_E4B)).toBe(4)
    expect(slidingWindowLayers(GEMMA4_E4B)).toBe(20)
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

  it('charges Gemma 4 only for the blocks whose cache grows', () => {
    // Four full layers, 2 heads, 512+512 halves, f16: 16 KiB per token.
    // The windowed twenty are not in this number — they stop at the window.
    expect(kvBytesPerToken(GEMMA4_E4B)).toBe(16 * 1024)
  })

  it('puts Gemma 4 at 128k near 2 GiB instead of 21', () => {
    // The number the old estimator got wrong by six times. 4 full layers of
    // 16 KiB/token at 131072 plus twenty 512-token windows of 4 KiB/token.
    const bytes = kvCacheBytes(GEMMA4_E4B, 131072)
    expect(bytes / 1024 ** 3).toBeCloseTo(2.04, 1)

    const quantised = kvCacheBytes(GEMMA4_E4B, 131072, 'q8_0', 'q4_0')
    expect(quantised / 1024 ** 3).toBeCloseTo(0.82, 1)
  })
})
