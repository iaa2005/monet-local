import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractFlat, untar } from './manager.js'
import { gunzipSync } from 'fflate'

/**
 * The macOS and Linux runtime packs are tarballs nested under build/bin;
 * the reader and the flattening are tried on one made right here with the
 * system tar (bsdtar on Windows, GNU tar elsewhere — both write ustar).
 */
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeTarball(): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), 'monet-tar-'))
  dirs.push(root)
  mkdirSync(join(root, 'build', 'bin'), { recursive: true })
  writeFileSync(join(root, 'build', 'bin', 'llama-server'), '#!/bin/sh\necho hi\n')
  // As llama.cpp's own tarball has it: the binary is executable in the tar.
  if (process.platform !== 'win32') chmodSync(join(root, 'build', 'bin', 'llama-server'), 0o755)
  writeFileSync(join(root, 'build', 'bin', 'libllama.dylib'), Buffer.alloc(1500, 7))
  writeFileSync(join(root, 'build', 'LICENSE'), 'MIT')
  // Relative paths on purpose: GNU tar reads `C:\...` as a remote host.
  execFileSync('tar', ['-czf', 'pack.tar.gz', 'build'], { cwd: root })
  return new Uint8Array(readFileSync(join(root, 'pack.tar.gz')))
}

describe('runtime tarballs', () => {
  it('reads every file in a tarball, with its path and size', () => {
    const files = untar(gunzipSync(makeTarball()))
    const byName = new Map(files.map((f) => [f.name.replace(/^\.\//, ''), f]))
    expect(byName.get('build/bin/llama-server')?.data.length).toBe(18)
    expect(byName.get('build/bin/libllama.dylib')?.data.length).toBe(1500)
    expect(byName.get('build/LICENSE')?.data.length).toBe(3)
    // Directories are not files.
    expect([...byName.keys()].some((n) => n.endsWith('/'))).toBe(false)
  })

  it('extracts a tarball flat, binaries beside their libraries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monet-pack-'))
    dirs.push(dir)
    extractFlat(makeTarball(), dir)
    expect(existsSync(join(dir, 'llama-server'))).toBe(true)
    expect(existsSync(join(dir, 'libllama.dylib'))).toBe(true)
    expect(existsSync(join(dir, 'build'))).toBe(false)
    if (process.platform !== 'win32') {
      // The mode survives: this is what lets the server start on a Mac.
      expect(statSync(join(dir, 'llama-server')).mode & 0o111).not.toBe(0)
      // A library is data, not a program.
      expect(statSync(join(dir, 'libllama.dylib')).mode & 0o111).toBe(0)
    }
  })
})
