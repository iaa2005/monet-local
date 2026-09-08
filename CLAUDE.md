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
- **`-ngl 0` is NOT how you run on the CPU. `--device none` is.** With a
  GPU-capable build, zero offloaded layers leaves the backend selected, and on
  a hybrid model llama.cpp aborts the process outright -- exit `0xC0000409`,
  no message, right after "llama threadpool init". Cost half an hour to find;
  the registry now has a device flag and the estimator keys off it.
- **A GGUF header can be valid while the weights are missing.** A download in
  progress listed itself as a model, went into the router's preset and died at
  load time. The reader compares the last tensor's offset against the file
  size and refuses.
- **`--list-devices` free memory is not what you can allocate.** On a
  shared-memory GPU it ignores what other applications have reserved: with
  Photoshop open, llama.cpp could not allocate 150 MB while the same call
  still reported 17373 MiB free. Never present that number as headroom.
- **The Anthropic response puts thinking FIRST.** `content[0]` is a
  `thinking` block; the answer is a later `text` one. A client that reads
  `content[0].text` renders an empty message.
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

## llama-bench is not llama-server

They are different programs with different argument sets, and llama-bench
**exits** on an argument it does not know rather than ignoring it — so a
wrong flag does not degrade a measurement, it kills the run. Verify against
`llama-bench --help` on the installed build before adding one; do not infer
it from the server's flag registry. Two that do not carry across:

- There is no `-c`/`--ctx-size`. Context is expressed as **depth** (`-d`):
  the cache is sized from prompt + generation + depth. Passing `-c` is what
  produced `invalid parameter for argument: -c`.
- There is no `--no-repack` and no equivalent. The setting this app exists to
  get right is the one a benchmark cannot vary, so it is reported as
  uncovered rather than quietly assumed.

Runs measured at different depths are not comparable: generation slows as the
cache fills, so a ratio across depths reports the depth, not the profile.
`BenchResult.depth` exists so the screen can refuse that comparison.

## A Router outlives its process

`Router` is a long-lived object; the llama-server it spawned is not. When the
child exits, the object stays, and a load sent afterwards reached the UI as a
bare `TypeError: fetch failed` with the ECONNREFUSED buried in its cause.
Every call that talks to the router checks the process first and corrects the
state on a failed connection, so the screen stops offering a button that
cannot work.

## "Not ours" is the hard half of stray detection

`findStrays` takes every pid this app is responsible for — the Electron
process **and** the router it spawned — and treats descendants as ours too,
because router mode starts a child llama-server per loaded model. Filtering
on the Electron pid alone is worthless: that pid is never a llama-server, so
the app listed its own router as someone else's and offered a button to kill
it. On Windows that kill is a TerminateProcess, i.e. **exit code 1**, so the
next Load failed with `llama-server exited with code 1` pointing at nothing
the user had done wrong. Use CIM, not `tasklist`: tasklist reports no parent,
and without parents there is no way to tell our own model children from
someone else's server.

## The router's load and unload are both asynchronous

Measured against the real binary: `POST /models/load` and `/models/unload`
each answer `200 {"success":true}` before anything has happened. An 8 GB
model reports `loading` for about ten seconds; an unload keeps reporting
`loaded` for about two. There is no event stream, so the Router polls
`/models` once a second while it is ready and pushes only when a status
actually changed.

`unload` waits for the model to settle; `load` does not, because a large
model takes minutes and the poll is what moves the screen on. Returning
early from an unload is what let a second click reach a model that was
already gone — `400 model is not running`.

## Settings reach a model only when it is loaded, and only from the preset

llama.cpp reads `--models-preset` once, at startup, and **ignores arguments
passed in a `/models/load` body** — measured: it answers 200 and loads the
preset's values anyway. So an edited profile changes nothing until the router
is restarted. Editing therefore only ever saves; `server:apply` is the
explicit action that restarts the router and reloads what was loaded. Never
apply on change: settings arrive a keystroke at a time and each apply
reloads a model.

The saved settings are the user's, and the UI calls them **configurations**.
Nothing in the list is protected: the single seed exists so a fresh install
has something to show, and it can be renamed or deleted like any other —
deleting the last one re-seeds. Editing edits the configuration itself, so
every model assigned to it moves together; the screen says how many that is
before the keystroke rather than after it. There is no fork-on-edit: creating
a configuration behind the user's back is the opposite of letting them manage
their own.

Naming: in code, `Profile` is the type for a bare set of flag values (used by
the estimator, the builder and the benchmark) and `NamedProfile` is the saved
entity the UI presents as a configuration. Keep user-facing strings on
"configuration".

Assignment is per model id, which is per file, so per quant — Q4 and Q6 of one
model do not fit the same way and do not share settings unless asked to.

## `general.name` is not the model's name

