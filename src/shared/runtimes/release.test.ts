import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKENDS, backendsFor } from './catalog.js'
import { packsIn, type Release } from './release.js'

/**
 * A recorded release, so every backend row is exercised without the network
 * and without the hardware. This is how CUDA, ROCm and SYCL get covered on a
 * machine that has an integrated AMD GPU and nothing else.
 */
const release: Release = JSON.parse(
  readFileSync(
    resolve('docs/reference/release-b10826.json'),
    'utf8',
  ),
) as Release

const WIN_X64 = backendsFor('win32', 'x64')

describe('packsIn', () => {
  it('finds every Windows x64 pack b10826 shipped', () => {
    const ids = packsIn(release, WIN_X64).map((p) => p.backend.id)
    expect(ids).toEqual([
      'vulkan',
      'cpu',
      'cuda-12.4',
      'cuda-13.3',
      'rocm',
      'sycl',
      'openvino',
    ])
  })

  it('counts a CUDA pack together with its runtime archive', () => {
    const cuda = packsIn(release, WIN_X64).find(
      (p) => p.backend.id === 'cuda-13.3',
    )
    // 142 MB of build plus 372 MB of cudart: the number the download button
    // has to show, not the 142 the asset alone would suggest.
    expect(cuda?.extra?.name).toContain('cudart')
    expect(Math.round(cuda!.totalBytes / 1024 ** 2)).toBe(514)
  })

  it('drops a CUDA pack whose runtime archive is missing', () => {
    // Half a CUDA install starts and dies on a missing DLL; better absent.
    const crippled: Release = {
      ...release,
      assets: release.assets.filter((a) => !a.name.startsWith('cudart-')),
    }
    const ids = packsIn(crippled, WIN_X64).map((p) => p.backend.id)
    expect(ids).not.toContain('cuda-13.3')
    expect(ids).toContain('vulkan')
  })

  it('skips a backend this release did not build', () => {
    const noVulkan: Release = {
      ...release,
      assets: release.assets.filter((a) => !a.name.includes('vulkan')),
    }
    expect(packsIn(noVulkan, WIN_X64).map((p) => p.backend.id)).not.toContain(
      'vulkan',
    )
  })

  it('offers nothing for a platform the catalog has no rows for', () => {
    expect(packsIn(release, backendsFor('darwin', 'arm64'))).toEqual([])
  })
})

describe('catalog', () => {
  it('bundles exactly the two packs that must work offline', () => {
    expect(BACKENDS.filter((b) => b.bundled).map((b) => b.id)).toEqual([
      'vulkan',
      'cpu',
    ])
  })

  it('marks every pack no one here can test', () => {
    // If this list shrinks, someone confirmed hardware — make sure they also
    // removed the badge from the UI.
    const untested = BACKENDS.filter((b) => b.untested).map((b) => b.id)
    expect(untested).toEqual([
      'cuda-12.4',
      'cuda-13.3',
      'rocm',
      'sycl',
      'openvino',
      'opencl-adreno',
    ])
  })
})
