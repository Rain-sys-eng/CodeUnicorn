## Context

issue #1062：用户在 GUI 会话中要求读取 workspace 外路径（如用户目录下 `.claude/CLAUDE.md`），Claude 沙箱以 **allowed working directories** 硬拒绝；mossx 审批桥只对部分 **区内写文件** 合成 `ApprovalRequest`，Read/Bash 越界不会变成可点的授权卡。

现状代码事实：

- `looks_like_claude_permission_denial_message` 已识别 `allowed working directories` 等文案（`claude/approval.rs`）。
- `detect_claude_synthetic_approval_kind` 只分 `FileChange` / `CommandExecution`：文件 → synthetic approval；命令 → `modeBlocked`。
- **无 DirectoryGrant kind**；启动时额外目录仅靠 `--add-dir`（如 custom_spec_root），无运行时扩权。
- 本地 apply 对 workspace root 外路径硬拒。

多系统约束：

- 路径形态：Win `C:\` / `\` / UNC；Linux 大小写敏感；macOS 默认不敏感。
- L3 OS 隐私（TCC）几乎只有 macOS；Win/Linux 不得伪造系统弹窗。

## Goals / Non-Goals

**Goals:**

1. 三层权限模型（L1 session allowlist / L2 tool approval / L3 OS privacy）跨平台共用。
2. 越界失败 → `DirectoryGrantRequest` → 用户决策 → 写 L1 → 引擎映射 → 自动重试。
3. 方案 A 内联卡为主路径；敏感根强提示；拒绝 fail-closed 可诊断。
4. 契约前后端对齐；路径 canonical 可测。

**Non-Goals:**

- 完整方案 B allowlist 管理 UI、方案 C 四步向导完整实现。
- 任意 Bash 本地代执行 bridge。
- 与原生 Claude TUI 审批 1:1 等价声明。
- 默认 global always allow。

## Decisions

### D1 — 独立 kind：`DirectoryGrant`，不复用 file Approval

- **选择**：新增 `DirectoryGrantRequest` / `DirectoryGrantDecision`（事件 + TS 类型），与 `approval:request` 并行或作为带 `kind: "directory_grant"` 的扩展 shape。
- **替代**：把越界塞进现有 `ApprovalRequest.method`。
- **理由**：语义不同（扩 L1 根 vs 区内写文件）；避免 L2 UI 误当成「同意写文件」；便于 scope 三选与重试上下文。

### D2 — Scope 默认 `session`，禁止默认 global always

| Scope | 生命周期 | 持久化 |
|-------|----------|--------|
| `once` | 单次工具调用：临时根 + 用完即删（倾向实现） | 否 |
| `session` | 当前会话（推荐默认） | 否（仅内存/会话状态） |
| `workspace` | 绑定本项目 | 是（workspace 级 store） |

### D3 — 越界检测与合成时机

1. 工具结果 / 错误消息命中 `allowed working directories` / outside sandbox 等信号。
2. 从 tool input 解析目标 path；canonical 后判断是否已在 L1。
3. 若不在 L1 → 合成 `DirectoryGrantRequest`（含 `path`、`canonicalPath`、`suggestedRoot`、`scope` 默认、`os`、`engine`、`retryContext`）。
4. 若已是 file-change 区内审批 → 保持现有 FileChange 路径，不降级为 grant。

### D4 — 引擎映射

| Engine | 映射 |
|--------|------|
| Claude | grant 根 → `--add-dir`；同会话热扩若 CLI 不支持 → 标记下一 turn 生效 + UI 明示，**不伪造成功** |
| Codex | sandbox allowed roots 扩展（若 API 支持）；否则 diagnostic + 下一启动 |
| Host | path gate / 本地读校验与 L1 对齐；写仍过 L2 + workspace apply gate（写越界策略本 change 默认仍拒，除非未来扩展） |

### D5 — 路径 canonical

- 统一模块（Rust 优先，前端仅展示格式化）：
  - Win：盘符规范化、`/` → `\` 或统一 forward 后再比；拒绝未解析的 8.3 模糊匹配时 fail-closed。
  - Linux：大小写敏感。
  - macOS：默认不敏感比较。
- `canonicalize` 解析 symlink/junction；判界用 canonical 后路径；逃逸出 grant 根则拒绝。
- 敏感根（家目录根、系统盘根、`~/.ssh`、`/etc` 等）：卡片强提示，默认 suggested root 收窄到目标文件父目录而非整个家目录。

### D6 — UI：方案 A 内联卡

- 渲染位置：对话流 / 与现有 inline approval 同区域，但独立卡片组件。
- 内容：格式化路径、scope 三选、允许/拒绝、macOS 可选 L3 提示。
- 允许：写 L1 → 引擎映射 → 用 `retryContext` 自动重试原工具。
- 拒绝：诊断文案 + 手动 `--add-dir` / 打开对应 workspace 指引。
- Thread scoping：复用 `conversation-approval-thread-scoping` 规则（DirectoryGrant 视同 thread-bound request）。

### D7 — 状态与事件存储

- grant 事件优先复用 shared_event_log / 既有 EngineEvent 通道；若 API 不匹配则最小扩展 `EngineEvent::DirectoryGrantRequest`（或 `Raw` 带稳定 `type`）。
- L1 allowlist 挂在 session runtime state；`workspace` scope 写入 workspace-bound store（可撤销接口预留，UI 后置）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| Claude CLI 不支持同会话热扩 `--add-dir` | Phase 2 先验证；降级：下一 turn 生效 + UI 明示 |
| Win 路径漏判（盘符大小写、UNC、8.3） | 独立矩阵测试；canonical 失败 fail-closed |
| symlink/junction 逃逸 | canonical 后判界；写操作仍 L2 + apply gate |
| `workspace` scope 扩大攻击面 | 仅显式选择；列表可查可撤销（B 后续） |
| 与 event log / projection 冲突 | 复用既有 API，不新开存储通道 |
| 误实现系统级弹窗 | 仅 macOS 文案提示 L3 |

## Migration Plan

1. 契约落地 → 旧客户端忽略未知 event type（向前兼容）。
2. 先 Claude default 路径，再 Codex/host gate。
3. Feature 可默认开启（安全 fail-closed 路径更优）；若需 flag，用内部 flag 灰度。
4. 回滚：停用 DirectoryGrant 合成，回退到现有 modeBlocked/tool error（无数据迁移）。

## Open Questions

1. Claude CLI 当前版本 `--add-dir` 是否支持运行中追加？
   - **结论（实现期）**：未发现稳定的同进程热扩 API。产品策略：accept 后写入 session L1，**下一次 Claude CLI launch** 注入 `--add-dir`；UI 明示可能需要下一条消息才生效。不伪造成功热扩。
2. `once` 实现：单次工具调用放行 vs 临时根 + 用完即删 —— **当前实现** 接受 once 时仍写入 session L1（与 session 类似），真正用完即删留后续。
3. DirectoryGrant 事件形态 —— **当前实现**：复用 `EngineEvent::ApprovalRequest` + `tool_name=DirectoryGrant` + method `item/directoryGrant/requestApproval`，params 携带 grant 字段；避免新建独立 Tauri channel。

## 验收映射

见 proposal 验收标准；实现 tasks 逐步勾选并附 gate 命令输出。
