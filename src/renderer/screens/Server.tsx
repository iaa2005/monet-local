import { useCallback, useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'
import type { Estimate } from '@shared/estimator.js'
import type { StringKey } from '@shared/i18n.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import { bytes } from '@shared/format.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, ClickRow, Empty, Page, PageHeader, Section, Stat } from '@/components/ui/page'
import { ProfilePanel } from '@/components/ProfilePanel'
import { Verdict } from '@/components/Verdict'
import { api } from '@/lib/api'
import { ipcMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type {
  ModelInfo,
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
  const [selected, setSelected] = useState<string | null>(null)
  const [values, setValues] = useState<Profile>({})
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [s, scan, hw, str, profiles] = await Promise.all([
      api()?.server.status(),
      api()?.models.scan(),
      api()?.server.hardware(),
      api()?.server.strays(),
      api()?.profiles.get(),
    ])
    if (s) setStatus(s)
    if (hw) setHardware(hw)
    if (str) setStrays(str)
    if (scan) {
      setModels(scan.models)
      setSelected((cur) => cur ?? scan.models[0]?.id ?? null)
    }
    if (profiles) {
      const p = profiles.profiles.find(
        (x) => x.id === profiles.defaultProfileId,
      )
      setValues((cur) => (Object.keys(cur).length ? cur : (p?.values ?? {})))
    }
  }, [])

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
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {t('server.title')}
          </div>
          <div
            className={cn(
              'mt-0.5 flex items-center gap-2 font-display text-[22px] font-semibold leading-none tracking-tight',
              running ? 'text-green-text' : status?.state === 'failed' ? 'text-red-text' : '',
            )}
          >
            <span
              className={cn(
                'size-2.5 rounded-full',
                running
                  ? 'bg-green-text'
                  : status?.state === 'failed'
                    ? 'bg-red-text'
                    : 'bg-muted-foreground',
              )}
            />
            {t(`server.state.${status?.state ?? 'stopped'}` as StringKey)}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <Stat label={t('settings.port')} value={String(status?.port ?? 17171)} />
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
          <Verdict
            estimate={estimate}
            onApply={(fix) => {
              // Every suggestion maps to a flag the panel below owns, so
              // "do that for me" is one setState rather than advice.
              const next: Profile = { ...values }
              if (fix.code === 'lower-context' && fix.value)
                next['ctxSize'] = fix.value
              if (fix.code === 'enable-no-kv-offload') next['noKvOffload'] = true
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
              setValues(next)
            }}
          />
          <div className="mt-6">
            <ProfilePanel
              values={values}
              hardware={hardware}
              effective={{
                mmprojPath: models.find((m) => m.id === selected)?.mmprojPath,
              }}
              onChange={setValues}
            />
          </div>
          <div className="mt-8">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('server.command')}
            </h3>
            {/* What the preview shows is what launches: both come out of
                buildArgs, so they cannot drift apart. */}
            <pre className="overflow-x-auto rounded-xl border border-border bg-card p-4 text-xs leading-relaxed">
              {command}
            </pre>
          </div>
        </Section>
      ) : null}
    </Page>
  )
}
