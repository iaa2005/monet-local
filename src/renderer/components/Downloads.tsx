/**
 * The downloads, as a list a person can act on.
 *
 * Every row says what is true of the file right now — waiting, moving (this
 * far, this fast, this long to go), done, stopped, failed and why — and
 * offers the one or two things that make sense for that state: stop, resume,
 * or remove. It sits above both tabs of the Models screen, so a search for
 * the next model never hides the one on its way; the sidebar pill below is
 * the same list reduced to a line, for every other screen.
 */

import { Download, Pause, Play, Trash2, X } from 'lucide-react'
import type { DownloadJob } from '@shared/downloads.js'
import { bytes } from '@shared/format.js'
import { Button } from '@/components/ui/button'
import { Badge, Card, Section } from '@/components/ui/page'
import { activeSummary } from '@/lib/downloads'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useT, useUi } from '@/stores/uiStore'
import type { StringKey } from '@shared/i18n.js'

function eta(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return ''
  if (seconds < 90) return `${Math.ceil(seconds)} s`
  if (seconds < 5400) return `${Math.ceil(seconds / 60)} min`
  return `${(seconds / 3600).toFixed(1)} h`
}

export function DownloadsPanel({ jobs }: { jobs: DownloadJob[] }): JSX.Element | null {
  const t = useT()
  if (jobs.length === 0) return null
  const finished = jobs.filter((j) => j.status === 'done').length
  return (
    <Section
      title={t('dl.title')}
      actions={
        finished ? (
          <Button size="sm" variant="ghost" onClick={() => void api()?.hf.clearFinished()}>
            {t('dl.clear')}
          </Button>
        ) : undefined
      }
    >
      <Card>
        {jobs.map((j) => (
          <Row key={j.id} job={j} />
        ))}
      </Card>
    </Section>
  )
}

function Row({ job: j }: { job: DownloadJob }): JSX.Element {
  const t = useT()
  const percent = j.totalBytes > 0 ? Math.min(100, (j.receivedBytes / j.totalBytes) * 100) : 0
  const tone =
    j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : j.status === 'paused' ? 'warn' : 'brand'
  const figures =
    j.status === 'done'
      ? bytes(j.totalBytes)
      : `${bytes(j.receivedBytes)} / ${bytes(j.totalBytes)}` +
        (j.status === 'downloading' && j.bytesPerSecond > 0
          ? ` · ${bytes(j.bytesPerSecond, 1)}/s${j.etaSeconds ? ` · ${eta(j.etaSeconds)}` : ''}`
          : '')
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          <span className="text-sm font-medium">{j.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{j.repoId}</span>
        </span>
        <Badge tone={tone}>{t(`dl.status.${j.status}` as StringKey)}</Badge>
        {j.status === 'downloading' || j.status === 'queued' ? (
          <Button size="sm" variant="outline" title={t('dl.pause')} onClick={() => void api()?.hf.cancel(j.id)}>
            <Pause className="mr-1.5 size-3.5" />
            {t('dl.pause')}
          </Button>
        ) : null}
        {j.status === 'paused' || j.status === 'failed' ? (
          <Button size="sm" variant="outline" title={t('dl.resume')} onClick={() => void api()?.hf.retry(j.id)}>
            <Play className="mr-1.5 size-3.5" />
            {t('dl.resume')}
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          title={j.status === 'done' ? t('dl.dismiss') : t('dl.remove')}
          onClick={() => void api()?.hf.remove(j.id)}
        >
          {j.status === 'done' ? <X className="size-3.5" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>
      {j.status !== 'done' ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              j.status === 'failed' ? 'bg-red-text' : j.status === 'paused' ? 'bg-warn' : 'bg-brand',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      <p className="mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
        <span>{figures}</span>
        {j.status === 'failed' && j.error ? <span className="text-red-text">{j.error}</span> : null}
        {j.status === 'paused' && j.receivedBytes > 0 ? <span>{t('dl.resumable')}</span> : null}
      </p>
    </div>
  )
}

/**
 * The same list as one line, for the sidebar: how many are moving and how
 * far along, together. Clicking goes to the list.
 */
export function DownloadsPill({ jobs }: { jobs: DownloadJob[] }): JSX.Element | null {
  const t = useT()
  const go = useUi((s) => s.go)
  const s = activeSummary(jobs)
  if (!s) return null
  return (
    <button
      type="button"
      onClick={() => go('models')}
      className="group mb-1 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-2">
        <Download className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t('dl.pill')} {s.active > 1 ? `· ${s.active}` : ''}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.percent}%</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${s.percent}%` }} />
      </div>
      {s.bytesPerSecond > 0 ? (
        <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">{bytes(s.bytesPerSecond, 1)}/s</div>
      ) : null}
    </button>
  )
}
