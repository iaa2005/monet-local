import { useCallback, useEffect, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { estimate } from '@shared/estimator.js'
import { bytes } from '@shared/format.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, Empty, Section } from '@/components/ui/page'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type {
  DownloadEvent,
  HfFile,
  HfRepo,
  RepoContents,
} from '../../preload/index.js'

/**
 * Finding a model, with the verdict on every row.
 *
 * A repository offers a dozen quantisations and nothing on the page says
 * which of them this machine can run. That is the whole reason this screen
 * exists rather than a link to the website: the estimator runs on the size
 * before anything is fetched, so a 22 GB quant that cannot load is marked as
 * such instead of costing three hours to find out.
 */
export function HuggingFace({
  hardware,
  profile,
  onDownloaded,
}: {
  hardware: Hardware
  /** The profile a downloaded model would run under — the verdict needs it. */
  profile: Profile
  onDownloaded: () => void
}): JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const [repos, setRepos] = useState<HfRepo[] | null>(null)
  const [contents, setContents] = useState<RepoContents | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<DownloadEvent | null>(null)
  const [pending, setPending] = useState<{ name: string; bytes: number }[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadPending = useCallback(async () => {
    const p = await api()?.hf.pending()
    if (p) setPending(p)
  }, [])

  useEffect(() => {
    void loadPending()
    return api()?.hf.onProgress(setProgress)
  }, [loadPending])

  const guard = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      setProgress(null)
      await loadPending()
    }
  }

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void guard('search', async () => {
            setContents(null)
            const r = await api()?.hf.search(query)
            setRepos(r ?? [])
          })
        }}
      >
        <input
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={t('hf.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy !== null}>
          <Search className="mr-2 size-3.5" />
          {busy === 'search' ? t('hf.searching') : t('hf.search')}
        </Button>
      </form>

      {error ? (
        <p className="mt-3 rounded-md bg-red-bg px-3 py-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}

      {pending.length ? (
        <Section title={t('hf.pending')}>
          <Card>
            {pending.map((p) => (
              <div key={p.name} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="truncate font-mono text-xs">{p.name}</span>
                <div className="flex-1" />
                <Badge>{bytes(p.bytes)}</Badge>
              </div>
            ))}
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">{t('hf.pendingHint')}</p>
        </Section>
      ) : null}

      {repos && !contents ? (
        <Section title={`${repos.length}`}>
          {repos.length === 0 ? (
            <Empty>{t('common.none')}</Empty>
          ) : (
            <Card>
              {repos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void guard('repo', async () => {
                      const c = await api()?.hf.repo(r.id)
                      if (c) setContents(c)
                    })
                  }
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="truncate text-sm">{r.id}</span>
                  <div className="flex-1" />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(r.downloads ?? 0).toLocaleString('en-US')} {t('hf.downloads')}
                  </span>
                </button>
              ))}
            </Card>
          )}
        </Section>
      ) : null}

      {contents ? (
        <Section
          title={contents.repoId}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setContents(null)}>
              ←
            </Button>
          }
        >
          <Card>
            {contents.models.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                hardware={hardware}
                profile={profile}
                busy={busy !== null}
                downloading={busy === f.path}
                progress={busy === f.path ? progress : null}
                onDownload={() =>
                  void guard(f.path, async () => {
                    await api()?.hf.download(
                      contents.repoId,
                      f.path,
                      f.sizeBytes,
                      f.sha256,
                    )
                    onDownloaded()
                  })
                }
              />
            ))}
            {contents.projectors.map((f) => (
              <div key={f.path} className="flex items-center gap-2 px-4 py-2.5">
                <span className="truncate text-sm">{f.path}</span>
                <Badge>{t('hf.projector')}</Badge>
                <Badge>{bytes(f.sizeBytes)}</Badge>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    void guard(f.path, async () => {
                      await api()?.hf.download(
                        contents.repoId,
                        f.path,
                        f.sizeBytes,
                        f.sha256,
                      )
                      onDownloaded()
                    })
                  }
                >
                  <Download className="size-3.5" />
                </Button>
              </div>
            ))}
          </Card>
          {contents.split.length ? (
            // Said rather than silently omitted: a repository whose only
            // BF16 is split would otherwise look as if it had none.
            <p className="mt-2 text-xs text-muted-foreground">
              {contents.split.length} × {t('hf.split')}
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>
  )
}

function FileRow({
  file,
  hardware,
  profile,
  busy,
  downloading,
  progress,
  onDownload,
}: {
  file: HfFile
  hardware: Hardware
  profile: Profile
  busy: boolean
  downloading: boolean
  progress: DownloadEvent | null
  onDownload: () => void
}): JSX.Element {
  const t = useT()
  // Geometry is unknown before the file exists, so this is the weights-only
  // verdict: enough to rule out a quant that cannot fit at all, and honest
  // about being an upper bound rather than the whole story.
  const verdict = estimate({
    fileBytes: file.sizeBytes,
    profile,
    hardware,
  })

  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm">{file.path}</span>
        {file.quant ? <Badge tone="brand">{file.quant}</Badge> : null}
        <Badge>{bytes(file.sizeBytes)}</Badge>
        <Badge
          tone={
            verdict.level === 'fits'
              ? 'muted'
              : verdict.level === 'tight'
                ? 'warn'
                : 'warn'
          }
        >
          <span
            className={cn(
              verdict.level === 'fits' && 'text-green-text',
              verdict.level === 'wont_fit' && 'text-red-text',
            )}
          >
            {t(`verdict.${verdict.level}`)}
          </span>
        </Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDownload}>
          <Download className="mr-2 size-3.5" />
          {downloading ? t('hf.downloading') : t('hf.download')}
        </Button>
      </div>
      {downloading && progress ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {bytes(progress.receivedBytes)} / {bytes(progress.totalBytes)} ·{' '}
          {bytes(progress.bytesPerSecond)}/s
          {progress.etaSeconds
            ? ` · ${Math.ceil(progress.etaSeconds / 60)} min`
            : ''}
          {progress.resumedFrom > 0 ? ` · ${t('hf.resumed')}` : ''}
        </p>
      ) : null}
    </div>
  )
}
