import { useCallback, useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { tokens } from '@shared/format.js'
import {
  bandwidthCeiling,
  buildBenchArgs,
  compare,
  DDR5_5600_DUAL,
  unsupportedByBench,
} from '@shared/bench.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, Empty, Page, PageHeader, Section, Stat } from '@/components/ui/page'
import { api } from '@/lib/api'
import { ipcMessage } from '@/lib/errors'
import { useT } from '@/stores/uiStore'
import type { ModelInfo, ProfilesFile, StoredRun } from '../../preload/index.js'

export function Benchmark(): JSX.Element {
  const t = useT()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [profiles, setProfiles] = useState<ProfilesFile | null>(null)
  const [modelId, setModelId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [history, setHistory] = useState<StoredRun[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [scan, p, h] = await Promise.all([
      api()?.models.scan(),
      api()?.profiles.get(),
      api()?.bench.history(),
    ])
    if (scan) {
      setModels(scan.models)
      setModelId((cur) => cur || (scan.models[0]?.id ?? ''))
    }
    if (p) {
      setProfiles(p)
      setProfileId((cur) => cur || p.defaultProfileId)
    }
    if (h) setHistory(h)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const model = models.find((m) => m.id === modelId)
  const profile = profiles?.profiles.find((p) => p.id === profileId)

  const run = async (): Promise<void> => {
    if (!model || !profile) return
    setBusy(true)
    setError(null)
    try {
      await api()?.bench.run(model.id, profile.name, profile.values)
      await refresh()
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const select =
    'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  // Two runs of the same model are what a comparison is: the newest against
  // the one before it.
  const forModel = history.filter((r) => r.modelId === modelId)
  const latest = forModel[0]
  // Only against a run measured at the same context. Generation slows as the
  // cache fills, so "1.8x faster" between depth 512 and depth 8192 would be
  // reporting the depth as if it were the profile.
  const previous = forModel.find(
    (r, i) => i > 0 && r.result.depth === latest?.result.depth,
  )
  const delta = latest && previous ? compare(previous.result, latest.result) : null
  const ignored = profile ? unsupportedByBench(profile.values) : []

  return (
    <Page>
      <PageHeader title="benchmark.title" blurb="benchmark.blurb" />

      {models.length === 0 ? (
        <div className="mt-6">
          <Empty>{t('server.noModels')}</Empty>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {t('bench.model')}
            </span>
            <select
              className={select}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} · {m.quant}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-48 flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {t('bench.profile')}
            </span>
            <select
              className={select}
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {(profiles?.profiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="brand"
            size="sm"
            disabled={busy || !model || !profile}
            onClick={() => void run()}
          >
            <Play className="mr-2 size-3.5" />
            {busy ? t('bench.running') : t('bench.run')}
          </Button>
        </div>
      )}

      {error ? (
        <p className="mt-3 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}

      {/* What will run, before it runs — the same promise the server screen
          makes about its command line. llama-bench exits on an argument it
          does not know rather than ignoring it, so "what gets passed" is not
          a detail. */}
      {model && profile ? (
        <div className="mt-5">
          <pre className="overflow-x-auto rounded-xl border border-border bg-card p-4 text-xs leading-relaxed">
            llama-bench{' '}
            {buildBenchArgs(model.path, profile.values).join(' ')}
          </pre>
          {ignored.length ? (
            // Said before the run, not after: a profile whose --no-repack
            // cannot be honoured is not the profile being measured, and
            // llama-bench has no equivalent for it at all.
            <p className="mt-2 text-xs text-warn">
              {t('bench.ignored')} {ignored.join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}

      {model ? (
        <div className="mt-6 grid grid-cols-3 gap-4">
          {/* The number that makes a measurement legible: on a dense model
              generation is pinned to memory bandwidth, so a result close to
              this is the hardware, not the profile. */}
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <Stat
              label={t('bench.ceiling')}
              value={bandwidthCeiling(model.sizeBytes, DDR5_5600_DUAL).toFixed(1)}
              unit="tok/s"
              hint="DDR5-5600 ×2"
            />
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <Stat
              label={t('bench.generation')}
              value={latest?.result.genTps?.toFixed(2) ?? '—'}
              unit="tok/s"
              hint={latest ? undefined : t('bench.empty')}
            />
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <Stat
              label={t('bench.prompt')}
              value={latest?.result.promptTps?.toFixed(1) ?? '—'}
              unit="tok/s"
              hint={
                delta?.genRatio
                  ? delta.fasterGen === null
                    ? t('bench.noise')
                    : `${delta.genRatio.toFixed(2)}× ${t('bench.faster')}`
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}

      <Section title={t('bench.history')}>
        {history.length === 0 ? (
          <Empty>{t('bench.empty')}</Empty>
        ) : (
          <Card>
            {history.slice(0, 20).map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{r.profileName}</span>
                  <Badge>{r.result.backend}</Badge>
                  {r.result.depth ? (
                    <Badge tone="brand">
                      {t('models.context')} {tokens(r.result.depth)}
                    </Badge>
                  ) : null}
                  <div className="flex-1" />
                  <span className="text-sm tabular-nums">
                    <span className="text-muted-foreground">{t('bench.prompt')}</span>{' '}
                    <b className="font-display text-base">
                      {r.result.promptTps?.toFixed(1) ?? '—'}
                    </b>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{t('bench.generation')}</span>{' '}
                    <b className="font-display text-base">
                      {r.result.genTps?.toFixed(2) ?? '—'}
                    </b>{' '}
                    <span className="text-xs text-muted-foreground">tok/s</span>
                  </span>
                </div>
                {r.id === latest?.id && delta?.genRatio ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('bench.compare')}:{' '}
                    {delta.fasterGen === null
                      ? t('bench.noise')
                      : `${delta.genRatio.toFixed(2)}× ${t('bench.faster')}`}
                  </p>
                ) : null}
                {r.ignored.length ? (
                  // Said out loud: a profile whose reasoning effort was
                  // dropped is not the profile the user thinks was measured.
                  <p className="mt-1 text-xs text-warn">
                    {t('bench.ignored')} {r.ignored.join(', ')}
                  </p>
                ) : null}
              </div>
            ))}
          </Card>
        )}
      </Section>
    </Page>
  )
}
