import { useState } from 'react'
import { FLAGS, GROUP_ORDER } from '@shared/flags/registry.js'
import type {
  FlagDef,
  FlagLevel,
  Hardware,
  Profile,
} from '@shared/flags/types.js'
import type { StringKey } from '@shared/i18n.js'
import { tokens } from '@shared/format.js'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { useT, useUi } from '@/stores/uiStore'

const LEVELS: FlagLevel[] = ['basic', 'advanced', 'expert']

/**
 * The form, generated from the registry.
 *
 * Every control here is a registry entry: label, help, type and bounds all
 * come from the same object the command line is built from, so a flag cannot
 * appear in the form and be missing from what runs.
 */
export function ProfilePanel({
  values,
  hardware,
  onChange,
}: {
  values: Profile
  hardware: Hardware
  onChange: (next: Profile) => void
}): JSX.Element {
  const t = useT()
  const locale = useUi((s) => s.prefs.locale)
  const [level, setLevel] = useState<FlagLevel>('basic')

  const allowed = LEVELS.slice(0, LEVELS.indexOf(level) + 1)
  const set = (id: string, v: Profile[string]): void =>
    onChange({ ...values, [id]: v })

  return (
    <div>
      <Segmented
        value={level}
        options={LEVELS.map((l) => ({
          value: l,
          label: t(`flags.level.${l}` as StringKey),
        }))}
        onChange={setLevel}
      />

      {GROUP_ORDER.map((group) => {
        const flags = Object.entries(FLAGS).filter(
          ([, d]) =>
            d.group === group &&
            allowed.includes(d.level) &&
            (d.visibleWhen?.(values, hardware) ?? true),
        )
        if (!flags.length) return null
        return (
          <section key={group} className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              {t(`flags.group.${group}` as StringKey)}
            </h3>
            <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {flags.map(([id, def]) => (
                <Field
                  key={id}
                  id={id}
                  def={def}
                  value={values[id]}
                  recommended={def.recommendWhen?.(values, hardware) ?? false}
                  locale={locale}
                  onChange={(v) => set(id, v)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Field({
  def,
  value,
  recommended,
  locale,
  onChange,
}: {
  id: string
  def: FlagDef
  value: Profile[string]
  recommended: boolean
  locale: 'en' | 'ru'
  onChange: (v: Profile[string]) => void
}): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-left text-sm"
        >
          {def.label[locale]}
          {recommended ? (
            <span className="ml-2 rounded-sm bg-brand-wash px-1.5 py-0.5 text-[11px]">
              {t('flags.recommended')}
            </span>
          ) : null}
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">
            {def.cli}
          </span>
        </button>
        <Control def={def} value={value} onChange={onChange} />
      </div>
      {/* The help is the product; it is one click away rather than always on,
          because forty paragraphs at once is its own kind of unhelpful. */}
      {open ? (
        <p className="mt-2 max-w-prose text-xs text-muted-foreground">
          {def.help[locale]}
        </p>
      ) : null}
    </div>
  )
}

function Control({
  def,
  value,
  onChange,
}: {
  def: FlagDef
  value: Profile[string]
  onChange: (v: Profile[string]) => void
}): JSX.Element {
  const input =
    'h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  if (def.type === 'bool') {
    const on = value === true
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cn(
          'relative h-[22px] w-10 shrink-0 rounded-full border transition-colors',
          on ? 'border-brand bg-brand' : 'border-brand/60 bg-brand-wash',
        )}
      >
        <span
          className={cn(
            'absolute top-[1px] size-[18px] rounded-full bg-white shadow transition-all',
            on ? 'left-[19px]' : 'left-[1px]',
          )}
        />
      </button>
    )
  }

  if (def.type === 'enum') {
    return (
      <select
        className={input}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">—</option>
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  if (def.type === 'int' && def.scale) {
    // Context is a ladder, not a free number: the values between the powers
    // of two are never what anyone wants and every one of them changes the
    // memory verdict.
    return (
      <select
        className={input}
        value={String(value ?? '')}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {def.scale.map((n) => (
          <option key={n} value={n}>
            {tokens(n)}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      className={cn(input, 'w-28')}
      type={def.type === 'int' ? 'number' : 'text'}
      value={value === undefined ? '' : String(value)}
      placeholder={def.type === 'string' ? def.placeholder : ''}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') return onChange(undefined)
        onChange(def.type === 'int' ? Number(raw) : raw)
      }}
    />
  )
}
