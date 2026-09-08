import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { describeModel, modelId } from './describe.js'
import { readGgufHeader } from './gguf.js'

/**
 * The reader is checked against the real files on the dev machine when they
 * are there, and skipped when they are not — CI has no 16 GB GGUF and should
 * not download one. The pure arithmetic these feed
 * (src/shared/models/geometry.test.ts) runs everywhere.
 */
const REAL = 'D:/Colibri/models/Qwen3.8-27B-GGUF/Qwen3.8-27B-Q4_K_M.gguf'
const MMPROJ =
  'D:/Colibri/models/Qwen3.8-27B-GGUF/mmproj-Qwen3.8-27B-BF16.gguf'
const haveReal = existsSync(REAL)

describe('modelId', () => {
  it('is a stable slug of the filename', () => {
    expect(modelId('Qwen3.8-27B-Q4_K_M.gguf')).toBe('qwen3.8-27b-q4_k_m')
    expect(modelId('Qwen3.8-27B-UD-IQ4_XS.gguf')).toBe('qwen3.8-27b-ud-iq4_xs')
  })

  it('survives characters an INI section or URL would choke on', () => {
    expect(modelId('My Model (v2)!.gguf')).toBe('my-model-v2')
  })
})

describe.skipIf(!haveReal)('readGgufHeader on a real model', () => {
  it('reads the header without loading 16 GB', () => {
    const started = Date.now()
    const h = readGgufHeader(REAL)
    // The whole point of the streaming reader: metadata in milliseconds.
    expect(Date.now() - started).toBeLessThan(3000)
    expect(h.kv['general.architecture']).toBe('qwen35')
    expect(h.tensorCount).toBe(866)
  })

  it('skips the quarter-million-entry tokenizer instead of holding it', () => {
    const h = readGgufHeader(REAL)
    expect(h.kv['tokenizer.ggml.tokens']).toEqual({ skipped: 248320 })
  })

  it('describes the model the way the Models screen will', () => {
    const m = describeModel(REAL, readGgufHeader(REAL), MMPROJ)
    expect(m.architecture).toBe('qwen35')
    expect(m.quant).toBe('Q4_K_M')
    expect(m.contextMax).toBe(262144)
    // Dense, despite being a big modern model — no expert tensors anywhere.
    // This is what ruled Colibri out: it streams experts, and there are none.
    expect(m.moe).toBe(false)
    // The MTP head llama.cpp warns about as "unused tensor" unless asked for.
    expect(m.mtp).toBe(true)
    expect(m.geometry).toEqual({
      blockCount: 65,
      kvHeads: 4,
      keyLength: 256,
      valueLength: 256,
      fullAttentionInterval: 4,
    })
    expect(m.kvBytesPerToken).toBe(64 * 1024)
    expect(m.mmprojPath).toBe(MMPROJ)
  })
})
