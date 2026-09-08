# Monet Local

Local model provider for Code Monet, built on llama.cpp.

The part LM Studio doesn't have: every `llama-server` flag with an
explanation, a memory estimator that says *why* something won't fit,
runtime packs for Vulkan / CUDA / CPU, an A/B benchmark, and a chat — in
the Code Monet design.

- Plan and architecture: [docs/PLAN.md](docs/PLAN.md)
- Engineering notes for agents: [CLAUDE.md](CLAUDE.md)
- llama.cpp flag reference: [docs/reference](docs/reference)

Status: planning. First milestone is the Electron scaffold with the Monet
design tokens and a packaged `.exe`.
