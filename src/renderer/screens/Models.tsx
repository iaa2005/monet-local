import { useCallback, useEffect, useState } from 'react'
import { Eye, FolderPlus, RefreshCw, Trash2 } from 'lucide-react'
import { bytes, tokens } from '@shared/format.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, Empty, Page, PageHeader, Section, Stat } from '@/components/ui/page'
import { Segmented } from '@/components/ui/segmented'
import { HuggingFace } from '@/screens/HuggingFace'
import { api } from '@/lib/api'
import { useT } from '@/stores/uiStore'
import type { Hardware, Profile } from '@shared/flags/types.js'
import type { ModelFolder, ModelInfo, ScanResult } from '../../preload/index.js'

export function Models(): JSX.Element {
  const t = useT()
  const [folders, setFolders] = useState<ModelFolder[]>([])
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'local' | 'hf'>('local')
  const [hardware, setHardware] = useState<Hardware>({
    totalRamBytes: 0,
    devices: [],
  })
  const [profile, setProfile] = useState<Profile>({})

  const rescan = useCallback(async () => {
    setBusy(true)
    try {
      const [f, s, hw, profiles] = await Promise.all([
        api()?.models.folders(),
        api()?.models.scan(),
        api()?.server.hardware(),
        api()?.profiles.get(),
      ])
      if (f) setFolders(f)
      if (s) setScan(s)
      if (hw) setHardware(hw)
      if (profiles) {
        const p = profiles.profiles.find((x) => x.id === profiles.defaultProfileId)
        if (p) setProfile(p.values)
      }
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void rescan()
  }, [rescan])

  const models = scan?.models ?? []

  return (
    <Page>
      <PageHeader
        title="models.title"
        blurb="models.blurb"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  await api()?.models.addFolder(false)
                  await rescan()
                })()
              }
            >
              <FolderPlus className="mr-2 size-4" />
              {t('models.addFolder')}
            </Button>
            <Button variant="ghost" size="icon-sm" disabled={busy} onClick={rescan}>
              <RefreshCw className="size-3.5" />
            </Button>
          </>
        }
      />

      <div className="mt-5">
        <Segmented
          value={tab}
          options={[
            { value: 'local' as const, label: t('models.folders') },
            { value: 'hf' as const, label: t('hf.tab') },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'hf' ? (
        <div className="mt-6">
          <HuggingFace
            hardware={hardware}
            profile={profile}
            onDownloaded={rescan}
          />
        </div>
      ) : (
        <>
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <Stat label={t('models.count')} value={String(models.length)} />
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <Stat label={t('models.folders')} value={String(folders.length)} />
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <Stat
            label={t('models.size')}
            value={bytes(models.reduce((n, m) => n + m.sizeBytes, 0), 0)}
          />
        </div>
      </div>

      <Section title={t('models.folders')}>
        {folders.length === 0 ? (
          <Empty>{t('models.empty')}</Empty>
        ) : (
          <Card>
            {folders.map((f) => (
              <div key={f.path} className="flex items-center gap-3 px-4 py-3">
                <span className="truncate font-mono text-[13px]">{f.path}</span>
                {f.readOnly ? <Badge>{t('common.readOnly')}</Badge> : null}
                <div className="flex-1" />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={t('common.remove')}
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      await api()?.models.removeFolder(f.path)
                      await rescan()
                    })()
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </Card>
        )}
      </Section>

      {models.length > 0 ? (
        <Section title={t('models.title')}>
          <Card>
            {models.map((m) => (
              <ModelRow key={m.id} model={m} />
            ))}
          </Card>
        </Section>
      ) : null}

      {scan?.failures.length ? (
        <Section title={t('models.failures')}>
          <Card>
            {scan.failures.map((f) => (
              <div key={f.path} className="px-4 py-3 text-xs">
                <span className="font-mono">{f.path}</span>
                <span className="ml-2 text-red-text">{f.error}</span>
              </div>
            ))}
          </Card>
        </Section>
      ) : null}
        </>
      )}
    </Page>
  )
}

function ModelRow({ model: m }: { model: ModelInfo }): JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-semibold">{m.displayName}</span>
        <Badge tone="brand">{m.quant}</Badge>
        <Badge>{m.architecture}</Badge>
        {m.moe ? (
          <Badge>
            {t('models.moe')}
            {m.expertCount ? ` ×${m.expertCount}` : ''}
          </Badge>
        ) : (
          <Badge>{t('models.dense')}</Badge>
        )}
        {m.mmprojPath ? (
          <Badge>
            <Eye className="mr-1 size-3" />
            {t('models.vision')}
          </Badge>
        ) : null}
        {m.mtp ? <Badge>{t('models.mtp')}</Badge> : null}
      </div>
      <div className="mt-1 font-mono text-xs text-muted-foreground">{m.id}</div>
      </div>
      {/* The numbers are the row: size, context, and the one the context
          slider is really spending — 64 KiB a token is 16 GiB at the
          advertised max, which is the reason this app exists. */}
      <div className="flex shrink-0 gap-6">
        <Stat label={t('models.size')} value={bytes(m.sizeBytes, 1)} />
        <Stat label={t('models.context')} value={tokens(m.contextMax)} />
        {m.kvBytesPerToken !== undefined ? (
          <Stat
            label={t('models.kvPerToken')}
            value={bytes(m.kvBytesPerToken, 0)}
          />
        ) : null}
      </div>
    </div>
  )
}
