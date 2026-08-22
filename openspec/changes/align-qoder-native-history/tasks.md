## 1. Native reader routing

- [x] 1.1 [P0] 完善 `qoder_history.rs` 的 workspace-scoped JSONL lookup：raw / canonical / `/tmp` alias 的 O(1) slug candidates 失败后，以有界 metadata scan 找到同 workspace 的 session；输入为 `workspacePath + sessionId`，输出为只读 JSONL path 或缺失。
- [x] 1.2 [P0] 将 session list / load 收口为 local JSONL primary：list 有本地记录即返回，load 有本地 file 即 parse；本地没有可用记录时才调用既有 ACP helper；`delete_qoder_session` 保持 ACP-only。
- [x] 1.3 [P1] 将 sidebar summary 改为流式最小解析（首条 visible user/title + metadata + file mtime），避免为 list 物化完整 transcript；保持排序、title fallback 和返回 schema。

## 2. Parser and regression tests

- [x] 2.1 [P0] 为本地 Qoder JSONL fixture 添加 Rust tests：summary、user/text/reasoning/tool/result 投影、malformed-line isolation、sidechain filter、tool-result merge。
- [x] 2.2 [P0] 为 deterministic lookup 与 metadata-scan fallback 添加 Rust tests；确认不同 workspace 的同名/无关 session 不泄漏。
- [x] 2.3 [P0] 保留并执行 Qoder ACP `session/load` / `session/prompt` trailing-drain regression；确认本 change 不修改 realtime protocol path。

## 3. Verification and handoff

- [x] 3.1 [P0] 运行 focused `qoder_history` / `qoder` Rust tests 与 `cargo check --bin cc_gui_daemon`；记录已有 unrelated warning，不将其归因于本 change。
- [x] 3.2 [P0] 运行 Qoder frontend history loader parity test、OpenSpec strict validation 与 capability matrix gate。
- [ ] 3.3 [P0] 手工验收：打开已有工具型 Qoder session 验证本地首屏；再发一条工具型 live turn 验证 reasoning/tool/text 不回归（需要运行中的 app，保留为手工项）。
