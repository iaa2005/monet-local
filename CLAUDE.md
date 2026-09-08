# Monet Local — engineering notes

A server, not a chat. Monet Local runs llama.cpp's `llama-server` with every
flag explained and budgeted, manages runtime packs for any backend, indexes
GGUF models, benchmarks profiles, and exposes one endpoint that speaks both
the OpenAI and the Anthropic API. Code Monet (and Claude Code, curl, anything)
connects to it; all tuning happens here.

Read `docs/PLAN.md` first — decisions D1–D8, the management API, the Code
Monet integration (part 2), milestones. This file is the short version an
agent needs while editing.

## Stack (same as Code Monet, `D:\Projects\monet\desktop`)

Electron 33 · electron-vite 2 · React 19 · TypeScript 5.6 (strict) ·
Tailwind 4 · shadcn/react + radix-ui · zustand · zod · **lucide-react only**
(no hugeicons/@iconify) · electron-builder 25 (NSIS) · electron-updater
(GitHub Releases, repo `iaa2005/monet-local`).

Layout: `src/main` (Node: process control, management server, proxy) ·
`src/preload` (typed bridge, `window.local.*` by namespace) · `src/renderer`
(React) · `src/shared` (flag registry, types, i18n strings). Aliases `@main`,
`@shared`, `@/` = renderer, as in monet's tsconfig.

Brand: orange `oklch(67.1967% 0.201986 42.2057)` (#f65e00). No painting
background. Languages: en and ru, every user-visible string through i18n.
App icon source: `build/icon-source.png`.

## Commands

```
npm run dev          electron-vite dev (via scripts/dev-quiet.mjs)
npm run typecheck    gate, must be clean
npm test             vitest on pure modules
npm run package      electron-builder -> release/*.exe   (CI, or a dev box
                     with Windows Developer Mode on)
npm run package:local  same, minus rcedit -- see below
```

**Packaging on a Windows dev box.** `npm run package` needs to create symbolic
links while unpacking electron-builder's `winCodeSign` archive (it carries
macOS dylibs as symlinks), and Windows refuses that without administrator
rights or Developer Mode. The build then retries three times and dies with
`Cannot create symbolic link`, leaving `release/win-unpacked` and no
installer.

`npm run package:local` passes `--config.win.signAndEditExecutable=false`,
which skips the rcedit step that needs it. The installer builds; the only
loss is that the `.exe` carries Electron's default icon instead of ours.
CI runs the real `npm run package` on `windows-latest`, where symlinks work,
so shipped builds are unaffected. Turning on Developer Mode (Settings ->
Privacy & security -> For developers) makes the full build work locally too.

## Rules that came from real failures

- **The flag registry (`src/shared/flags/registry.ts`) is the only source of
  truth.** Form, CLI preview, presets, validation and the estimator all read
  it. Never build a command line anywhere else.
- **`--no-webui` always. Tools, MCP, `--agent` never.** Not in the registry,
  not in any preset. The server spends nothing on them.
- **Router mode, never `--models-dir`.** One `llama-server` router with a
  generated `--models-preset` INI and `--no-models-autoload`; models are
  loaded/unloaded with `POST /models/load|unload {"model": id}`. The
  `--models-dir` heuristic treats a folder as one model and picked the 22 GB
  Q6_K out of `Qwen3.8-27B-GGUF\` — the one that does not fit.
- **Downloads never land in a models folder until complete.** They go to
  `%APPDATA%/monet-local/downloads/*.part`; the router happily tried to load
  a half-downloaded GGUF.
- **`/v1/models` on the public port lists only `loaded` models.** The full
  list with statuses is `/monet-local/v1/models`. No JIT loading; a request
  for an unloaded model returns the router's `400 model not found`.
- **`--no-repack` defaults on.** Repack keeps a second copy of Q4_K weights;
  on 32 GB it turned a working model into a swap storm and a `0xC0000409`.
- **Bind `127.0.0.1` by default.** LAN mode is an explicit toggle and makes
  the API key mandatory.
- **Never spawn a second `llama-server` silently.** Scan for running ones,
  warn, offer to stop. Two of them fighting for RAM cost a day.
- **Runtime binaries never inside app.asar.** They live in
  `%APPDATA%/monet-local/runtimes/`; bundled ones ship via `extraResources`.
- **No native Node modules.** Everything llama.cpp is a child process; the
  management server and proxy are plain `node:http`.
- **Estimator output must name the reason** ("KV 16 GiB + weights 15.65 GiB
  > 27.7 GB RAM"), never just a red badge. That is the point of the app.
- **UMA GPUs share system RAM.** "GPU 17 GB" is subtracted from RAM, not
  added. Verdicts on iGPU use total RAM as the ceiling.
- **Model ids are stable slugs** from the filename (`qwen3.8-27b-q4_k_m`);
  they are what clients put in `model`. Do not use paths or display names.

## Style

Follow monet's code: English identifiers and comments; comments explain
*why* (what broke, what was measured), not what the line does. Small files
named after the one thing they do. Pure functions in `src/shared` and
`src/main/*/pure.ts` so they test without Electron.

## Reference material in this repo

- `docs/PLAN.md` — plan, API, open questions.
- `docs/reference/llama-server-help.txt` — full `--help` of b10826.
- `docs/reference/llama-bench-help.txt`.
- `docs/reference/release-b10826.json` — Windows asset list, test fixture.
- Measured facts for this machine: Appendix A of the plan — use them as
  estimator test cases.

## Testing without CUDA / other hardware

Dev machine: Ryzen 7840HS + Radeon 780M (Vulkan, UMA). Other backends are
exercised through the same backend-agnostic RuntimeManager with recorded
`--list-devices` fixtures and the recorded release JSON. Mark such packs
"untested" in the UI until a user confirms them.
