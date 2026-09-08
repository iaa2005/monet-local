import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** A second line, for what the option costs or where it came from. */
  hint?: string
}

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
  const [up, setUp] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const index = options.findIndex((o) => o.value === value)
  const current = index >= 0 ? options[index] : undefined

  // Anywhere else on the page closes it — including inside another control,
  // which is why this is pointerdown on the document and not a blur handler.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // Before the browser paints, so a list that would fall off the bottom of
  // the window never appears there first and jumps.
  useLayoutEffect(() => {
    if (!open) return
    setActive(index >= 0 ? index : 0)
    const box = root.current?.getBoundingClientRect()
    if (box) setUp(window.innerHeight - box.bottom < 240 && box.top > 240)
  }, [open, index])

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

      {open ? (
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
          className={cn(
            'absolute z-50 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg outline-none',
            up ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
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
        </div>
      ) : null}
    </div>
  )
}
