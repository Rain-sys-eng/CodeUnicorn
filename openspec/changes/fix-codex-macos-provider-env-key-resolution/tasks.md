# Tasks

- [x] Add provider-scoped environment resolver.
- [x] Parse all legal `model_providers.*.env_key` values generically.
- [x] Preserve inherited values and inject resolved values only into Codex child process.
- [x] Wire resolver into Codex app-server launch.
- [x] Add focused unit tests for key collection, framing, and invalid names.
- [x] Update backend guideline and foundation-design calibration.
- [x] Optimization: resolve all missing keys in one bounded login-shell invocation (no per-key spawns).
- [x] Optimization: relax shell allowlist to any absolute zsh/bash path, with platform default fallback when SHELL is unset.
- [x] Optimization: per-key framed markers so prefix-colliding names stay unambiguous; document Windows no-op and `-i` rationale.
- [x] Fix daemon bin module wiring: `cc_gui_daemon.rs` adds `#[path = "../codex/provider_env.rs"]` module and `codex::provider_env` shim (PR 原版导致 daemon bin E0433)。
- [x] Fix spec delta headers so `openspec validate --strict` passes (PR 原版缺 `## ADDED Requirements`、scenario 层级错)。
- [x] Run Rust tests with an available Cargo toolchain.（隔离 worktree：lib provider_env 8 passed；`cargo check --bin cc_gui_daemon` 无 E0433）
- [ ] Perform macOS Finder/Dock GUI smoke test with a shell-only provider key.
