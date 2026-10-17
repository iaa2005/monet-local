/**
 * `mlock` and `noMmap` are one llama.cpp setting, not two.
 *
 * The server used to take `--mlock` and `--no-mmap` separately. Both are
 * deprecated in favour of `--load-mode`, and from b11712 the old spelling is
 * gone from the preset parser too: a `mmap` key is rejected outright
 * ("option 'mmap' not recognized in preset"), the router dies before it
 * listens, and the screen shows "llama-server did not become ready" with
 * nothing else to go on.
 *
 * `--load-mode` has been in every build this app ships — the b10826 reference
 * help already lists it, with `--mmap` and `--mlock` marked DEPRECATED — so
 * the registry feeds this one value on every backend.
 *
 * Undefined means "leave llama.cpp alone", which is not the same as passing
 * its default explicitly.
 */
import type { Profile } from './types.js'

export function loadMode(profile: Profile): string | undefined {
  const mlock = profile['mlock'] === true
  const mmap = profile['noMmap'] !== true
  if (mlock && mmap) return 'mmap+mlock'
  if (mlock) return 'mlock'
  if (!mmap) return 'none'
  return undefined
}
