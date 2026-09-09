/**
 * The shape of a flag in the registry.
 *
 * One definition feeds the form, the command-line preview, the INI preset the
 * router is handed, the validation and the memory estimator. Nothing anywhere
 * else is allowed to compose a llama.cpp argument — the moment two places do
 * it, the preview stops matching what actually launches, and the preview is
 * the reason to trust the app.
 */

import type { Localized } from '../i18n.js'

export type FlagGroup =
  | 'model'
  | 'context'
  | 'memory'
  | 'gpu'
  | 'sampling'
  | 'reasoning'
  | 'speculative'
  | 'server'
  | 'advanced'

/** How much rope the user has asked for. */
export type FlagLevel = 'basic' | 'advanced' | 'expert'

/** Everything the estimator and the visibility rules get to look at. */
export interface Hardware {
  totalRamBytes: number
  /**
   * What is free RIGHT NOW, when the caller measured it. Optional: a stored
   * verdict has no "now". When present it is a second, tighter ceiling — see
   * the estimator for why the fixed reserve alone was not enough.
   */
  freeRamBytes?: number
  devices: {
    id: string
    name: string
    totalBytes: number
    freeBytes: number
    uma?: boolean
  }[]
}

export type FlagValue = string | number | boolean | undefined

/** A profile is values by flag id; anything absent means "llama.cpp's own". */
export type Profile = Record<string, FlagValue>

interface Base {
  /** Long CLI form, e.g. `--ctx-size`. Shown in the preview. */
  cli: string
  /**
   * INI key for `--models-preset`: the CLI name without its dashes. Absent
   * when a flag only makes sense on the router's own command line.
   */
  ini?: string
  group: FlagGroup
  level: FlagLevel
  label: Localized
  help: Localized
  /** Surfaced with a "recommended" hint when this holds. */
  recommendWhen?: (p: Profile, hw: Hardware) => boolean
  /** Hidden entirely when this is false — e.g. GPU flags with no GPU. */
  visibleWhen?: (p: Profile, hw: Hardware) => boolean
}

export interface BoolFlag extends Base {
  type: 'bool'
  default: boolean
  /**
   * The CLI flag turns something OFF (`--no-repack`, `--no-kv-offload`), so
   * `true` here means "pass the flag", and the INI writes `key = 0`.
   */
  negated?: boolean
}

export interface IntFlag extends Base {
  type: 'int'
  default?: number
  min?: number
  max?: number
  step?: number
  /** Powers of two the slider snaps through — context, batch sizes. */
  scale?: number[]
}

export interface EnumFlag extends Base {
  type: 'enum'
  default?: string
  options: { value: string; label: string }[]
}

export interface StringFlag extends Base {
  type: 'string'
  default?: string
  placeholder?: string
}

export type FlagDef = BoolFlag | IntFlag | EnumFlag | StringFlag
export type Registry = Record<string, FlagDef>
