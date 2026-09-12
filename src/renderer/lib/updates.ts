/**
 * What the updater is doing, for whoever wants to show it.
 *
 * Two places ask: the pill in the sidebar, which appears only when there is
 * something to say, and the About block in Settings, where a person who
 * suspects the app has stopped looking can ask it directly and get an
 * answer either way. The automatic check is silent about failures — an
 * offline laptop is Tuesday — so "no pill" means BOTH "up to date" and "the
 * check never reached GitHub". The manual one tells them apart, which is
 * why check() is exposed rather than implied.
 */

import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '../../main/app/updater.js'
import { api } from '@/lib/api'

export type { UpdateState }

export interface UpdateHandle {
  state: UpdateState
  /** The version running right now, once main has answered. */
  current: string
  /** True while a manual check is in flight. */
  checking: boolean
  /** True once a manual check came back with nothing — "up to date". */
  checked: boolean
  check: () => Promise<void>
  download: () => void
  install: () => void
}

export function useUpdateState(): UpdateHandle {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [current, setCurrent] = useState('')
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    void api()
      ?.updates.state()
      .then((s) => s && setState(s))
      .catch(() => undefined)
    void api()
      ?.updates.currentVersion()
      .then((v) => v && setCurrent(v))
      .catch(() => undefined)
    return api()?.updates.onState((s) => {
      setState(s)
      if (s.status !== 'idle') setChecked(false)
    })
  }, [])

  const check = useCallback(async () => {
    setChecking(true)
    setChecked(false)
    try {
      const s = await api()?.updates.check()
      if (s) {
        setState(s)
        if (s.status === 'idle') setChecked(true)
      }
    } finally {
      setChecking(false)
    }
  }, [])

  return {
    state,
    current,
    checking,
    checked,
    check,
    download: () => void api()?.updates.download(),
    install: () => void api()?.updates.install(),
  }
}
