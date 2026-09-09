/**
 * The shape Code Monet reads.
 *
 * This is a contract between two applications, and the failure mode when it
 * drifts is silence: a renamed field does not throw over there, it makes the
 * model fall back to a guess. The end-to-end test asserts the field NAMES
 * against a real server; this asserts what the values mean, which is the half
 * a running server cannot show — the profile it happens to be loaded with is
 * only ever one of the cases.
 */

import { describe, expect, it } from 'vitest'
import { publicModels, type PublicModelInput } from './public-models.js'
import type { Hardware, Profile } from './flags/types.js'

const MODEL: PublicModelInput = {
  id: 'qwen3.8-27b-q4_k_m',
  displayName: 'Qwen3.8 27B',
  architecture: 'qwen3',
  quant: 'Q4_K_M',
  sizeBytes: 16e9,
  contextMax: 262144,
  moe: false,
}

const HARDWARE: Hardware = { totalRamBytes: 64e9, devices: [] }

function published(profile: Profile): Record<string, unknown> {
  const [m] = publicModels([MODEL], new Map(), () => profile, HARDWARE)
  return m as unknown as Record<string, unknown>
}

describe('what a client is told about a model', () => {
  it('publishes the CONFIGURED context, not the advertised one', () => {
    // A 262144-token model running at 8192 refuses anything longer, so a
    // budget built on the header figure walks straight into a refusal.
    const m = published({ ctxSize: 8192 })
    expect(m['context_max']).toBe(262144)
    expect(m['context_configured']).toBe(8192)
  })

  it('publishes the answer limit, because the caller sets max_tokens', () => {
    // The bug: Code Monet asks for max_tokens on every request and defaulted
    // to 16000. A profile raised to 32000 changed nothing, because the number
    // that applied belonged to the caller and the caller had never been told.
    expect(published({ ctxSize: 8192, nPredict: 32000 })['predict_configured']).toBe(32000)
  })

  it('says null when the answer is unbounded, rather than publishing -1', () => {
    // -1 is llama.cpp for "until the context runs out". Passed through as a
    // number it would become a max_tokens of minus one on the wire.
    expect(published({ ctxSize: 8192, nPredict: -1 })['predict_configured']).toBeNull()
  })

  it('says null when the profile sets no limit at all', () => {
    expect(published({ ctxSize: 8192 })['predict_configured']).toBeNull()
  })

  it('still describes a model whose profile is empty', () => {
    const m = published({})
    expect(m['context_configured']).toBeNull()
    expect(m['predict_configured']).toBeNull()
    expect(m['modalities']).toContain('text')
  })
})
