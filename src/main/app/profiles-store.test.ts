import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => mkdtempSync(join(tmpdir(), 'monet-local-profiles-')) },
}))

const { BUILT_IN, assignProfile, profileFor, setProfileFor, writeProfiles } =
  await import('./profiles-store.js')

beforeEach(() => {
  writeProfiles({
    profiles: BUILT_IN,
    assignments: {},
    defaultProfileId: 'fast',
  })
})

describe('setProfileFor', () => {
  it('does not write into the shared profile other models use', () => {
    // The whole point of forking. Editing the context in front of one model
    // must not change every other model that happens to sit on "Fast".
    setProfileFor('qwen-q4', { ctxSize: 32768 }, 'Qwen Q4')

    expect(profileFor('qwen-q4').values['ctxSize']).toBe(32768)
    expect(profileFor('some-other-model').values['ctxSize']).toBe(
      BUILT_IN[0]!.values['ctxSize'],
    )
  })

  it('keeps editing the same profile after the first fork', () => {
    setProfileFor('qwen-q4', { ctxSize: 32768 }, 'Qwen Q4')
    setProfileFor('qwen-q4', { ctxSize: 65536 }, 'Qwen Q4')

    const own = profileFor('qwen-q4')
    expect(own.values['ctxSize']).toBe(65536)
    // One profile, not one per edit.
    expect(own.id).toBe('model:qwen-q4')
  })

  it('gives each quant of a model its own settings', () => {
    // Model ids are per file, so Q4 and Q6 of the same model are different
    // models here — which is right: they do not fit the same way.
    setProfileFor('qwen-q4', { ctxSize: 32768 }, 'Qwen Q4')
    setProfileFor('qwen-q6', { ctxSize: 8192 }, 'Qwen Q6')

    expect(profileFor('qwen-q4').values['ctxSize']).toBe(32768)
    expect(profileFor('qwen-q6').values['ctxSize']).toBe(8192)
  })
})

describe('assignProfile', () => {
  it('moves a model onto an existing profile', () => {
    assignProfile('qwen-q4', 'long-context')
    expect(profileFor('qwen-q4').id).toBe('long-context')
  })

  it('forks again on the next edit rather than rewriting the built-in', () => {
    assignProfile('qwen-q4', 'long-context')
    setProfileFor('qwen-q4', { ctxSize: 4096 }, 'Qwen Q4')

    expect(profileFor('qwen-q4').values['ctxSize']).toBe(4096)
    expect(profileFor('anything-else').id).toBe('fast')
    // The built-in it was based on is untouched and still available.
    expect(
      BUILT_IN.find((p) => p.id === 'long-context')!.values['ctxSize'],
    ).toBe(131072)
  })
})
