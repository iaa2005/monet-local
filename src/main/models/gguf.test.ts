import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { closeSync, mkdtempSync, openSync, readSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeModel, displayNameFor, modelId } from './describe.js'
import { readGgufHeader, TruncatedGgufError } from './gguf.js'

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
  it('uses the name the model was published under', () => {
    // These are the real filenames, and the real `general.name` beside them.
    // The converter builds the metadata out of the Hugging Face repo id, so
    // `openai/gpt-oss-20b` arrives title-cased with the owner glued on and
    // the hyphens gone. The filename came through intact.
    expect(displayNameFor('gpt-oss-20b-MXFP4.gguf', 'Openai_Gpt Oss 20b')).toBe(
      'gpt-oss-20b',
    )
    expect(
      displayNameFor('Qwen3.8-27B-Q4_K_M.gguf', 'Qwen_Qwen3.8 27B'),
    ).toBe('Qwen3.8-27B')
    expect(displayNameFor('gemma-4-E4B-it-Q8_0.gguf', 'Gemma 4 E4B')).toBe(
      'gemma-4-E4B-it',
    )
  })

  it('invents no capitals of its own', () => {
    // A rule that title-cased the first letter would be wrong exactly where
    // it showed: OpenAI writes it "gpt-oss".
    expect(displayNameFor('gpt-oss-20b-MXFP4.gguf')).toBe('gpt-oss-20b')
  })

  it('takes off the packaging, whatever it is', () => {
    expect(displayNameFor('Qwen3.8-27B-UD-IQ4_XS.gguf')).toBe('Qwen3.8-27B')
    expect(displayNameFor('model-name-BF16.gguf')).toBe('model-name')
    expect(displayNameFor('Foo-7B-Q4_K_M-00001-of-00003.gguf')).toBe('Foo-7B')
  })

  it('falls back to metadata when the filename says nothing', () => {
    expect(displayNameFor('ggml-model-q4_0.gguf', 'Qwen_Qwen3.8 27B')).toBe(
      'Qwen3.8 27B',
    )
    // And still says something when there is no metadata either.
    expect(displayNameFor('ggml-model-q4_0.gguf')).toBe('ggml-model')
  })

  it('drops a repeated owner but never a real word', () => {
    // `Qwen_Qwen3.8` is the owner said twice. `phi_4_mini` is not: dropping
    // the prefix there would leave "4_mini", which is not a name.
    // Through the metadata path — a filename that identifies nothing, so
    // the mangled name is all there is to clean up.
    expect(displayNameFor('ggml-model.gguf', 'Qwen_Qwen3.8 27B')).toBe(
      'Qwen3.8 27B',
    )
    expect(displayNameFor('phi_4_mini.gguf')).toBe('phi_4_mini')
  })
})
