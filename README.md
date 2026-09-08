# Monet Local

Local model server for Code Monet, built on llama.cpp. A server, not a chat.

- every `llama-server` flag, explained, with a memory estimator that says
  *why* something won't fit
- runtime packs for any backend llama.cpp builds (Vulkan, CUDA, ROCm, SYCL,
  OpenVINO, CPU, or your own build)
- one endpoint that speaks both the OpenAI and the Anthropic API — Code
  Monet, Claude Code, curl
- A/B benchmark for profiles

Plan and architecture: [docs/PLAN.md](docs/PLAN.md). Notes for agents:
[CLAUDE.md](CLAUDE.md). llama.cpp flag reference: [docs/reference](docs/reference).

Status: planning. First milestone is the Electron scaffold with the Monet
design tokens, orange brand, and a packaged `.exe`.
