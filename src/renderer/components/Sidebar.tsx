import {
  BarChart3,
  BookOpen,
  Boxes,
  Cpu,
  Plug,
  Server,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react'
import { DownloadsPill } from '@/components/Downloads'
import { UpdatePill } from '@/components/UpdatePill'
import { useDownloads } from '@/lib/downloads'
import { cn } from '@/lib/utils'
import { useT, useUi, type ScreenId } from '@/stores/uiStore'
import type { StringKey } from '@shared/i18n.js'

const ITEMS: { id: ScreenId; label: StringKey; Icon: LucideIcon }[] = [
  { id: 'server', label: 'nav.server', Icon: Server },
  { id: 'models', label: 'nav.models', Icon: Boxes },
  { id: 'runtimes', label: 'nav.runtimes', Icon: Cpu },
  { id: 'benchmark', label: 'nav.benchmark', Icon: BarChart3 },
  { id: 'integrations', label: 'nav.integrations', Icon: Plug },
  { id: 'settings', label: 'nav.settings', Icon: SettingsIcon },
]

/**
 * Pinned to the bottom, away from the rest.
 *
 * It is the one entry that does nothing to the machine — reading it cannot
 * start, stop or load anything — so it does not belong in a list of things
 * that can.
 */
const FOOT: typeof ITEMS = [
  { id: 'handbook', label: 'nav.handbook', Icon: BookOpen },
]

export function Sidebar(): JSX.Element {
  const screen = useUi((s) => s.screen)
  const go = useUi((s) => s.go)
  const t = useT()
  const downloads = useDownloads()

  const item = ({ id, label, Icon }: (typeof ITEMS)[number]): JSX.Element => {
    const active = screen === id
    return (
      <button
        key={id}
        type="button"
        onClick={() => go(id)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
          active
            // Selection is the brand wash, and the label takes the brand
            // colour too — the icon alone was not enough of a mark.
            ? 'bg-brand-wash text-brand'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
        )}
      >
        <Icon
          className={cn('size-4 shrink-0', active && 'text-brand')}
          strokeWidth={active ? 2.25 : 2}
        />
        {t(label)}
      </button>
    )
  }

  return (
    <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2">
      {ITEMS.map(item)}
      <div className="flex-1" />
      {/* Above the handbook, below everything that acts on the machine:
          an update is offered here and never installed unasked. */}
      <DownloadsPill jobs={downloads} />
      <UpdatePill />
      {FOOT.map(item)}
    </nav>
  )
}
