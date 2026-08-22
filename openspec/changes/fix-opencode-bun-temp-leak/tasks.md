## 1. Windows containment foundation

- [x] 1.1 新增 `opencode_native_artifact` internal module：为 Windows OpenCode child 创建 marker/lock 保护的 per-run `BUN_TMPDIR` lease，并在 macOS/Linux 保持 no-op。验证：unit tests 覆盖 lease 路径、marker、lock 和 non-Windows policy。
- [x] 1.2 实现 fail-closed stale cleanup 与 metadata-only 预算检查（单 run 256 MiB、root 512 MiB、每秒最多一次）。验证：unit tests 证明 locked/unmarked/symlink candidate 不会被删除，超限会返回 diagnostic error。

## 2. OpenCode command-path integration

- [x] 2.1 将 lease 生命周期接入 `OpenCodeSession` spawn / wait / timeout / interrupt 路径；预算超限走现有 child termination 语义。验证：Rust tests 与 code review 确认 one-shot args、stream、cancel contract 未改变。
- [x] 2.2 将 OpenCode engine status 的 `--version`、`--help`、`models` probes，以及 desktop / `cc_gui_daemon` 的 management、provider、session command 统一接入同一 policy，并保持其他 engines 的 generic CLI probing 不变。验证：focused Rust tests、daemon compile 和 symbol audit。
- [x] 2.3 为 OpenCode doctor 与 installer version probe 接入同一 policy，返回不含路径的 `opencodeNativeArtifactContainment` diagnostics；embedded Bun version 无法独立验证时标记 `unverified`。验证：doctor structured-output test。

## 3. Automated verification and specification gate

- [x] 3.1 运行新增/受影响 Rust tests、`rustfmt --edition 2021 --check`（仅本次改动叶子文件）和相关 Cargo compile/test gate；记录既有失败，不将其归因于本 change。
- [x] 3.2 运行 `openspec validate fix-opencode-bun-temp-leak --strict --no-interactive`、`git diff --check` 和 targeted change diff audit；确认没有修改全局 Temp、updater、JetBrains bridge 或 frontend IPC。

## 4. Platform manual acceptance

- [ ] 4.1 Windows：用 known vulnerable OpenCode runtime 重复运行 OpenCode turn，确认 `.dll` / `.node` 不进入 `%TEMP%`、private root 受预算限制、turn/interrupt/attachment 正常。
- [ ] 4.2 macOS：确认 OpenCode child 继承现有 `BUN_TMPDIR` / `TMPDIR`，不创建 containment root；手工覆盖 run/stream/interrupt/attachment 并记录 native artifact evidence state。

> `4.1` 与 `4.2` 需要对应平台的真实 OpenCode runtime / interaction evidence；当前开发机为 macOS，未把未执行的手工验收标记为完成。
