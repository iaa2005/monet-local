import { useState } from 'react'
import { Download, Search } from 'lucide-react'
import { estimate } from '@shared/estimator.js'
import { bytes } from '@shared/format.js'
import type { Hardware, Profile } from '@shared/flags/types.js'
import type { StringKey } from '@shared/i18n.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, ClickRow, Empty, Section } from '@/components/ui/page'
import { api } from '@/lib/api'
import { ipcMessage } from '@/lib/errors'
import { useT } from '@/stores/uiStore'
import type { DownloadJob } from '@shared/downloads.js'
import { jobId } from '@shared/downloads.js'
import type { HfFile, HfRepo, RepoContents } from '../../preload/index.js'

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
  downloads,
}: {
  hardware: Hardware
  /** The profile a downloaded model would run under — the verdict needs it. */
  profile: Profile
  /** The queue, live: each row reads its own state from it. */
  downloads: DownloadJob[]
}): JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const [repos, setRepos] = useState<HfRepo[] | null>(null)
  const [contents, setContents] = useState<RepoContents | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const guard = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(null)
    }
  }

  /** Queue it and let go: the list above the tabs shows the rest. */
  const enqueue = (repoId: string, f: HfFile): void => {
    setError(null)
    void api()
      ?.hf.download(repoId, f.path, f.sizeBytes, f.sha256)
      .catch((e) => setError(ipcMessage(e)))
  }
  const jobFor = (repoId: string, path: string): DownloadJob | undefined =>
    downloads.find((j) => j.id === jobId(repoId, path))

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
          className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <p className="mt-3 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}

      {repos && !contents ? (
        <Section title={`${repos.length} · ${t('hf.tab')}`}>
          {repos.length === 0 ? (
            <Empty>{t('common.none')}</Empty>
          ) : (
            <Card>
              {repos.map((r) => (
                <ClickRow
                  key={r.id}
                  onClick={
                    busy !== null
                      ? undefined
                      : () =>
                          void guard('repo', async () => {
                            const c = await api()?.hf.repo(r.id)
                            if (c) setContents(c)
                          })
                  }
                >
                  <span className="truncate text-sm font-medium">{r.id}</span>
                  <div className="flex-1" />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    <b className="text-sm text-foreground">
                      {(r.downloads ?? 0).toLocaleString('en-US')}
                    </b>{' '}
                    {t('hf.downloads')}
                  </span>
                </ClickRow>
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
                job={jobFor(contents.repoId, f.path)}
                onDownload={() => enqueue(contents.repoId, f)}
              />
            ))}
            {contents.projectors.map((f) => (
              <div key={f.path} className="flex items-center gap-2 px-4 py-2.5">
                <span className="truncate text-sm">{f.path}</span>
                <Badge>{t('hf.projector')}</Badge>
                <Badge>{bytes(f.sizeBytes)}</Badge>
                <div className="flex-1" />
                <ProjectorAction job={jobFor(contents.repoId, f.path)} onDownload={() => enqueue(contents.repoId, f)} />
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

/** A projector's button, or its place in the queue. */
function ProjectorAction({
  job,
  onDownload,
}: {
  job: DownloadJob | undefined
  onDownload: () => void
}): JSX.Element {
  const t = useT()
  if (job && job.status !== 'paused' && job.status !== 'failed')
    return (
      <Badge tone={job.status === 'done' ? 'ok' : 'brand'}>
        {t(`dl.status.${job.status}` as StringKey)}
      </Badge>
    )
  return (
    <Button size="sm" variant="ghost" onClick={onDownload}>
      <Download className="size-3.5" />
    </Button>
  )
}

function FileRow({
  file,
  hardware,
  profile,
  job,
  onDownload,
}: {
  file: HfFile
  hardware: Hardware
  profile: Profile
  /** This file's place in the queue, if it has one. */
  job: DownloadJob | undefined
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
  const percent =
    job && job.totalBytes > 0 ? Math.min(100, (job.receivedBytes / job.totalBytes) * 100) : 0

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{file.path}</span>
        {file.quant ? <Badge tone="brand">{file.quant}</Badge> : null}
        <Badge>{bytes(file.sizeBytes)}</Badge>
        <Badge
          tone={
            verdict.level === 'fits' ? 'ok' : verdict.level === 'tight' ? 'warn' : 'bad'
          }
        >
          {t(`verdict.${verdict.level}`)}
        </Badge>
        <div className="flex-1" />
        {job && job.status !== 'paused' && job.status !== 'failed' ? (
          // Its state, from the list; the buttons for it are up there too.
          <Badge tone={job.status === 'done' ? 'ok' : 'brand'}>
            {t(`dl.status.${job.status}` as StringKey)}
            {job.status === 'downloading' ? ` · ${Math.floor(percent)}%` : ''}
          </Badge>
        ) : (
          <Button
            size="sm"
            variant={verdict.level === 'wont_fit' ? 'ghost' : 'outline'}
            onClick={onDownload}
          >
            <Download className="mr-2 size-3.5" />
            {job ? t('dl.resume') : t('hf.download')}
          </Button>
        )}
      </div>
    </div>
  )
}
