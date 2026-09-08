import { createServer, type Server } from 'node:http'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'monet-local-dl-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

const { downloadModel, ChecksumError } = await import('./download.js')
const { downloadsDir } = await import('../app/settings-store.js')

/** A file big enough to arrive in several chunks. */
const BODY = Buffer.from('x'.repeat(200_000))
const SHA = createHash('sha256').update(BODY).digest('hex')

let server: Server
let port = 0
/** Set to cut the response short, the way a dropped connection does. */
let truncateAt: number | null = null
/** Set to make the server ignore Range, the way some CDNs do. */
let ignoreRange = false
let sawRange: string | undefined

beforeAll(async () => {
  server = createServer((req, res) => {
    sawRange = req.headers['range'] as string | undefined
    const range = ignoreRange ? undefined : sawRange
    const from = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0
    const slice = BODY.subarray(from)
    const body = truncateAt === null ? slice : slice.subarray(0, truncateAt)

    res.writeHead(from > 0 && !ignoreRange ? 206 : 200, {
      'content-length': String(body.length),
      ...(from > 0 && !ignoreRange
        ? { 'content-range': `bytes ${from}-${BODY.length - 1}/${BODY.length}` }
        : {}),
    })
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
  rmSync(tmp, { recursive: true, force: true })
})

const url = (): string => `http://127.0.0.1:${port}/model.gguf`
const dest = (name: string): string => join(tmp, 'models', name)

describe('downloadModel', () => {
  it('fetches a file and puts it where it belongs', async () => {
    const to = dest('plain.gguf')
    const r = await downloadModel({ url: url(), destPath: to, expectedBytes: BODY.length })
    expect(r.bytes).toBe(BODY.length)
    expect(readFileSync(to).equals(BODY)).toBe(true)
  })

  it('never leaves a partial file in the models folder', async () => {
    // The rule this module exists for. A GGUF header is complete long before
    // the weights are, so a partial in a models folder is indistinguishable
    // from a model until it fails to load.
    truncateAt = 50_000
    const to = dest('interrupted.gguf')
    await expect(
      downloadModel({ url: url(), destPath: to, expectedBytes: BODY.length }),
    ).rejects.toThrow(/incomplete/)
    expect(existsSync(to)).toBe(false)
    // …and what was fetched is kept, in the downloads folder, to resume from.
    expect(existsSync(join(downloadsDir(), 'interrupted.gguf.part'))).toBe(true)
    truncateAt = null
  })

  it('resumes from what is already on disk', async () => {
    const to = dest('interrupted.gguf')
    sawRange = undefined
    const r = await downloadModel({
      url: url(),
      destPath: to,
      expectedBytes: BODY.length,
    })
    // Asked for the rest rather than starting over: two hours saved on a
    // 14 GB file at this machine's 2 MB/s.
    expect(sawRange).toBe('bytes=50000-')
    expect(r.bytes).toBe(BODY.length)
    expect(readFileSync(to).equals(BODY)).toBe(true)
  })

  it('starts over when the server ignores the range', async () => {
    // A 200 to a ranged request means the whole file is coming; appending it
    // to what is already there would produce a longer, corrupt file.
    truncateAt = 40_000
    const to = dest('ignored-range.gguf')
    await expect(
      downloadModel({ url: url(), destPath: to, expectedBytes: BODY.length }),
    ).rejects.toThrow(/incomplete/)
    truncateAt = null

    ignoreRange = true
    const r = await downloadModel({
      url: url(),
      destPath: to,
      expectedBytes: BODY.length,
    })
    ignoreRange = false
    expect(r.bytes).toBe(BODY.length)
    expect(readFileSync(to).equals(BODY)).toBe(true)
  })

  it('verifies the hash and refuses a corrupt file', async () => {
    const to = dest('bad-hash.gguf')
    await expect(
      downloadModel({
        url: url(),
        destPath: to,
        expectedBytes: BODY.length,
        sha256: 'not-the-right-hash',
      }),
    ).rejects.toThrow(ChecksumError)
    expect(existsSync(to)).toBe(false)
    // A corrupt partial must NOT be resumable — appending to it would never
    // converge on the right file.
    expect(existsSync(join(downloadsDir(), 'bad-hash.gguf.part'))).toBe(false)
  })

  it('accepts a file whose hash matches', async () => {
    const to = dest('good-hash.gguf')
    const r = await downloadModel({
      url: url(),
      destPath: to,
      expectedBytes: BODY.length,
      sha256: SHA,
    })
    expect(r.bytes).toBe(BODY.length)
  })

  it('does not re-fetch a file that is already there', async () => {
    const to = dest('already.gguf')
    writeFileSync(to, BODY)
    const r = await downloadModel({ url: url(), destPath: to, expectedBytes: BODY.length })
    expect(r.alreadyComplete).toBe(true)
  })

  it('reports progress with a rate to show', async () => {
    const seen: number[] = []
    await downloadModel({
      url: url(),
      destPath: dest('progress.gguf'),
      expectedBytes: BODY.length,
      onProgress: (p) => seen.push(p.receivedBytes),
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(BODY.length)
  })
})
