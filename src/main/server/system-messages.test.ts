import { describe, expect, it } from 'vitest'
import { normaliseChatBody } from './system-messages.js'

describe('normaliseChatBody', () => {
  it('moves a system message from the middle into the Anthropic system', () => {
    // Measured: Qwen3.5's template raises "System message must be at the
    // beginning" for exactly this shape, and Claude Desktop retries ten
    // times. The text is kept, not dropped.
    const body = JSON.stringify({
      model: 'm',
      system: 'Top.',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'system', content: 'Middle.' },
        { role: 'user', content: 'Say OK' },
      ],
    })
    const out = JSON.parse(normaliseChatBody('/v1/messages', body)!)
    expect(out.system).toEqual([
      { type: 'text', text: 'Top.' },
      { type: 'text', text: 'Middle.' },
    ])
    expect(out.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'Say OK' },
    ])
  })

  it('keeps cache_control when merging system blocks', () => {
    const body = JSON.stringify({
      system: [{ type: 'text', text: 'Cached.', cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'system', content: 'Also cached.' },
        { role: 'user', content: 'Hi' },
      ],
    })
    const out = JSON.parse(normaliseChatBody('/v1/messages', body)!)
    expect(out.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(out.system[1]).toEqual({ type: 'text', text: 'Also cached.' })
  })

  it('leaves an Anthropic body with no system messages alone', () => {
    expect(
      normaliseChatBody(
        '/v1/messages',
        JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      ),
    ).toBe(undefined)
  })

  it('leaves the one-system-first OpenAI shape alone', () => {
    // What every template accepts already; re-encoding it would churn bytes
    // and lose properties this module does not know about.
    expect(
      normaliseChatBody(
        '/v1/chat/completions',
        JSON.stringify({
          messages: [
            { role: 'system', content: 'Top.' },
            { role: 'user', content: 'Hi' },
          ],
        }),
      ),
    ).toBe(undefined)
  })

  it('lifts an OpenAI system message out of the middle', () => {
    const out = JSON.parse(
      normaliseChatBody(
        '/v1/chat/completions',
        JSON.stringify({
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'system', content: 'Later.' },
            { role: 'user', content: 'Say OK' },
          ],
        }),
      )!,
    )
    expect(out.messages[0]).toEqual({ role: 'system', content: 'Later.' })
    expect(out.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'user',
    ])
  })

  it('merges several OpenAI system messages, string or parts', () => {
    const out = JSON.parse(
      normaliseChatBody(
        '/v1/chat/completions',
        JSON.stringify({
          messages: [
            { role: 'system', content: 'One.' },
            { role: 'developer', content: [{ type: 'text', text: 'Two.' }] },
            { role: 'user', content: 'Hi' },
          ],
        }),
      )!,
    )
    expect(out.messages).toEqual([
      { role: 'system', content: 'One.\n\nTwo.' },
      { role: 'user', content: 'Hi' },
    ])
  })

  it('does not touch other routes or unparseable bodies', () => {
    expect(normaliseChatBody('/v1/models', '{"messages":[]}')).toBe(undefined)
    expect(normaliseChatBody('/v1/messages', 'not json')).toBe(undefined)
  })
})
