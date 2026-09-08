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

Next: M2 — the flag registry, the memory estimator, and the router.

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
