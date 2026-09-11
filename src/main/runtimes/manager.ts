/**
 * Runtime packs: install, inspect, choose.
 *
 * A pack is a folder holding one llama.cpp build — `llama-server.exe`,
 * `llama-bench.exe` and their DLLs — plus a `pack.json` we write recording
 * what it is and what it found. Several builds of the same backend can sit
 * side by side, so a bad llama.cpp release is a one-click rollback rather
 * than a broken install.
 *
 * Nothing here knows what CUDA is. A backend is a row in the catalog, and
 * this module downloads whatever that row names.
 */

import { spawn } from 'node:child_process'
import { chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { gunzipSync, unzipSync } from 'fflate'
import type { BackendId } from '@shared/runtimes/catalog.js'
import { backendById, type BackendSpec } from '@shared/runtimes/catalog.js'
import { parseDevices, type Device } from '@shared/runtimes/devices.js'
import type { AvailablePack, Release } from '@shared/runtimes/release.js'
import { runtimesDir } from '../app/settings-store.js'
import { resolveLatestRelease } from './releases.js'

export interface InstalledPack {
  /** Folder name, and the id settings store: `vulkan-b10826`. */
  id: string
  backendId: BackendId
  label: string
  build: string
  dir: string
  serverPath: string
  benchPath?: string
  /** What `--list-devices` found, cached from install time. */
  devices: Device[]
  /** llama.cpp's own version string. */
  version?: string
  /** Added by the user pointing at a folder rather than downloaded. */
  custom?: boolean
  installedAt: string
}

const SERVER_EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
const BENCH_EXE = process.platform === 'win32' ? 'llama-bench.exe' : 'llama-bench'

function packJsonPath(dir: string): string {
  return join(dir, 'pack.json')
}

/** Run a pack's binary and collect what it prints, without a shell. */
function run(exe: string, args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(exe, args, { windowsHide: true })
    const done = (): void => resolve(out)
    const timer = setTimeout(() => {
      child.kill()
      done()
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    // llama.cpp prints its device banner to stderr, so both streams matter.
    child.stderr.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => {
      clearTimeout(timer)
      done()
    })
    child.on('close', () => {
      clearTimeout(timer)
      done()
    })
  })
}

/**
 * Ask a build what hardware it can see.
 *
 * This is what separates "installed" from "usable": a Vulkan pack on a
 * machine with no Vulkan driver starts, prints its banner and lists nothing.
 *
 * Devices come from `llama-bench --list-devices`, not the server's. Both
 * print the same "Available devices" block, but only llama-bench initialises
 * the backend first and so emits the line carrying `uma: 1` — and that one
 * bit decides whether a GPU's memory is a separate pool or a slice of system
 * RAM, which is the difference between a budget that adds 18 GB and one that
 * subtracts it. The server is the fallback when a pack ships without bench.
 */
export async function probe(
  dir: string,
): Promise<{ devices: Device[]; version?: string }> {
  const exe = join(dir, SERVER_EXE)
  if (!existsSync(exe)) return { devices: [] }
  const bench = join(dir, BENCH_EXE)
  const lister = existsSync(bench) ? bench : exe

  const [devicesOut, versionOut] = await Promise.all([
    run(lister, ['--list-devices']),
    run(exe, ['--version'], 10_000),
  ])
  const version = /version:\s*(.+)/.exec(versionOut)?.[1]?.trim()
  return {
    devices: parseDevices(devicesOut),
    ...(version ? { version } : {}),
  }
}

export function listInstalled(): InstalledPack[] {
  const root = runtimesDir()
  if (!existsSync(root)) return []
  const packs: InstalledPack[] = []
  for (const name of readdirSync(root)) {
    try {
      const raw = readFileSync(packJsonPath(join(root, name)), 'utf8')
      packs.push(JSON.parse(raw) as InstalledPack)
    } catch {
      // A folder without a readable pack.json is a half-finished install.
      // Ignore it here; installPack() clears it before writing.
    }
  }
  return packs.sort((a, b) => a.id.localeCompare(b.id))
}

