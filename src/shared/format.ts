/**
 * Sizes, the way the app says them everywhere.
 *
 * Binary units, because that is what every number in this domain is: a GGUF
 * header, a device's memory report, a KV cache. Mixing decimal GB into that
 * is how "GPU 17.24 GB" ends up next to "18287 MiB" meaning the same thing.
 */

export function bytes(n: number | undefined, digits = 1): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`
}

/** Context lengths, which are always powers of two and always long. */
export function tokens(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`
  return n.toLocaleString('en-US')
}
