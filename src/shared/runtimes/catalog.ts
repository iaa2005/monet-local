/**
 * Which llama.cpp build to fetch for which hardware.
 *
 * The runtime manager knows nothing about any backend beyond a row here:
 * an asset name pattern, an optional second archive, and a label. Adding
 * ROCm or SYCL support is adding a row — which is the only honest way to
 * support hardware nobody on the project has (see docs/PLAN.md §6).
 *
 * `ggml-org/llama.cpp` names its Windows assets
 * `llama-<build>-bin-win-<backend>-<arch>.zip`; the CUDA packs need a second
 * archive carrying the CUDA runtime DLLs, named `cudart-llama-bin-win-…`
 * with no build number in it.
 */

export type BackendId =
  | 'cpu'
  | 'vulkan'
  | 'cuda-12.4'
  | 'cuda-13.3'
  | 'rocm'
  | 'sycl'
  | 'openvino'
  | 'opencl-adreno'
  | 'custom'

export interface BackendSpec {
  id: BackendId
  label: string
  /** `{build}` is substituted; matched case-insensitively against asset names. */
  asset: string
  /** A second archive extracted into the same folder (CUDA runtime DLLs). */
  extraAsset?: string
  platform: 'win32' | 'darwin' | 'linux'
  arch: 'x64' | 'arm64'
  /**
   * Ships inside the installer so a fresh install works with no network.
   * Vulkan covers every modern GPU; CPU is the fallback that always runs.
   */
  bundled?: boolean
  /**
   * No one on the project has this hardware. The UI says so rather than
   * implying a tested path.
   */
  untested?: boolean
  note?: { en: string; ru: string }
}

export const BACKENDS: BackendSpec[] = [
  {
    id: 'vulkan',
    label: 'Vulkan',
    asset: 'llama-{build}-bin-win-vulkan-x64.zip',
    platform: 'win32',
    arch: 'x64',
    bundled: true,
    note: {
      en: 'Works on virtually any GPU, integrated ones included.',
      ru: 'Работает почти на любой видеокарте, включая встроенные.',
    },
  },
  {
    id: 'cpu',
    label: 'CPU',
    asset: 'llama-{build}-bin-win-cpu-x64.zip',
    platform: 'win32',
    arch: 'x64',
    bundled: true,
    note: {
      en: 'No GPU at all. Always available, always the slowest.',
      ru: 'Без видеокарты. Есть всегда, работает медленнее всех.',
    },
  },
  {
    id: 'cuda-12.4',
    label: 'CUDA 12.4',
    asset: 'llama-{build}-bin-win-cuda-12.4-x64.zip',
    extraAsset: 'cudart-llama-bin-win-cuda-12.4-x64.zip',
    platform: 'win32',
    arch: 'x64',
    untested: true,
    note: {
      en: 'NVIDIA, for drivers older than the 13.x runtime.',
      ru: 'NVIDIA, для драйверов старее рантайма 13.x.',
    },
  },
  {
    id: 'cuda-13.3',
    label: 'CUDA 13.3',
    asset: 'llama-{build}-bin-win-cuda-13.3-x64.zip',
    extraAsset: 'cudart-llama-bin-win-cuda-13.3-x64.zip',
    platform: 'win32',
    arch: 'x64',
    untested: true,
    note: { en: 'NVIDIA, current drivers.', ru: 'NVIDIA, свежие драйверы.' },
  },
  {
    id: 'rocm',
    label: 'ROCm (HIP)',
    asset: 'llama-{build}-bin-win-rocm-10.0-x64.zip',
    platform: 'win32',
    arch: 'x64',
    untested: true,
    note: {
      en: 'AMD discrete cards. Vulkan is the safer choice unless you know you want this.',
      ru: 'Дискретные AMD. Если не уверены — надёжнее Vulkan.',
    },
  },
  {
    id: 'sycl',
    label: 'SYCL',
    asset: 'llama-{build}-bin-win-sycl-x64.zip',
    platform: 'win32',
    arch: 'x64',
    untested: true,
    note: {
      en: 'Intel GPUs. Needs the oneAPI runtime installed separately.',
      ru: 'Видеокарты Intel. Нужен отдельно установленный oneAPI runtime.',
    },
  },
  {
    id: 'openvino',
    label: 'OpenVINO',
    asset: 'llama-{build}-bin-win-openvino-2026.3.1-x64.zip',
    platform: 'win32',
    arch: 'x64',
    untested: true,
    note: {
      en: 'Intel CPUs, GPUs and NPUs.',
      ru: 'Процессоры, видеокарты и NPU от Intel.',
    },
  },
  {
    id: 'opencl-adreno',
    label: 'OpenCL (Adreno)',
    asset: 'llama-{build}-bin-win-opencl-adreno-arm64.zip',
    platform: 'win32',
    arch: 'arm64',
    untested: true,
    note: {
      en: 'Snapdragon laptops.',
      ru: 'Ноутбуки на Snapdragon.',
    },
  },
]

export function backendById(id: BackendId): BackendSpec | undefined {
  return BACKENDS.find((b) => b.id === id)
}

/** The packs that make sense on the machine the app is running on. */
export function backendsFor(
  platform: NodeJS.Platform,
  arch: string,
): BackendSpec[] {
  return BACKENDS.filter((b) => b.platform === platform && b.arch === arch)
}