async function download(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  const chunks: Uint8Array[] = []
  let received = 0
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
    received += chunk.length
    onProgress?.(received, total)
  }
  const out = new Uint8Array(received)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * Extract a llama.cpp archive FLAT.
 *
 * The Windows zips put everything at the root, but some builds nest one
 * folder deep; the macOS and Linux tarballs nest under `build/bin/`. Either
 * way the binaries must end up beside their libraries, so paths are
 * collapsed to their basename rather than preserved.
 *
 * A tarball is told by its bytes (gzip's 1f 8b), not its name: the name is
 * whatever the release called it, and a renamed download is still a tarball.
 * File modes come from the tar header — without them `llama-server` lands
 * on disk unrunnable, and nothing on macOS says why beyond EACCES.
 */
export function extractFlat(archive: Uint8Array, dir: string): void {
  mkdirSync(dir, { recursive: true })
  const entries: { name: string; data: Uint8Array; mode?: number }[] =
    archive[0] === 0x1f && archive[1] === 0x8b
      ? untar(gunzipSync(archive))
      : Object.entries(unzipSync(archive)).map(([name, data]) => ({ name, data }))
  for (const { name, data, mode } of entries) {
    if (name.endsWith('/') || data.length === 0) continue
    const target = join(dir, basename(name))
    writeFileSync(target, data)
    if (process.platform !== 'win32') {
      // Executable if the tar said so, OR if it has no extension at all: a
      // zip carries no mode, a tarball written on Windows carries none
      // worth having, and `llama-server` is exactly that kind of name.
      const exec =
        (mode !== undefined && (mode & 0o111) !== 0) || !/\.[a-z0-9]+$/i.test(basename(name))
      chmodSync(target, exec ? 0o755 : 0o644)
    }
  }
}

/**
 * The files in a tar stream — ustar with GNU long names, which is what
 * `tar czf` writes on the CI machines llama.cpp releases from. Directories,
 * links and pax records are skipped; nothing in a runtime pack is one.
 */
export function untar(buf: Uint8Array): { name: string; data: Uint8Array; mode: number }[] {
  const out: { name: string; data: Uint8Array; mode: number }[] = []
  const text = new TextDecoder()
  const field = (at: number, len: number): string => {
    const s = text.decode(buf.subarray(at, at + len))
    const nul = s.indexOf('\0')
    return (nul >= 0 ? s.slice(0, nul) : s).trim()
  }
  let off = 0
  let longName: string | null = null
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break
    const name = field(off, 100)
    const mode = parseInt(field(off + 100, 8) || '0', 8)
    const size = parseInt(field(off + 124, 12) || '0', 8)
    const type = String.fromCharCode(buf[off + 156] ?? 0)
    const prefix = field(off + 345, 155)
    const dataStart = off + 512
    const data = buf.subarray(dataStart, dataStart + size)
    off = dataStart + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = field(dataStart, size)
      continue
    }
    const full = longName ?? (prefix ? `${prefix}/${name}` : name)
    longName = null
    if (type === '0' || type === '\0' || type === '') out.push({ name: full, data, mode })
  }
  return out
}

export interface InstallProgress {
  stage: 'downloading' | 'extracting' | 'probing' | 'done'
  received?: number
  total?: number
  /** Which archive, when a pack has two (CUDA's runtime DLLs). */
  part?: number
  parts?: number
}

