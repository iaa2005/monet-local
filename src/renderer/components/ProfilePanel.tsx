import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { FLAGS, GROUP_ORDER } from '@shared/flags/registry.js'
import type {
  FlagDef,
  FlagLevel,
  Hardware,
  IntFlag,
  Profile,
} from '@shared/flags/types.js'
import { tokens } from '@shared/format.js'
import type { StringKey } from '@shared/i18n.js'
import { NumberSlider } from '@/components/ui/number-slider'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/page'
import { cn } from '@/lib/utils'
import { useT, useUi } from '@/stores/uiStore'

const LEVELS: FlagLevel[] = ['basic', 'advanced', 'expert']

/**
 * What the app fills in for a flag the user has not set.
 *
 * Every field that CAN be empty says what empty means. A blank projector box
 * next to a model that has one was the first thing the user pointed at: the
 * app knew the answer (it is beside the file) and showed a hole instead.
 */
export interface Effective {
  /** The projector the library found beside the selected model. */
  mmprojPath?: string
  /** The selected model's advertised ceiling — the context slider's top. */
  contextMax?: number
  /** What this machine has, so the threads dial stops at the real number. */
  cpuThreads?: number
  /** The model's layers, so "all of them" is where the track ends. */
  gpuLayers?: number
}

/**
 * A dial's real top end.
 *
 * The registry can only state a bound that holds everywhere; the useful one
 * depends on the model in front of the user and on the machine. A threads
 * slider running to 64 on an eight-core laptop is a worse control than no
 * slider at all.
 */
function ceilingFor(id: string, def: IntFlag, e: Effective): number {
  if (id === 'ctxSize' && e.contextMax) return e.contextMax
  if (id === 'threads' && e.cpuThreads) return e.cpuThreads
  if (id === 'nGpuLayers' && e.gpuLayers) return e.gpuLayers
  return def.max ?? 4096
}

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
  effective = {},
  onChange,
}: {
  values: Profile
  hardware: Hardware
  effective?: Effective
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
          <section key={group} className="mt-7">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t(`flags.group.${group}` as StringKey)}
            </h3>
            <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
              {flags.map(([id, def]) => (
                <Field
                  key={id}
                  id={id}
                  def={def}
                  value={values[id]}
                  effective={effective}
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
  id,
  def,
  value,
  effective,
  recommended,
  locale,
  onChange,
}: {
  id: string
  def: FlagDef
  value: Profile[string]
  effective: Effective
  recommended: boolean
  locale: 'en' | 'ru'
  onChange: (v: Profile[string]) => void
}): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  // A slider in the narrow right-hand column would be a stub. It gets its
  // own line under the label instead.
  const wide = def.type === 'int' && !!def.scale

  return (
    <div className="px-4 py-3">
      <div
        className={cn(
          'flex flex-wrap gap-x-4 gap-y-2',
          wide
            ? 'flex-col items-stretch'
            : 'items-center justify-between',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className="text-sm font-medium">{def.label[locale]}</span>
          {recommended ? <Badge tone="brand">{t('flags.recommended')}</Badge> : null}
          <span className="font-mono text-[11px] text-muted-foreground">{def.cli}</span>
          <ChevronDown
            className={cn(
              'size-3.5 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        <Control
          id={id}
          def={def}
          value={value}
          effective={effective}
          onChange={onChange}
        />
      </div>
      {/* The help is the product; it is one click away rather than always on,
          because forty paragraphs at once is its own kind of unhelpful. */}
      {open ? (
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          {def.help[locale]}
        </p>
      ) : null}
    </div>
  )
}

function Control({
  id,
  def,
  value,
  effective,
  onChange,
}: {
  id: string
  def: FlagDef
  value: Profile[string]
  effective: Effective
  onChange: (v: Profile[string]) => void
}): JSX.Element {
  const t = useT()
  const input =
    'h-9 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

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
      <Select
        className="w-44"
        value={String(value ?? '')}
        onChange={(v) => onChange(v || undefined)}
        options={[
          // "auto", spelled out: an empty option reads as a missing value,
          // and what it actually means is "llama.cpp decides".
          { value: '', label: t('flags.auto') },
          ...def.options.map((o) => ({ value: o.value, label: o.label })),
        ]}
      />
    )
  }

  if (def.type === 'int' && def.scale) {
    // A dial, not a ladder. The marks are still one click away underneath,
    // because they are still what most people want — but the values between
    // them are legal, cost real memory, and were unreachable.
    const min = def.min ?? 0
    const max = ceilingFor(id, def, effective)
    return (
      <NumberSlider
        value={typeof value === 'number' ? value : undefined}
        min={min}
        max={max}
        {...(def.step !== undefined ? { step: def.step } : {})}
        marks={def.scale}
        fallback={def.default ?? min}
        // A flag with no default of its own is llama.cpp's to decide, and
        // the dial has to be able to hand it back rather than pretending
        // some position is what "unset" looks like.
        allowAuto={def.default === undefined}
        autoLabel={t('flags.auto')}
        // Token counts read better abbreviated; a thread count does not.
        format={max >= 1024 ? tokens : String}
        onChange={onChange}
      />
    )
  }

  // The projector is known from the library; the field shows what will be
  // used rather than an empty box beside a model that has one.
  if (id === 'mmproj' && !value && effective.mmprojPath) {
    const name = effective.mmprojPath.split(/[\\/]/).pop() ?? effective.mmprojPath
    return (
      <span
        className="inline-flex h-9 max-w-[280px] items-center gap-2 truncate rounded-lg border border-dashed border-input px-3 text-sm text-muted-foreground"
        title={effective.mmprojPath}
      >
        <span className="truncate">{name}</span>
        <Badge>{t('flags.fromFolder')}</Badge>
      </span>
    )
  }

  const placeholder =
    def.type === 'string' && def.placeholder
      ? `${t('flags.auto')} · ${def.placeholder}`
      : id === 'temp' || id === 'topP'
        ? t('flags.fromModel')
        : t('flags.auto')

  return (
    <input
      className={cn(input, 'w-40')}
      type={def.type === 'int' ? 'number' : 'text'}
      value={value === undefined ? '' : String(value)}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') return onChange(undefined)
        onChange(def.type === 'int' ? Number(raw) : raw)
      }}
    />
  )
}
