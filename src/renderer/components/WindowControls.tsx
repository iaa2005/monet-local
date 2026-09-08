import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useT } from '@/stores/uiStore'

/**
 * Space the macOS traffic lights occupy at the header's left edge. Rendered
 * at the START of the title bar, on darwin only.
 */
export function MacTrafficLightInset(): JSX.Element {
  if (api()?.platform !== 'darwin') return <></>
  return <div aria-hidden className="h-full w-[72px] shrink-0" />
}

/**
 * Minimize / maximize-restore / close for the frameless window.
 *
 * A FIXED layer above everything, with an in-flow spacer holding its place in
 * the header: the window must stay minimizable and closable even when a modal
 * is open, or the dialog takes the whole window hostage.
 */
export function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const t = useT()
  const isMac = api()?.platform === 'darwin'

  useEffect(() => {
    if (isMac) return
    void api()?.win.isMaximized().then(setMaximized)
    return api()?.win.onMaximizeChange(setMaximized)
  }, [isMac])

  // macOS draws its own traffic lights top-left; a second set on the right
  // would give the window two.
  if (isMac) return <></>

  // 46px is the Windows caption-button width; the height comes from the title
  // bar's own token, so a hover block can never overhang the bar.
  const base =
    'app-no-drag flex h-full w-[46px] items-center justify-center text-muted-foreground transition-colors'
  const hover =
    'hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]'

  return (
    <>
      <div aria-hidden className="h-full w-[138px] shrink-0" />
      <div className="app-no-drag fixed right-0 top-0 z-[200] flex h-[var(--titlebar-h)] items-stretch">
        <button
          type="button"
          title={t('window.minimize')}
          aria-label={t('window.minimize')}
          onClick={() => void api()?.win.minimize()}
          className={`${base} ${hover}`}
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          title={maximized ? t('window.restore') : t('window.maximize')}
          aria-label={maximized ? t('window.restore') : t('window.maximize')}
          onClick={() => void api()?.win.toggleMaximize()}
          className={`${base} ${hover}`}
        >
          {maximized ? (
            <Copy className="size-3.5 -scale-x-100" />
          ) : (
            <Square className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          title={t('window.close')}
          aria-label={t('window.close')}
          onClick={() => void api()?.win.close()}
          className={`${base} hover:bg-red-500 hover:text-white`}
        >
          <X className="size-4" />
        </button>
      </div>
    </>
  )
}
