/**
 * A GitHub release of llama.cpp, matched against the backend catalog.
 *
 * Pure so it can be tested on a recorded release
 * (docs/reference/release-b10826.json) rather than the network — the whole
 * point of the table-driven design is that a backend nobody here can run is
 * still covered by a test.
 */

import type { BackendSpec } from './catalog.js'

export interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

export interface Release {
  tag_name: string
  published_at?: string
  assets: ReleaseAsset[]
}

export interface AvailablePack {
  backend: BackendSpec
  build: string
  asset: ReleaseAsset
  /** CUDA's runtime DLLs — a second archive into the same folder. */
  extra?: ReleaseAsset
  /** Both archives together, which is what the download actually costs. */
  totalBytes: number
}

function findAsset(
  assets: ReleaseAsset[],
  pattern: string,
  build: string,
): ReleaseAsset | undefined {
  const want = pattern.replace('{build}', build).toLowerCase()
  return assets.find((a) => a.name.toLowerCase() === want)
}

/**
 * Which of the catalog's packs this release actually carries.
 *
 * A backend missing from a release is not an error: llama.cpp adds and drops
 * build targets between tags, and a pack that is simply absent should
 * disappear from the list rather than fail to download later.
 */
export function packsIn(
  release: Release,
  backends: BackendSpec[],
): AvailablePack[] {
  const build = release.tag_name
  const packs: AvailablePack[] = []

  for (const backend of backends) {
    const asset = findAsset(release.assets, backend.asset, build)
    if (!asset) continue

    const extra = backend.extraAsset
      ? findAsset(release.assets, backend.extraAsset, build)
      : undefined
    // A CUDA pack without its runtime archive would install and then fail to
    // start with a missing-DLL box. Skip it instead of offering a trap.
    if (backend.extraAsset && !extra) continue

    packs.push({
      backend,
      build,
      asset,
      ...(extra ? { extra } : {}),
      totalBytes: asset.size + (extra?.size ?? 0),
    })
  }
  return packs
}
