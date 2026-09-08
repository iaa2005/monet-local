import { cn } from '@/lib/utils'

/**
 * A row of mutually exclusive choices — theme, language, later the flag
 * levels. A segmented control rather than a `<select>` because these sets are
 * two or three items long and the options are worth seeing at rest.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}): JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex rounded-md border border-input bg-background p-0.5',
        className,
      )}
      role="radiogroup"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[calc(var(--radius-md)-2px)] px-3 py-1 text-sm transition-colors',
            value === o.value
              ? 'bg-brand-wash text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
