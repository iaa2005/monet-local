import { describe, expect, it } from 'vitest'
import {
  exitLabel,
  exitMessage,
  parseInstanceExit,
} from './instance-exit.js'

/**
 * The line this exists for, copied out of the log it was found in.
 *
 * Everything downstream — the model row that says why it is no longer
 * loaded, the answer a client gets instead of "proxy error: Could not
 * establish connection" — reads this one line, so the parse is the contract.
 */
const REAL =
  '27.21.796.454 I srv    operator(): instance name=qwen3.8-27b-ud-iq4_xs exited with status -1073741819'

describe('a child server that died', () => {
  it('is read out of the router log', () => {
    const exit = parseInstanceExit(REAL)
    expect(exit?.id).toBe('qwen3.8-27b-ud-iq4_xs')
    expect(exit?.code).toBe(-1073741819)
    expect(exit?.crashed).toBe(true)
  })

  it('names the fault, because the number alone is unreadable', () => {
    // Every reproduction on this machine ended with this exact status, and
    // "-1073741819" is not something anyone can look at and understand.
    expect(exitLabel(-1073741819)).toContain('access violation')
    expect(exitLabel(-1073741819)).toContain('0xC0000005')
    expect(exitLabel(-1073740791)).toContain('0xC0000409')
  })

  it('does not dress an ordinary exit up as a fault', () => {
    expect(exitLabel(1)).toBe('exit code 1')
    expect(parseInstanceExit('instance name=m exited with status 0')?.crashed).toBe(
      false,
    )
  })

  it('still says something about a fault it has no name for', () => {
    const label = exitLabel(-1073741234)
    expect(label).toContain('fault')
    expect(label).toContain('0x')
  })

  it('ignores every other line in the log', () => {
    for (const line of [
      '27.03.340.122 I srv  proxy_reques: proxying request to model qwen3.8-27b-ud-iq4_xs on port 58218',
      '0.13.881.256 I srv  llama_server: model loaded',
      'E srv    operator(): http client error: Could not establish connection',
      '',
    ]) {
      expect(parseInstanceExit(line), line).toBeNull()
    }
  })

  it('carries the model name into the message, and the lever to pull', () => {
    const msg = exitMessage(parseInstanceExit(REAL)!)
    expect(msg).toContain('qwen3.8-27b-ud-iq4_xs')
    expect(msg).toContain('access violation')
    // The advice is narrow because the evidence is: every reproduction was a
    // full GPU offload, and capping the layers fixed it.
    expect(msg).toContain('Layers on the GPU')
  })

  it('gives no advice for an ordinary exit — there is nothing to advise', () => {
    const msg = exitMessage(parseInstanceExit('instance name=m exited with status 3')!)
    expect(msg).toContain('exit code 3')
    expect(msg).not.toContain('Layers on the GPU')
  })
})
