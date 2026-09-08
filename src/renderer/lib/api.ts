import type { LocalAPI } from '../../preload/index.js'

/**
 * The preload bridge, or undefined.
 *
 * Undefined happens in exactly one place — a component rendered outside
 * Electron (a test, a storybook page). Every call site treats it as optional
 * rather than asserting, so a missing bridge degrades to a dead button
 * instead of a white screen.
 */
export function api(): LocalAPI | undefined {
  return (window as unknown as { local?: LocalAPI }).local
}
