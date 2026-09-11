/**
 * How fast this machine's memory is — the number that decides generation
 * speed, and the one nobody has to hand.
 *
 * A dense model reads every weight for every token, so tokens per second is
 * bandwidth divided by weights. Bandwidth is not something an app can
 * measure cheaply (a real measurement means a benchmark run), but it is
 * something the firmware states: the modules' transfer rate and how many of
 * them are populated. DDR moves eight bytes per channel per transfer, and a
 * populated module is a channel on every consumer board this would run on.
 *
 * Asked once and remembered. It cannot change while the app is open — a DIMM
 * is not hot-pluggable — and the query is a process spawn.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { ddrBandwidth } from '@shared/models/speed.js'

const run = promisify(exec)

export interface MemorySpeed {
  /** Transfers per second, in MT/s, as the modules report. */
  mtPerSecond: number
  /** Populated modules, taken as channels. */
  channels: number
  bytesPerSecond: number
  /** False when nothing could be read and the figure below is a default. */
  measured: boolean
}

/**
 * What to assume when the firmware will not say.
 *
 * DDR5-5600 in two channels: a current laptop, and the machine this was
 * written on. Wrong on a desktop with four sticks (it will under-promise)
 * and wrong on an older DDR4 machine (it will over-promise), which is why
 * `measured` says which it is and the UI can too.
 */
const FALLBACK: MemorySpeed = {
  mtPerSecond: 5600,
  channels: 2,
  bytesPerSecond: ddrBandwidth(5600, 2),
  measured: false,
}

let cached: MemorySpeed | null = null

/** Windows: the modules, their configured rate, and how many are populated. */
async function readWindows(): Promise<MemorySpeed | null> {
  const { stdout } = await run(
    'powershell -NoProfile -NonInteractive -Command ' +
      '"Get-CimInstance Win32_PhysicalMemory | ' +
      'Select-Object ConfiguredClockSpeed,Speed | ConvertTo-Csv -NoTypeInformation"',
  )
  const rows = stdout
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.match(/^"?(\d*)"?,"?(\d*)"?/))
    .filter((m): m is RegExpMatchArray => !!m)
    // The CONFIGURED rate is what the memory actually runs at; `Speed` is what
    // the module is rated for, and an XMP kit at stock reports the two
    // differently. Prefer the truth over the sticker.
    .map((m) => Number(m[1]) || Number(m[2]) || 0)
    .filter((v) => v > 0)
  if (rows.length === 0) return null
  const mtPerSecond = Math.min(...rows)
  const channels = rows.length
  return {
    mtPerSecond,
    channels,
    bytesPerSecond: ddrBandwidth(mtPerSecond, channels),
    measured: true,
  }
}

/**
 * Apple silicon: the bandwidth is a property of the chip, and Apple states
 * it. No module to read, no channel count that means anything — the number
 * itself is the fact, so it is looked up by the chip's name.
 *
 * Figures as Apple publishes them, in GB/s. A chip not in the table gets
 * the fallback, labelled as such, rather than a neighbour's number.
 */
const APPLE_BANDWIDTH_GBPS: [RegExp, number][] = [
  [/\bM1 Ultra\b/, 800],
  [/\bM1 Max\b/, 400],
  [/\bM1 Pro\b/, 200],
  [/\bM1\b/, 68.25],
  [/\bM2 Ultra\b/, 800],
  [/\bM2 Max\b/, 400],
  [/\bM2 Pro\b/, 200],
  [/\bM2\b/, 100],
  [/\bM3 Ultra\b/, 800],
  [/\bM3 Max\b/, 300],
  [/\bM3 Pro\b/, 150],
  [/\bM3\b/, 100],
  [/\bM4 Max\b/, 410],
  [/\bM4 Pro\b/, 273],
  [/\bM4\b/, 120],
  [/\bM5\b/, 153],
]

export function appleBandwidth(brand: string): number | null {
  const hit = APPLE_BANDWIDTH_GBPS.find(([re]) => re.test(brand))
  return hit ? hit[1] * 1e9 : null
}

async function readDarwin(): Promise<MemorySpeed | null> {
  const { stdout } = await run('sysctl -n machdep.cpu.brand_string')
  const bytesPerSecond = appleBandwidth(stdout.trim())
  if (bytesPerSecond === null) return null
  // LPDDR5 on one wide bus: expressed as "one channel at the rate that
  // gives this bandwidth", so the rest of the app can keep dividing by
  // 8 bytes × MT/s without a special case.
  return { mtPerSecond: Math.round(bytesPerSecond / 8 / 1e6), channels: 1, bytesPerSecond, measured: true }
}

/** Linux: dmidecode needs root, so this reads what a user can read. */
async function readLinux(): Promise<MemorySpeed | null> {
  const { stdout } = await run('lscpu 2>/dev/null || true')
  // Nothing in /proc states the transfer rate. Rather than parse a vendor
  // string into a guess, say nothing and let the fallback be labelled.
  return stdout ? null : null
}

export async function memorySpeed(): Promise<MemorySpeed> {
  if (cached) return cached
  try {
    const read =
      process.platform === 'win32'
        ? await readWindows()
        : process.platform === 'darwin'
          ? await readDarwin()
          : process.platform === 'linux'
            ? await readLinux()
            : null
    cached = read ?? FALLBACK
  } catch {
    cached = FALLBACK
  }
  return cached
}

/** The last answer, without waiting. FALLBACK until the first real read. */
export function memorySpeedNow(): MemorySpeed {
  return cached ?? FALLBACK
}
