/**
 * The model library: the GGUF files in the user's folders, described.
 *
 * Files are never copied or moved. A folder is added, indexed, and its
 * contents stay exactly where they were — including the LM Studio folders,
 * which are added read-only because they are somebody else's to manage.
 *
 * Reading a header costs ~15 ms, but a folder of twenty models on a cold
 * cache is still a visible pause, so results are cached by path + mtime +
 * size. A file that changed is re-read; one that did not is free.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { indexDir } from '../app/settings-store.js'
import { describeModel, type ModelInfo } from './describe.js'
import { readGgufHeader } from './gguf.js'

/**
 * Bump this when `describeModel` changes what it produces.
 *
 * The rest of the cache key — path, mtime, size — describes the FILE, and
 * none of it notices that the code deriving the description changed. So
 * improving a display name left every already-indexed model showing the old
 * one, for good: the files had not been touched, so nothing was ever re-read.
 * This is the part of the key that belongs to us.
 */
const DERIVATION = 2

interface CacheEntry {
  mtimeMs: number
  sizeBytes: number
  info: ModelInfo
}

interface Cache {
  derivation: number
  entries: Record<string, CacheEntry>
}

function cachePath(): string {
  return join(indexDir(), 'models.json')
}

function emptyCache(): Cache {
  return { derivation: DERIVATION, entries: {} }
}

function loadCache(): Cache {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8')) as Partial<Cache>
    // A cache written by a version that described models differently is not
    // a cache, it is a set of stale answers.
    if (raw.derivation !== DERIVATION || !raw.entries) return emptyCache()
    return { derivation: DERIVATION, entries: raw.entries }
  } catch {
    return emptyCache()
  }
}

function saveCache(cache: Cache): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(cache), 'utf8')
  } catch (err) {
    console.error('[library] could not save index', err)
  }
}

/**
 * A projector is not a model.
 *
 * `mmproj-*.gguf` files sit beside the model they belong to and are loaded
 * with it, not instead of it. Listing them as models would offer the user a
 * 0.9 GB "model" that cannot answer anything.
 */
function isProjector(name: string): boolean {
  return /^mmproj[-_.]/i.test(name)
}

function findProjector(dir: string, files: string[]): string | undefined {
  const p = files.find(isProjector)
  return p ? join(dir, p) : undefined
}

export interface ScanResult {
  models: ModelInfo[]
  /** Paths that looked like models but could not be read, with the reason. */
  failures: { path: string; error: string }[]
}

/**
 * Walk one folder (and its immediate subfolders — LM Studio nests a folder
 * per repository) and describe every GGUF found.
 */
export function scanFolder(root: string, cache: Cache): ScanResult {
  const models: ModelInfo[] = []
  const failures: { path: string; error: string }[] = []

  const visit = (dir: string, depth: number): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch (err) {
      failures.push({ path: dir, error: (err as Error).message })
      return
    }

    const ggufs = entries.filter((e) => e.toLowerCase().endsWith('.gguf'))
    const projector = findProjector(dir, ggufs)

    for (const name of ggufs) {
      if (isProjector(name)) continue
      const path = join(dir, name)
      try {
        const st = statSync(path)
        const hit = cache.entries[path]
        if (hit && hit.mtimeMs === st.mtimeMs && hit.sizeBytes === st.size) {
          models.push(hit.info)
          continue
        }
        const info = describeModel(path, readGgufHeader(path), projector)
        cache.entries[path] = { mtimeMs: st.mtimeMs, sizeBytes: st.size, info }
        models.push(info)
      } catch (err) {
        // A download in progress, a truncated file, something that is not a
        // GGUF at all. Reported rather than swallowed: a model the user
        // expects to see and does not is worth an explanation.
        failures.push({ path, error: (err as Error).message })
      }
    }

    if (depth > 0) {
      for (const name of entries) {
        const sub = join(dir, name)
        try {
          if (statSync(sub).isDirectory()) visit(sub, depth - 1)
        } catch {
          // Unreadable subfolder: not worth a failure row.
        }
      }
    }
  }

  if (!existsSync(root)) {
    return { models, failures: [{ path: root, error: 'folder not found' }] }
  }
  visit(root, 1)
  return { models, failures }
}

export function scanFolders(roots: string[]): ScanResult {
  const cache = loadCache()
  const models: ModelInfo[] = []
  const failures: ScanResult['failures'] = []
  const seen = new Set<string>()

  for (const root of roots) {
    const r = scanFolder(root, cache)
    failures.push(...r.failures)
    for (const m of r.models) {
      // The same file reachable through two configured folders (a parent and
      // its child) is one model, not two.
      if (seen.has(m.path)) continue
      seen.add(m.path)
      models.push(m)
    }
  }

  // Ids are what clients send in `model` and what INI sections are named, so
  // a collision has to be visible rather than silently shadowing a file.
  const byId = new Map<string, ModelInfo>()
  for (const m of models) {
    const clash = byId.get(m.id)
    if (clash) {
      failures.push({
        path: m.path,
        error: `id "${m.id}" already taken by ${clash.path}`,
      })
      continue
    }
    byId.set(m.id, m)
  }

  saveCache(cache)
  return {
    models: [...byId.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    ),
    failures,
  }
}
