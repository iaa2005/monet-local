import { useCallback, useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import {
  bandwidthCeiling,
  compare,
  DDR5_5600_DUAL,
} from '@shared/bench.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, Empty, PageHeader, Section } from '@/components/ui/page'
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
    'h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  // Two runs of the same model are what a comparison is: the newest against
  // the one before it.
  const forModel = history.filter((r) => r.modelId === modelId)
  const [latest, previous] = forModel
  const delta = latest && previous ? compare(previous.result, latest.result) : null

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <PageHeader title="benchmark.title" blurb="benchmark.blurb" />

      <div className="mt-5 flex flex-wrap items-center gap-3">
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

      {error ? (
        <p className="mt-3 rounded-md bg-red-bg px-3 py-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}

      {model ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {/* The number that makes a measurement legible: on a dense model
              generation is pinned to memory bandwidth, so a result close to
              this is the hardware, not the profile. */}
          {t('bench.ceiling')}{' '}
          <span className="font-medium text-foreground">
            {bandwidthCeiling(model.sizeBytes, DDR5_5600_DUAL).toFixed(1)} tok/s
          </span>
          . {t('bench.ceilingWhy')}
        </p>
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
                  <Badge>{r.modelId}</Badge>
                  <Badge>{r.result.backend}</Badge>
                  <div className="flex-1" />
                  <span className="text-sm">
                    {t('bench.prompt')}{' '}
                    <b>{r.result.promptTps?.toFixed(1) ?? '—'}</b> ·{' '}
                    {t('bench.generation')}{' '}
                    <b>{r.result.genTps?.toFixed(2) ?? '—'}</b> tok/s
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
    </div>
  )
}
