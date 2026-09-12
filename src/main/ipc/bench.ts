import { ipcMain } from 'electron'
import type { Profile } from '@shared/flags/types.js'
import { rankRepos, repoContents, type HfRepo, type HfSibling } from '@shared/hf.js'
import { activeWeightBytes, effectiveBandwidth } from '@shared/models/speed.js'
import { benchHistory, runBench } from '../bench/run.js'
import { recordBandwidth } from '../app/bandwidth-store.js'
import { readSettings } from '../app/settings-store.js'
import { downloads, enqueueDownload } from '../models/download-manager.js'
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
      const run = await runBench(
        pack.benchPath,
        modelId,
        model.path,
        profileName,
        profile,
        opts ?? {},
      )
      // The run knows what this runtime's memory delivers, which nothing
      // else does; keep it, and every speed on the Server screen is divided
      // by a measurement from then on. Needs the tensor table: without it
      // there is no "bytes per token" to multiply by.
      if (run.result.genTps && model.weightBytes) {
        const active = activeWeightBytes({
          weightBytes: model.weightBytes,
          ...(model.expertBytes ? { expertBytes: model.expertBytes } : {}),
          ...(model.expertCount ? { expertCount: model.expertCount } : {}),
          ...(model.expertUsedCount ? { expertUsedCount: model.expertUsedCount } : {}),
          bandwidthBytesPerSecond: 0,
        })
        recordBandwidth(pack.id, {
          bytesPerSecond: effectiveBandwidth(run.result.genTps, active),
          genTps: run.result.genTps,
          activeBytes: active,
          modelId,
          modelName: `${model.displayName} ${model.quant}`.trim(),
          runtimeLabel: pack.label,
          at: run.result.ran,
        })
      }
      return run
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

  /**
   * Queue a file and answer at once. The transfer runs in main, in a list
   * every screen can see; holding this call for the two hours a 14 GB file
   * takes here is what disabled the screen and hid the progress.
   */
  ipcMain.handle(
    'hf:download',
    (_e, repoId: string, path: string, expectedBytes: number, sha256?: string) => {
      const settings = readSettings()
      const folder =
        settings.downloadFolder ??
        settings.modelFolders.find((f) => !f.readOnly)?.path
      if (!folder) throw new Error('no writable model folder configured')
      const name = path.split('/').pop() ?? path
      return enqueueDownload({
        repoId,
        path,
        name,
        // Flattened: a repository's folders are its business, and a nested
        // path would put the file somewhere the library has to go looking.
        destPath: join(folder, name),
        expectedBytes,
        ...(sha256 ? { sha256 } : {}),
      })
    },
  )

  ipcMain.handle('hf:downloads', () => downloads().list())
  ipcMain.handle('hf:cancel', (_e, id: string) => downloads().cancel(id))
  ipcMain.handle('hf:retry', (_e, id: string) => downloads().retry(id))
  ipcMain.handle('hf:remove', (_e, id: string) => downloads().remove(id))
  ipcMain.handle('hf:clearFinished', () => downloads().clearFinished())

}
