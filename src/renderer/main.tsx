import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// KaTeX brings its own fonts; imported once here so every formula in the
// handbook renders the same wherever it appears.
import 'katex/dist/katex.min.css'
import './styles/globals.css'
import { api } from './lib/api'
import { DEFAULT_PREFS } from '@shared/prefs.js'

// Before React mounts: main already read the prefs off disk synchronously and
// handed them over as a value, so the dark class lands on the first paint
// instead of a light frame flashing and then snapping.
const prefs = api()?.prefsAtStartup ?? DEFAULT_PREFS
const dark =
  prefs.theme === 'dark' ||
  (prefs.theme === 'system' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches)
document.documentElement.classList.toggle('dark', dark)
document.documentElement.lang = prefs.locale

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[renderer] unhandled render error', error, info.componentStack)
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', color: '#ef4444' }}>
        <h1>Monet Local crashed</h1>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {error.message}
          {'\n\n'}
          {error.stack}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            cursor: 'pointer',
            border: '1px solid currentColor',
            borderRadius: 6,
            padding: '8px 12px',
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
