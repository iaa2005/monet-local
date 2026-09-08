import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => mkdtempSync(join(tmpdir(), 'monet-local-profiles-')) },
}))

const {
  SEED,
  assignProfile,
  createProfile,
  profileFor,
  removeProfile,
  renameProfile,
  setProfileValues,
  writeProfiles,
} = await import('./profiles-store.js')

beforeEach(() => {
  writeProfiles({
    profiles: [SEED],
    assignments: {},
    defaultProfileId: SEED.id,
  })
})

describe('the profiles are the user’s', () => {
  it('lets the one that ships be renamed and deleted like any other', () => {
    // Nothing here is protected. The seed exists so a fresh install has
    // something to show, not so the app can keep opinions the user did not
    // ask for.
    renameProfile(SEED.id, 'Мой профиль')
    expect(profileFor('any-model').name).toBe('Мой профиль')

    const { id } = createProfile('Second', { ctxSize: 4096 })
    const after = removeProfile(SEED.id)
    expect(after.profiles.map((p) => p.id)).toEqual([id])
  })

  it('re-seeds rather than leaving nothing to load a model with', () => {
    const after = removeProfile(SEED.id)
    expect(after.profiles).toHaveLength(1)
    expect(after.defaultProfileId).toBe(after.profiles[0]!.id)
  })
})

describe('createProfile', () => {
  it('starts from the values it is given, so duplicating is one call', () => {
    const { id } = createProfile('Copy of Default', SEED.values)
    const copy = (assignProfile('m', id)).profiles.find((p) => p.id === id)!
    expect(copy.values).toEqual(SEED.values)
    // A copy, not an alias: editing one must not move the other.
    setProfileValues(id, { ...SEED.values, ctxSize: 262144 })
    expect(profileFor('other')['values']['ctxSize']).toBe(
      SEED.values['ctxSize'],
    )
  })

  it('does not reuse an id that is still in use', () => {
    const a = createProfile('A').id
    const b = createProfile('B').id
    expect(a).not.toBe(b)
    removeProfile(a)
    // The freed id may come back — what matters is that nothing collides.
    const c = createProfile('C').id
    expect(c).not.toBe(b)
  })
})

describe('setProfileValues', () => {
  it('changes the profile, and so every model assigned to it', () => {
    // The deliberate behaviour of a named profile: shared is shared. The
    // screen says how many models use one, so this is visible in advance
    // rather than discovered afterwards.
    const { id } = createProfile('Shared', { ctxSize: 8192 })
    assignProfile('q4', id)
    assignProfile('q6', id)

    setProfileValues(id, { ctxSize: 32768 })

    expect(profileFor('q4').values['ctxSize']).toBe(32768)
    expect(profileFor('q6').values['ctxSize']).toBe(32768)
  })

  it('leaves models on other profiles alone', () => {
    const { id } = createProfile('Only q4', { ctxSize: 32768 })
    assignProfile('q4', id)

    setProfileValues(id, { ctxSize: 65536 })

    expect(profileFor('q4').values['ctxSize']).toBe(65536)
    expect(profileFor('q6').values['ctxSize']).toBe(SEED.values['ctxSize'])
  })
})

describe('removeProfile', () => {
  it('puts the models that used it back on the default', () => {
    const { id } = createProfile('Temporary', { ctxSize: 4096 })
    assignProfile('q4', id)

    removeProfile(id)

    expect(profileFor('q4').id).toBe(SEED.id)
  })

  it('hands the default over when the default is the one deleted', () => {
    const { id } = createProfile('Mine', { ctxSize: 4096 })
    const after = removeProfile(SEED.id)
    expect(after.defaultProfileId).toBe(id)
    expect(profileFor('anything').id).toBe(id)
  })
})

describe('assignProfile', () => {
  it('is per model, so per quant', () => {
    // Q4 and Q6 of one model are different files and different ids here,
    // which is right: they do not fit the machine the same way.
    const fast = createProfile('Fits on the GPU', { ctxSize: 8192 }).id
    const long = createProfile('Cache in RAM', { ctxSize: 131072 }).id
    assignProfile('qwen-q4', long)
    assignProfile('qwen-q6', fast)

    expect(profileFor('qwen-q4').values['ctxSize']).toBe(131072)
    expect(profileFor('qwen-q6').values['ctxSize']).toBe(8192)
  })
})
