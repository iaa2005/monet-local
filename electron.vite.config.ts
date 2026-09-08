import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Code both processes must agree on: the flag registry, the i18n strings, the
// shapes crossing IPC. Aliased rather than reached at by relative path so a
// file can move between src/main and src/renderer without rewriting imports.
const shared = { find: '@shared', replacement: resolve('src/shared') }
const main = { find: '@main', replacement: resolve('src/main') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: [shared, main] },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: [shared, main] },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
    resolve: {
      alias: [shared, { find: '@', replacement: resolve('src/renderer') }],
    },
    plugins: [react()],
  },
})
