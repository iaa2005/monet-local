import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  id: string
  label: string
  /** A second line: what it will do, or what it costs. */
  hint?: string
  disabled?: boolean
  onSelect: () => void
}

const GAP = 4
const MARGIN = 8

/**
 * A small trigger that opens a list of actions.
 *
 * The same portal as the Select and for the same reason: every card is
 * `overflow-hidden`, and a list that opens inside one is cut off at the
 * card's last row. Fixed and measured, so it can hang below the trigger or
 * rise above it when the window's bottom is close.
 *
 * Right-aligned to its trigger rather than left, because it lives at the
 * end of a row: opening to the right would put it off the card.
 */
export function MenuButton({
  items,
  disabled,
  title,
  className,
}: {
  items: MenuItem[]
  disabled?: boolean
  title?: string
  className?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{
    right: number
    top?: number
    bottom?: number
  } | null>(null)
  const root = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const place = useCallback((): void => {
    const box = root.current?.getBoundingClientRect()
    if (!box) return
    const below = window.innerHeight - box.bottom - GAP - MARGIN
    const up = below < 160 && box.top > below
    setAnchor({
      right: window.innerWidth - box.right,
      ...(up
        ? { bottom: window.innerHeight - box.top + GAP }
        : { top: box.bottom + GAP }),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !list.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    setActive(items.findIndex((i) => !i.disabled))
    place()
  }, [open, items, place])

  useEffect(() => {
    if (!open) return
    const follow = (): void => place()
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    list.current?.focus()
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open, place])

  const pick = (i: number): void => {
    const item = items[i]
    if (!item || item.disabled) return
    setOpen(false)
    item.onSelect()
  }

  return (
    <>
      <button
        ref={root}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={cn(
          'inline-flex h-8 items-center justify-center rounded-lg border border-input bg-background px-1.5 text-sm transition-colors',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
      >
        <ChevronDown
          className={cn(
            'size-3.5 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && anchor
        ? createPortal(
            <div
              ref={list}
              role="menu"
              tabIndex={-1}
              // Clicks inside must not reach the row behind the portal: a
              // menu that lives in a selectable row would select it.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') return setOpen(false)
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  return pick(active)
                }
                const move = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                if (move) {
                  e.preventDefault()
                  setActive((i) => Math.min(items.length - 1, Math.max(0, i + move)))
                }
              }}
              style={{
                position: 'fixed',
                right: anchor.right,
                ...(anchor.top !== undefined ? { top: anchor.top } : {}),
                ...(anchor.bottom !== undefined ? { bottom: anchor.bottom } : {}),
              }}
              className="z-50 min-w-64 max-w-sm rounded-lg border border-border bg-popover p-1 shadow-lg outline-none"
            >
              {items.map((item, i) => (
                <div
                  key={item.id}
                  role="menuitem"
                  aria-disabled={item.disabled}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn(
                    'cursor-pointer rounded-md px-2 py-1.5 text-sm',
                    i === active && !item.disabled && 'bg-accent',
                    item.disabled && 'cursor-default opacity-50',
                  )}
                >
                  <span className="block">{item.label}</span>
                  {item.hint ? (
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {item.hint}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
