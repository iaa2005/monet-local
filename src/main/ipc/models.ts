import { dialog, ipcMain } from 'electron'
import { readSettings, writeSettings } from '../app/settings-store.js'
import { getMainWindow } from '../app/main-window.js'
import { scanFolders } from '../models/library.js'

export function registerModelIpc(): void {
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch: unknown) =>
    writeSettings(patch as Parameters<typeof writeSettings>[0]),
  )

  ipcMain.handle('models:folders', () => readSettings().modelFolders)

  ipcMain.handle('models:scan', () => {
    const folders = readSettings().modelFolders
    return scanFolders(folders.map((f) => f.path))
  })

  ipcMain.handle('models:addFolder', async (_e, readOnly = false) => {
    const win = getMainWindow()
    const picked = await dialog.showOpenDialog(win!, {
      title: 'Folder with .gguf models',
      properties: ['openDirectory'],
    })
    const dir = picked.filePaths[0]
    if (picked.canceled || !dir) return readSettings().modelFolders
    const folders = readSettings().modelFolders
    if (!folders.some((f) => f.path === dir)) {
      folders.push({ path: dir, readOnly: readOnly === true })
      writeSettings({ modelFolders: folders })
    }
    return readSettings().modelFolders
  })

  ipcMain.handle('models:removeFolder', (_e, path: string) => {
    writeSettings({
      modelFolders: readSettings().modelFolders.filter((f) => f.path !== path),
    })
    return readSettings().modelFolders
  })
}
