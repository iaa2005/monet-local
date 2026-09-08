/**
 * Everything the app remembers, beyond the two things the first paint needs
 * (those live in prefs.ts).
 *
 * Parsed defensively on read: this file is plain JSON in a folder the user
 * can open, and a hand-edited or half-written one must degrade to defaults
 * rather than take the app down.
 */

export interface ModelFolder {
  path: string
  /**
   * Indexed but never written to. The LM Studio and Bionic folders are added
   * this way — their contents are somebody else's to manage.
   */
  readOnly: boolean
}

export interface AppSettings {
  modelFolders: ModelFolder[]
  /** Where the Hugging Face downloader puts finished files. */
  downloadFolder?: string
  /** Installed runtime pack to launch with, e.g. `vulkan-b10826`. */
  runtimeId?: string
  /** The one port clients talk to. 17172 (router) is internal. */
  port: number
  /** Bind 0.0.0.0 instead of 127.0.0.1 — see the LAN note in the plan. */
  networkAccess: boolean
  /** Required when networkAccess is on. */
  apiKey?: string
  /** Hugging Face token, for repositories behind a licence click. */
  hfToken?: string
  /**
   * Optional GitHub token. Runtime lookup does not need one — it avoids the
   * API entirely — but a token raises the limit if you point this at a
   * private mirror.
   */
  githubToken?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  modelFolders: [],
  // Deliberately not 8080 (llama.cpp), 1234 (LM Studio) or 11434 (Ollama):
  // Monet Local should never be the reason one of those fails to bind.
  port: 17171,
  networkAccess: false,
}

function isFolder(v: unknown): v is ModelFolder {
  const o = v as Partial<ModelFolder> | null
  return !!o && typeof o.path === 'string' && o.path.length > 0
}

export function parseSettings(raw: unknown): AppSettings {
  const o = (raw ?? {}) as Partial<AppSettings>
  const port =
    typeof o.port === 'number' && o.port >= 1 && o.port <= 65535
      ? Math.floor(o.port)
      : DEFAULT_SETTINGS.port
  return {
    modelFolders: Array.isArray(o.modelFolders)
      ? o.modelFolders
          .filter(isFolder)
          .map((f) => ({ path: f.path, readOnly: f.readOnly === true }))
      : [],
    ...(typeof o.downloadFolder === 'string'
      ? { downloadFolder: o.downloadFolder }
      : {}),
    ...(typeof o.runtimeId === 'string' ? { runtimeId: o.runtimeId } : {}),
    port,
    networkAccess: o.networkAccess === true,
    ...(typeof o.apiKey === 'string' ? { apiKey: o.apiKey } : {}),
    ...(typeof o.hfToken === 'string' ? { hfToken: o.hfToken } : {}),
    ...(typeof o.githubToken === 'string' ? { githubToken: o.githubToken } : {}),
  }
}