The common GGUF converters build it out of the Hugging Face repo id, and it
arrives mangled: `openai/gpt-oss-20b` becomes `Openai_Gpt Oss 20b`,
`Qwen/Qwen3.8-27B` becomes `Qwen_Qwen3.8 27B` — owner duplicated, every word
title-cased. The FILE name survives that trip, so `displayNameFor` takes the
filename with the packaging stripped (quantisation, `-NNNNN-of-NNNNN`, a
trailing `-GGUF`), turns the separators into spaces, and falls back to
metadata only for a file named something that identifies nothing
(`ggml-model-q4_0.gguf`).

**Order matters.** The quantisation comes off BEFORE the separators are
replaced: `Q4_K_M` and `IQ4_XS` are held together by the very characters
being replaced, and the other order yields "Qwen3.8 27B Q4 K M".

Invent no capitals on top of either. A rule that title-cased the first letter
would be wrong exactly where it showed: OpenAI writes it "gpt oss".

## The model index cache does not notice a code change

`models.json` is keyed on path + mtime + size — all properties of the FILE.
Change what `describeModel` produces and every already-indexed model keeps
its old description for good, because nothing will ever re-read a file that
was not touched. **Bump `DERIVATION` in library.ts** whenever the derivation
changes; a cache written under a different one is discarded whole.

## The Server screen shows the gateway's port

The router sits on 17172 and is internal. The number a user reads under
"Port" has to be the one a client connects to (the gateway, 17171) — the
router's own port honours neither the API key nor the network toggle.
`RouterStatus.port` is the wrong field for anything user-facing.

## No native `<select>`, and the context is a dial

Windows draws `<select>` in its own font at its own size with its own hover
colour, so one row of a form built out of them looked nothing like the row
above it. `components/ui/select.tsx` is the replacement; everything the
native control gave away for free is paid for there (arrows, Home/End, Enter,
Escape, click-away, scroll-into-view, opening upwards near the bottom of the
window). Do not reintroduce a bare `<select>`.

Context length is a log-scaled slider plus a number box, not a ladder of
powers of two. Linear would put 8192 at three percent of a track reaching
262144; a log track gives each doubling equal width, which is also how the
memory cost grows. The powers of two remain as clickable marks under it —
they are still what most people want — but values between them are legal,
cost real memory, and used to be unreachable.

## The pinned verdict is a SECOND bar, not the card collapsed

The memory verdict stays readable while the settings scroll under it. The
first attempt collapsed the card in place when it reached the top, and the
page shook: collapsing changed the document height, which moved the scroll,
which changed what was on screen, which collapsed or expanded it again.

Nothing in the flow may move. The card stays exactly as it is and a separate
compact bar is drawn when the card is out of view — hung off a `h-0` sticky
rail, so the form below is laid out as if neither existed. Verified by
measurement: `scrollHeight` is identical with the bar shown and hidden.

Two more things it needs. A sticky element is clamped to its containing
block, so the rail's parent has to be the tall one — wrap it in a `<div>`
fitted to it, even just for a margin, and it unsticks the moment the scroll
passes that div's height (measured: 802px above the viewport). And the scroll
container is `<main>`, not the window, so the IntersectionObserver that asks
"is the card still visible" is rooted there.

The pinned bar's glass is a plate that BLURS and does not tint. A gradient of
the page colour painted over the rows erased them; what is wanted is the rows
still being there and out of focus. It spans the scroller's full width, and
that width is MEASURED: `100vw` overshoots and then needs clipping, but
`overflow-x: clip` beside an `overflow-y: auto` computes to `hidden`, which
silently makes the page horizontally scrollable by two thousand pixels of
nothing. Centring with a transform does not land exactly either — the offset
to the scroller's edge is a number, so it is used as one.

## The handbook is content, not components

`src/renderer/handbook/{en,ru}.ts` are data — chapters of topics of typed
blocks — so both languages carry the same structure and the screen has one
renderer to keep right. The inline markup is three things wide: `$maths$`,
`` `code` `` and `**bold**`. Anything more is a markdown dependency plus a
sanitiser plus a theme, to get italics.

Its formulae are the ones this program actually computes, and each topic ends
with an `app` block naming where the number shows up. That is the whole
argument for a handbook inside the program rather than a link to one — and it
means a change to the estimator is a change to the handbook.

The first half follows the path of "The Welch Labs Illustrated Guide to AI"
(Stephen Welch, 2025). The prose is ours; the book is credited in the closing
topic, along with the note that the measurements come from one machine and do
not travel.

Its figures are TikZ, not hand-written SVG. `figures/*.tex` are the source;
`npm run figures` compiles them with `latex` → `dvisvgm --no-fonts` and
commits the SVG beside each one, with the LaTeX embedded in it as a comment
so the two cannot be separated. NOT part of `npm run build` — a TeX
installation has no business being required to build this app.

Two colours survive the compile and both are rewritten by the script: every
neutral grey becomes `currentColor`, and magenta becomes `hsl(var(--brand))`.
That is why the figures are inlined rather than `<img src>`: an image in its
own document cannot see this one's custom properties, and would come out
black on black in the dark theme. Anything a figure needs beyond those two
colours, it gets from `opacity`.
