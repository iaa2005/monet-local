/**
 * GGUF header reader — metadata only, never the weights.
 *
 * A model file is 16 GB; everything the library needs sits in the first few
 * megabytes. The reader opens the file, walks the key/value block and the
 * tensor table, and stops. On this machine that is milliseconds per file
 * against a folder scan that would otherwise be minutes.
 *
 * Two things it deliberately does NOT do:
 *
 *   - materialise large arrays. `tokenizer.ggml.tokens` is 248,320 strings on
 *     Qwen3.8; keeping them would cost more memory than everything else the
 *     app holds, and nothing needs them. Arrays over ARRAY_KEEP entries are
 *     skipped and recorded as a length.
 *   - read a fixed prefix. Header size varies by two orders of magnitude
 *     between models, so the buffer grows on demand instead of guessing.
 *
 * Format: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'

const MAGIC = 0x46554747 // "GGUF" little-endian
const ARRAY_KEEP = 64
/** Refuse a file whose header wants more than this — it is not a GGUF. */
const MAX_HEADER = 256 * 1024 * 1024

export type GgufValue = string | number | boolean | GgufValue[] | { skipped: number }

/**
 * Bytes per BLOCK and elements per block, by ggml type.
 *
 * Needed to weigh the tensor table: a tensor's size is not its element count
 * — a Q4_K value is 4.5 bits, MXFP4 is 4.25 with a shared scale. The table is
 * llama.cpp's own (ggml.c, type_traits), and an unknown type is left at zero
 * rather than guessed: a wrong number here would be a wrong speed estimate
 * with nothing to say it was invented.
 */
const GGML_TYPE: Record<number, { blockBytes: number; blockElems: number }> = {
  0: { blockBytes: 4, blockElems: 1 }, // F32
  1: { blockBytes: 2, blockElems: 1 }, // F16
  2: { blockBytes: 18, blockElems: 32 }, // Q4_0
  3: { blockBytes: 20, blockElems: 32 }, // Q4_1
  6: { blockBytes: 22, blockElems: 32 }, // Q5_0
  7: { blockBytes: 24, blockElems: 32 }, // Q5_1
  8: { blockBytes: 34, blockElems: 32 }, // Q8_0
  9: { blockBytes: 36, blockElems: 32 }, // Q8_1
  10: { blockBytes: 84, blockElems: 256 }, // Q2_K
  11: { blockBytes: 110, blockElems: 256 }, // Q3_K
  12: { blockBytes: 144, blockElems: 256 }, // Q4_K
  13: { blockBytes: 176, blockElems: 256 }, // Q5_K
  14: { blockBytes: 210, blockElems: 256 }, // Q6_K
  15: { blockBytes: 292, blockElems: 256 }, // Q8_K
  16: { blockBytes: 66, blockElems: 256 }, // IQ2_XXS
  17: { blockBytes: 74, blockElems: 256 }, // IQ2_XS
  18: { blockBytes: 98, blockElems: 256 }, // IQ3_XXS
  19: { blockBytes: 50, blockElems: 256 }, // IQ1_S
  20: { blockBytes: 18, blockElems: 32 }, // IQ4_NL
  21: { blockBytes: 110, blockElems: 256 }, // IQ3_S
  22: { blockBytes: 82, blockElems: 256 }, // IQ2_S
  23: { blockBytes: 136, blockElems: 256 }, // IQ4_XS
  24: { blockBytes: 1, blockElems: 1 }, // I8
  25: { blockBytes: 2, blockElems: 1 }, // I16
  26: { blockBytes: 4, blockElems: 1 }, // I32
  27: { blockBytes: 8, blockElems: 1 }, // I64
  28: { blockBytes: 8, blockElems: 1 }, // F64
  29: { blockBytes: 56, blockElems: 256 }, // IQ1_M
  30: { blockBytes: 2, blockElems: 1 }, // BF16
  39: { blockBytes: 17, blockElems: 32 }, // MXFP4
}

export interface GgufHeader {
  version: number
  tensorCount: number
  kv: Record<string, GgufValue>
  /** Tensor names only — enough to tell MoE from dense, and cheap to hold. */
  tensorNames: string[]
  /** Every weight in the file, in bytes. */
  weightBytes: number
  /**
   * Of those, the ones held in EXPERT tensors (`ffn_*_exps`).
   *
   * The split is what makes a mixture of experts fast: a dense model reads
   * every weight for every token, an MoE reads the shared part plus the few
   * experts its router picked. Measured on this machine, that is the
   * difference between 4 tokens a second and 26 — see @shared/models/speed.
   */
  expertBytes: number
  fileSize: number
}

/** A file whose header is fine but whose weights are not all there. */
export class TruncatedGgufError extends Error {
  constructor(readonly haveBytes: number, readonly needBytes: number) {
    super(
      `GGUF is incomplete: ${haveBytes} bytes on disk, header describes at least ${needBytes}`,
    )
    this.name = 'TruncatedGgufError'
  }
}

enum T {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

/**
 * A cursor over a file that pulls more bytes in when the parser walks past
 * the end of what has been read.
 */
class Reader {
  private buf = Buffer.alloc(0)
  private pos = 0

  constructor(
    private readonly fd: number,
    private readonly size: number,
  ) {}

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return
    const want = Math.min(
      this.size,
      Math.max(this.pos + n, this.buf.length * 2, 1 << 20),
    )
    if (want > MAX_HEADER) throw new Error('GGUF header is implausibly large')
    const next = Buffer.alloc(want)
    const read = readSync(this.fd, next, 0, want, 0)
    if (read < this.pos + n) throw new Error('GGUF file ends inside its header')
    this.buf = next.subarray(0, read)
  }

  /** Where the cursor is — the header's size, once the tables are read. */
  get position(): number {
    return this.pos
  }

