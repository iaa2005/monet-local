/**
 * When a model's own server dies, say so.
 *
 * The router spawns a child `llama-server` per model. If that child dies, the
 * router itself is fine — it keeps answering, keeps listing, and forwards the
 * next request to a port with nobody behind it. What the client gets back is:
 *
 *   API 500: proxy error: Could not establish connection
 *
 * Which says nothing. The truth was in the router's log the whole time:
 *
 *   instance name=qwen3.8-27b-ud-iq4_xs exited with status -1073741819
 *
 * `-1073741819` is `0xC0000005`, an access violation. Measured on this
 * machine, with that model: it loads, it reads a 12,000-token prompt at 47
 * tok/s, and it dies on the FIRST generated token — every time, and only with
 * every layer on the GPU. At 62 of 64 layers the same file, the same profile
 * and the same context run fine. So the file is not corrupt and the prompt is
 * not too long, which are the two things anyone would try first.
 *
 * This module turns that log line into something a person can act on. It does
 * NOT predict the crash: the estimator's own calibration case (a LARGER model
 * whose weights take 15.8 GiB on the same device) runs happily with every
 * layer offloaded, so "the device is full" is measurably not the rule, and a
 * guess dressed as a verdict would be worse than the silence it replaced.
 */

/** One child server that stopped on its own. */
export interface InstanceExit {
  /** The model id, as the router names it. */
  id: string
  /** Raw exit status, as reported. */
  code: number
  /** What that status is called, when it is a known one. */
  label: string
  /** True for the signatures that mean "the process was killed by a fault". */
  crashed: boolean
}

/**
 * Windows NTSTATUS codes a llama.cpp child actually dies with, as Node
 * reports them (signed 32-bit).
 */
const STATUS: Record<number, string> = {
  [-1073741819]: 'access violation (0xC0000005)',
  [-1073740791]: 'stack buffer overrun (0xC0000409)',
  [-1073741571]: 'stack overflow (0xC00000FD)',
  [-1073741801]: 'out of memory (0xC0000017)',
  [-1073741795]: 'illegal instruction (0xC000001D)',
  [-1073741676]: 'integer divide by zero (0xC0000094)',
}

export function exitLabel(code: number): string {
  const known = STATUS[code]
  if (known) return known
  if (code < 0) {
    // Any other negative status is still a fault, just not one we name.
    return `fault ${code} (0x${(code >>> 0).toString(16).toUpperCase()})`
  }
  return `exit code ${code}`
}

/**
 * Read one router log line, or null if it is not a child's death.
 *
 * Matched loosely on purpose: the router's log format carries a timestamp, a
 * level and a function name that have all changed between builds, and the
 * only parts worth depending on are the name and the status.
 */
export function parseInstanceExit(line: string): InstanceExit | null {
  const m = /instance name=(\S+) exited with status (-?\d+)/.exec(line)
  if (!m) return null
  const code = Number(m[2])
  return {
    id: m[1]!,
    code,
    label: exitLabel(code),
    crashed: code < 0,
  }
}

/**
 * What to tell someone whose request just failed because of this.
 *
 * The advice is narrow because the evidence is: every reproduction of the
 * fault above was a full GPU offload, and capping the layers fixed it without
 * costing measurable speed. It is offered as the thing to try, not as the
 * diagnosis — an ordinary non-zero exit gets no advice at all.
 */
export function exitMessage(exit: InstanceExit): string {
  const head = `The server for "${exit.id}" stopped on its own: ${exit.label}.`
  if (!exit.crashed) return `${head} It is no longer loaded.`
  return (
    `${head} The model is no longer loaded, so requests to it fail until it ` +
    `is started again. A fault like this usually happens with every layer on ` +
    `the GPU — try setting "Layers on the GPU" a little below the model's ` +
    `layer count in its profile, and restart the server. The full reason, if ` +
    `there is one, is in this run's router log.`
  )
}
