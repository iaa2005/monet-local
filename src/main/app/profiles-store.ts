/**
 * Profiles: a set of flag values, and which model uses which.
 *
 * They belong to the user, not to the app. Nothing here is protected,
 * built-in or undeletable — the one profile that ships exists so a fresh
 * install has something to show, and it can be renamed or deleted like any
 * other. Model ids are per file, so a profile is assigned per quant, which
 * is the level at which the settings actually differ: Q4 and Q6 of the same
 * model do not fit the same way.
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
 * What a fresh install starts with: one profile, with the values measured on
 * the dev machine as a starting point rather than a recommendation. The
 * estimator is what says whether they apply to the machine in front of it.
 *
 * Deliberately one. A list of opinions the user did not ask for is clutter
 * they then have to clear out.
 */
export const SEED: NamedProfile = {
  id: 'default',
  name: 'Default',
  values: {
    ctxSize: 8192,
    noRepack: true,
    ubatchSize: 256,
    parallel: 1,
    nPredict: 4096,
    reasoningEffort: 'low',
  },
}

function path(): string {
  return join(dataDir(), 'profiles.json')
}

let cached: ProfilesFile | null = null

export function readProfiles(): ProfilesFile {
  if (cached) return cached
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as ProfilesFile
    const profiles =
      Array.isArray(raw.profiles) && raw.profiles.length
        ? raw.profiles
        : [SEED]
    cached = {
      profiles,
      assignments: raw.assignments ?? {},
      defaultProfileId:
        profiles.some((p) => p.id === raw.defaultProfileId)
          ? raw.defaultProfileId
          : profiles[0]!.id,
    }
  } catch {
    cached = { profiles: [SEED], assignments: {}, defaultProfileId: SEED.id }
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

/** The smallest unused `profile-N`, so ids stay short and predictable. */
function nextId(taken: NamedProfile[]): string {
  for (let n = 1; ; n++) {
    const id = `profile-${n}`
    if (!taken.some((p) => p.id === id)) return id
  }
}

export interface CreateResult {
  file: ProfilesFile
  id: string
}

/** A new profile, optionally starting from the values of another. */
export function createProfile(name: string, values: Profile = {}): CreateResult {
  const f = readProfiles()
  const id = nextId(f.profiles)
  return {
    file: writeProfiles({ ...f, profiles: [...f.profiles, { id, name, values }] }),
    id,
  }
}

export function renameProfile(id: string, name: string): ProfilesFile {
  const f = readProfiles()
  return writeProfiles({
    ...f,
    profiles: f.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
  })
}

/**
 * Change what a profile does.
 *
 * Edits the profile itself, and every model assigned to it feels that —
 * which is what a named, user-managed profile means. The screen says how
 * many models share one so the effect is visible before the keystroke, not
 * discovered after it.
 */
export function setProfileValues(id: string, values: Profile): ProfilesFile {
  const f = readProfiles()
  return writeProfiles({
    ...f,
    profiles: f.profiles.map((p) => (p.id === id ? { ...p, values } : p)),
  })
}

/**
 * Delete a profile, and leave the file coherent.
 *
 * Models pointing at it fall back to the default; if the default was the one
 * deleted, another takes over. Deleting the last profile re-seeds rather
 * than leaving a model with no settings at all.
 */
export function removeProfile(id: string): ProfilesFile {
  const f = readProfiles()
  const profiles = f.profiles.filter((p) => p.id !== id)
  if (!profiles.length) {
    return writeProfiles({
      profiles: [SEED],
      assignments: {},
      defaultProfileId: SEED.id,
    })
  }
  const defaultProfileId =
    f.defaultProfileId === id ? profiles[0]!.id : f.defaultProfileId
  const assignments = Object.fromEntries(
    Object.entries(f.assignments).filter(([, pid]) => pid !== id),
  )
  return writeProfiles({ profiles, assignments, defaultProfileId })
}

/** Point a model at a profile. */
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
  return f.profiles.find((p) => p.id === id) ?? f.profiles[0] ?? SEED
}
