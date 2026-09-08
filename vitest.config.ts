import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: resolve('src/shared') },
      { find: '@main', replacement: resolve('src/main') },
    ],
  },
  test: {
    globals: true,
    // Only the pure modules: anything that needs Electron is covered by the
    // smoke probes instead, so `npm test` stays a second-long gate.
    include: ['src/shared/**/*.test.ts', 'src/main/**/*.test.ts'],
  },
})
