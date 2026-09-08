import { describe, expect, it } from 'vitest'
import { downloadUrl, quantOf, rankRepos, repoContents } from './hf.js'

/** Verbatim shapes from unsloth/Qwen3.8-27B-GGUF. */
const SIBLINGS = [
  { rfilename: 'README.md', size: 4000 },
  { rfilename: 'BF16/Qwen3.8-27B-BF16-00001-of-00002.gguf', size: 49_986_159_616 },
  { rfilename: 'BF16/Qwen3.8-27B-BF16-00002-of-00002.gguf', size: 4_671_576_000 },
  {
    rfilename: 'Qwen3.8-27B-UD-IQ4_XS.gguf',
    lfs: { oid: 'abc123', size: 14_250_000_000 },
  },
  { rfilename: 'Qwen3.8-27B-UD-Q3_K_XL.gguf', size: 13_150_000_000 },
  { rfilename: 'mmproj-Qwen3.8-27B-BF16.gguf', size: 931_145_856 },
  { rfilename: 'imatrix_unsloth.gguf', size: 10_000_000 },
]

describe('repoContents', () => {
  it('offers the whole quants, smallest first', () => {
    const { models } = repoContents(SIBLINGS)
    expect(models.map((m) => m.path)).toEqual([
      'imatrix_unsloth.gguf',
      'Qwen3.8-27B-UD-Q3_K_XL.gguf',
      'Qwen3.8-27B-UD-IQ4_XS.gguf',
    ])
  })

  it('keeps split archives out of the list', () => {
    // A part is not a model. Offering `-00001-of-00002` as something to
    // download is a 50 GB mistake that only shows up at load time.
    const { models, split } = repoContents(SIBLINGS)
    expect(models.some((m) => m.path.includes('00001-of-00002'))).toBe(false)
    expect(split).toHaveLength(2)
  })

  it('separates the projector, which is not a model on its own', () => {
    const { models, projectors } = repoContents(SIBLINGS)
    expect(projectors.map((p) => p.path)).toEqual(['mmproj-Qwen3.8-27B-BF16.gguf'])
    expect(models.some((m) => m.path.startsWith('mmproj'))).toBe(false)
  })

  it('takes the size and hash from the LFS record when there is one', () => {
    const iq4 = repoContents(SIBLINGS).models.find((m) => m.path.includes('IQ4_XS'))
    expect(iq4?.sizeBytes).toBe(14_250_000_000)
    expect(iq4?.sha256).toBe('abc123')
  })

  it('ignores everything that is not a GGUF', () => {
    expect(repoContents(SIBLINGS).models.some((m) => m.path.endsWith('.md'))).toBe(
      false,
    )
  })
})

describe('quantOf', () => {
  it('reads the tag off the end, not the parameter count', () => {
    // `27B` sits earlier in the name; a greedy scan reports it as the quant.
    expect(quantOf('Qwen3.8-27B-UD-IQ4_XS.gguf')).toBe('UD-IQ4_XS')
    expect(quantOf('Qwen3.8-27B-Q4_K_M.gguf')).toBe('Q4_K_M')
    expect(quantOf('folder/Model-BF16.gguf')).toBe('BF16')
  })

  it('says nothing when the name says nothing', () => {
    expect(quantOf('imatrix_unsloth.gguf')).toBeUndefined()
  })
})

describe('rankRepos', () => {
  it('puts the repository people actually pull from first', () => {
    // Likes accumulate on whatever was published first; downloads track what
    // is maintained.
    const ranked = rankRepos([
      { id: 'someone/fork', downloads: 479_597, likes: 640 },
      { id: 'unsloth/Qwen3.8-27B-GGUF', downloads: 10_675_683, likes: 3688 },
    ])
    expect(ranked[0]?.id).toBe('unsloth/Qwen3.8-27B-GGUF')
  })
})

describe('downloadUrl', () => {
  it('points at the file in the repository', () => {
    expect(downloadUrl('unsloth/Qwen3.8-27B-GGUF', 'a/b.gguf')).toBe(
      'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/a/b.gguf',
    )
  })
})
