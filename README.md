# Monet Local

Local model server for Code Monet, built on llama.cpp. A server, not a chat.

- every `llama-server` flag, explained, with a memory estimator that says
  *why* something won't fit
- runtime packs for any backend llama.cpp builds (Vulkan, CUDA, ROCm, SYCL,
  OpenVINO, CPU, or your own build)
- one endpoint that speaks both the OpenAI and the Anthropic API — Code
  Monet, Claude Code, curl
- A/B benchmark for profiles

## Status

**M0 — scaffold. Done.** Electron shell in the Code Monet design with the
orange brand, English and Russian, light and dark, and a packaged installer.

**M1 — runtimes and models. Done.** Runtime packs install from a llama.cpp
release or from a folder of your own; each is probed for what hardware it can
actually see. The model library reads GGUF headers (never the weights) and
reports architecture, quantisation, context, MoE-or-dense, vision, an MTP
head, and what a token of context costs in KV cache.

**M2 — profiles, estimator, router. Done.** One flag registry feeds the form,
the command preview and the router's INI preset. The estimator says whether a
profile will run *and why not*, checked against two ceilings — RAM, and what
the GPU allocator will actually hand out. The router is llama.cpp's own
multi-model mode: models load and unload over HTTP, and only Monet Local
decides which.

**M3 — one port, both APIs. Done.** A gateway fronts the router: management
API at `/monet-local/v1`, the OpenAI and Anthropic APIs at `/v1`, one key, one
network toggle. `/v1/models` lists only what is loaded. An end-to-end test
loads a real 16 GB model and checks a completion, a streamed completion and an
Anthropic message all come back through it.

**M4 — the provider inside Code Monet. Done** (in the `monet` repo): a
provider kind whose model list is live, carrying each model's real context and
modalities instead of guesses.

**M5 — benchmark and the Hugging Face downloader. Done.** Two profiles
measured against each other with the memory-bandwidth ceiling shown beside
them, and a downloader that resumes and never lands a partial file in a model
folder.

Next: M6 — updater, polish, and the first release.

## Develop

```
npm install
npm run dev            # electron-vite, hot reload
npm run typecheck      # gate
npm test               # vitest on the pure modules
npm run package:local  # installer, on a dev box without Developer Mode
```

Plan and architecture: [docs/PLAN.md](docs/PLAN.md). Notes for agents:
[CLAUDE.md](CLAUDE.md). llama.cpp flag reference: [docs/reference](docs/reference).
