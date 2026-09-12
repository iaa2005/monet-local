/**
 * The update, offered — not performed behind the user's back.
 *
 * One card at the foot of the sidebar, and it says what is true right now:
 * a version is available (download it?), it is downloading (this far), it is
 * ready (relaunch — or just close the app when you are done and it installs
 * itself), or the download failed and here is why. Silent about "nothing
 * new": that answer lives on the Settings screen, where it can be asked for.
 *
 * Dismissable only in the sense that closing the app finishes the job:
 * autoInstallOnAppQuit is on, so "not now" is a real answer.
 */

import { useEffect, useState } from 'react'
import { ArrowRight, Download, RotateCw, X } from 'lucide-react'
import { bytes } from '@shared/format.js'
import { useUpdateState } from '@/lib/updates'
import { useT } from '@/stores/uiStore'

export function UpdatePill(): JSX.Element | null {
  const t = useT()
  const { state, check, download, install } = useUpdateState()
  // Hidden for this run only: a new state is news again, so a pill dismissed
  // while it said "failed" comes back when the download starts working.
  const [hidden, setHidden] = useState(false)
  useEffect(() => setHidden(false), [state.status])

  if (hidden) return null
  if (state.status === 'idle' || state.status === 'checking') return null

  const row =
    'group mb-1 flex w-full items-center gap-2.5 rounded-lg border border-brand-edge bg-brand-wash px-2.5 py-2 text-left transition-colors hover:bg-accent'

  if (state.status === 'downloading')
    return (
      <div className="mb-1 w-full rounded-lg border border-border bg-card px-2.5 py-2">
        <div className="flex items-center gap-2">
          <Download className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {t('update.downloading')} v{state.version}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {state.percent}%
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${state.percent}%` }}
          />
        </div>
      </div>
    )

  if (state.status === 'ready')
    return (
      <button type="button" onClick={install} className={row}>
        <RotateCw className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{t('update.ready')}</span>
          <span className="block text-xs text-muted-foreground">
            v{state.version} — {t('update.readyHint')}
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
    )

  if (state.status === 'error')
    return (
      <div className="mb-1 w-full rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{t('update.failed')}</span>
            <span className="block break-words text-xs text-muted-foreground">
              {state.message}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setHidden(true)}
            aria-label={t('update.dismiss')}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => (state.version ? download() : void check())}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          <RotateCw className="size-3.5" />
          {t('update.retry')}
        </button>
      </div>
    )

  // available — the offer itself. Nothing has been downloaded yet.
  return (
    <button type="button" onClick={download} className={row}>
      <Download className="size-4 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{t('update.available')}</span>
        <span className="block text-xs text-muted-foreground">
          {t('update.download')} v{state.version}
          {state.bytes ? ` — ${bytes(state.bytes, 0)}` : ''}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
