import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** A second line, for what the option costs or where it came from. */
  hint?: string
}

/** Where the open list goes, in viewport coordinates. */
interface Anchor {
  left: number
  width: number
  /** Set for a list that hangs below the button. */
  top?: number
  /** Set for one that rises above it. */
  bottom?: number
  maxHeight: number
}

const GAP = 4
const MARGIN = 8

/**
 * A dropdown that belongs to this app.
 *
 * The native control is a different program's widget: Windows draws it in
 * its own font at its own size with its own hover colour, so one row of a
 * form built out of `<select>` looked nothing like the row above it.
 *
 * Everything the native one gives away for free has to be paid for here, and
 * the list is short but not optional: the keyboard (arrows, Home/End, Enter,
 * Escape), closing on a click elsewhere, scrolling the highlighted row into
 * view, and opening upwards when there is no room below.
 *
 * The list is a portal, and that is the one thing here that is not cosmetic.
 * Every card in this app is `overflow-hidden` — rows inside paint their own
 * backgrounds and would otherwise square off its rounded corners — and an
 * absolutely positioned list inside such a card is clipped by it: the options
 * that fell past the card's last row were cut in half. A portal has no
 * ancestor to be clipped by, which is why the position here is measured and
 * fixed rather than inherited.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  placeholder,
  disabled,
}: {
  value: T | undefined
  options: SelectOption<T>[]
  onChange: (v: T) => void
  className?: string
  placeholder?: string
  disabled?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const index = options.findIndex((o) => o.value === value)
  const current = index >= 0 ? options[index] : undefined

  const place = useCallback((): void => {
    const box = root.current?.getBoundingClientRect()
    if (!box) return
    const below = window.innerHeight - box.bottom - GAP - MARGIN
    const above = box.top - GAP - MARGIN
    // Downwards unless the list would be cramped there and roomier above.
    const up = below < Math.min(240, above)
    setAnchor({
      left: box.left,
      width: box.width,
      ...(up
        ? { bottom: window.innerHeight - box.top + GAP }
        : { top: box.bottom + GAP }),
      maxHeight: Math.max(96, Math.min(240, up ? above : below)),
    })
  }, [])

  // Anywhere else on the page closes it — including inside another control,
  // which is why this is pointerdown on the document and not a blur handler.
  // The list is no longer a descendant of the button, so it needs its own
  // half of the test.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !list.current?.contains(t)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // Before the browser paints, so a list that would fall off the bottom of
  // the window never appears there first and jumps.
  useLayoutEffect(() => {
    if (!open) return
    setActive(index >= 0 ? index : 0)
    place()
  }, [open, index, place])

  // A fixed list does not travel with the page under it. Following the
  // button costs one measurement per scroll; the alternative is a list that
  // detaches from its own control, which looks broken.
  useEffect(() => {
    if (!open) return
    const follow = (): void => place()
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    // Focus the list so the arrows reach it rather than scrolling the page
    // behind it.
    list.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const pick = (i: number): void => {
    const o = options[i]
    if (!o) return
    onChange(o.value)
    setOpen(false)
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
            if (!open) {
              e.preventDefault()
              setOpen(true)
            }
          }
        }}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm transition-colors',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <span className={cn('flex-1 truncate', !current && 'text-muted-foreground')}>
          {current?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && anchor
        ? createPortal(
            <div
              ref={list}
              role="listbox"
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.key === 'Escape') return setOpen(false)
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  return pick(active)
                }
                const move =
                  e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                if (move) {
                  e.preventDefault()
                  setActive((i) =>
                    Math.min(options.length - 1, Math.max(0, i + move)),
                  )
                }
                if (e.key === 'Home') {
                  e.preventDefault()
                  setActive(0)
                }
                if (e.key === 'End') {
                  e.preventDefault()
                  setActive(options.length - 1)
                }
              }}
              style={{
                position: 'fixed',
                left: anchor.left,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
                ...(anchor.top !== undefined ? { top: anchor.top } : {}),
                ...(anchor.bottom !== undefined ? { bottom: anchor.bottom } : {}),
              }}
              className="z-50 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg outline-none"
            >
              {options.map((o, i) => (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    i === active && 'bg-accent',
                    o.value === value && 'bg-brand-wash',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {o.hint}
                      </span>
                    ) : null}
                  </span>
                  {o.value === value ? (
                    <Check className="size-3.5 shrink-0 text-brand" />
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
