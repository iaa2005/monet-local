/**
 * The brand colour, and the arithmetic that keeps it legible.
 *
 * The brand is orange: `oklch(67.1967% 0.201986 42.2057)` = `#f65e00` =
 * `hsl(23 100% 48%)`. globals.css spells it in HSL because the whole token
 * set is HSL triplets — `hsl(var(--brand) / 0.28)` for the selection wash,
 * `hsl(var(--brand-hue) 91% 83.5%)` for the edge — and mixing colour spaces
 * across those would mean rewriting every one of them.
 *
 * Why a module and not just CSS: the mark and the link cannot be the same
 * orange. Measured here, on the light canvas (#f6f6f6):
 *
 *   brand  #f65e00   2.98:1   fine for large glyphs and fills, fails AA text
 *   link   #c24a00   4.55:1   clears AA (4.5:1)
 *
 * Dark canvas (#181818) needs no such split — the brand lifted to 55%
 * lightness measures 6.45:1 there, so mark and link share it.
 *
 * Code Monet derives everything from one number (`--brand-hue: 211`) and
 * checks it with scripts/brand-hue-probe.cjs at runtime. Same idea, moved
 * into a pure function so `npm test` catches a regression without launching
 * Electron: change a lightness in globals.css, forget to check, and
 * brand.test.ts fails.
 */

export const BRAND_HUE = 23

/**
 * HSL triplets, exactly as globals.css declares them.
 *
 * The light brand's lightness is 48.2 and not a round 48 for a reason the
 * test below pins down: 48 rounds to #f55e00, one step off the requested
 * colour. Invisible, and wrong — so the digit stays.
 */
export const BRAND = {
  light: { brand: [BRAND_HUE, 100, 48.2], link: [BRAND_HUE, 100, 38] },
  dark: { brand: [BRAND_HUE, 100, 55], link: [BRAND_HUE, 100, 55] },
} as const

/** The canvas each is measured against — `--bg-100` in globals.css. */
export const CANVAS = {
  light: [0, 0, 96.6],
  dark: [0, 0, 9.4],
} as const

export type Hsl = readonly [number, number, number]

export function hslToRgb([h, s, l]: Hsl): [number, number, number] {
  const S = s / 100
  const L = l / 100
  const c = (1 - Math.abs(2 * L - 1)) * S
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = L - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** WCAG relative luminance. */
export function luminance(hsl: Hsl): number {
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = hslToRgb(hsl)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two colours, 1…21. */
export function contrast(a: Hsl, b: Hsl): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/** AA for body text. Links must clear this on their canvas. */
export const AA_TEXT = 4.5
