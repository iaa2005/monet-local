# Monet Local — engineering notes

Desktop wrapper around llama.cpp's `llama-server`: every flag explained and
budgeted, runtime packs (Vulkan / CUDA / CPU), model library, memory
estimator, benchmark, chat, and a provider mode for Code Monet.

Read `docs/PLAN.md` first — decisions D1–D8, architecture, milestones. This
file is the short version an agent needs while editing.

## Stack (same as Code Monet, `D:\Projects\monet\desktop`)

Electron 33 · electron-vite 2 · React 19 · TypeScript 5.6 (strict) ·
Tailwind 4 (`@tailwindcss/postcss`) · shadcn/react + radix-ui · zustand ·
zod · lucide-react + hugeicons via @iconify · electron-builder 25 (NSIS) ·
electron-updater (GitHub Releases, repo `iaa2005/monet-local`).

Layout: `src/main` (Node, process control) · `src/preload` (typed bridge,
`window.local.*` by namespace) · `src/renderer` (React) · `src/shared`
(code both sides must agree on: flag registry, types). Aliases `@main`,
`@shared`, `@/` = renderer — as in monet's tsconfig.

## Commands

```
npm run dev          electron-vite dev (via scripts/dev-quiet.mjs)
npm run typecheck    gate, must be clean
npm test             vitest on pure modules
npm run package      electron-builder → release/*.exe
```

## Rules that came from real failures

- **The flag registry (`src/shared/flags/registry.ts`) is the only source of
  truth.** Form, CLI preview, presets, validation and the estimator all read
  it. Never build a command line anywhere else.
- **`--no-repack` defaults on.** Repack keeps a second copy of Q4_K weights;
  on 32 GB it turned a working model into a swap storm and a `0xC0000409`.
- **Bind `127.0.0.1` by default.** Tools and MCP are opt-in;
  `exec_shell_command` is never in a default preset and carries a warning.
- **Never spawn a second `llama-server` silently.** Scan for running ones,
  warn, offer to stop. Two of them fighting for RAM cost a day.
- **Do not put runtime binaries inside app.asar.** They go to
  `%APPDATA%/monet-local/runtimes/`; bundled ones ship via `extraResources`.
- **No native Node modules.** Everything llama.cpp is a child process.
- **Estimator output must name the reason** ("KV 16 GiB + weights 15.65 GiB
  > 27.7 GB RAM"), never just a red badge. That is the whole point of the app.
- **UMA GPUs share system RAM.** "GPU 17 GB" is subtracted from RAM, not added.
  Verdicts on iGPU use total RAM as the ceiling.

## Style

Follow monet's code: English identifiers and comments; comments explain
*why* a thing is the way it is (what broke, what was measured), not what the
line does. Keep files small and named after the one thing they do. Prefer
pure functions in `src/shared` and `src/main/*/pure.ts` so they are testable
without Electron.

## Reference material in this repo

- `docs/PLAN.md` — the plan and open questions.
- `docs/reference/llama-server-help.txt` — full `--help` of b10826 (735 lines).
- `docs/reference/llama-bench-help.txt`.
- Measured facts for this machine: Appendix A of the plan. Use them as test
  cases for the estimator.

## Testing without CUDA hardware

The dev machine is a Ryzen 7840HS with a Radeon 780M (Vulkan, UMA). CUDA
paths are exercised through the same backend-agnostic RuntimeManager with
recorded `--list-devices` fixtures and a recorded release JSON. Mark the
CUDA pack "untested" in the UI until a user confirms it.
