/**
 * Profiles: a set of flag values, and which model uses which.
 *
 * Kept apart from settings.json because these are the thing the user edits
 * most and the thing an export/import in M6 will carry.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile } from '@shared/flags/types.js'
import { dataDir } from './settings-store.js'

export interface NamedProfile {
  id: string
  name: string
  values: Profile
}

export interface ProfilesFile {
  profiles: NamedProfile[]
  /** modelId → profileId. Anything unlisted uses `defaultProfileId`. */
  assignments: Record<string, string>
  defaultProfileId: string
}

/**
 * The two profiles that come with the app, both of them measured.
 *
 * "Fast" is the fastest thing the dev machine does; "Long context" is the
 * only shape in which the full 262144 fits into 32 GB. They are starting
 * points, not recommendations for other hardware — the estimator is what
 * says whether either applies.
 */
export const BUILT_IN: NamedProfile[] = [
  {
    id: 'fast',
    name: 'Fast',
    values: {
      ctxSize: 8192,
      noRepack: true,
      ubatchSize: 256,
      parallel: 1,
      nPredict: 4096,
      reasoningEffort: 'low',
    },
  },
  {
    id: 'long-context',
    name: 'Long context',
    values: {
      ctxSize: 131072,
      noRepack: true,
      noKvOffload: true,
      flashAttn: 'on',
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q4_0',
      ubatchSize: 256,
      parallel: 1,
      nPredict: 4096,
      reasoningEffort: 'low',
    },
  },
]

const EMPTY: ProfilesFile = {
  profiles: BUILT_IN,
  assignments: {},
  defaultProfileId: 'fast',
}

function path(): string {
  return join(dataDir(), 'profiles.json')
}

let cached: ProfilesFile | null = null

export function readProfiles(): ProfilesFile {
  if (cached) return cached
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as ProfilesFile
    cached = {
      profiles: Array.isArray(raw.profiles) && raw.profiles.length
        ? raw.profiles
        : BUILT_IN,
      assignments: raw.assignments ?? {},
      defaultProfileId: raw.defaultProfileId ?? 'fast',
    }
  } catch {
    cached = { ...EMPTY }
  }
  return cached
}

export function writeProfiles(next: ProfilesFile): ProfilesFile {
  cached = next
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(path(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.error('[profiles] could not save', err)
  }
  return cached
}

/** The id a model's own profile gets. One per model file, so per quant. */
export function ownProfileId(modelId: string): string {
  return `model:${modelId}`
}

/**
 * Save settings for one model.
 *
 * The first edit forks. A model normally starts on a shared profile — one of
 * the built-ins — and writing straight into that would silently change every
 * other model using it, which is not what editing the settings in front of
 * one model means. So the model gets a profile of its own, named after it,
 * and the assignment moves there.
 */
export function setProfileFor(
  modelId: string,
  values: Profile,
  name: string,
): ProfilesFile {
  const f = readProfiles()
  const id = ownProfileId(modelId)
  const existing = f.profiles.some((p) => p.id === id)
  return writeProfiles({
    ...f,
    profiles: existing
      ? f.profiles.map((p) => (p.id === id ? { ...p, name, values } : p))
      : [...f.profiles, { id, name, values }],
    assignments: { ...f.assignments, [modelId]: id },
  })
}

/** Point a model at an existing profile — a built-in, or another model's. */
export function assignProfile(modelId: string, profileId: string): ProfilesFile {
  const f = readProfiles()
  return writeProfiles({
    ...f,
    assignments: { ...f.assignments, [modelId]: profileId },
  })
}

export function profileFor(modelId: string): NamedProfile {
  const f = readProfiles()
  const id = f.assignments[modelId] ?? f.defaultProfileId
  return (
    f.profiles.find((p) => p.id === id) ??
    f.profiles[0] ??
    (BUILT_IN[0] as NamedProfile)
  )
}
