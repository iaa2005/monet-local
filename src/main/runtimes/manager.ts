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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { unzipSync } from 'fflate'
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
 * folder deep; either way the binaries must end up beside their DLLs, so
 * paths are collapsed to their basename rather than preserved.
 */
function extractFlat(zip: Uint8Array, dir: string): void {
  const files = unzipSync(zip)
  mkdirSync(dir, { recursive: true })
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || data.length === 0) continue
    writeFileSync(join(dir, basename(name)), data)
  }
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
