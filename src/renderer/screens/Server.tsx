import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Pencil, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react'
import type { Estimate } from '@shared/estimator.js'
import type { StringKey } from '@shared/i18n.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import { bytes } from '@shared/format.js'
import {
  activeWeightBytes,
  formatTps,
  generationTps,
  speedBand,
} from '@shared/models/speed.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, ClickRow, Empty, Page, PageHeader, Section, Stat } from '@/components/ui/page'
import { ProfilePanel } from '@/components/ProfilePanel'
import { MenuButton } from '@/components/ui/menu'
import { Select } from '@/components/ui/select'
import { Verdict } from '@/components/Verdict'
import { api } from '@/lib/api'
import { ipcMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type {
  Activity,
  AutoProfileResult,
  AutoProgress,
  EndpointInfo,
  ModelInfo,
  ProfilesFile,
  RouterStatus,
  StrayProcess,
} from '../../preload/index.js'

export function Server(): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<RouterStatus | null>(null)
  /** What each loaded model is doing, refreshed twice a second. */
  const [activity, setActivity] = useState<Record<string, Activity>>({})
  const [models, setModels] = useState<ModelInfo[]>([])
  const [hardware, setHardware] = useState<Hardware>({
    totalRamBytes: 0,
    devices: [],
  })
  const [strays, setStrays] = useState<StrayProcess[]>([])
  /** The port CLIENTS use. The router's own is internal and not this. */
  const [endpoint, setEndpoint] = useState<EndpointInfo | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfilesFile | null>(null)
  const [values, setValues] = useState<Profile>({})
  /** Models configured differently from what the router is actually running. */
  const [pending, setPending] = useState<string[]>([])
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What the last Auto decided, shown until the next one or a dismissal. */
  const [autoNote, setAutoNote] = useState<AutoProfileResult | null>(null)
  /** The model Auto is working on, so its row can say so. */
  const [autoBusy, setAutoBusy] = useState<string | null>(null)
  /** Auto's attempts so far, as main reports them — cleared by the result. */
  const [autoProgress, setAutoProgress] = useState<AutoProgress[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [armed, setArmed] = useState(false)

  const inputCls =
    'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  const refresh = useCallback(async () => {
    const [s, scan, hw, str, p, pend, ep, act] = await Promise.all([
      api()?.server.status(),
      api()?.models.scan(),
      api()?.server.hardware(),
      api()?.server.strays(),
      api()?.profiles.get(),
      api()?.server.pending(),
      api()?.server.endpoint(),
      api()?.server.activity(),
    ])
    if (s) setStatus(s)
    if (ep) setEndpoint(ep)
    if (hw) setHardware(hw)
    if (str) setStrays(str)
    if (p) setProfiles(p)
    if (pend) setPending(pend)
    if (act) setActivity(act)
    if (scan) {
      setModels(scan.models)
      setSelected((cur) => cur ?? scan.models[0]?.id ?? null)
    }
  }, [])

  /**
   * The settings on screen belong to the selected model, not to whatever
   * profile happens to be the default — each model, so each quant, carries
   * its own.
   *
   * Only when the model or its profile changes. Reloading on every update
   * of the profiles file would fight the person typing: a save lands 400 ms
   * behind the keystroke that triggered it, and putting the saved value
   * back on screen would undo everything typed in between.
   */
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!selected || !profiles) return
    const id = profiles.assignments[selected] ?? profiles.defaultProfileId
    const key = `${selected}:${id}`
    if (loadedFor.current === key) return
    loadedFor.current = key
    setValues(profiles.profiles.find((x) => x.id === id)?.values ?? {})
  }, [selected, profiles])

  useEffect(() => {
    void refresh()
    const off = [
      api()?.server.onStatus(setStatus),
      api()?.server.onActivity(setActivity),
      api()?.server.onAutoProgress((p) =>
        setAutoProgress((prev) => [...prev, p]),
      ),
    ]
    return () => {
      for (const f of off) f?.()
    }
  }, [refresh])

  // The verdict follows every keystroke: it is only useful if it answers
  // before the choice is made, not after the server refuses to start.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    void api()
      ?.server.estimate(selected, values)
      .then((r) => {
        if (cancelled) return
        setEstimate(r.estimate)
        setCommand(r.command)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selected, values])

  /** The profile the selected model is on. */
  const profileId =
    (selected ? profiles?.assignments[selected] : undefined) ??
    profiles?.defaultProfileId
  const profile = profiles?.profiles.find((p) => p.id === profileId)
  /** How many models this profile speaks for — editing it moves all of them. */
  const sharedWith = models.filter(
    (m) =>
      (profiles?.assignments[m.id] ?? profiles?.defaultProfileId) === profileId,
  ).length

  const reload = async (file?: ProfilesFile): Promise<void> => {
    if (file) setProfiles(file)
    const pend = await api()?.server.pending()
    if (pend) setPending(pend)
  }

  /**
   * Save the edit; do not apply it.
   *
   * Debounced because these arrive a keystroke at a time. Saved and not
   * applied because applying means reloading the model — llama.cpp fixes a
   * model's arguments when it loads it — and doing that per keystroke is
   * not something anyone wants. The banner is how it gets applied.
   *
   * It edits the profile, not a copy of it: a profile is a named thing the
   * user made, and every model on it is meant to move together. The count
   * beside the name says how many that is, before the keystroke rather than
   * after it.
   */
  const edit = (next: Profile): void => {
    setValues(next)
    if (!profileId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void (async () => {
        await reload(await api()?.profiles.setValues(profileId, next))
      })()
    }, 400)
  }

  const commitRename = async (): Promise<void> => {
    setRenaming(false)
    const name = draftName.trim()
    if (!profileId || !name || name === profile?.name) return
    await reload(await api()?.profiles.rename(profileId, name))
  }

  /**
   * Pick the settings for a model and load it with them.
   *
   * Three steps that look like one: write the configuration (a new one if
   * this model shares its current one, the existing one if it is its own —
   * decided in main, by the same count the panel shows), restart the router
   * so llama.cpp reads the new preset (it reads it once, at startup), then
   * load. A model that was already loaded comes back through the restart
   * with the new settings and is not loaded twice.
   */
  const autoLoad = async (modelId: string): Promise<void> => {
    setAutoBusy(modelId)
    setAutoNote(null)
    setAutoProgress([])
    try {
      await guard(async () => {
        // Main does the whole loop — write, restart, load, ask for a token,
        // back off, again — and reports each attempt on the way. This side
        // only shows it.
        const r = await api()!.profiles.auto(modelId)
        setAutoNote(r)
        setProfiles(r.file)
        // The panel reloads its values only when the model:profile key
        // changes. An edit in place keeps the key, so force it.
        loadedFor.current = null
        setSelected(modelId)
      })
    } finally {
      setAutoBusy(null)
    }
  }

  const guard = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * What the machine and the selected model really allow, so the dials in
   * the panel stop where reality does rather than at a registry bound that
   * has to hold everywhere.
   */
  /**
   * How fast each model would WRITE here.
   *
   * Bandwidth divided by what one token reads — see @shared/models/speed.
   * It is in the list rather than behind a click because it is the fact that
   * decides which model to load, and nothing on this screen said it: a 13 GiB
   * file and an 11 GiB file sat side by side, and the smaller one is seven
   * times faster because it is a mixture of experts.
   */
  const speedOf = useCallback(
    (m: ModelInfo) => {
      const bandwidth = hardware.memoryBandwidthBytesPerSecond
      if (!bandwidth || !m.weightBytes) return null
      const input = {
        weightBytes: m.weightBytes,
        ...(m.expertBytes ? { expertBytes: m.expertBytes } : {}),
        ...(m.expertCount ? { expertCount: m.expertCount } : {}),
        ...(m.expertUsedCount ? { expertUsedCount: m.expertUsedCount } : {}),
        bandwidthBytesPerSecond: bandwidth,
      }
      const tps = generationTps(input)
      return { tps, band: speedBand(tps), activeBytes: activeWeightBytes(input), bandwidth }
    },
    [hardware.memoryBandwidthBytesPerSecond],
  )

  const chosen = models.find((m) => m.id === selected)
  const effective = {
    ...(chosen?.mmprojPath ? { mmprojPath: chosen.mmprojPath } : {}),
    ...(chosen?.contextMax ? { contextMax: chosen.contextMax } : {}),
    ...(chosen?.geometry?.blockCount
      ? { gpuLayers: chosen.geometry.blockCount + 1 }
      : {}),
    ...(navigator.hardwareConcurrency
      ? { cpuThreads: navigator.hardwareConcurrency }
      : {}),
  }

  const running = status?.state === 'ready'
  const loaded = new Set(
    (status?.models ?? []).filter((m) => m.status === 'loaded').map((m) => m.id),
  )
  const loading = new Set(
    (status?.models ?? [])
      .filter((m) => m.status === 'loading')
      .map((m) => m.id),
  )
  // A child server that faults leaves the ROUTER healthy — it keeps
  // answering and keeps listing — so nothing on this screen said anything at
  // all, and the client got a 500 naming nothing. See instance-exit.ts.
  const died = (status?.models ?? []).filter((m) => m.lastExit)

  return (
    <Page>
      <PageHeader
        title="server.title"
        blurb="server.blurb"
        actions={
          <Button
            variant={running ? 'outline' : 'brand'}
            size="sm"
            disabled={busy || models.length === 0}
            onClick={() =>
              void guard(() =>
                running
                  ? (api()?.server.stop() ?? Promise.resolve())
                  : (api()?.server.start() ?? Promise.resolve()),
              )
            }
          >
            {running ? (
              <Square className="mr-2 size-3.5" />
            ) : (
              <Play className="mr-2 size-3.5" />
            )}
            {running ? t('server.stop') : t('server.start')}
          </Button>
        }
      />

      {/* The four facts a glance should answer, as tiles: what state, on
          which port, how many models are up, how much RAM there is to spend.
          The number is the large thing; the label stays out of its way. */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          {/* No status light. The word already says it and the colour
              backs it up; a dot in front of the value was the one thing on
              this row that pushed its text out of line with the other
              three tiles. */}
          <Stat
            label={t('server.title')}
            value={t(`server.state.${status?.state ?? 'stopped'}` as StringKey)}
            {...(running
              ? { tone: 'ok' as const }
              : status?.state === 'failed'
                ? { tone: 'bad' as const }
                : {})}
          />
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          {/* The gateway's port, not the router's. The router sits on
              17172 and is nobody's business but this app's; putting that
              number under a label reading "Port" invites a client to the
              one address that will not honour the API key. */}
          <Stat
            label={t('settings.port')}
            value={String(endpoint?.port ?? 17171)}
          />
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <Stat
            label={t('server.loaded')}
            value={String(loaded.size)}
            unit={`/ ${models.length}`}
          />
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <Stat
            label="RAM"
            value={hardware.totalRamBytes ? bytes(hardware.totalRamBytes, 0) : '—'}
            unit={hardware.devices.some((d) => d.uma) ? 'UMA' : undefined}
          />
        </div>
      </div>
      {status?.error ? (
        <p className="mt-3 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-text">
          {status.error}
        </p>
      ) : null}

      {died.map((m) => (
        <p
          key={`died-${m.id}`}
          className="mt-3 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-text"
        >
          {t('server.died')} <b>{m.id}</b> — {m.lastExit!.label}.{' '}
          {m.lastExit!.crashed ? t('server.diedHint') : null}
        </p>
      ))}

      {error ? (
        <p className="mt-3 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}

      {strays.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <span>{t('server.strays')}</span>
          {strays.map((s) => (
            <Button
              key={s.pid}
              size="sm"
              variant="outline"
              onClick={() => void guard(() => api()!.server.killStray(s.pid))}
            >
              {t('server.killStray')} ({s.pid})
            </Button>
          ))}
        </div>
      ) : null}

      {/* Manual, and it says why it has to be: llama.cpp reads its preset
          file once at startup and ignores arguments handed to a load, so
          nothing an edit does can reach a running server without this. */}
      {pending.length > 0 && running ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-brand-edge bg-brand-wash px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t('server.pending')}</div>
            <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
              {t('server.pendingHelp')}
            </p>
          </div>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="brand"
            disabled={busy}
            onClick={() => void guard(() => api()!.server.apply())}
          >
            <RotateCw className="mr-2 size-3.5" />
            {busy ? t('server.applying') : t('server.apply')}
          </Button>
        </div>
      ) : null}

      <Section title={t('models.title')}>
        {models.length === 0 ? (
          <Empty>{t('server.noModels')}</Empty>
        ) : (
          <Card>
            {models.map((m) => (
              <ClickRow
                key={m.id}
                selected={selected === m.id}
                onClick={() => setSelected(m.id)}
              >
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    loaded.has(m.id)
                      ? 'bg-green-text'
                      : loading.has(m.id)
                        ? 'bg-warn'
                        : 'bg-border',
                    // Working, not merely resident. The row already says so
                    // in words; this is what catches the eye from across a
                    // list of eight models.
                    activity[m.id] && activity[m.id]!.state !== 'idle'
                      ? 'animate-pulse'
                      : null,
                  )}
                />
                <span className="text-sm font-medium">{m.displayName}</span>
                <Badge tone="brand">{m.quant}</Badge>
                <Badge>{bytes(m.sizeBytes, 1)}</Badge>
                <Speed s={speedOf(m)} />
                {loaded.has(m.id) ? (
                  // Until the first slot poll lands the honest thing to say
                  // is that the weights are in memory; a second later it
                  // says what the model is doing with them.
                  activity[m.id] ? (
                    <Live a={activity[m.id]!} />
                  ) : (
                    <Badge tone="ok">{t('server.loaded')}</Badge>
                  )
                ) : null}
                {pending.includes(m.id) && running ? (
                  <Badge tone="warn" title={t('server.pendingHelp')}>
                    {t('server.changed')}
                  </Badge>
                ) : null}
                <div className="flex-1" />
                {/* Load, and beside it the other way to load: Auto, which
                    picks the settings first. Its own control rather than a
                    second button, because "load with what is configured"
                    and "configure, then load" are one verb with a
                    qualifier, and a row of two full buttons read as two
                    unrelated actions. */}
                <div className="flex items-center gap-1">
                  {running ? (
                    <Button
                      size="sm"
                      variant={loaded.has(m.id) ? 'outline' : 'brand'}
                      disabled={busy || loading.has(m.id)}
                      onClick={(e) => {
                        // The row selects; the button loads. One click must
                        // not do both, or unloading would also switch the
                        // profile.
                        e.stopPropagation()
                        void guard(() =>
                          loaded.has(m.id)
                            ? api()!.server.unload(m.id)
                            : api()!.server.load(m.id),
                        )
                      }}
                    >
                      {autoBusy === m.id
                        ? t('server.autoWorking')
                        : loading.has(m.id)
                          ? t('common.loading')
                          : loaded.has(m.id)
                            ? t('server.unload')
                            : t('server.load')}
                    </Button>
                  ) : null}
                  <MenuButton
                    title={t('server.more')}
                    disabled={busy || loading.has(m.id)}
                    items={[
                      {
                        id: 'auto',
                        label: loaded.has(m.id)
                          ? t('server.autoReload')
                          : t('server.auto'),
                        hint: t('server.autoHint'),
                        onSelect: () => void autoLoad(m.id),
                      },
                    ]}
                  />
                </div>
              </ClickRow>
            ))}
          </Card>
        )}
      </Section>

      {autoBusy && autoProgress.length ? (
        <AutoLive steps={autoProgress} />
      ) : null}
      {autoNote ? (
        <AutoNote r={autoNote} onClose={() => setAutoNote(null)} />
      ) : null}

      {selected && estimate ? (
        <Section title={t('server.profile')}>
          {/* Directly under the heading, which already says what this is —
              a second "Configuration" label above the select would be the
              same word twice. The configurations are the user's: made
              here, renamed here, deleted here, and nothing in the list is
              protected. */}
          <div
            className="flex flex-wrap items-end gap-2"
            onPointerDown={(e) => {
              // Disarm on anything that is not the delete button itself.
              if (armed && !(e.target as HTMLElement).closest('[data-arm]'))
                setArmed(false)
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {renaming ? (
                // Rename in place: the name is one field, and a dialog for
                // one field is a dialog too many.
                <input
                  autoFocus
                  className={inputCls}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename()
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                />
              ) : (
                <Select
                  value={profileId ?? ''}
                  options={(profiles?.profiles ?? []).map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                  onChange={(v) =>
                    void (async () => {
                      await reload(await api()?.profiles.assign(selected, v))
                    })()
                  }
                />
              )}
            </div>
            <Button
              size="icon-sm"
              variant="outline"
              title={t('profiles.new')}
              onClick={() =>
                void (async () => {
                  const r = await api()?.profiles.create(t('profiles.newName'))
                  if (!r) return
                  await reload(
                    await api()?.profiles.assign(selected, r.id),
                  )
                  setDraftName(t('profiles.newName'))
                  setRenaming(true)
                })()
              }
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              title={t('profiles.duplicate')}
              onClick={() =>
                void (async () => {
                  const name = `${profile?.name ?? ''} ${t('profiles.copySuffix')}`
                  const r = await api()?.profiles.create(name, values)
                  if (!r) return
                  await reload(await api()?.profiles.assign(selected, r.id))
                })()
              }
            >
              <Copy className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              title={t('profiles.rename')}
              onClick={() => {
                setDraftName(profile?.name ?? '')
                setRenaming(true)
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            {/* Asks once. A tuned configuration is minutes of work and
                there is no undo, so the first click arms and the second
                does it; anything else on the row disarms. */}
            <Button
              data-arm
              size={armed ? 'sm' : 'icon-sm'}
              variant={armed ? 'destructive' : 'outline'}
              title={t('profiles.deleteHint')}
              onClick={() =>
                void (async () => {
                  if (!profileId) return
                  if (!armed) return setArmed(true)
                  setArmed(false)
                  await reload(await api()?.profiles.remove(profileId))
                })()
              }
            >
              <Trash2 className={armed ? 'mr-2 size-3.5' : 'size-3.5'} />
              {armed ? t('profiles.confirmDelete') : null}
            </Button>
          </div>
          {sharedWith > 1 ? (
            // Said before the keystroke rather than discovered after it.
            <p className="mt-2 text-xs text-warn">
              {t('profiles.sharedBy')} {sharedWith}
            </p>
          ) : null}

          {/* No wrapper. A sticky element cannot leave its parent's box, so
              a div fitted to the card would unstick it the moment the
              scroll passed the card's own height — which is exactly what
              it did. Its parent has to be the tall one: the section. */}
          <Verdict
            estimate={estimate}
            onApply={(fix) => {
              // Every suggestion maps to a flag the panel below owns, so
              // "do that for me" is one setState rather than advice.
              const next: Profile = { ...values }
              if (fix.code === 'lower-context' && fix.value)
                next['ctxSize'] = fix.value
              if (fix.code === 'enable-no-kv-offload')
                next['noKvOffload'] = true
              if (fix.code === 'enable-no-repack') next['noRepack'] = true
              if (fix.code === 'disable-mlock') next['mlock'] = false
              if (fix.code === 'lower-ubatch')
                next['ubatchSize'] = Math.max(
                  16,
                  Math.floor(Number(values['ubatchSize'] ?? 256) / 2),
                )
              if (fix.code === 'quantise-kv') {
                next['flashAttn'] = 'on'
                next['cacheTypeK'] = 'q8_0'
                next['cacheTypeV'] = 'q4_0'
              }
              edit(next)
            }}
          />
          <div className="mt-4">
            <ProfilePanel
              values={values}
              hardware={hardware}
              effective={effective}
              onChange={edit}
            />
          </div>
          <div className="mt-8">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('server.command')}
            </h3>
            {/* What the preview shows is what launches: both come out of
                buildArgs, so they cannot drift apart. */}
            <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl border border-border bg-card p-4 text-xs leading-relaxed">
              {command}
            </pre>
          </div>
        </Section>
      ) : null}
    </Page>
  )
}

/** A live count, grouped so four digits do not read as one number. */
function count(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * What this model would write at, per second.
 *
 * Predicted, not measured, and it does not pretend otherwise — the tooltip
 * shows the whole arithmetic, because "≈26 tok/s" is only trustworthy if the
 * reader can check where it came from. Generation on a machine like this is
 * memory bandwidth divided by the weights a token reads; there is nothing
 * else in it.
 */
function Speed({
  s,
}: {
  s: { tps: number; band: 'fast' | 'usable' | 'slow'; activeBytes: number; bandwidth: number } | null
}): JSX.Element | null {
  const t = useT()
  if (!s) return null
  const why =
    `${t('server.speedTitle')}: ${t(`server.speed.${s.band}` as StringKey)}
` +
    `${t('server.speedWhy')} ${bytes(s.activeBytes, 1)}; ` +
    `${t('server.speedBandwidth')} ${bytes(s.bandwidth, 0)}/s`
  return (
    <Badge tone={s.band === 'fast' ? 'ok' : s.band === 'usable' ? undefined : 'warn'} title={why}>
      ≈{formatTps(s.tps)}
    </Badge>
  )
}

/**
 * What Auto decided, in one line a person can check against the panel.
 *
 * Every number here is one the panel below now shows; the line exists so
 * the decision is read as a sentence before it is read as a form. The
 * verdict colour is the estimator's, and a refusal is said here rather than
 * left to be discovered when the server will not start.
 */
/** "58/65 layers on the GPU" or "CPU only" — the part that changes between attempts. */
function attemptLabel(s: AutoProfileResult['summary'], t: ReturnType<typeof useT>): string {
  const ctx = `${s.ctxSize >= 1024 ? `${s.ctxSize / 1024}K` : s.ctxSize}`
  const parts = [
    s.cpuOnly
      ? t('server.autoCpu')
      : s.gpuLayers
        ? `${s.gpuLayers.on}/${s.gpuLayers.of} ${t('server.autoLayers')}`
        : null,
    s.projectorOnCpu ? t('server.autoProjector') : null,
    t(`server.autoKv.${s.kv}` as StringKey),
    `${ctx} ${t('server.autoCtx')}`,
    s.ubatch !== 256 ? `${t('server.autoUbatch')} ${s.ubatch}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** The attempt in flight, as main narrates it. */
function AutoLive({ steps }: { steps: AutoProgress[] }): JSX.Element {
  const t = useT()
  const last = steps[steps.length - 1]!
  return (
    <div className="mt-3 rounded-lg border border-brand-edge bg-brand-wash px-3 py-2 text-sm">
      <span className="font-medium">
        {t('server.autoAttempt')} {last.attempt}: {attemptLabel(last.summary, t)}
      </span>
      <span className="text-muted-foreground"> — {t(`server.autoPhase.${last.phase}` as StringKey)}</span>
      {steps
        .filter((p) => p.phase === 'failed')
        .map((p) => (
          <div key={p.attempt} className="text-xs text-muted-foreground">
            {p.attempt}. {attemptLabel(p.summary, t)} — {p.reason}
          </div>
        ))}
    </div>
  )
}

function AutoNote({
  r,
  onClose,
}: {
  r: AutoProfileResult
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const s = r.summary
  const profile = r.file.profiles.find((p) => p.id === r.profileId)
  const parts = [
    `${s.ctxSize >= 1024 ? `${s.ctxSize / 1024}K` : s.ctxSize} ${t('server.autoCtx')}`,
    t(`server.autoKv.${s.kv}` as StringKey),
    s.cpuOnly
      ? t('server.autoCpu')
      : s.gpuLayers
        ? `${s.gpuLayers.on}/${s.gpuLayers.of} ${t('server.autoLayers')}`
        : null,
    s.projectorOnCpu ? t('server.autoProjector') : null,
    s.ubatch !== 256 ? `${t('server.autoUbatch')} ${s.ubatch}` : null,
    `${s.threads} ${t('server.autoThreads')}`,
  ].filter(Boolean)
  const tone = s.level === 'fits' ? 'ok' : s.level === 'tight' ? 'warn' : 'bad'
  return (
    <div
      className={cn(
        'mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm',
        tone === 'ok' && 'border-green-text/30 bg-green-bg',
        tone === 'warn' && 'border-warn/40 bg-warn/10',
        tone === 'bad' && 'border-red-text/30 bg-red-bg text-red-text',
      )}
    >
      <Badge tone={r.created ? 'brand' : undefined}>
        {r.created ? t('server.autoCreated') : t('server.autoEdited')}
      </Badge>
      <span className="font-medium">{profile?.name}</span>
      <span className="text-muted-foreground">{parts.join(' · ')}</span>
      {s.level === 'wont_fit' ? (
        <span className="basis-full text-xs">{t('server.autoWontFit')}</span>
      ) : null}
      {r.attempts.length ? (
        // Every arrangement tried, and how it ended. "58 of 65 died, 48
        // ran" is the whole finding on hardware whose wall moves.
        <ol className="basis-full text-xs">
          {r.attempts.map((a, i) => (
            <li key={i} className={a.ok ? 'text-green-text' : 'text-muted-foreground'}>
              {i + 1}. {attemptLabel(a.summary, t)} — {a.ok ? t('server.autoPhase.ok') : a.reason ?? t('server.autoPhase.failed')}
            </li>
          ))}
          <li className={cn('mt-1', r.running ? 'text-green-text' : 'text-red-text')}>
            {r.running ? t('server.autoRunning') : t('server.autoNotRunning')}
          </li>
        </ol>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onClose}
        className="text-xs text-muted-foreground hover:text-foreground"
        aria-label="dismiss"
      >
        ×
      </button>
    </div>
  )
}

/**
 * What a loaded model is doing, in the row that offers to unload it.
 *
 * Three states, because llama.cpp has three: the weights are resident and
 * nothing is asked of them; a prompt is being read; an answer is being
 * written. The middle one is worth its own word — on a 27B running from
 * system memory a long prompt is a minute of apparent silence, and "Ready"
 * during it is the wrong answer to "is it stuck?".
 *
 * Numbers are `tabular-nums` on purpose: a counter that changes width every
 * time a 1 becomes a 7 drags the badge beside it back and forth.
 */
function Live({ a }: { a: Activity }): JSX.Element {
  const t = useT()
  if (a.state === 'idle') return <Badge tone="ok">{t('server.act.ready')}</Badge>

  const detail = [
    a.cachedTokens
      ? `${count(a.cachedTokens)} ${t('server.act.tok')} — ${t('server.act.cached')}`
      : '',
    a.contextMax
      ? `${count(a.contextTokens)} / ${count(a.contextMax)} ${t('server.act.context')}`
      : '',
    a.busySlots > 1 ? `${a.busySlots} ${t('server.act.parallel')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Badge tone={a.state === 'generating' ? 'brand' : 'warn'} title={detail}>
      {/* One flex child, not four: the badge puts a gap between its items,
          and the separators here are punctuation, not layout. */}
      <span>
        {a.state === 'generating' ? (
          <>
            {t('server.act.generating')} ·{' '}
            <span className="tabular-nums">
              {count(a.decoded)} {t('server.act.tok')}
            </span>
            {a.tokensPerSecond !== undefined ? (
              <span className="tabular-nums opacity-70">
                {' '}
                · {a.tokensPerSecond.toFixed(1)} {t('server.act.perSecond')}
              </span>
            ) : null}
          </>
        ) : (
          <>
            {t('server.act.prompt')} ·{' '}
            <span className="tabular-nums">
              {count(a.promptTokens)} {t('server.act.tok')}
            </span>
          </>
        )}
      </span>
    </Badge>
  )
}
