import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { closeSync, mkdtempSync, openSync, readSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeModel, displayNameFor, modelId } from './describe.js'
import {
  readGgufHeader,
  TruncatedGgufError,
  type GgufHeader,
  type GgufValue,
} from './gguf.js'

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

describe('sliding-window metadata', () => {
  /** Gemma 4 E4B as llama.cpp reads it, without a 5 GB file behind it. */
  const header = (pattern: GgufValue): GgufHeader => ({
    version: 3,
    tensorCount: 0,
    kv: {
      'general.architecture': 'gemma4',
      'gemma4.block_count': 42,
      'gemma4.attention.head_count_kv': 2,
      'gemma4.attention.key_length': 512,
      'gemma4.attention.value_length': 512,
      'gemma4.attention.sliding_window': 512,
      'gemma4.attention.sliding_window_pattern': pattern,
      'gemma4.attention.key_length_swa': 256,
      'gemma4.attention.value_length_swa': 256,
      'gemma4.attention.shared_kv_layers': 18,
    },
    tensorNames: [],
    weightBytes: 0,
    expertBytes: 0,
    fileSize: 1,
  })

  it('reads the per-block pattern and the shared KV layers', () => {
    const pattern = Array.from({ length: 42 }, (_, il) => il % 6 < 5)
    const m = describeModel('Gemma-4-E4B-Q4_K_M.gguf', header(pattern))
    expect(m.geometry).toEqual({
      blockCount: 42,
      kvHeads: 2,
      keyLength: 512,
      valueLength: 512,
      slidingWindowPattern: pattern,
      slidingWindow: 512,
      keyLengthSwa: 256,
      valueLengthSwa: 256,
      // 42 - 18 shared: the blocks that own a cache.
      kvLayers: 24,
    })
    // Four full layers at 16 KiB/token; the windowed twenty do not grow.
    expect(m.kvBytesPerToken).toBe(16 * 1024)
  })

  it('expands the older integer form of the pattern', () => {
    // Gemma 3 and earlier store the period, not an array; llama.cpp's
    // default `dense_first = false` makes every sixth block full attention.
    const m = describeModel('Gemma-4-E4B-Q4_K_M.gguf', header(6))
    const flags = m.geometry?.slidingWindowPattern ?? []
    expect(flags).toHaveLength(42)
    expect(flags.filter(Boolean)).toHaveLength(35)
    expect(flags[5]).toBe(false)
    expect(flags[11]).toBe(false)
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

describe.skipIf(!haveReal)('a download in progress', () => {
  it('is refused rather than listed as a model', () => {
    // Found live: a 1.47 GB slice of a 13 GB quant sat in the models folder
    // with a perfectly valid header. The library listed it, the router wrote
    // it into its preset, and loading it died with something unhelpful.
    // The last tensor's offset is a floor on how big the file has to be.
    const dir = mkdtempSync(join(tmpdir(), 'monet-gguf-'))
    const partial = join(dir, 'partial.gguf')
    // 12 MB: just past this model's header (10.5 MB of it is the 248,320-
    // entry tokenizer) and nowhere near its weights, whose last tensor sits
    // at the 15 GB mark. Read that prefix directly — pulling the whole 16 GB
    // in to slice it is the sort of thing that makes a suite unrunnable.
    const buf = Buffer.alloc(12 * 1024 * 1024)
    const fd = openSync(REAL, 'r')
    const n = readSync(fd, buf, 0, buf.length, 0)
    closeSync(fd)
    writeFileSync(partial, buf.subarray(0, n))

    expect(() => readGgufHeader(partial)).toThrow(TruncatedGgufError)
  })
})

describe('displayNameFor', () => {
  it('uses the name the model was published under, spaced out', () => {
    // These are the real filenames, and the real `general.name` beside them.
    // The converter builds the metadata out of the Hugging Face repo id, so
    // `openai/gpt-oss-20b` arrives title-cased with the owner glued on. The
    // filename came through intact.
    expect(displayNameFor('gpt-oss-20b-MXFP4.gguf', 'Openai_Gpt Oss 20b')).toBe(
      'gpt oss 20b',
    )
    expect(displayNameFor('Qwen3.8-27B-Q4_K_M.gguf', 'Qwen_Qwen3.8 27B')).toBe(
      'Qwen3.8 27B',
    )
    expect(displayNameFor('gemma-4-E4B-it-Q8_0.gguf', 'Gemma 4 E4B')).toBe(
      'gemma 4 E4B it',
    )
  })

  it('invents no capitals of its own', () => {
    // A rule that title-cased the first letter would be wrong exactly where
    // it showed: OpenAI writes it "gpt-oss".
    expect(displayNameFor('gpt-oss-20b-MXFP4.gguf')).toBe('gpt oss 20b')
  })

  it('takes the quantisation off before touching the separators', () => {
    // The order is the whole trick: `Q4_K_M` and `IQ4_XS` are held together
    // by the characters being replaced, so doing it the other way round
    // leaves "Qwen3.8 27B Q4 K M".
    expect(displayNameFor('Qwen3.8-27B-Q4_K_M.gguf')).toBe('Qwen3.8 27B')
    expect(displayNameFor('Qwen3.8-27B-UD-IQ4_XS.gguf')).toBe('Qwen3.8 27B')
    expect(displayNameFor('Foo-7B-Q8_0.gguf')).toBe('Foo 7B')
    expect(displayNameFor('model-name-BF16.gguf')).toBe('model name')
    expect(displayNameFor('Foo-7B-Q4_K_M-00001-of-00003.gguf')).toBe('Foo 7B')
  })

  it('falls back to metadata when the filename says nothing', () => {
    expect(displayNameFor('ggml-model-q4_0.gguf', 'Qwen_Qwen3.8 27B')).toBe(
      'Qwen3.8 27B',
    )
    // And still says something when there is no metadata either.
    expect(displayNameFor('ggml-model-q4_0.gguf')).toBe('ggml model')
  })

  it('drops a repeated owner but never a real word', () => {
    // Through the metadata path — a filename that identifies nothing, so
    // the mangled name is all there is to clean up.
    expect(displayNameFor('ggml-model.gguf', 'Qwen_Qwen3.8 27B')).toBe(
      'Qwen3.8 27B',
    )
    // `phi_4_mini` is not an owner said twice: the underscore is a
    // separator like any other and the words survive it.
    expect(displayNameFor('phi_4_mini.gguf')).toBe('phi 4 mini')
  })
})
