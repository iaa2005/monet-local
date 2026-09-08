import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Pencil, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react'
import type { Estimate } from '@shared/estimator.js'
import type { StringKey } from '@shared/i18n.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import { bytes } from '@shared/format.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, ClickRow, Empty, Page, PageHeader, Section, Stat } from '@/components/ui/page'
import { ProfilePanel } from '@/components/ProfilePanel'
import { Select } from '@/components/ui/select'
import { Verdict } from '@/components/Verdict'
import { api } from '@/lib/api'
import { ipcMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type {
  EndpointInfo,
  ModelInfo,
  ProfilesFile,
  RouterStatus,
  StrayProcess,
} from '../../preload/index.js'

export function Server(): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<RouterStatus | null>(null)
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [armed, setArmed] = useState(false)

  const inputCls =
    'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  const refresh = useCallback(async () => {
    const [s, scan, hw, str, p, pend, ep] = await Promise.all([
      api()?.server.status(),
      api()?.models.scan(),
      api()?.server.hardware(),
      api()?.server.strays(),
      api()?.profiles.get(),
      api()?.server.pending(),
      api()?.server.endpoint(),
    ])
    if (s) setStatus(s)
    if (ep) setEndpoint(ep)
    if (hw) setHardware(hw)
    if (str) setStrays(str)
    if (p) setProfiles(p)
    if (pend) setPending(pend)
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
    return api()?.server.onStatus(setStatus)
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
                  )}
                />
                <span className="text-sm font-medium">{m.displayName}</span>
                <Badge tone="brand">{m.quant}</Badge>
                <Badge>{bytes(m.sizeBytes, 1)}</Badge>
                {loaded.has(m.id) ? (
                  <Badge tone="ok">{t('server.loaded')}</Badge>
                ) : null}
                {pending.includes(m.id) && running ? (
                  <Badge tone="warn" title={t('server.pendingHelp')}>
                    {t('server.changed')}
                  </Badge>
                ) : null}
                <div className="flex-1" />
                {running ? (
                  <Button
                    size="sm"
                    variant={loaded.has(m.id) ? 'outline' : 'brand'}
                    disabled={busy || loading.has(m.id)}
                    onClick={(e) => {
                      // The row selects; the button loads. One click must not
                      // do both, or unloading would also switch the profile.
                      e.stopPropagation()
                      void guard(() =>
                        loaded.has(m.id)
                          ? api()!.server.unload(m.id)
                          : api()!.server.load(m.id),
                      )
                    }}
                  >
                    {loading.has(m.id)
                      ? t('common.loading')
                      : loaded.has(m.id)
                        ? t('server.unload')
                        : t('server.load')}
                  </Button>
                ) : null}
              </ClickRow>
            ))}
          </Card>
        )}
      </Section>

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

          <div className="mt-5">
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
          </div>
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
