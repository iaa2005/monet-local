/**
 * Clients that cannot send a system prompt the way a chat template expects.
 *
 * Measured against Qwen3.5's template (llama.cpp b11712): it raises
 * "System message must be at the beginning" for any message with role
 * `system` that is not the first one in the list. Claude Desktop, routed
 * through a provider switcher, sends a top-level `system` AND a system-role
 * message, so every request fails with a 500 and the client retries ten
 * times before giving up.
 *
 * The template belongs to the model and is not ours to edit. What this does
 * instead is the one thing every such template agrees on: all system text
 * becomes a single leading system message. Order is preserved, text blocks
 * keep their `cache_control`, and every other message stays where it was.
 */

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSystem(m: unknown): m is Json {
  return isObject(m) && (m['role'] === 'system' || m['role'] === 'developer')
}

/** System content as Anthropic text blocks, whatever shape it arrived in. */
function textBlocks(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) return []
  return content.filter(
    (b): b is Json => isObject(b) && b['type'] === 'text',
  )
}

/**
 * Anthropic Messages: move every system-role message into `system`.
 *
 * A system message in the middle of the conversation is not something the
 * API describes, but it is what arrives; keeping its text and moving it is
 * closer to the client's intent than dropping it.
 */
function normaliseAnthropic(body: Json): boolean {
  const messages = body['messages']
  if (!Array.isArray(messages)) return false

  const kept: unknown[] = []
  const moved: Json[] = []
  for (const m of messages) {
    if (isSystem(m)) moved.push(...textBlocks(m['content']))
    else kept.push(m)
  }
  if (moved.length === 0) return false

  body['messages'] = kept
  body['system'] = [...textBlocks(body['system']), ...moved]
  return true
}

/** One content value for the merged OpenAI system message. */
function mergeContent(contents: unknown[]): unknown {
  const parts: unknown[] = []
  for (const c of contents) {
    if (typeof c === 'string') {
      if (c) parts.push({ type: 'text', text: c })
    } else if (Array.isArray(c)) {
      parts.push(...c)
    }
  }
  const texts = parts.filter((p) => isObject(p) && p['type'] === 'text')
  if (texts.length === parts.length) {
    // Plain text all the way: a string is what most templates render, and
    // it keeps the body small.
    const joined = texts
      .map((p) => String((p as Json)['text'] ?? ''))
      .filter(Boolean)
      .join('\n\n')
    return joined
  }
  return parts
}

/**
 * OpenAI Chat Completions: one leading system message, the rest in order.
 *
 * A single system message already at index 0 is left exactly as it is — that
 * is the shape every template accepts, and re-encoding it would only churn
 * the bytes.
 */
function normaliseOpenAI(body: Json): boolean {
  const messages = body['messages']
  if (!Array.isArray(messages)) return false

  const system = messages.filter(isSystem)
  if (system.length === 0) return false
  if (system.length === 1 && messages[0] === system[0]) return false

  const rest = messages.filter((m) => !isSystem(m))
  body['messages'] = [
    { role: 'system', content: mergeContent(system.map((m) => m['content'])) },
    ...rest,
  ]
  return true
}

/**
 * The body to send upstream, or undefined when the request is already in the
 * shape the template accepts (or is not one we understand).
 */
export function normaliseChatBody(
  path: string,
  raw: string,
): string | undefined {
  const route = path.split('?')[0]
  if (route !== '/v1/messages' && route !== '/v1/chat/completions') {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isObject(parsed)) return undefined

  const changed =
    route === '/v1/messages'
      ? normaliseAnthropic(parsed)
      : normaliseOpenAI(parsed)
  return changed ? JSON.stringify(parsed) : undefined
}
