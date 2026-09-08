/**
 * The library, in the shape a client sees it.
 *
 * Its own module because it is a CONTRACT: Code Monet reads these field names
 * to fill in a model's context window, its modalities and its display name.
 * Renaming one here silently gives every model in that app a guessed context
 * and no vision, so the shape is built in one pure function and asserted
 * against a real server in the end-to-end test.
 */

import { estimate } from './estimator.js'
import type { Hardware, Profile } from './flags/types.js'
import type { ModelGeometry } from './models/geometry.js'

export type ModelStatus = 'unloaded' | 'loading' | 'loaded'

/** What the library knows about one file, trimmed to what this needs. */
export interface PublicModelInput {
  id: string
  displayName: string
  architecture: string
  quant: string
  sizeBytes: number
  contextMax?: number
  geometry?: ModelGeometry
  mmprojPath?: string
  moe: boolean
}

export interface PublicModel {
  id: string
  object: 'model'
  owned_by: 'monet-local'
  status: ModelStatus
  display_name: string
  architecture: string
  quantisation: string
  size_bytes: number
  /** What the model advertises. */
  context_max: number | null
  /**
   * What its profile actually gives it, which is the number that matters: a
   * 262144-token model running at 8192 refuses anything longer, and a client
   * budgeting against the advertised figure walks straight into that.
   */
  context_configured: number | null
  modalities: ('text' | 'image')[]
  moe: boolean
  /** Whether this machine could run it as configured. */
  verdict: 'fits' | 'tight' | 'wont_fit'
}

export function publicModels(
  models: PublicModelInput[],
  statuses: Map<string, ModelStatus>,
  profileFor: (id: string) => Profile,
  hardware: Hardware,
): PublicModel[] {
  return models.map((m) => {
    const profile = profileFor(m.id)
    const verdict = estimate({
      fileBytes: m.sizeBytes,
      ...(m.geometry ? { geometry: m.geometry } : {}),
      profile,
      hardware,
    })
    const ctx = profile['ctxSize']
    return {
      id: m.id,
      object: 'model',
      owned_by: 'monet-local',
      status: statuses.get(m.id) ?? 'unloaded',
      display_name: m.displayName,
      architecture: m.architecture,
      quantisation: m.quant,
      size_bytes: m.sizeBytes,
      context_max: m.contextMax ?? null,
      context_configured: typeof ctx === 'number' ? ctx : null,
      modalities: m.mmprojPath ? ['text', 'image'] : ['text'],
      moe: m.moe,
      verdict: verdict.level,
    }
  })
}
