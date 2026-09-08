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
    displayName: str(kv, 'general.name') ?? fileName.replace(/\.gguf$/i, ''),
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
