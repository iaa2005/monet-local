import { describe, expect, it } from 'vitest'
import {
  buildArgs,
  buildIniSection,
  isCpuOnly,
  previewCommand,
  splitArgs,
} from './build.js'
import { FLAGS } from './registry.js'
import type { Profile } from './types.js'

/** The profile that measured 4.31 tok/s on the dev machine. */
const FAST: Profile = {
  ctxSize: 8192,
  noRepack: true,
  threads: 8,
  ubatchSize: 256,
  reasoningEffort: 'low',
}

/** The one that fits 262144 into 32 GB — see Appendix A of the plan. */
const LONG: Profile = {
  ctxSize: 262144,
  noRepack: true,
  noKvOffload: true,
  flashAttn: 'on',
  cacheTypeK: 'q8_0',
  cacheTypeV: 'q4_0',
  threads: 8,
  ubatchSize: 256,
}

describe('buildArgs', () => {
  it('always disables the web UI', () => {
    // Monet Local is a server. The built-in chat is never wanted and never
    // paid for; this is not a profile setting anyone can turn back on.
    expect(buildArgs({})).toContain('--no-webui')
  })

  it('builds the fast profile', () => {
    expect(buildArgs(FAST, { modelPath: 'D:/m.gguf' })).toEqual([
      '--model',
      'D:/m.gguf',
      '--no-webui',
      '--ctx-size',
      '8192',
      '--no-repack',
      '--reasoning-effort',
      'low',
      '--n-predict',
      '4096',
      '--threads',
      '8',
      '--ubatch-size',
      '256',
      '--parallel',
      '1',
    ])
  })

  it('builds the long-context profile with both cache types', () => {
    const args = buildArgs(LONG)
    expect(args).toContain('--no-kv-offload')
    expect(args.join(' ')).toContain('--cache-type-k q8_0')
    expect(args.join(' ')).toContain('--cache-type-v q4_0')
    // Quantised KV needs flash attention; the profile says so explicitly
    // rather than relying on `auto` picking it.
    expect(args.join(' ')).toContain('--flash-attn on')
  })

  it('emits our defaults, because every one of them overrides llama.cpp', () => {
    // The tempting optimisation — drop anything sitting at its default to
    // keep the preview short — is wrong here: --no-repack is OFF upstream,
    // --ubatch-size is 512, --parallel is auto. Omitting them would show a
    // command that does something different from what the form promises.
    const args = buildArgs({})
    expect(args).toContain('--no-repack')
    expect(args.join(' ')).toContain('--ubatch-size 256')
    expect(args.join(' ')).toContain('--parallel 1')

    // A flag we are content to leave to llama.cpp carries no default and so
    // stays off the command line until someone sets it.
    expect(args).not.toContain('--cache-type-k')
    expect(args).not.toContain('--flash-attn')
  })

  it('turns a boolean off by removing the flag, not by negating it', () => {
    expect(buildArgs({ noRepack: false })).not.toContain('--no-repack')
    expect(buildArgs({ mlock: true })).toContain('--mlock')
    expect(buildArgs({ mlock: false })).not.toContain('--mlock')
  })

  it('appends extra arguments, respecting quotes', () => {
    const args = buildArgs({ extraArgs: '--chat-template-file "C:/a b/t.jinja"' })
    expect(args.slice(-2)).toEqual([
      '--chat-template-file',
      'C:/a b/t.jinja',
    ])
  })
})

describe('splitArgs', () => {
  it('keeps a quoted path with spaces in one piece', () => {
    // A path with a space is the normal case on Windows; splitting on
    // whitespace alone hands llama.cpp two broken arguments.
    expect(splitArgs('-m "D:/LM Studio/models/a.gguf" -c 8192')).toEqual([
      '-m',
      'D:/LM Studio/models/a.gguf',
      '-c',
      '8192',
    ])
  })
})

