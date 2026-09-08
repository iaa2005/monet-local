import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import katex from 'katex'
import { Button } from '@/components/ui/button'
import { Card, ClickRow, Page, PageHeader, Section } from '@/components/ui/page'
import { HANDBOOK_EN } from '@/handbook/en'
import { HANDBOOK_RU } from '@/handbook/ru'
import type { Block, Chapter, Topic } from '@/handbook/types'

/**
 * The figures, as raw SVG.
 *
 * Inlined rather than `<img src>` because they are drawn in `currentColor`
 * and `hsl(var(--brand))`: an image in its own document cannot see this
 * one's custom properties, and would come out black on black in the dark
 * theme.
 */
const FIGURES = import.meta.glob('../handbook/figures/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function figure(id: string): string | undefined {
  const key = Object.keys(FIGURES).find((k) => k.endsWith(`/${id}.svg`))
  // The XML declaration is not valid inside an HTML document; the LaTeX
  // source that follows it is a comment and stays.
  return key ? FIGURES[key]!.replace(/<\?xml[^?]*\?>\s*/, '') : undefined
}
import { cn } from '@/lib/utils'
import { useT, useUi } from '@/stores/uiStore'

/**
 * The handbook.
 *
 * Inside the program rather than a link to one, because the whole point is
 * that a paragraph can end with "and that is the number the Server screen
 * calls KV cache". A tab is the only place that sentence is worth writing.
 *
 * Contents first, one topic at a time after: this is a reference people
 * arrive at with a question, not a book anyone reads front to back in a
 * window this size.
 */
export function Handbook(): JSX.Element {
  const t = useT()
  const locale = useUi((s) => s.prefs.locale)
  const chapters = locale === 'ru' ? HANDBOOK_RU : HANDBOOK_EN
  const [openId, setOpenId] = useState<string | null>(null)

  // The reading order, flattened, so "next" can cross a chapter boundary
  // without the reader being sent back to the contents to do it by hand.
  const flat = useMemo(
    () =>
      chapters.flatMap((c) => c.topics.map((topic) => ({ chapter: c, topic }))),
    [chapters],
  )
  const at = flat.findIndex((x) => x.topic.id === openId)
  const current = at >= 0 ? flat[at] : undefined

  if (current) {
    return (
      <Page>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t('handbook.contents')}
        </button>

        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {current.chapter.title}
        </div>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-tight">
          {current.topic.title}
        </h1>

        <article className="mt-6 max-w-[68ch]">
          {current.topic.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </article>

        {/* Same column as the prose. Left to the page width these sat out
            past the right edge of every line they follow, which reads as a
            layout accident rather than as the end of the article. */}
        <div className="mt-10 flex max-w-[68ch] items-center justify-between gap-3 border-t border-border pt-4">
          <Nav
            side="prev"
            entry={flat[at - 1]}
            onGo={setOpenId}
            label={t('handbook.prev')}
          />
          <Nav
            side="next"
            entry={flat[at + 1]}
            onGo={setOpenId}
            label={t('handbook.next')}
          />
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader title="handbook.title" blurb="handbook.blurb" />
      {chapters.map((c) => (
        <Section key={c.id} title={c.title}>
          <p className="-mt-1 mb-3 text-sm text-muted-foreground">{c.blurb}</p>
          <Card>
            {c.topics.map((topic) => (
              <ClickRow key={topic.id} onClick={() => setOpenId(topic.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{topic.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {topic.blurb}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </ClickRow>
            ))}
          </Card>
        </Section>
      ))}
    </Page>
  )
}

function Nav({
  side,
  entry,
  label,
  onGo,
}: {
  side: 'prev' | 'next'
  entry: { chapter: Chapter; topic: Topic } | undefined
  label: string
  onGo: (id: string) => void
}): JSX.Element {
  if (!entry) return <span />
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-auto max-w-[46%] flex-col items-start gap-0 py-1.5 text-left"
      onClick={() => onGo(entry.topic.id)}
    >
      <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-sm">
        {side === 'prev' ? '← ' : ''}
        {entry.topic.title}
        {side === 'next' ? ' →' : ''}
      </span>
    </Button>
  )
}

function BlockView({ block: b }: { block: Block }): JSX.Element {
  switch (b.k) {
    case 'h':
      return (
        <h2 className="mt-8 font-display text-lg font-semibold tracking-tight">
          {b.t}
        </h2>
      )
    case 'p':
      return (
        <p className="mt-3 text-[15px] leading-relaxed">
          <Rich text={b.t} />
        </p>
      )
    case 'ul':
      return (
        <ul className="mt-3 space-y-1.5 text-[15px] leading-relaxed">
          {b.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground">·</span>
              <span>
                <Rich text={item} />
              </span>
            </li>
          ))}
        </ul>
      )
    case 'math':
      return (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card px-4 py-3">
          <Tex tex={b.tex} display />
          {b.note ? (
            <p className="mt-2 text-xs text-muted-foreground">
              <Rich text={b.note} />
            </p>
          ) : null}
        </div>
      )
    case 'app':
      return (
        <div className="mt-4 rounded-xl border border-brand-edge bg-brand-wash px-4 py-3 text-[14px] leading-relaxed">
          <Rich text={b.t} />
        </div>
      )
    case 'fig': {
      const svg = figure(b.id)
      if (!svg) return <></>
      return (
        <figure className="mt-5">
          <div
            className="rounded-xl border border-border bg-card px-4 py-4 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <figcaption className="mt-2 text-xs text-muted-foreground">
            <Rich text={b.caption} />
          </figcaption>
        </figure>
      )
    }
    case 'table':
      return (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {b.head.map((h, i) => (
                  <th
                    key={i}
                    className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, i) => (
                <tr key={i} className="border-b border-border/60">
                  {row.map((cell, j) => (
                    <td key={j} className="px-2 py-1.5 align-top">
                      <Rich text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/** KaTeX, rendered to a string once and handed over. */
function Tex({ tex, display }: { tex: string; display?: boolean }): JSX.Element {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display ?? false,
        throwOnError: false,
        // The handbook's own source is the only input here, so this is not
        // a sanitiser question; `false` keeps a mistyped macro from
        // rendering as a red error in the middle of a sentence.
        strict: false,
      })
    } catch {
      return tex
    }
  }, [tex, display])
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * The whole of the inline markup: `$maths$`, `` `code` `` and `**bold**`.
 *
 * A regex split rather than a parser. The alternative is a markdown
 * dependency, its sanitiser and a theme for it, to get three things.
 */
function Rich({ text }: { text: string }): JSX.Element {
  const parts = useMemo(
    () => text.split(/(\$[^$]+\$|`[^`]+`|\*\*[^*]+\*\*)/g),
    [text],
  )
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          return <Tex key={i} tex={part.slice(1, -1)} />
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <b key={i} className="font-semibold">
              {part.slice(2, -2)}
            </b>
          )
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code
              key={i}
              className={cn(
                'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]',
              )}
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