  /** Skip forward without materialising anything — for arrays we discard. */
  skip(n: number): void {
    this.ensure(n)
    this.pos += n
  }

  u8(): number {
    this.ensure(1)
    return this.buf.readUInt8(this.pos++)
  }
  i8(): number {
    this.ensure(1)
    return this.buf.readInt8(this.pos++)
  }
  u16(): number {
    this.ensure(2)
    const v = this.buf.readUInt16LE(this.pos)
    this.pos += 2
    return v
  }
  i16(): number {
    this.ensure(2)
    const v = this.buf.readInt16LE(this.pos)
    this.pos += 2
    return v
  }
  u32(): number {
    this.ensure(4)
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }
  i32(): number {
    this.ensure(4)
    const v = this.buf.readInt32LE(this.pos)
    this.pos += 4
    return v
  }
  f32(): number {
    this.ensure(4)
    const v = this.buf.readFloatLE(this.pos)
    this.pos += 4
    return v
  }
  f64(): number {
    this.ensure(8)
    const v = this.buf.readDoubleLE(this.pos)
    this.pos += 8
    return v
  }
  /** Counts and dimensions are u64 on disk; Number is exact to 2^53. */
  u64(): number {
    this.ensure(8)
    const v = this.buf.readBigUInt64LE(this.pos)
    this.pos += 8
    return Number(v)
  }
  i64(): number {
    this.ensure(8)
    const v = this.buf.readBigInt64LE(this.pos)
    this.pos += 8
    return Number(v)
  }
  str(): string {
    const n = this.u64()
    this.ensure(n)
    const s = this.buf.toString('utf8', this.pos, this.pos + n)
    this.pos += n
    return s
  }
  /** Length-prefixed string, thrown away without decoding. */
  skipStr(): void {
    this.skip(this.u64())
  }
}

const FIXED_WIDTH: Partial<Record<T, number>> = {
  [T.UINT8]: 1,
  [T.INT8]: 1,
  [T.BOOL]: 1,
  [T.UINT16]: 2,
  [T.INT16]: 2,
  [T.UINT32]: 4,
  [T.INT32]: 4,
  [T.FLOAT32]: 4,
  [T.UINT64]: 8,
  [T.INT64]: 8,
  [T.FLOAT64]: 8,
}

function readScalar(r: Reader, type: T): GgufValue {
  switch (type) {
    case T.UINT8:
      return r.u8()
    case T.INT8:
      return r.i8()
    case T.UINT16:
      return r.u16()
    case T.INT16:
      return r.i16()
    case T.UINT32:
      return r.u32()
    case T.INT32:
      return r.i32()
    case T.FLOAT32:
      return r.f32()
    case T.BOOL:
      return r.u8() !== 0
    case T.STRING:
      return r.str()
    case T.UINT64:
      return r.u64()
    case T.INT64:
      return r.i64()
    case T.FLOAT64:
      return r.f64()
    default:
      throw new Error(`GGUF: unknown value type ${type}`)
  }
}

function readValue(r: Reader, type: T): GgufValue {
  if (type !== T.ARRAY) return readScalar(r, type)

  const elem = r.u32() as T
  const count = r.u64()
  if (count > ARRAY_KEEP) {
    // Skip wholesale. Fixed-width elements are one jump; strings and nested
    // arrays have to be walked, but walking is still far cheaper than
    // decoding a quarter of a million tokenizer entries.
    const width = FIXED_WIDTH[elem]
    if (width !== undefined) r.skip(width * count)
    else if (elem === T.STRING) for (let i = 0; i < count; i++) r.skipStr()
    else for (let i = 0; i < count; i++) readValue(r, elem)
    return { skipped: count }
  }

  const out: GgufValue[] = []
  for (let i = 0; i < count; i++) out.push(readValue(r, elem))
  return out
}

export function readGgufHeader(path: string): GgufHeader {
  const fd = openSync(path, 'r')
  try {
    const fileSize = statSync(path).size
    const r = new Reader(fd, fileSize)

    if (r.u32() !== MAGIC) throw new Error('not a GGUF file')
    const version = r.u32()
    const tensorCount = r.u64()
    const kvCount = r.u64()

    const kv: Record<string, GgufValue> = {}
    for (let i = 0; i < kvCount; i++) {
      const key = r.str()
      kv[key] = readValue(r, r.u32() as T)
    }

    // Names tell dense from MoE (`blk.N.ffn_gate_exps`) and reveal the MTP
    // head, which no metadata key states outright.
    const tensorNames: string[] = []
    let lastOffset = 0
    let weightBytes = 0
    let expertBytes = 0
    for (let i = 0; i < tensorCount; i++) {
      const name = r.str()
      tensorNames.push(name)
      const dims = r.u32()
      let elems = 1
      for (let d = 0; d < dims; d++) elems *= r.u64()
      const type = GGML_TYPE[r.u32()]
      const bytes = type ? (elems / type.blockElems) * type.blockBytes : 0
      weightBytes += bytes
      if (name.includes('_exps')) expertBytes += bytes
      lastOffset = Math.max(lastOffset, r.u64())
    }

    // A download in progress has a perfectly good header and no weights.
    // Left unchecked it appears in the library as a model, gets written into
    // the router's preset, and fails at load time with something unhelpful —
    // which is exactly what happened with a 1.47 GB slice of a 13 GB file.
    // The last tensor's offset is a floor on how big the file has to be.
    const needBytes = r.position + lastOffset
    if (fileSize < needBytes) {
      throw new TruncatedGgufError(fileSize, needBytes)
    }

    return { version, tensorCount, kv, tensorNames, weightBytes, expertBytes, fileSize }
  } finally {
    closeSync(fd)
  }
}
