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

  it('offers the macOS and Linux tarballs to the machines they are for', () => {
    // The recorded release predates the rows; a release with the tarballs
    // llama.cpp ships today (b10909's names) is what a Mac would see.
    const tag = 'b10909'
    const withTarballs: Release = {
      tag_name: tag,
      assets: [
        `llama-${tag}-bin-macos-arm64.tar.gz`,
        `llama-${tag}-bin-macos-x64.tar.gz`,
        `llama-${tag}-bin-ubuntu-vulkan-x64.tar.gz`,
        `llama-${tag}-bin-ubuntu-x64.tar.gz`,
        `llama-${tag}-bin-win-vulkan-x64.zip`,
      ].map((name) => ({ name, size: 1, browser_download_url: `https://x/${name}` })),
    }
    const ids = (p: string, a: string): string[] =>
      packsIn(withTarballs, backendsFor(p as NodeJS.Platform, a)).map((x) => x.backend.id)
    expect(ids('darwin', 'arm64')).toEqual(['metal'])
    expect(ids('darwin', 'x64')).toEqual(['cpu-mac'])
    expect(ids('linux', 'x64')).toEqual(['vulkan-linux', 'cpu-linux'])
    // And a release without them offers a Mac nothing, rather than a zip.
    expect(packsIn(release, backendsFor('darwin', 'arm64'))).toEqual([])
  })
})

describe('catalog', () => {
  it('bundles exactly the packs that must work offline, per platform', () => {
    const bundled = (p: string, a: string): string[] =>
      backendsFor(p as NodeJS.Platform, a)
        .filter((b) => b.bundled)
        .map((b) => b.id)
    expect(bundled('win32', 'x64')).toEqual(['vulkan', 'cpu'])
    expect(bundled('darwin', 'arm64')).toEqual(['metal'])
    expect(bundled('darwin', 'x64')).toEqual(['cpu-mac'])
    expect(bundled('linux', 'x64')).toEqual(['vulkan-linux', 'cpu-linux'])
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
      // Nobody on the project has a Mac or a Linux box either — the rows
      // are there so the builds have something to download, and the badge
      // says the path is unproven.
      'metal',
      'cpu-mac',
      'vulkan-linux',
      'cpu-linux',
    ])
  })
})
