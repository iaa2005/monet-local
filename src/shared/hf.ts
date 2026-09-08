/**
 * Hugging Face, turned into rows a person can choose from.
 *
 * The catalogue is not the hard part — the API hands over filenames and byte
 * counts. The hard part is that a repository offers a dozen quantisations of
 * the same model and nothing on the page says which of them this machine can
 * run. That is the question the download screen answers, by putting the
 * estimator's verdict on every row before anything is fetched.
 *
 * Two shapes are filtered out here rather than downloaded and then found
 * wanting:
 *
 *   - SPLIT files (`-00001-of-00002.gguf`). A part is not a model, and
 *     offering one as if it were is a 50 GB mistake.
 *   - projectors (`mmproj-*.gguf`), which belong to a model rather than
 *     standing on their own — they are offered alongside instead.
 */

export interface HfRepo {
  id: string
  downloads?: number
  likes?: number
}

export interface HfSibling {
  rfilename: string
  size?: number
  lfs?: { oid?: string; size?: number }
}

export interface HfFile {
  /** Path within the repository, which is also the download path. */
  path: string
  sizeBytes: number
  /** The sha256 LFS records, when it is there — used to verify a download. */
  sha256?: string
  /** The quantisation this filename advertises. */
  quant?: string
}

export interface RepoContents {
  models: HfFile[]
  /** Vision projectors, offered with a model rather than as one. */
  projectors: HfFile[]
  /** Split archives, listed so their absence from `models` is explicable. */
  split: string[]
}

const SPLIT = /-\d{5}-of-\d{5}\.gguf$/i

function isProjector(path: string): boolean {
  return /(^|\/)mmproj[-_.]/i.test(path)
}

/** The quant tag at the end of a filename, e.g. `UD-IQ4_XS`, `Q4_K_M`. */
export function quantOf(path: string): string | undefined {
  const stem = path.replace(/\.gguf$/i, '').split('/').pop() ?? ''
  const m = stem.match(
    /(?:^|[-_.])((?:UD-)?(?:IQ|Q)\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4)$/i,
  )
  return m?.[1]?.toUpperCase()
}

export function repoContents(siblings: HfSibling[]): RepoContents {
  const models: HfFile[] = []
  const projectors: HfFile[] = []
  const split: string[] = []

  for (const s of siblings) {
    const path = s.rfilename
    if (!path.toLowerCase().endsWith('.gguf')) continue

    const size = s.lfs?.size ?? s.size ?? 0
    const file: HfFile = {
      path,
      sizeBytes: size,
      ...(s.lfs?.oid ? { sha256: s.lfs.oid } : {}),
      ...(quantOf(path) ? { quant: quantOf(path)! } : {}),
    }

    if (SPLIT.test(path)) split.push(path)
    else if (isProjector(path)) projectors.push(file)
    else models.push(file)
  }

  return {
    models: models.sort((a, b) => a.sizeBytes - b.sizeBytes),
    projectors,
    split: split.sort(),
  }
}

/** The download URL for a file in a repository. */
export function downloadUrl(repoId: string, path: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${path}`
}

/**
 * Rank search results the way someone choosing a quant would.
 *
 * Downloads over likes: a repository people actually pull from is more likely
 * to be the maintained one, and likes accumulate on whatever was first.
 */
export function rankRepos(repos: HfRepo[]): HfRepo[] {
  return [...repos].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
}
