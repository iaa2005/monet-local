import { describe, expect, it } from 'vitest'
import { AA_TEXT, BRAND, CANVAS, contrast, hslToRgb } from './brand.js'

describe('brand', () => {
  it('is the requested orange', () => {
    // oklch(67.1967% 0.201986 42.2057) converts to #f65e00.
    const [r, g, b] = hslToRgb(BRAND.light.brand).map(Math.round)
    expect([r, g, b]).toEqual([246, 94, 0])
  })

  it('links clear AA on their canvas', () => {
    // The whole reason light has a separate, darker link: the brand itself
    // measures 2.98:1 here, which is fine for a fill and unreadable as text.
    expect(contrast(BRAND.light.link, CANVAS.light)).toBeGreaterThanOrEqual(
      AA_TEXT,
    )
    expect(contrast(BRAND.dark.link, CANVAS.dark)).toBeGreaterThanOrEqual(
      AA_TEXT,
    )
  })

  it('records why light needs the split', () => {
    // If someone "simplifies" light's link back to the brand, this is the
    // number they are choosing.
    expect(contrast(BRAND.light.brand, CANVAS.light)).toBeLessThan(AA_TEXT)
  })
})
