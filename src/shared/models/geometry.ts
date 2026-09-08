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

/** How many of the model's blocks actually hold a growing K/V cache. */
export function attentionLayers(g: ModelGeometry): number {
  const interval = g.fullAttentionInterval
  if (!interval || interval <= 1) return g.blockCount
  return Math.floor(g.blockCount / interval)
}

/**
 * Bytes of KV cache per token of context.
 *
 * Both halves are cached, hence the two terms rather than a doubling: K and V
 * can be quantised separately (`-ctk q8_0 -ctv q4_0` is the combination that
 * makes 262144 fit here), and their head dimensions can differ.
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

/** Total KV cache for a given context, in bytes. */
export function kvCacheBytes(
  g: ModelGeometry,
  contextTokens: number,
  cacheTypeK = 'f16',
  cacheTypeV = 'f16',
): number {
  return kvBytesPerToken(g, cacheTypeK, cacheTypeV) * contextTokens
}
