/**
 * What `llama-server --list-devices` says, turned into something the
 * estimator can budget against.
 *
 * Two lines matter and they come from different places:
 *
 *   ggml_vulkan: 0 = AMD Radeon 780M Graphics (AMD proprietary driver) | uma: 1 | fp16: 1 | …
 *     Available devices:
 *       Vulkan0: AMD Radeon 780M Graphics (18287 MiB, 17373 MiB free)
 *
 * The second gives the memory; only the first says `uma`, and that single bit
 * decides whether the memory is a separate pool or a slice of system RAM. Get
 * it wrong on an integrated GPU and the verdict adds 18 GB the machine does
 * not have — which is exactly the mistake LM Studio's estimate makes look
 * plausible ("GPU 17.24 GB, Total 28.37 GB" on a 29.76 GB machine).
 */

export interface Device {
  /** `Vulkan0`, `CUDA0`, `SYCL0` … — what `--device` takes. */
  id: string
  backend: string
  name: string
  totalBytes: number
  freeBytes: number
  /**
   * Unified memory: the device shares system RAM (every integrated GPU).
   * Undefined when the backend printed no `uma` field.
   */
  uma?: boolean
}

const DEVICE_LINE =
  /^\s*([A-Za-z]+)(\d+):\s*(.+?)\s*\((\d+)\s*MiB,\s*(\d+)\s*MiB free\)\s*$/

/**
 * Integrated GPUs, by the names their drivers give them.
 *
 * Only asked when the backend printed no `uma` field. SYCL on a Core Ultra
 * laptop lists `Intel(R) Arc(TM) Graphics` and nothing about its memory —
 * the same device Vulkan flags `uma: 1` — and without this the pack read
 * as a discrete 9 GB card: no UMA badge, and Auto's shared-heap rule off.
 * The discrete Intel parts carry a model number (`Arc(TM) A770`, `B580`,
 * `Arc Pro B70`); the integrated ones are `Arc(TM) Graphics`, `Arc(TM)
 * 140V/130V/140T`, `Iris(R) Xe`, `UHD`. AMD's are the `M`-suffixed Radeons
 * and the bare `Radeon(TM) Graphics`.
 */
const INTEGRATED = [
  /^Intel\(R\)\s+Arc\(TM\)\s+Graphics$/i,
  /^Intel\(R\)\s+Arc\(TM\)\s+1[0-9]0[VT]\b/i,
  /^Intel\(R\)\s+(Iris\(R\)\s+(Xe\s+|Plus\s+)?|UHD\s+|HD\s+)Graphics/i,
  /^AMD\s+Radeon\(TM\)\s+Graphics$/i,
  /^AMD\s+Radeon(\(TM\))?\s+\d{3}M\b/i,
  /^AMD\s+Radeon(\(TM\))?\s+8060S\b/i,
]

export function integratedByName(name: string): boolean {
  return INTEGRATED.some((re) => re.test(name.trim()))
}
const UMA_LINE = /^\s*ggml_\w+:\s*(\d+)\s*=\s*(.+?)\s*\|(.*)$/

export function parseDevices(output: string): Device[] {
  // Collect the uma flags first: they arrive on separate lines, before the
  // device list, and are matched to it by name.
  const uma = new Map<string, boolean>()
  for (const line of output.split(/\r?\n/)) {
    const m = UMA_LINE.exec(line)
    if (!m) continue
    const name = (m[2] ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
    const flag = /\buma:\s*(\d)/.exec(m[3] ?? '')
    if (flag) uma.set(name, flag[1] === '1')
  }

  const devices: Device[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = DEVICE_LINE.exec(line)
    if (!m) continue
    const [, backend = '', index = '0', name = '', total = '0', free = '0'] = m
    // Metal prints no `uma` line, and does not need to: Apple silicon has
    // one memory for the GPU and the CPU, always. Leaving it undefined
    // would have the estimator add the device's memory on top of the RAM
    // it is. SYCL prints none either, and it runs on the same Intel iGPU
    // that Vulkan calls `uma: 1` — so the name is asked when the banner
    // says nothing.
    const known =
      uma.get(name) ?? (backend === 'MTL' || integratedByName(name) ? true : undefined)
    devices.push({
      id: `${backend}${index}`,
      backend,
      name,
      totalBytes: Number(total) * 1024 * 1024,
      freeBytes: Number(free) * 1024 * 1024,
      ...(known !== undefined ? { uma: known } : {}),
    })
  }
  return devices
}

/**
 * Whether a pack found any hardware to run on.
 *
 * A Vulkan build on a machine with no Vulkan driver still starts and still
 * prints its banner — it just lists nothing. That is the difference between
 * "installed" and "usable", and it is what picks the default runtime.
 */
export function hasUsableDevice(devices: Device[]): boolean {
  return devices.length > 0
}
