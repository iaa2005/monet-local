/**
 * The message an IPC failure should show.
 *
 * Electron wraps anything thrown in a main-process handler as
 * `Error invoking remote method 'runtimes:available': Error: …`, which puts
 * the channel name in front of the only part the reader needs. Worth
 * stripping: the first thing a user saw from this app was a GitHub rate-limit
 * notice behind two layers of plumbing.
 */
export function ipcMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^(Error|ReleaseLookupError|TypeError):\s*/, '')
    .trim()
}
