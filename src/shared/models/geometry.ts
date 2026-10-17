/**
 * What a model costs per token of context, worked out from its GGUF header.
 *
 * This is the arithmetic behind the verdict the app exists to give. It got
 * expensive to learn: a Qwen3.8-27B at its advertised 262144 context needs
 * 16 GiB of KV cache, which on a 32 GB machine is the difference between
 * 4.3 tokens a second and an answer that takes five hours. LM Studio offers
 * the same slider with no such number anywhere.
 *
 * The one subtlety is HYBRID models. Qwen3.8 has 65 blocks but only every
 * fourth is full attention — the other 49 are Gated DeltaNet layers whose
 * recurrent state does not grow with context at all. Counting all 65 would
 * over-state the cache four-fold and refuse configurations that fit.
 */

/** The header fields this module needs, already pulled out of the GGUF. */
export interface ModelGeometry {
  /** `{arch}.block_count` — every layer, attention or not. */
  blockCount: number
  /** `{arch}.attention.head_count_kv` — heads whose K/V are cached. */
  kvHeads: number
  /** `{arch}.attention.key_length` / `.value_length`, in elements. */
  keyLength: number
  valueLength: number
  /**
   * `{arch}.full_attention_interval` — present on hybrids: every Nth block is
   * full attention, the rest carry a fixed-size recurrent state. Absent on an
   * ordinary transformer, where every block caches.
   */
  fullAttentionInterval?: number
  /**
   * `{arch}.attention.sliding_window_pattern` — one flag per block, true when
   * that block caches only its sliding window instead of the whole context.
   *
   * Gemma 4 is the measured case: 35 of its 42 blocks are windowed, and
   * counting them as full attention over-states the cache at 128k by six
   * times. llama.cpp keeps a second, small cache for these blocks and sizes
   * it to `sliding_window + ubatch`, not to the context.
   */
  slidingWindowPattern?: boolean[]
  /** `{arch}.attention.sliding_window` — the window, in tokens. */
  slidingWindow?: number
  /**
   * `{arch}.attention.key_length_swa` / `.value_length_swa` — windowed blocks
   * can have their own head dimensions (Gemma 4: 256 against 512).
   */
  keyLengthSwa?: number
  valueLengthSwa?: number
  /**
   * `{arch}.attention.shared_kv_layers`: how many blocks at the START of the
   * model own a cache. Later blocks reuse one of those (`n_layer_kv_from_start`
   * in llama.cpp), so only the first `blockCount - shared` allocate anything.
   */
  kvLayers?: number
}

/** Bytes one element of a KV cache takes, by llama.cpp's cache type name. */
export const CACHE_TYPE_BYTES: Record<string, number> = {
  f32: 4,
  f16: 2,
  bf16: 2,
  q8_0: 1.0625, // 32 values in 34 bytes: 32 int8 + one f16 scale
  q5_1: 0.75,
  q5_0: 0.6875,
  q4_1: 0.5625,
  q4_0: 0.5625, // 32 values in 18 bytes: 16 packed bytes + one f16 scale
  iq4_nl: 0.5625,
}

/** Blocks that allocate a cache at all; the rest reuse one of them. */
function cachedBlocks(g: ModelGeometry): number {
  return Math.min(g.blockCount, g.kvLayers ?? g.blockCount)
}

/** Full context vs a fixed window, for one block. */
function isWindowed(g: ModelGeometry, il: number): boolean {
  return g.slidingWindowPattern?.[il] === true
}

/**
 * Blocks whose cache grows with the context.
 *
 * Recurrent blocks (the non-attention ones of a `full_attention_interval`
 * hybrid) hold a fixed-size state and are not counted at all; windowed blocks
 * grow only up to their window and are counted separately.
 */
export function attentionLayers(g: ModelGeometry): number {
  if (g.slidingWindowPattern && g.slidingWindow) {
    const n = cachedBlocks(g)
    let full = 0
    for (let il = 0; il < n; il++) if (!isWindowed(g, il)) full++
    return full
  }
  const interval = g.fullAttentionInterval
  if (!interval || interval <= 1) return cachedBlocks(g)
  return Math.floor(cachedBlocks(g) / interval)
}

/** Blocks that keep a sliding window instead of the whole context. */
export function slidingWindowLayers(g: ModelGeometry): number {
  if (!g.slidingWindowPattern || !g.slidingWindow) return 0
  const n = cachedBlocks(g)
  let windowed = 0
  for (let il = 0; il < n; il++) if (isWindowed(g, il)) windowed++
  return windowed
}

/**
 * Bytes of KV cache per token of context.
 *
 * This is the MARGINAL cost — what one more token of context adds — so only
 * the full-attention blocks count: a windowed block's cache stops growing
 * once the window is full. Both halves are cached, hence the two terms rather
 * than a doubling: K and V can be quantised separately (`-ctk q8_0 -ctv q4_0`
 * is the combination that makes 262144 fit here), and their head dimensions
 * can differ.
 */
export function kvBytesPerToken(
  g: ModelGeometry,
  cacheTypeK = 'f16',
  cacheTypeV = 'f16',
): number {
  const k = CACHE_TYPE_BYTES[cacheTypeK] ?? 2
  const v = CACHE_TYPE_BYTES[cacheTypeV] ?? 2
  const perLayer = g.kvHeads * (g.keyLength * k + g.valueLength * v)
  return perLayer * attentionLayers(g)
}

/**
 * Total KV cache for a given context, in bytes.
 *
 * The growing half is `kvBytesPerToken × context`; every windowed block adds
 * one window-sized cache instead, with its own head dimensions. llama.cpp
 * sizes that cache to `sliding_window + ubatch` and pads it, so this is a
 * few MiB short at the margin — next to a verdict measured in GiB, the
 * difference is not worth a parameter that would then be guessed at.
 */
export function kvCacheBytes(
  g: ModelGeometry,
  contextTokens: number,
  cacheTypeK = 'f16',
  cacheTypeV = 'f16',
): number {
  const full = kvBytesPerToken(g, cacheTypeK, cacheTypeV) * contextTokens
  const windowedLayers = slidingWindowLayers(g)
  if (!windowedLayers || !g.slidingWindow) return full

  const k = CACHE_TYPE_BYTES[cacheTypeK] ?? 2
  const v = CACHE_TYPE_BYTES[cacheTypeV] ?? 2
  const keyLength = g.keyLengthSwa ?? g.keyLength
  const valueLength = g.valueLengthSwa ?? g.valueLength
  const perLayer = g.kvHeads * (keyLength * k + valueLength * v)
  const windowTokens = Math.min(contextTokens, g.slidingWindow)
  return full + perLayer * windowedLayers * windowTokens
}
