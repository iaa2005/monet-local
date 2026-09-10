import { describe, expect, it } from 'vitest'
import {
  activeWeightBytes,
  ddrBandwidth,
  formatTps,
  generationTps,
  speedBand,
} from './speed.js'

/**
 * Checked against llama-bench on the machine this was written for — a
 * Ryzen 7840HS with DDR5-5600 in two channels and a Radeon 780M. Every
 * expectation below is a real measurement, not a target.
 */
const BW = ddrBandwidth(5600) // 89.6 GB/s

/** gpt-oss-20b MXFP4: 32 experts, 4 used per token. */
const GPT_OSS = {
  weightBytes: 12.11e9,
  expertBytes: 10.18e9,
  expertCount: 32,
  expertUsedCount: 4,
  bandwidthBytesPerSecond: BW,
}

/** Qwen3.8-27B UD-IQ4_XS: dense, every weight on every token. */
const QWEN_27B = { weightBytes: 14.25e9, bandwidthBytesPerSecond: BW }

describe('what one token reads', () => {
  it('is every weight on a dense model', () => {
    expect(activeWeightBytes(QWEN_27B)).toBe(14.25e9)
  })

  it('is the shared part plus the experts actually used', () => {
    // 12.11 total − 10.18 experts + 10.18 × 4/32 = 3.19 GB.
    expect(activeWeightBytes(GPT_OSS) / 1e9).toBeCloseTo(3.19, 1)
  })

  it('falls back to dense when the two MoE signals disagree', () => {
    // Expert tensors but no counts, or counts but no tensors: the honest
    // answer is the slower one rather than a guess at the router.
    expect(activeWeightBytes({ ...GPT_OSS, expertCount: 0 })).toBe(12.11e9)
    expect(activeWeightBytes({ ...QWEN_27B, expertCount: 8, expertUsedCount: 2 })).toBe(14.25e9)
  })

  it('never reads more experts than there are', () => {
    expect(activeWeightBytes({ ...GPT_OSS, expertUsedCount: 99 })).toBeCloseTo(12.11e9, -6)
  })
})

describe('predicted generation speed, against llama-bench', () => {
  it('THE MoE IS THE FAST ONE — measured 26.3 tok/s', () => {
    const tps = generationTps(GPT_OSS)
    expect(tps).toBeGreaterThan(20)
    expect(tps).toBeLessThan(32)
  })

  it('and the bigger dense model beside it is not — measured 4.2 tok/s', () => {
    const tps = generationTps(QWEN_27B)
    expect(tps).toBeGreaterThan(3)
    expect(tps).toBeLessThan(6)
  })

  it('so the ranking a person actually needs comes out right', () => {
    // Two thirds the size, seven times the speed. Nothing in the app said so
    // before this; the file list showed 11.3 GiB beside 13.3 GiB.
    expect(generationTps(GPT_OSS)).toBeGreaterThan(generationTps(QWEN_27B) * 4)
    // And they land in different bands, which is what the list will show.
    expect(speedBand(generationTps(GPT_OSS))).toBe('fast')
    expect(speedBand(generationTps(QWEN_27B))).toBe('slow')
  })

  it('scales with the memory, because that is the whole model', () => {
    const half = generationTps({ ...QWEN_27B, bandwidthBytesPerSecond: BW / 2 })
    expect(half).toBeCloseTo(generationTps(QWEN_27B) / 2, 5)
  })

  it('says nothing rather than dividing by zero', () => {
    expect(generationTps({ weightBytes: 0, bandwidthBytesPerSecond: BW })).toBe(0)
  })
})

describe('what to call it', () => {
  it('bands it by what a chat feels like', () => {
    expect(speedBand(26)).toBe('fast')
    expect(speedBand(8)).toBe('usable')
    expect(speedBand(4.2)).toBe('slow')
  })

  it('keeps a decimal where one matters and drops it where it does not', () => {
    expect(formatTps(26.28)).toBe('26 tok/s')
    expect(formatTps(4.19)).toBe('4.2 tok/s')
  })

  it('DDR5-5600 in two channels is 89.6 GB/s', () => {
    expect(ddrBandwidth(5600) / 1e9).toBeCloseTo(89.6, 1)
    expect(ddrBandwidth(5600, 4) / 1e9).toBeCloseTo(179.2, 1)
  })
})
