/**
 * The handbook's content model.
 *
 * Data, not JSX, so the same structure carries both languages and the
 * screen has one renderer to keep right. The blocks are deliberately few:
 * a handbook that needs a tenth kind of block usually needs an editor
 * instead.
 *
 * Inline markup inside `t` is three characters wide: `$x$` is maths, and
 * `` `--flag` `` is code. Anything more would be a markdown parser, and a
 * markdown parser is a dependency plus a sanitiser plus a theme.
 */

export type Block =
  /** A paragraph. May contain `$maths$` and `` `code` ``. */
  | { k: 'p'; t: string }
  /** A sub-heading inside a topic. */
  | { k: 'h'; t: string }
  /** Display maths, optionally with a line naming what the letters are. */
  | { k: 'math'; tex: string; note?: string }
  | { k: 'ul'; items: string[] }
  /**
   * An aside tying the theory to this app: the flag it corresponds to, the
   * number it explains. The reason for a handbook inside the program rather
   * than a link to one.
   */
  | { k: 'app'; t: string }
  | { k: 'table'; head: string[]; rows: string[][] }
  /**
   * A figure, by the name of its file in `figures/`. Drawn in TikZ and
   * compiled to SVG by `npm run figures`; the `.tex` beside each one is the
   * source, and it is embedded in the SVG as a comment so the two cannot be
   * separated.
   */
  | { k: 'fig'; id: string; caption: string }

export interface Topic {
  id: string
  title: string
  /** One line, shown in the contents. */
  blurb: string
  blocks: Block[]
}

export interface Chapter {
  id: string
  title: string
  blurb: string
  topics: Topic[]
}
