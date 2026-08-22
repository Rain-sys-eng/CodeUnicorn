## 1. ACP terminal and execution configuration

- [x] 1.1 [P0] Make Qoder model/reasoning setters fail closed before `session/prompt`; add focused ACP error-path tests.
- [x] 1.2 [P0] Preserve typed Qoder cancel terminal, add bounded kill fallback, and test normal/cancel/forced-cancel settlement exactly once.
- [x] 1.3 [P1] Parse prompt usage into `EngineEvent::UsageUpdate`; test partial and absent usage payloads.

## 2. Native identity, discovery and history

- [x] 2.1 [P1] Route the existing Native Qoder `fork_session_id` contract through ACP `session/fork`, then use the returned child identity for `SessionStarted` / prompt; add focused validation.
- [x] 2.2 [P1] Thread resolved Qoder `home_dir` through runtime-aware status/model probes and diagnostics; test custom-root propagation.
- [x] 2.3 [P2] Distinguish unusable from readable-empty Qoder disk history and fall back to ACP only for the former; add unit coverage.

## 3. Calibration and verification

- [x] 3.1 [P0] Update Qoder capability/change/ADR documentation without overwriting concurrent Shared WIP; record supersession of ACP-only history wording.
- [x] 3.2 [P0] Run focused Rust/Vitest, capability matrix, daemon check, strict OpenSpec validation, and inspect the staged file list before commit.
- [ ] 3.3 [P1] Perform one real Qoder Native smoke: invalid model fails before prompt, cancel renders cancelled, usage/fork are visible, and custom config root returns matching catalog.
