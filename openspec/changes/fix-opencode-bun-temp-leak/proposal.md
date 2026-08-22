# Proposal: 修复 OpenCode/Bun native artifact 写满临时目录

## Why

Windows 现场已确认：启动 ccgui 后，`%LOCALAPPDATA%\\Temp` 持续出现随机命名的隐藏
`.dll` 与 `.node` 文件；关闭 ccgui 后写入立即停止。已采样的文件量为 8,990 个约
1,809 KiB 的 `.dll` 与 8,918 个约 506 KiB 的 `.node`，合计约 20.78 GB。

文件名、大小和持续增长模式与 Bun compiled executable 在 native library extraction
时重复写入临时目录的 upstream defect 一致。Bun 已在
[PR #29587](https://github.com/oven-sh/bun/pull/29587) 修复该问题，并随 Bun 1.4.0
发布；相关跨平台问题记录见 [issue #29585](https://github.com/oven-sh/bun/issues/29585)
与 [issue #30962](https://github.com/oven-sh/bun/issues/30962)。ccgui 当前以 one-shot
方式启动外部 `opencode run`，每次启动都会放大该 defect 的磁盘影响。

本仓库不包含截图中 JetBrains 插件的 `ai-bridge/daemon.js`；它是独立运行时，不能用
本 change 代替其修复。本 change 仅覆盖 ccgui 创建的 OpenCode child process。

> 🛠 **深度推演**：根因不是“Temp 未清理”，而是外部 Bun runtime 在每次 native
> extraction 时缺少稳定、可复用的 artifact path。清理全局 Temp 只能掩盖症状，还会
> 删除其他应用文件；正确边界是建议升级 upstream runtime，并将尚无法确认版本的
> runtime 写入限制在 ccgui 明确拥有、可证明可回收的目录内。

## 目标与边界

### 目标

- 将 ccgui 管辖的 Windows OpenCode child process 的 Bun 临时 native artifact 写入
  限制在应用拥有的专用目录中，避免继续污染系统 `%TEMP%`。
- 保持现有 `opencode-ai@latest` 安装/升级来源；embedded Bun version 无法从 OpenCode
  version 可靠推导时标记为 `unverified`，给出 upstream 更新建议，custom executable
  不静默替换。
- 在 `doctor` / diagnostics 中明确显示 runtime provenance、专用目录占用和受控 cleanup
  scope，便于定位而不泄露用户文件路径或内容。
- 保持 OpenCode 的 one-shot protocol、流式事件、取消和恢复语义不变。

### 平台边界

| 平台 | 证据状态 | 本 change 的行为 |
| --- | --- | --- |
| Windows | **已证实**：现场已复现 `.dll` / `.node` 大量写入 `%TEMP%` | 对 ccgui 创建的 OpenCode child 注入应用私有的 `BUN_TMPDIR`；仅清理该私有目录。 |
| macOS | **未证实**：upstream issue 表明同类 compiled-runtime 问题可能跨平台出现，但本仓库没有 macOS 复现证据 | 首期不改 `BUN_TMPDIR`、`TMPDIR` 或清理策略；保留继承的进程环境，只增加观测和人工验收门禁。 |
| Linux | **未证实且不在首期范围** | 不改变现有临时目录行为；不把 Windows 修复泛化为跨平台环境变量覆写。 |

因此，首期实现必须以 platform policy 隔离：Windows 行为通过 `#[cfg(windows)]` 或等价
平台策略启用；macOS/Linux 不得因为该修复被改写临时目录环境。

### 非目标

- 不修复 Bun upstream 本身，也不依赖“删除全局 Temp”解决问题。
- 不删除 `%TEMP%`、`$TMPDIR`、Tauri updater 目录或任何非 ccgui-owned 文件；不做递归
  临时目录清理。
- 不改变用户全局环境变量。Windows 的 `BUN_TMPDIR` 仅在 ccgui 创建的 OpenCode child
  process 内按应用策略覆写，父进程和系统设置保持不变。
- 不迁移到 `opencode serve` / persistent daemon，不重写 one-shot engine 架构。
- 不修改 JetBrains `ai-bridge`、其他 IDE 插件或其他 engine 的进程启动逻辑。
- 不将“macOS 尚未收到报告”表述为安全结论，也不宣称本 change 已修复 macOS。

## What Changes

1. 为 ccgui 的 OpenCode launcher 建立集中化的 platform-specific child environment
   policy。Windows child 使用应用私有 `BUN_TMPDIR`；所有 ccgui 管辖的 OpenCode
   command path 都复用该 policy，禁止在单个业务调用点零散设置环境变量。
2. 为 Windows 私有目录定义 ownership、multi-instance lock、容量上限与失败策略。
   清理只能发生在明确 owned 的目录内；遇到 active child、锁竞争、不可证明 ownership
   或删除失败时必须跳过并记录诊断，不能扩大清理范围。实现阶段使用现有
   `File::try_lock` / `unlock` 模式，避免新增 dependency 或并发控制框架。
3. 保持 ccgui 现有 `opencode-ai@latest` runtime 安装/升级来源。由于 OpenCode CLI
   version 不能可靠映射 embedded Bun version，诊断统一标记 `unverified` 并提示升级到
   包含 Bun 1.4.0+ 修复的 upstream release；不伪造安全结论，也不静默替换用户指定二进制。
4. 扩展 OpenCode `doctor` 与 diagnostics：报告平台 policy 是否启用、受控目录的
   artifact count/bytes、cleanup scope 和 runtime provenance。诊断只暴露必要的
   聚合数据，不泄露完整本地路径、文件名或会话内容。
5. 增加 Windows regression coverage 和 macOS evidence gate。macOS 首期仅验证其
   OpenCode run/stream/interrupt/attachment 流程与继承环境不变，并采样是否出现同类
   native artifact；采样结论必须标记为“已证实 / 已排除 / 未验证”。

## 方案取舍

### 方案 A：只升级 OpenCode runtime

- 优点：改动最小，Bun 1.4.0+ 从根因修复重复 extraction。
- 缺点：custom executable、历史缓存和未来供应链回退仍可能把写入留在全局 Temp，诊断
  能力不足。
- 结论：必要但不充分，不能单独采用。

### 方案 B：Windows scoped containment + upgrade guidance + diagnostics（推荐）

- 优点：直接覆盖已证实的 Windows 事故；不触碰全局 Temp；即使用户运行旧或版本未明的
  executable，爆炸性写入也受限于 ccgui-owned directory；可持续观测和安全回收。
- 缺点：需要处理 ownership、锁和子进程环境优先级。
- 结论：作为本 change 的首期方案。

### 方案 C：立即在所有平台重定向 `BUN_TMPDIR` 并清理

- 优点：表面上覆盖范围最大。
- 缺点：macOS/Linux 没有本仓库复现证据；会改变 `$TMPDIR` 关联的动态加载、sandbox 和
  用户自定义环境行为，风险高于当前证据。
- 结论：拒绝。待 macOS/Linux 收集证据后另建 change 决策。

### 方案 D：改成 persistent `opencode serve`

- 优点：可能减少 process spawn，从而降低 defect 放大倍数。
- 缺点：协议、生命周期、恢复和资源治理范围显著扩大，且不修复 Bun extraction 根因。
- 结论：不纳入本 change。

## Capabilities

### New Capabilities

- `opencode-native-artifact-containment`：定义 ccgui-owned OpenCode native artifact
  directory、Windows child environment policy、安全 cleanup、runtime safety diagnostics
  与平台证据状态。

### Modified Capabilities

- `opencode-engine`：所有 ccgui 发起的 OpenCode child process 必须经过统一 platform
  containment policy，同时保持现有 one-shot invocation contract。
- `opencode-cli-lifecycle`：OpenCode installation/upgrade 与 `doctor` 必须能够呈现可验证的
  Bun/runtime safety 状态，并对 custom executable 给出明确升级建议。

## Impact

- 预计涉及：`src-tauri/src/engine/opencode.rs`、OpenCode CLI lifecycle/doctor 相关代码、
  diagnostics、聚焦的 Rust tests，以及以上 OpenSpec capability specs。
- 可能新增一个 narrowly scoped 的 runtime-artifact helper；不引入第三方 dependency，
  不改变 frontend IPC contract，不改 Tauri updater。
- 现有 `runtime-lifecycle-recovery-guard` 只处理通用恢复/进程治理，不因本问题被扩展成
  全局临时文件清理器。
- 实施前必须盘点所有 ccgui 管辖的 OpenCode command path；如果某路径无法纳入统一 policy，
  必须在 design 中显式列为例外及风险，不能默默遗漏。

## 验收标准

### Windows（必须通过）

- 使用已知 vulnerable 的 OpenCode/Bun runtime 重复执行 OpenCode turn，ccgui 触发的随机
  `.dll` / `.node` artifact 只出现在其 private directory，不再落入系统 `%TEMP%`。
- private directory 的文件数和字节数受可验证的上限/回收策略约束；cleanup 不会删除
  private directory 外的任意文件。
- multi-instance、active child、文件锁和 cleanup 失败均不会误删或中断正在运行的 OpenCode
  请求；失败会产生可定位的诊断结果。
- doctor 不会从 OpenCode version 伪造 embedded Bun safety 结论；受管 runtime 与 custom
  executable 均至少显示 `unverified` 和 upstream 升级建议，不会被误报为安全。
- OpenCode run、stream、cancel、retry、image/file attachment 的现有行为保持通过。

### macOS（必须人工验证，但不改变运行时策略）

- 启动前后比较 OpenCode child 的 `BUN_TMPDIR` 与 `TMPDIR`：首期必须保持用户继承值，
  不创建 ccgui-owned redirect 或 global cleanup。
- 手工覆盖 OpenCode run、stream、cancel、retry、image/file attachment；确认没有因
  Windows policy 引入启动、动态加载或临时文件兼容性回归。
- 采样 `$TMPDIR` 中可能的 `.dylib` / `.node` artifact 后，将结果以“已证实 / 已排除 /
  未验证”记录在验证材料中；未完成采样不得将 macOS 标为已修复。

### 共同门禁

- non-OpenCode engines 与 Tauri updater 无行为变化。
- 通过 `openspec validate --strict`、聚焦 Rust tests、Windows manual regression 与 macOS
  manual regression；若 macOS 证据改变范围，必须新建或更新 OpenSpec decision，不得在
  implementation 中临时扩大平台行为。
