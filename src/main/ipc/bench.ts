import { ipcMain } from 'electron'
import type { Profile } from '@shared/flags/types.js'
import { downloadUrl, rankRepos, repoContents, type HfRepo, type HfSibling } from '@shared/hf.js'
import { benchHistory, runBench } from '../bench/run.js'
import { getMainWindow } from '../app/main-window.js'
import { readSettings } from '../app/settings-store.js'
import { downloadModel, pendingDownloads } from '../models/download.js'
import { scanFolders } from '../models/library.js'
import { listInstalled, pickDefault } from '../runtimes/manager.js'
import { join } from 'node:path'

function activePack() {
  const installed = listInstalled()
  return (
    installed.find((p) => p.id === readSettings().runtimeId) ??
    pickDefault(installed)
  )
}

const HF = 'https://huggingface.co/api'

function hfHeaders(): Record<string, string> {
  const token = readSettings().hfToken
  return {
    accept: 'application/json',
    // Gated repositories (Llama, Gemma and the rest of the "accept the
    // licence" family) 401 without one.
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

export function registerBenchIpc(): void {
  ipcMain.handle('bench:history', () => benchHistory())

  ipcMain.handle(
    'bench:run',
    async (
      _e,
      modelId: string,
      profileName: string,
      profile: Profile,
      opts?: { promptTokens?: number; genTokens?: number },
    ) => {
      const pack = activePack()
      if (!pack?.benchPath) throw new Error('this runtime has no llama-bench')
      const model = scanFolders(
        readSettings().modelFolders.map((f) => f.path),
      ).models.find((m) => m.id === modelId)
      if (!model) throw new Error(`unknown model ${modelId}`)
      return runBench(
        pack.benchPath,
        modelId,
        model.path,
        profileName,
        profile,
        opts ?? {},
      )
    },
  )

  // ── Hugging Face ──────────────────────────────────────────────────────

  ipcMain.handle('hf:search', async (_e, query: string) => {
    const url = `${HF}/models?search=${encodeURIComponent(query)}&filter=gguf&limit=20`
    const res = await fetch(url, { headers: hfHeaders() })
    if (!res.ok) throw new Error(`Hugging Face: ${res.status}`)
    return rankRepos((await res.json()) as HfRepo[])
  })

  ipcMain.handle('hf:repo', async (_e, repoId: string) => {
    const res = await fetch(`${HF}/models/${repoId}?blobs=true`, {
      headers: hfHeaders(),
    })
    if (!res.ok) throw new Error(`Hugging Face: ${res.status}`)
    const body = (await res.json()) as { siblings?: HfSibling[] }
    return { repoId, ...repoContents(body.siblings ?? []) }
  })

  ipcMain.handle(
    'hf:download',
    async (
      _e,
      repoId: string,
      path: string,
      expectedBytes: number,
      sha256?: string,
    ) => {
      const settings = readSettings()
      const folder =
        settings.downloadFolder ??
        settings.modelFolders.find((f) => !f.readOnly)?.path
      if (!folder) throw new Error('no writable model folder configured')

      const win = getMainWindow()
      return downloadModel({
        url: downloadUrl(repoId, path),
        // Flattened: a repository's folders are its business, and a nested
        // path would put the file somewhere the library has to go looking.
        destPath: join(folder, path.split('/').pop() ?? path),
        expectedBytes,
        ...(sha256 ? { sha256 } : {}),
        ...(settings.hfToken ? { token: settings.hfToken } : {}),
        onProgress: (p) =>
          void win?.webContents.send('hf:progress', { path, ...p }),
      })
    },
  )

  /** Partial downloads left by a previous run, so a queue can be resumed. */
  ipcMain.handle('hf:pending', () => pendingDownloads())
}