export async function installPack(
  pack: AvailablePack,
  onProgress?: (p: InstallProgress) => void,
): Promise<InstalledPack> {
  const id = `${pack.backend.id}-${pack.build}`
  const dir = join(runtimesDir(), id)
  // A previous attempt may have left a partial folder; start clean so a
  // retry cannot mix two builds' DLLs.
  rmSync(dir, { recursive: true, force: true })

  const archives = [pack.asset, ...(pack.extra ? [pack.extra] : [])]
  for (const [i, asset] of archives.entries()) {
    const bytes = await download(asset.browser_download_url, (received, total) =>
      onProgress?.({
        stage: 'downloading',
        received,
        total,
        part: i + 1,
        parts: archives.length,
      }),
    )
    onProgress?.({ stage: 'extracting', part: i + 1, parts: archives.length })
    extractFlat(bytes, dir)
  }

  onProgress?.({ stage: 'probing' })
  const { devices, version } = await probe(dir)

  const installed: InstalledPack = {
    id,
    backendId: pack.backend.id,
    label: pack.backend.label,
    build: pack.build,
    dir,
    serverPath: join(dir, SERVER_EXE),
    ...(existsSync(join(dir, BENCH_EXE)) ? { benchPath: join(dir, BENCH_EXE) } : {}),
    devices,
    ...(version ? { version } : {}),
    installedAt: new Date().toISOString(),
  }
  writeFileSync(packJsonPath(dir), JSON.stringify(installed, null, 2), 'utf8')
  onProgress?.({ stage: 'done' })
  return installed
}

/**
 * Adopt a folder the user built or downloaded themselves.
 *
 * This is what covers every backend llama.cpp can build but does not publish
 * a Windows zip for — CANN, MUSA, Hexagon, WebGPU, a local build with your
 * own flags. Validated by running it, not by trusting the folder name.
 */
export async function addCustomPack(dir: string): Promise<InstalledPack> {
  const exe = join(dir, SERVER_EXE)
  if (!existsSync(exe)) throw new Error(`no ${SERVER_EXE} in ${dir}`)

  const { devices, version } = await probe(dir)
  if (!version) throw new Error(`${SERVER_EXE} in ${dir} did not run`)

  const installed: InstalledPack = {
    id: `custom-${basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`,
    backendId: 'custom',
    label: `Custom (${basename(dir)})`,
    build: version,
    dir,
    serverPath: exe,
    ...(existsSync(join(dir, BENCH_EXE)) ? { benchPath: join(dir, BENCH_EXE) } : {}),
    devices,
    version,
    custom: true,
    installedAt: new Date().toISOString(),
  }
  // The record goes in OUR folder: the user's directory is theirs, and
  // writing a pack.json into it would be a surprise.
  const recordDir = join(runtimesDir(), installed.id)
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(
    packJsonPath(recordDir),
    JSON.stringify(installed, null, 2),
    'utf8',
  )
  return installed
}

export function removePack(id: string): void {
  const record = join(runtimesDir(), id)
  const pack = listInstalled().find((p) => p.id === id)
  // A custom pack points at the user's own folder — remove our record of it,
  // never their files.
  if (pack?.custom) rmSync(record, { recursive: true, force: true })
  else rmSync(record, { recursive: true, force: true })
}

/**
 * Which pack to run when the user has not chosen.
 *
 * Prefer one that actually found a GPU; fall back to CPU. On this machine
 * that picks Vulkan, which measured 4.48 tok/s against the CPU pack's 2.8.
 */
export function pickDefault(packs: InstalledPack[]): InstalledPack | undefined {
  return (
    packs.find((p) => p.devices.length > 0) ??
    packs.find((p) => p.backendId === 'cpu') ??
    packs[0]
  )
}

export function backendLabel(id: BackendId): string {
  return backendById(id)?.label ?? id
}

/**
 * The newest llama.cpp build, resolved without the GitHub API.
 *
 * See runtimes/releases.ts for why: the API is capped at sixty
 * unauthenticated requests an hour per IP, and hitting that shows the user a
 * 403 they did not cause and cannot fix.
 */
export async function fetchLatestRelease(
  backends: BackendSpec[],
  token?: string,
): Promise<Release> {
  return resolveLatestRelease(backends, token)
}