describe('buildIniSection', () => {
  it('writes a negated flag as key = 0, not as its own key', () => {
    const ini = buildIniSection('m', LONG, 'D:/m.gguf')
    expect(ini).toContain('repack = 0')
    expect(ini).toContain('kv-offload = 0')
    expect(ini).not.toContain('no-repack')
  })

  it('names the section after the model id and always kills the web UI', () => {
    const ini = buildIniSection('qwen3.8-27b-q4_k_m', FAST, 'D:/m.gguf')
    expect(ini.split('\n')[0]).toBe('[qwen3.8-27b-q4_k_m]')
    expect(ini).toContain('model = D:/m.gguf')
    expect(ini).toContain('webui = 0')
  })

  it('takes the projector from the library, not the profile', () => {
    // The library knows which mmproj sits beside which model; a profile
    // carrying a stale path would silently give the wrong model vision.
    const ini = buildIniSection('m', FAST, 'D:/m.gguf', 'D:/mmproj.gguf')
    expect(ini).toContain('mmproj = D:/mmproj.gguf')
  })

  it('uses the short INI keys llama.cpp expects', () => {
    const ini = buildIniSection('m', FAST, 'D:/m.gguf')
    expect(ini).toContain('c = 8192')
    expect(ini).toContain('ub = 256')
    expect(ini).toContain('np = 1')
  })
})

describe('registry', () => {
  it('offers no way to turn on the web UI, tools or MCP', () => {
    // These are the flags that would make the server spend memory and
    // attention on things Monet Local deliberately does not do.
    const clis = Object.values(FLAGS).map((f) => f.cli)
    for (const banned of ['--webui', '--tools', '--mcp-servers-config', '--agent']) {
      expect(clis).not.toContain(banned)
    }
  })

  it('gives every flag help in both languages', () => {
    for (const [id, def] of Object.entries(FLAGS)) {
      expect(def.label.en, id).toBeTruthy()
      expect(def.label.ru, id).toBeTruthy()
      expect(def.help.en, id).toBeTruthy()
      expect(def.help.ru, id).toBeTruthy()
    }
  })
})

describe('zero layers on the GPU', () => {
  // Measured, not guessed: Qwen3.8-27B Q4_K_M with `--n-gpu-layers 0` dies at
  // context creation with status 0xC0000409 and no message at all, and the
  // same model with `--device none` loads. The user's profile said 0 and the
  // app dutifully built the command that crashes.
  it('becomes --device none, not --n-gpu-layers 0', () => {
    const args = buildArgs({ nGpuLayers: 0 })
    expect(args).toContain('--device')
    expect(args[args.indexOf('--device') + 1]).toBe('none')
    expect(args).not.toContain('--n-gpu-layers')
  })

  it('is written the same way into the router preset', () => {
    const ini = buildIniSection('m', { nGpuLayers: 0 }, 'D:/m.gguf')
    expect(ini).toContain('device = none')
    expect(ini).not.toContain('n-gpu-layers')
  })

  it('leaves a real layer count alone', () => {
    const args = buildArgs({ nGpuLayers: 24 })
    expect(args).toContain('--n-gpu-layers')
    expect(args).not.toContain('--device')
  })

  it('wins over a device with nothing on it', () => {
    // "Zero layers on CUDA0" and "nothing on the GPU" are the same sentence,
    // and only one of the two spellings survives context creation.
    const args = buildArgs({ nGpuLayers: 0, device: 'CUDA0' })
    expect(args[args.indexOf('--device') + 1]).toBe('none')
  })

  it('reads both spellings as CPU only', () => {
    expect(isCpuOnly({ nGpuLayers: 0 })).toBe(true)
    expect(isCpuOnly({ device: 'none' })).toBe(true)
    expect(isCpuOnly({ nGpuLayers: 24 })).toBe(false)
    expect(isCpuOnly({})).toBe(false)
  })
})

describe('previewCommand', () => {
  it('quotes what a shell would need quoted', () => {
    expect(
      previewCommand('C:/a b/llama-server.exe', ['--model', 'D:/m.gguf']),
    ).toBe('"C:/a b/llama-server.exe" --model D:/m.gguf')
  })
})
