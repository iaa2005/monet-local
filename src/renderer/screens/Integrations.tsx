import { useCallback, useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, PageHeader, Section } from '@/components/ui/page'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useT } from '@/stores/uiStore'
import type { AppSettings, EndpointInfo } from '../../preload/index.js'

export function Integrations(): JSX.Element {
  const t = useT()
  const [ep, setEp] = useState<EndpointInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [host, setHost] = useState('127.0.0.1')

  const refresh = useCallback(async () => {
    const [e, s] = await Promise.all([
      api()?.server.endpoint(),
      api()?.settings.get(),
    ])
    if (e) setEp(e)
    if (s) setSettings(s)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!ep || !settings) return <div />

  const base = `http://${ep.networkAccess ? host : '127.0.0.1'}:${ep.port}`
  const key = ep.apiKey ?? ''

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    const s = await api()?.settings.set(patch)
    if (s) setSettings(s)
    await refresh()
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <PageHeader title="integrations.title" blurb="integrations.blurb" />

      {!ep.running ? (
        <p className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          {t('integrations.notRunning')}
        </p>
      ) : null}

      <Section title={t('integrations.codeMonet')}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('integrations.codeMonetHow')}
        </p>
        <Card>
          <Row label={t('integrations.baseUrl')} value={`${base}/v1`} />
          <Row
            label={t('integrations.apiKey')}
            value={key}
            placeholder={t('integrations.anyKey')}
          />
        </Card>
      </Section>

      <Section title={t('integrations.anthropic')}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('integrations.anthropicHow')}
        </p>
        <Card>
          <Row label="ANTHROPIC_BASE_URL" value={base} />
          <Row
            label="ANTHROPIC_API_KEY"
            value={key}
            placeholder={t('integrations.anyKey')}
          />
        </Card>
      </Section>

      <Section title={t('integrations.openai')}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('integrations.openaiHow')}
        </p>
        <Card>
          <Row label={t('integrations.baseUrl')} value={`${base}/v1`} />
        </Card>
      </Section>

      <Section title={t('integrations.network')}>
        <Card>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm">{t('integrations.network')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.networkAccess}
                onClick={() => {
                  // Turning this on without a key would put the model on the
                  // network for anyone who can reach the port.
                  if (!settings.networkAccess && !settings.apiKey) return
                  void save({ networkAccess: !settings.networkAccess })
                }}
                disabled={!settings.networkAccess && !settings.apiKey}
                className={cn(
                  'relative h-[22px] w-10 shrink-0 rounded-full border transition-colors disabled:opacity-50',
                  settings.networkAccess
                    ? 'border-brand bg-brand'
                    : 'border-brand/60 bg-brand-wash',
                )}
              >
                <span
                  className={cn(
                    'absolute top-[1px] size-[18px] rounded-full bg-white shadow transition-all',
                    settings.networkAccess ? 'left-[19px]' : 'left-[1px]',
                  )}
                />
              </button>
            </div>
            <p className="mt-2 max-w-prose text-xs text-muted-foreground">
              {t('integrations.networkHelp')}
            </p>
            {!settings.apiKey ? (
              <p className="mt-1 text-xs text-warn">
                {t('integrations.keyRequired')}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
            <span className="text-sm">{t('integrations.apiKey')}</span>
            <input
              className="h-8 w-56 rounded-md border border-input bg-background px-2 font-mono text-sm"
              value={settings.apiKey ?? ''}
              placeholder={t('integrations.anyKey')}
              onChange={(e) =>
                void save({ apiKey: e.target.value || undefined })
              }
            />
          </div>
          {settings.networkAccess ? (
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm">Host</span>
              {/* Shown so the address above is one another machine can use;
                  Monet Local does not guess which interface is the right one. */}
              <input
                className="h-8 w-56 rounded-md border border-input bg-background px-2 font-mono text-sm"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
          ) : null}
        </Card>
      </Section>
    </div>
  )
}

function Row({
  label,
  value,
  placeholder,
}: {
  label: string
  value: string
  placeholder?: string
}): JSX.Element {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="truncate rounded bg-muted px-2 py-1 text-xs">
          {value || placeholder}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          title={copied ? t('integrations.copied') : t('integrations.copy')}
          disabled={!value}
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? (
            <Check className="size-3.5 text-green-text" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  )
}
