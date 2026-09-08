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
  // Last, and the only entry that does not act on the machine.
  { id: 'handbook', label: 'nav.handbook', Icon: BookOpen },
]

export function Sidebar(): JSX.Element {
  const screen = useUi((s) => s.screen)
  const go = useUi((s) => s.go)
  const t = useT()

  return (
    <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2">
      {ITEMS.map(({ id, label, Icon }) => {
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
                // Selection is the brand wash with a real edge — the same
                // treatment every selected row in the app will get.
                ? 'bg-brand-wash text-foreground'
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
      })}
    </nav>
  )
}
