import { useCallback, useEffect, useState } from 'react'
import { Check, Cpu, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { bytes } from '@shared/format.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, Empty, PageHeader, Section } from '@/components/ui/page'
import { api } from '@/lib/api'
import { ipcMessage } from '@/lib/errors'
import { useT, useUi } from '@/stores/uiStore'
import type {
  AvailableRuntimes,
  InstallEvent,
  InstalledPack,
  RuntimeState,
} from '../../preload/index.js'

export function Runtimes(): JSX.Element {
  const t = useT()
  const locale = useUi((s) => s.prefs.locale)
  const [state, setState] = useState<RuntimeState | null>(null)
  const [available, setAvailable] = useState<AvailableRuntimes | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<InstallEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const s = await api()?.runtimes.state()
    if (s) setState(s)
  }, [])

  useEffect(() => {
    void refresh()
    return api()?.runtimes.onProgress(setProgress)
  }, [refresh])

  const guard = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  const installed = state?.installed ?? []

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <PageHeader
        title="runtimes.title"
        blurb="runtimes.blurb"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void guard('custom', async () => {
                const s = await api()?.runtimes.addCustom()
                if (s) setState(s)
              })
            }
          >
            <FolderOpen className="mr-2 size-4" />
            {t('runtimes.addCustom')}
          </Button>
        }
      />

      {error ? (
        <p className="mt-4 rounded-md bg-red-bg px-3 py-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}

      <Section title={t('runtimes.installed')}>
        {installed.length === 0 ? (
          <Empty>{t('runtimes.empty')}</Empty>
        ) : (
          <Card>
            {installed.map((p) => (
              <PackRow
                key={p.id}
                pack={p}
                active={state?.activeId === p.id}
                busy={busy !== null}
                onUse={() =>
                  void guard(p.id, async () => {
                    const s = await api()?.runtimes.choose(p.id)
                    if (s) setState(s)
                  })
                }
                onRemove={() =>
                  void guard(p.id, async () => {
                    const s = await api()?.runtimes.remove(p.id)
                    if (s) setState(s)
                  })
                }
              />
            ))}
          </Card>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {t('runtimes.addCustomHint')}
        </p>
      </Section>

      <Section
        title={t('runtimes.available')}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void guard('releases', async () => {
                const a = await api()?.runtimes.available()
                if (a) setAvailable(a)
              })
            }
          >
            <RefreshCw className="mr-2 size-3.5" />
            {t('runtimes.checkReleases')}
          </Button>
        }
      >
        {!available ? (
          <Empty>{t('runtimes.checkReleases')}</Empty>
        ) : (
          <Card>
            {available.packs.map((row) => {
              const already = installed.some(
                (p) => p.backendId === row.backendId && p.build === row.build,
              )
              const installing = busy === row.backendId
              return (
                <div
                  key={row.backendId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                >
                  <span className="font-medium">{row.label}</span>
                  <Badge>{row.build}</Badge>
                  <Badge>{bytes(row.totalBytes, 0)}</Badge>
                  {row.untested ? (
                    <Badge tone="warn" title={t('runtimes.untestedHint')}>
                      {t('runtimes.untested')}
                    </Badge>
                  ) : null}
                  <div className="flex-1" />
                  {already ? (
                    <span className="text-sm text-muted-foreground">
                      <Check className="mr-1 inline size-3.5" />
                      {t('common.inUse')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="brand"
                      disabled={busy !== null}
                      onClick={() =>
                        void guard(row.backendId, async () => {
                          const s = await api()?.runtimes.install(row._pack)
                          if (s) setState(s)
                        })
                      }
                    >
                      {installing ? t('runtimes.installing') : t('runtimes.install')}
                    </Button>
                  )}
                  {row.note ? (
                    <p className="w-full text-xs text-muted-foreground">
                      {row.note[locale]}
                    </p>
                  ) : null}
                  {installing && progress ? (
                    <p className="w-full text-xs text-muted-foreground">
                      {progress.stage === 'downloading' && progress.total
                        ? `${bytes(progress.received)} / ${bytes(progress.total)}` +
                          (progress.parts && progress.parts > 1
                            ? ` · ${progress.part}/${progress.parts}`
                            : '')
                        : progress.stage}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </Card>
        )}
      </Section>
    </div>
  )
}

function PackRow({
  pack,
  active,
  busy,
  onUse,
  onRemove,
}: {
  pack: InstalledPack
  active: boolean
  busy: boolean
  onUse: () => void
  onRemove: () => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <Cpu className={active ? 'size-4 text-brand' : 'size-4 text-muted-foreground'} />
      <span className="font-medium">{pack.label}</span>
      <Badge>{pack.build}</Badge>
      {pack.custom ? <Badge>custom</Badge> : null}
      <div className="flex-1" />
      {active ? (
        <Badge tone="brand">{t('common.inUse')}</Badge>
      ) : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onUse}>
          {t('common.use')}
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={busy}
        title={t('common.remove')}
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <div className="w-full pl-7 text-xs text-muted-foreground">
        {pack.devices.length === 0 ? (
          t('runtimes.noDevices')
        ) : (
          <ul>
            {pack.devices.map((d) => (
              <li key={d.id}>
                {d.id} · {d.name} · {bytes(d.totalBytes, 0)}
                {/* The one bit that changes the whole memory budget: on an
                    integrated GPU this "VRAM" is system RAM being spent. */}
                {d.uma ? ` · ${t('runtimes.uma')}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
