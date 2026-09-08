/**
 * TikZ sources → SVG, once, by hand.
 *
 * `npm run figures`. NOT part of `npm run build`: a TeX installation is a
 * gigabyte and a half and has no business being a requirement for building
 * this app, so the SVGs are generated here and committed. The `.tex` next to
 * each one is the source of truth — edit that, run this, commit both.
 *
 * The pipeline is `latex` → DVI → `dvisvgm --no-fonts`, which turns every
 * glyph into a path. That is the point: the figures carry real LaTeX
 * typesetting for their labels and need no font shipped with the app to
 * render it.
 *
 * Two colours survive into the output and both are rewritten here:
 *   black  → `currentColor`, so a figure follows the text colour and is
 *            right in either theme without a second copy;
 *   #f0f   → the brand, for the one thing the figure is about.
 * Anything else a figure needs, it gets with `opacity`, which dvisvgm emits
 * as a group attribute and which needs no rewriting.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = 'src/renderer/handbook/figures'

/** Sources beginning with `_` are includes, not figures. */
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.tex') && !f.startsWith('_'))
  .sort()

const only = process.argv[2]
let built = 0
let skipped = 0

for (const tex of sources) {
  const name = basename(tex, '.tex')
  if (only && name !== only) continue
  const out = join(DIR, `${name}.svg`)
  const src = join(DIR, tex)

  // Cheap rebuild check: the .tex, and the shared preamble it includes.
  if (existsSync(out)) {
    const age = statSync(out).mtimeMs
    // This script counts as an input: it decides the colours.
    const inputs = [
      src,
      join(DIR, '_preamble.tex'),
      fileURLToPath(import.meta.url),
    ].filter(existsSync)
    if (inputs.every((f) => statSync(f).mtimeMs <= age)) {
      skipped++
      continue
    }
  }

  const work = mkdtempSync(join(tmpdir(), 'monet-fig-'))
  try {
    copyFileSync(src, join(work, tex))
    for (const extra of readdirSync(DIR).filter((f) => f.startsWith('_'))) {
      copyFileSync(join(DIR, extra), join(work, extra))
    }
    execFileSync('latex', ['-interaction=nonstopmode', '-halt-on-error', tex], {
      cwd: work,
      stdio: 'pipe',
    })
    execFileSync(
      'dvisvgm',
      ['--no-fonts', '--exact', '--bbox=papersize', `${name}.dvi`, '-o', `${name}.svg`],
      { cwd: work, stdio: 'pipe' },
    )

    let svg = readFileSync(join(work, `${name}.svg`), 'utf8')

    // Follow the theme rather than the page it was typeset on.
    svg = svg
      .replace(/(fill|stroke)='#f0f(0ff)?'/gi, "$1='hsl(var(--brand))'")
      // A white fill is the paper showing through; there is no paper here.
      .replace(/(fill|stroke)='#fff(fff)?'/g, "$1='none'")
      // Every neutral grey is structure - black, and whatever pgfplots
      // reaches for on its own for ticks and rules. Matched as "all three
      // channels equal" rather than by listing the shades it uses today.
      .replace(/(fill|stroke)='#([0-9a-f])\2\2'/gi, "$1='currentColor'")
      .replace(/(fill|stroke)='#([0-9a-f]{2})\2\2'/gi, "$1='currentColor'")

    // Scale to the column instead of to the point size LaTeX chose.
    svg = svg.replace(
      /<svg([^>]*?)width='[^']*'\s+height='[^']*'/,
      "<svg$1width='100%'",
    )

    // The source, kept where it cannot drift away from its output.
    const source = readFileSync(src, 'utf8').replace(/--/g, '- -')
    svg = svg.replace(
      /<\?xml[^?]*\?>\n?/,
      `<?xml version='1.0' encoding='UTF-8'?>\n<!--\n  Generated from ${tex} by scripts/build-figures.mjs. Do not edit.\n\n${source}\n-->\n`,
    )

    writeFileSync(out, svg, 'utf8')
    built++
    console.log(`  ${name}.svg  ${(svg.length / 1024).toFixed(1)} kB`)
  } catch (err) {
    const log = join(work, `${name}.log`)
    const detail = existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((l) => l.startsWith('!') || l.startsWith('l.'))
          .slice(0, 8)
          .join('\n')
      : String(err)
    console.error(`\n${name}: FAILED\n${detail}\n`)
    process.exitCode = 1
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
console.log(`figures: ${built} built, ${skipped} already current`)
