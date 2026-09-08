/**
 * Finding llama.cpp builds without spending GitHub's API budget.
 *
 * The obvious way — `api.github.com/repos/.../releases` — is capped at sixty
 * unauthenticated requests an hour PER IP, and a developer machine burns
 * those on other things. The screen then fails with `403 rate limit
 * exceeded`, which is both true and useless: nothing the user did caused it
 * and nothing they can do fixes it.
 *
 * So this module does not use the API at all by default:
 *
 *   TAGS come from `releases.atom`, a plain feed with no limit and no auth.
 *   Note that `/releases/latest` is NOT the answer — it points at the
 *   semver tag (`v0.4.0`), which carries no binaries. The builds are the
 *   `bNNNNN` tags, and only the feed lists those in order.
 *
 *   SIZES come from a HEAD on the asset itself. A 404 means this build did
 *   not produce that pack, which is also how the catalogue stays honest
 *   about backends that come and go between releases.
 *
 * A token is still honoured when one is configured: it raises the limit and
 * is the only way into a private mirror. It is an option, not a requirement.
 */

import type { BackendSpec } from '@shared/runtimes/catalog.js'
import type { Release, ReleaseAsset } from '@shared/runtimes/release.js'

const REPO = 'ggml-org/llama.cpp'
const ATOM = `https://github.com/${REPO}/releases.atom`

/**
 * Build tags from the atom feed, newest first.
 *
 * Only `bNNNNN` tags: the semver ones are source releases with no binaries,
 * and offering one would produce a pack that 404s on every asset.
 */
export function parseAtomTags(xml: string): string[] {
  const tags = [...xml.matchAll(/\/releases\/tag\/([^"<\s]+)/g)].map((m) => m[1]!)
  const seen = new Set<string>()
  return tags.filter((t) => /^b\d+$/.test(t) && !seen.has(t) && seen.add(t))
}

function assetUrl(tag: string, name: string): string {
  return `https://github.com/${REPO}/releases/download/${tag}/${name}`
}

async function headSize(
  url: string,
  headers: Record<string, string>,
): Promise<number | null> {
  try {
    // Some CDNs answer HEAD with no length; a ranged GET always reports the
    // full size in Content-Range and costs one byte.
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...headers, range: 'bytes=0-0' },
    })
    if (res.status === 404) return null
    const range = res.headers.get('content-range')
    const total = range ? Number(range.split('/')[1]) : NaN
    if (Number.isFinite(total) && total > 0) return total
    const len = Number(res.headers.get('content-length') ?? 0)
    return len > 0 ? len : null
  } catch {
    return null
  }
}

export class ReleaseLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseLookupError'
  }
}

/**
 * The newest build that actually shipped the packs this platform wants.
 *
 * Tags are tried in order because a build can fail partway and publish some
 * assets but not others; the first one carrying what we need is the answer.
 */
export async function resolveLatestRelease(
  backends: BackendSpec[],
  token?: string,
  maxTagsToTry = 4,
): Promise<Release> {
  const headers: Record<string, string> = {}
  if (token) headers['authorization'] = `Bearer ${token}`

  const feed = await fetch(ATOM, { headers })
  if (!feed.ok) {
    throw new ReleaseLookupError(
      `could not reach GitHub (${feed.status}). Check the connection, or add a runtime folder you already have.`,
    )
  }
  const tags = parseAtomTags(await feed.text())
  if (tags.length === 0) {
    throw new ReleaseLookupError('GitHub listed no llama.cpp builds')
  }

  for (const tag of tags.slice(0, maxTagsToTry)) {
    const assets: ReleaseAsset[] = []
    const wanted = new Set<string>()
    for (const b of backends) {
      wanted.add(b.asset.replace('{build}', tag))
      if (b.extraAsset) wanted.add(b.extraAsset.replace('{build}', tag))
    }

    await Promise.all(
      [...wanted].map(async (name) => {
        const url = assetUrl(tag, name)
        const size = await headSize(url, headers)
        if (size !== null) {
          assets.push({ name, size, browser_download_url: url })
        }
      }),
    )

    if (assets.length > 0) {
      return { tag_name: tag, assets }
    }
  }

  throw new ReleaseLookupError(
    `none of the last ${maxTagsToTry} llama.cpp builds shipped a pack for this platform`,
  )
}
