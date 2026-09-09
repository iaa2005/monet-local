/**
 * Turning a profile into what actually launches.
 *
 * Two outputs from one registry walk: the argument list (what the preview
 * shows and what a single-model run uses) and the INI section the router is
 * handed. They must not drift, which is why they share this file and this
 * test — a preview that lies is worse than no preview.
 */

import { FLAGS } from './registry.js'
import type { FlagDef, FlagValue, Profile } from './types.js'

/**
 * Flags Monet Local sets itself, on every run, no matter the profile.
 *
 * `--no-webui` because this is a server and the built-in chat is dead weight.
 * Tools and MCP are absent for the same reason — see the registry's header.
 */
export const ALWAYS_ARGS = ['--no-webui'] as const
export const ALWAYS_INI: Record<string, string> = { webui: '0' }

function isSet(v: unknown): boolean {
  return v !== undefined && v !== null && v !== ''
}

/**
 * Fill in what the profile does not say.
 *
 * A registry `default` is Monet Local's own choice and is always emitted,
 * because every one of them differs from llama.cpp's: `--no-repack` is off
 * upstream, `--ubatch-size` is 512, `--parallel` is auto, `--n-predict` is
 * unlimited. A flag we are happy to leave to llama.cpp simply has no default
 * here and stays absent until the user sets it.
 *
 * This is also what keeps the preview honest: everything the form shows is in
 * the profile, and everything in the profile is on the command line.
 */
export function withDefaults(profile: Profile): Profile {
  const out: Profile = { ...onlyCpu(profile) }
  for (const [id, def] of Object.entries(FLAGS)) {
    if (out[id] === undefined && 'default' in def && def.default !== undefined) {
      out[id] = def.default as FlagValue
    }
  }
  return out
}

/**
 * Whether this profile means "compute on the processor".
 *
 * Two settings say it and only one of them works. `--device none` takes the
 * backend out of the picture; `--n-gpu-layers 0` selects the backend and then
 * offloads nothing to it, which is a different thing and, on some models, a
 * fatal one — Qwen3.8-27B Q4_K_M dies at context creation with 0xC0000409 and
 * not a word of explanation, while the same model with `--device none` loads
 * in twenty seconds. The registry's help for both flags says so; this is
 * where the app stops relying on the user having read it.
 */
export function isCpuOnly(p: Profile): boolean {
  return p['device'] === 'none' || p['nGpuLayers'] === 0
}

/**
 * Zero layers, rewritten into the flag that means it.
 *
 * A silent rewrite needs justifying, and the justification is that there is
 * no second reading of "put zero layers on the GPU" — including when a
 * device is named beside it, since zero layers on that device is the same
 * sentence. The preview shows the result, so what launches is still what the
 * user is looking at.
 */
export function onlyCpu(p: Profile): Profile {
  if (p['nGpuLayers'] !== 0) return p
  const out: Profile = { ...p, device: 'none' }
  delete out['nGpuLayers']
  return out
}

/** The value a flag contributes, or undefined when it contributes nothing. */
function normalise(def: FlagDef, raw: unknown): string | boolean | undefined {
  if (def.type === 'bool') return raw === true ? true : undefined
  if (!isSet(raw)) return undefined
  return String(raw)
}

export interface BuildContext {
  /** Absolute path to the .gguf. Omitted for the router, which has the INI. */
  modelPath?: string
}

/** The command line, as the preview shows it and a direct run uses it. */
export function buildArgs(raw: Profile, ctx: BuildContext = {}): string[] {
  const profile = withDefaults(raw)
  const args: string[] = []
  if (ctx.modelPath) args.push('--model', ctx.modelPath)
  args.push(...ALWAYS_ARGS)

  for (const [id, def] of Object.entries(FLAGS)) {
    if (id === 'extraArgs') continue
    const v = normalise(def, profile[id])
    if (v === undefined) continue
    if (def.type === 'bool') {
      // `negated: true` means the CLI flag turns something off, so the flag
      // is present exactly when the setting is on.
      if (v === true) args.push(def.cli)
      continue
    }
    args.push(def.cli, v as string)
  }

  const extra = profile['extraArgs']
  if (typeof extra === 'string' && extra.trim()) {
    args.push(...splitArgs(extra))
  }
  return args
}

/**
 * Split a free-text argument string the way a shell would, honouring quotes.
 *
 * Needed because a path with a space in it is the normal case on Windows and
 * splitting on whitespace alone would hand llama.cpp two broken arguments.
 */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (const ch of s.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * One `[model-id]` section of the router's `--models-preset` file.
 *
 * INI keys are CLI names without their dashes; booleans are 1 and 0, so a
 * `--no-x` flag is written as `x = 0` rather than as its own key.
 */
export function buildIniSection(
  id: string,
  raw: Profile,
  modelPath: string,
  mmprojPath?: string,
): string {
  const profile = withDefaults(raw)
  const lines: string[] = [`[${id}]`, `model = ${modelPath}`]
  for (const [key, value] of Object.entries(ALWAYS_INI)) {
    lines.push(`${key} = ${value}`)
  }
  if (mmprojPath) lines.push(`mmproj = ${mmprojPath}`)

  for (const [flagId, def] of Object.entries(FLAGS)) {
    if (flagId === 'extraArgs' || !def.ini) continue
    if (flagId === 'mmproj') continue // handled above, from the library
    const v = normalise(def, profile[flagId])
    if (v === undefined) continue
    if (def.type === 'bool') {
      lines.push(`${def.ini} = ${def.negated ? '0' : '1'}`)
      continue
    }
    lines.push(`${def.ini} = ${v as string}`)
  }
  return lines.join('\n')
}

/**
 * The whole preset file: a `[*]` section of shared settings, then one per
 * model. `load-on-startup` is never written — Monet Local, and only Monet
 * Local, decides what is loaded.
 */
export function buildIni(
  entries: {
    id: string
    profile: Profile
    modelPath: string
    mmprojPath?: string
  }[],
): string {
  const parts = ['version = 1', '', '[*]', 'webui = 0', '']
  for (const e of entries) {
    parts.push(buildIniSection(e.id, e.profile, e.modelPath, e.mmprojPath), '')
  }
  return parts.join('\n')
}

/** The preview string, quoted so it can be pasted into a terminal. */
export function previewCommand(exe: string, args: string[]): string {
  const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s)
  return [quote(exe), ...args.map(quote)].join(' ')
}
