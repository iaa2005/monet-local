/**
 * A GGUF header, turned into the row the Models screen shows.
 *
 * Every architecture namespaces its own keys (`qwen35.block_count`,
 * `llama.block_count`), so everything here is looked up through the
 * `general.architecture` value rather than by a fixed name.
 */

import { basename } from 'node:path'
import type { ModelGeometry } from '@shared/models/geometry.js'
import { kvBytesPerToken } from '@shared/models/geometry.js'
import { quantFromFilename, quantName } from '@shared/models/quant.js'
import type { GgufHeader, GgufValue } from './gguf.js'

export interface ModelInfo {
  /** Stable id: what a client puts in `model`, and the INI section name. */
  id: string
  path: string
  fileName: string
  sizeBytes: number
  architecture: string
  displayName: string
  quant: string
  /** Advertised maximum context, `{arch}.context_length`. */
  contextMax?: number
  geometry?: ModelGeometry
  /** f16 KV cost, the number the context slider is really spending. */
  kvBytesPerToken?: number
  /** Mixture of experts, and how many. */
  moe: boolean
  expertCount?: number
  /** Carries a multi-token-prediction head (`blk.N.nextn.*`). */
  mtp: boolean
  /** Paired `mmproj-*.gguf` in the same folder, if any. */
  mmprojPath?: string
}

function num(kv: Record<string, GgufValue>, key: string): number | undefined {
  const v = kv[key]
  return typeof v === 'number' ? v : undefined
}

function str(kv: Record<string, GgufValue>, key: string): string | undefined {
  const v = kv[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * A filename turned into an id that is stable, unique within a folder, and
 * safe in an INI section header and a URL.
 *
 * Not the path (it changes when a folder moves) and not the display name
 * (two quants of one model share it).
 */
export function modelId(fileName: string): string {
  return fileName
    .replace(/\.gguf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A filename with the packaging taken off: the quantisation, the split
 * suffix, a trailing -GGUF.
 */
function stem(fileName: string): string {
  return fileName
    .replace(/\.gguf$/i, '')
    .replace(/-\d{5}-of-\d{5}$/i, '')
    .replace(
      /[-._](UD[-_])?(I?Q\d[_A-Z0-9]*|BF16|FP?16|FP?32|MXFP\d|TQ\d[_A-Z0-9]*)$/i,
      '',
    )
    .replace(/[-._]GGUF$/i, '')
}

/** `ggml-model-q4_0.gguf` and friends: a name that identifies nothing. */
const GENERIC = /^(ggml[-._])?model([-._]|$)/i

/**
 * `Qwen_Qwen3.8 27B` — the converter's separator between the repo owner and
 * the model. Dropped only when the owner is repeated in what follows, which
 * is pure duplication and cannot lose information; `phi_4_mini` keeps its
 * underscore because `4_mini` is not a name.
 */
function withoutRepeatedOwner(name: string): string {
  const m = /^([A-Za-z][A-Za-z0-9.]*)_(.+)$/.exec(name)
  if (!m) return name
  const [, owner, rest] = m as unknown as [string, string, string]
  return rest.toLowerCase().startsWith(owner.toLowerCase()) ? rest : name
}

/**
 * Separators out, words in. Runs LAST, after the quantisation has already
 * been taken off the end — `Q4_K_M` and `IQ4_XS` are held together by the
 * very characters being replaced, and a name reading "Qwen3.8 27B Q4 K M"
 * would be the price of doing this in the other order.
 */
function spaced(name: string): string {
  return name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * What to call a model.
 *
 * `general.name` is written by whatever converted the model, and the common
 * converters build it out of the Hugging Face repo id: `openai/gpt-oss-20b`
 * arrives as "Openai_Gpt Oss 20b", `Qwen/Qwen3.8-27B` as "Qwen_Qwen3.8 27B".
 * The owner is duplicated and every word has been title-cased, so a model
 * nobody writes that way is displayed that way.
 *
 * The FILE name came through that trip intact — it is what the publisher
 * called the thing — so it wins. Metadata is the fallback for a file named
 * something that identifies nothing.
 *
 * No case is invented on top of either. Capitalising the first letter would
 * be wrong exactly where it showed: OpenAI writes it "gpt oss", not "Gpt
 * oss".
 */
export function displayNameFor(fileName: string, metaName?: string): string {
  const fromFile = withoutRepeatedOwner(stem(fileName))
  if (fromFile && !GENERIC.test(fromFile)) return spaced(fromFile)
  const fromMeta = metaName ? withoutRepeatedOwner(metaName.trim()) : ''
  return spaced(fromMeta || fromFile || fileName)
}

export function describeModel(
  path: string,
  header: GgufHeader,
  mmprojPath?: string,
): ModelInfo {
  const kv = header.kv
  const arch = str(kv, 'general.architecture') ?? 'unknown'
  const fileName = basename(path)

  const blockCount = num(kv, `${arch}.block_count`)
  const kvHeads =
    num(kv, `${arch}.attention.head_count_kv`) ??
    num(kv, `${arch}.attention.head_count`)
  // key_length/value_length are absent on models where the head dimension is
  // simply embedding / heads; derive it rather than giving up on the estimate.
  const embed = num(kv, `${arch}.embedding_length`)
  const heads = num(kv, `${arch}.attention.head_count`)
  const derivedHeadDim = embed && heads ? Math.floor(embed / heads) : undefined
  const keyLength = num(kv, `${arch}.attention.key_length`) ?? derivedHeadDim
  const valueLength = num(kv, `${arch}.attention.value_length`) ?? derivedHeadDim

  const geometry: ModelGeometry | undefined =
    blockCount && kvHeads && keyLength && valueLength
      ? {
          blockCount,
          kvHeads,
          keyLength,
          valueLength,
          ...(num(kv, `${arch}.full_attention_interval`) !== undefined
            ? { fullAttentionInterval: num(kv, `${arch}.full_attention_interval`)! }
            : {}),
        }
      : undefined

  const expertCount = num(kv, `${arch}.expert_count`)
  // Two independent signals, because neither is universal: the metadata key,
  // and expert tensors. A model with `ffn_gate_exps` blocks is MoE whatever
  // its header claims.
  const hasExpertTensors = header.tensorNames.some((n) =>
    n.includes('_exps'),
  )

  const quantFromType = quantName(num(kv, 'general.file_type'))
  const quantFromName = quantFromFilename(fileName)
  // The filename wins when it says something more specific: the enum cannot
  // express unsloth's UD- prefix or an imatrix variant.
  const quant =
    quantFromName && quantFromName.replace(/^UD-/, '') !== quantFromType
      ? quantFromName
      : quantFromType

  return {
    id: modelId(fileName),
    path,
    fileName,
    sizeBytes: header.fileSize,
    architecture: arch,
    displayName: displayNameFor(fileName, str(kv, 'general.name')),
    quant,
    ...(num(kv, `${arch}.context_length`) !== undefined
      ? { contextMax: num(kv, `${arch}.context_length`)! }
      : {}),
    ...(geometry
      ? { geometry, kvBytesPerToken: kvBytesPerToken(geometry) }
      : {}),
    moe: hasExpertTensors || (expertCount ?? 0) > 0,
    ...(expertCount !== undefined ? { expertCount } : {}),
    mtp:
      num(kv, `${arch}.nextn_predict_layers`) !== undefined ||
      header.tensorNames.some((n) => n.includes('.nextn.')),
    ...(mmprojPath ? { mmprojPath } : {}),
  }
}
