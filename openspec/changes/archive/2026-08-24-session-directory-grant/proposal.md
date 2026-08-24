## Why

Claude/GUI 会话对 **workspace 外路径**（如 `~/.claude/CLAUDE.md` 或 `C:\Users\...\.claude\CLAUDE.md`）当前走 **沙箱硬拒绝**：Read/Bash 失败后既不合成可点的授权卡，也无法运行时把目录加入 allowed working directories。issue #1062 的根因不是模型能力，而是 **L1 session allowlist 扩权缺少一等交互**；Mac/Win/Linux 共用同一缺口，仅路径形态不同。

## 目标与边界

- 越界工具失败可识别为 **DirectoryGrant**（区别于 file/command approval），并在对话流弹出 **方案 A 内联授权卡**。
- 用户选择 scope（`once` / `session` / `workspace`，默认 `session`）后写入 L1 allowlist，引擎映射（Claude `--add-dir` / Codex roots / Host path gate），并 **自动重试** 原工具。
- 拒绝保持 **fail-closed** + 可诊断文案（含手动 `--add-dir` 指引），禁止静默失败。
- macOS / Windows / Linux **共用三层权限模型**；仅路径 canonical 与 L3（TCC）文案分支。
- 安全：禁止默认 `always global`；symlink/junction 逃逸仍拒；写操作继续走 L2 tool approval。

## 非目标

- 不把任意 Bash/command 升级为完整 native CLI 审批等价物（仍受现有 non-file bridge 评估约束）。
- 不伪造 Windows/Linux 系统隐私弹窗；L3 仅 macOS 提示。
- 不在本 change 实现完整方案 B 侧栏 allowlist 管理面（仅预留状态与事件）。
- 不改变 workspace 内既有 file synthetic approval 行为。
- 不默认开启 full-access / bypassPermissions。

## What Changes

- 新增 capability `session-directory-grant`：DirectoryGrantRequest/Decision 契约、L1 allowlist 状态、越界 → 授权 → 重试语义。
- 修改 Claude access-mode / approval 桥：对「outside allowed working directories」类失败优先合成 DirectoryGrant，而非裸 `modeBlocked` / 静默 tool error。
- 前端：对话内联授权卡（方案 A）；scope 三选；允许/拒绝；授权后自动重试。
- 后端：路径 canonical 模块（Win 盘符/`\`、Linux 大小写敏感、mac 默认不敏感）；session grant 持久化边界（仅 `workspace` scope）。
- 引擎：Claude grant → `--add-dir`（热扩若不可用则下一 turn 生效 + UI 明示）；Host path gate 与 L1 对齐。
- 测试：路径矩阵 + 授权/拒绝/重试 vitest + Rust 单测。

## 方案取舍

- **方案 A（采用，主路径）**：对话内联 DirectoryGrant 卡。与现有审批心智最贴、落地最快，覆盖 #1062 核心路径。
- **方案 B（后续）**：底部 sticky + 右侧 allowlist 管理。适合多 grant 管理，本 change 只落事件/状态钩子，不做完整 UI。
- **方案 C（敏感根降级）**：四步向导。仅家目录根/系统盘根/`~/.ssh` 等敏感路径升强提示（本 change 卡片内强提示 + 默认收窄子目录，完整向导可后置）。

## Capabilities

### New Capabilities

- `session-directory-grant`：会话级目录授权（L1 allowlist）、越界失败可恢复 UX、scope 语义、多系统路径 canonical、引擎映射与自动重试。

### Modified Capabilities

- `claude-code-access-modes`：default 模式下「allowed working directories 越界」从不可恢复硬拦升级为可 DirectoryGrant 恢复；不宣称与原生 CLI 审批 1:1 等价。
- `conversation-approval-thread-scoping`：审批/授权请求线程归属扩展到 DirectoryGrant kind，避免跨 thread 误点。

## Impact

- Frontend: `src/types/*`（DirectoryGrant 类型）、对话流卡片组件、`useAppServerEvents` 路由、i18n
- Backend: `src-tauri/src/engine/events.rs`、`claude/approval.rs`、`claude/event_conversion.rs`、路径 canonical 模块、session allowlist 状态
- Contracts: runtime-contracts 对齐
- OpenSpec: 新 capability + 两处 delta
- Prototype（已有）: `docs/prototypes/session-directory-grant-ui-variants.html`

## 验收标准

1. 复现 #1062：读 workspace 外 `~/.claude/CLAUDE.md`（mac）与 `C:\Users\...\.claude\CLAUDE.md`（win）弹出内联授权卡，而非裸失败。
2. 允许（session）→ 原工具自动重试成功；新会话该根不再默认允许。
3. 拒绝 → fail-closed，诊断含手动扩权指引，无静默失败。
4. 三端路径 canonical 测试全绿；symlink 逃逸用例被拒。
5. `openspec validate session-directory-grant --strict --no-interactive` 通过；相关 lint/typecheck/test/cargo/runtime-contracts gate 通过。
