import { useEffect } from 'react'
import { BarChart3 } from 'lucide-react'
import { api } from '@/lib/api'
import { Sidebar } from '@/components/Sidebar'
import {
  MacTrafficLightInset,
  WindowControls,
} from '@/components/WindowControls'
import { Integrations } from '@/screens/Integrations'
import { Models } from '@/screens/Models'
import { Placeholder } from '@/screens/Placeholder'
import { Runtimes } from '@/screens/Runtimes'
import { Server as ServerScreen } from '@/screens/Server'
import { Settings } from '@/screens/Settings'
import {
  applyTheme,
  isDark,
  useT,
  useUi,
  type ScreenId,
} from '@/stores/uiStore'

export default function App(): JSX.Element {
  const screen = useUi((s) => s.screen)
  const prefs = useUi((s) => s.prefs)
  const systemDark = useUi((s) => s.systemDark)
  const setSystemDark = useUi((s) => s.setSystemDark)
  const t = useT()

  useEffect(() => {
    applyTheme(isDark(prefs, systemDark))
    document.documentElement.lang = prefs.locale
  }, [prefs, systemDark])

  // Main owns the authoritative answer (it also repaints the window's own
  // background), but the media query keeps the page right even if that
  // message is ever missed.
  useEffect(() => {
    const off = api()?.prefs.onSystemThemeChange(setSystemDark)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', onMq)
    return () => {
      off?.()
      mq.removeEventListener('change', onMq)
    }
  }, [setSystemDark])

  return (
    <div className="flex h-full flex-col">
      <header className="app-drag flex h-[var(--titlebar-h)] shrink-0 items-center border-b border-border bg-sidebar">
        <MacTrafficLightInset />
        <span className="font-display px-3 text-[13px] font-semibold tracking-tight">
          {t('app.name')}
        </span>
        <div className="flex-1" />
        <WindowControls />
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin bg-background">
          {screen === 'settings' ? <Settings /> : <Screen id={screen} />}
        </main>
      </div>
    </div>
  )
}

function Screen({ id }: { id: Exclude<ScreenId, 'settings'> }): JSX.Element {
  switch (id) {
    case 'server':
      return <ServerScreen />
    case 'models':
      return <Models />
    case 'runtimes':
      return <Runtimes />
    case 'benchmark':
      return (
        <Placeholder title="benchmark.title" blurb="benchmark.blurb" Icon={BarChart3} />
      )
    case 'integrations':
      return <Integrations />
  }
}
