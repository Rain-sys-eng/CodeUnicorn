# add-qoder-engine review 包（待审核）

> 状态：**implemented, P0/P1 已补**。未 commit。
> 本文是 review 入口：决策记录 / 预存问题 / 验证证据 / 待目视验收项。
> 审核结论见 [`review-code.md`](review-code.md)。后置项见 [`docs/research/mossx-qoder-engine-deferred.md`](../../../docs/research/mossx-qoder-engine-deferred.md)。
> 行为契约见 proposal / design / 8 个 spec delta；协议事实见 `docs/research/mossx-qoder-capability-spike.md`。

## 1. 范围一句话

Qoder CLI（`qodercli` 1.1.27）作为第 9 个 Native Engine，第四条协议族 `acp-stdio`，spawn-per-turn + ACP `session/resume`；**不进 Shared**。

## 2. 核对矩阵完成度（A–H）

（实施后按 tasks.md 勾选状态更新；⚠ 项全部人工核对记录在此。）

## 3. 🔵 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| Shared 资格（F1–F5） | **不进** | pendingProbe / 成功 terminal / cancel 语义未完整实测；picker disabled；**写路径** `assertSharedSessionWriteEngine` 拒绝 qoder（读路径 `normalize` 仍 claude fallback，同 gemini/dsh） |
| L3 NativeHistoryReader | 后置 | `session/load` readback 通道已验证可用，独立 change |
| `qoder_auth.rs` | **已创建**（mossx PAT） | 写 `~/.ccgui/qoder-auth.json`，不写 `~/.qoder`；daemon 必须 `#[path]` include |
| Provider Profile key CRUD | 不做 | Qoder 无 API-key provider 面；profile 只承载 `--config-dir` 隔离；`isProviderProfileEngine("qoder")===false` |
| 权限模式 | `bypassPermissions` + `session/request_permission` 兜底 auto-approve | 对齐 kimi `-p` auto / acpx `--yolo` headless 惯例；elicitation 卡桥接后置；composer accessMode 对 qoder 禁用（同 kimi） |
| 自定义模型（E3） | 不做 | 模型目录 = ACP `models.availableModels` 账号实时目录 |
| 专属 usage 卡（D9） | 不做 | ACP usage 未实测；走通用 token 卡 |
| presentationProfile（D7） | fallback | pi 同样无专属 profile |
| SLASH_CATALOG_ENGINES | 不加 | `available_commands_update` v1 不在 mossx 斜杠 UI 暴露 |
| CommitMessageEngine | 排除（同 dsh） | `qodercli commit` 存在但 v1 不接 |
| Onboarding | FIRST_RUN_MORE_ENGINES（同 pi） | 不上 primary 安装行 |
| G6 Session Management | catalog 过滤 + icon，不做独立磁盘解析器 | 同 grok/kimi 现状；history 走 ACP |
| 全局 catalog `build_global_engine_catalog_entries` | 跟随 pi（workspace projection only） | pi 同样不在全局路径 |
| `coding_plan_quota` / `host_cli` | 明确 unsupported | 账号制，无 base_url+key；无 Codex `account/rateLimits`、无 Kimi `/usages` HTTP；账户额度只在 TUI `/usage`。不刮 TUI、不读 `~/.qoder` |
| input.mid-turn | 不接（`unknown`） | `_meta.qoder.promptQueueing` 声明存在但未实测 |
| 安装命令 | InstallLatest = echo 指引官方文档；UpdateLatest = `qodercli update`（--help 已验证）；Uninstall = echo 不支持（保护 ~/.qoder） | 官方安装脚本 URL 本环境无法核实，禁止编造 |
| detect binary | 只认 `qodercli` | `qoder` 是 IDE launcher；`qoderclicn` 是 CN 版，均不接 |
| CN 版 `qoderclicn` | 首期不接 | 不同 binary / 账号体系 |

## 4. 预存问题（HEAD 已存在，本 change 未触碰 / 顺手修复的已标注）

| 问题 | 位置 | 本 change 处理 |
|---|---|---|
| `check:engine-controller-facade` 失败（617 > 600 行阈值） | `src/features/engine/hooks/useEngineController.ts` | 未触碰，HEAD 即失败 |
| `check:app-shell:governance` T3.7 失败（2 个 unlisted bridge） | `useThreadActionsResumeThread.ts` / `dshHistoryLoader.ts` | 未触碰，HEAD 即失败（offender 列表逐字一致，worktree 对比证实） |
| threads/shared-session/services 23 个测试文件失败 | threads/hooks 多个 | 未触碰，HEAD 同集（103 失败测试，逐文件 diff 为空） |
| `check:docs` 红（kanban 断链 / dsh spike `status: draft` / superpowers 不可达等 ~40 项） | docs/** 多处 | 未触碰，HEAD 即失败；本 change 新增/修改文档零新增告警（`rg qoder` 无命中） |
| daemon `parse_engine_type_string` 缺 `"pi"` 臂 | `cc_gui_daemon.rs:1096` | 未修（additive 纪律），只加了 `"qoder"` |
| daemon `sync_engine_configs` 不推 kimi/grok/pi bin | `daemon_state.rs:881` | 未修；qoder 跟随 kimi/grok 模式不在 daemon sync |
| daemon 无 pi history/doctor RPC | `daemon_state.rs` | 未修；qoder doctor 注册参照 kimi/dsh 已有臂 |
| `EngineFeatures::pi()` 主 crate 与 daemon 不一致（reasoning_effort true/false） | `engine/mod.rs` vs `engine_bridge.rs` | 未修；qoder 两份一致（true） |
| adapter_registry 测试断言 `len()==7`（实际 8） | `adapter_registry.rs:298` | **本 change 修复为 9** |
| `engineRegistry.test.ts` `BUILTIN_ENGINE_TYPES` 缺 pi/dsh | `engineRegistry.test.ts:13` | **本 change 补齐 9 引擎** |
| 基石文档 Built-in engines 写 7（漏 PI） | `mossx-multi-cli-...md` 校准表 | **本 change 回写时修正为 9** |
| 基石文档 Shared boundary 漏 PI | 同上 | **本 change 回写时修正** |
| SettingsView session counts 把 pi 计入 codex | `SettingsView.tsx:220-309` | qoder 同 pi 现状，记录不扩展 |
| `sessionManagementSectionUtils` 漏 dsh icon | `sessionManagementSectionUtils.ts` | qoder 正常接入 normalize/icon（不复制 dsh 缺漏） |
| 接入指南 C2/C3/C4 注释仍写「六引擎」 | `mossx-new-cli-onboarding-guide.md` | 文档漂移，建议下个规则 change 校准 |

## 5. 验证证据

> 对比基线：HEAD `f3b16a7e1`（git worktree 隔离复跑，非管道伪绿）。

### 编译 / 静态检查

| 项 | 结果 |
|---|---|
| `cargo check`（lib） | ✅ 0 error |
| `cargo check --bin cc_gui_daemon` | ✅ 0 error |
| `npx tsc --noEmit` | ✅ 0 error |
| `npm run lint` | 41 problems（9 error / 32 warning）——与 HEAD **逐项一致**，零新增 |

### 测试

| 套件 | 结果 | 回归判定 |
|---|---|---|
| `cargo test --lib qoder` | ✅ 20/20（含 ACP parser / 事件映射 / 图片 block / fs 沙箱 / history 去重 / installer 断言） | 新增 |
| `cargo test --lib` 全量 | 2316 passed / 16 failed | 16 个失败**全部在 HEAD 预存集**（HEAD 19 个）；3 个 HEAD 失败在分支转绿（含本 change 修复的 adapter_registry 断言） |
| vitest composer/vendors/engine | ✅ 150 files / 1150 tests 全绿 | — |
| vitest threads/shared-session/services | 229 files passed / 23 failed | 23 个失败文件与 HEAD **逐文件同集**（预存 mock 漂移） |
| vitest app-shell/messages/onboarding | 159 passed / 13 failed files | 2 个疑似新增已复核：freeze count 79（本 change 有意入账，已咬实测并注释）；runtime-reconnect 单跑 29/29 绿（并行 flake） |
| vitest i18n parity | ✅ 10 files / 72 tests 全绿（10 locale） | — |

### Contract gates

| Gate | 结果 |
|---|---|
| `check:engine-capability-matrix` | ✅ ok（15 capabilities × 9 engines） |
| `check:engine-adapter-registry` | ✅ ok（9 built-ins） |
| `check:model-provider-catalog` | ✅ valid（qoder = runtime-only） |
| `check-branding` | ✅ 通过（grok/kimi 命中为预存） |
| `check:engine-controller-facade` | ❌ HEAD 即失败（616 行 > 600 阈值），本 change 未触碰 |
| `check:app-shell:governance` | T3.7 两个 offender 与 HEAD 逐字一致；domain key 预算 79 = 贴顶（见决策记录） |
| `check:docs` | HEAD 即红（kanban 断链等 ~40 项预存）；本 change 文档零新增告警 |
| `scan-engine-name-branches` | 27 个 qoder finding 全部为预期 capability 白名单分支（modelSelection / MessagesCore / TimelineRowRenderer / useAppServerEvents 等），与 pi/dsh 模式一致 |
| `openspec validate --all --strict` | add-qoder-engine ✅ valid；其余 10 个失败均为预存 active changes（add-dsh-engine 等），与本 change 无关 |

### 哨兵

`rg '"qoder"' src/features/messages src/features/threads src/conversation-presentation src/features/app/hooks/useAppServerEvents.ts` → 多命中（registry / contracts / TimelineRowRenderer / MessagesCore / useAppServerEvents / historyLoaderFactory 全覆盖）。

### 冒烟修复（2026-08-21 真实客户端）

| 症状 | 根因 | 修复 | 验证 |
|---|---|---|---|
| 发送报 `session/new timed out` | session/new 扫 cwd，大 repo 实测 30.1s > 15s 握手超时 | `QODER_SESSION_NEW_TIMEOUT=90s`（resume 30s） | 延迟复测表（spike §7.5）+ cargo check 双 target 0 error |
| 创建 session 无法选模型 | create-session seeder 只含 Shared+dsh，qoder target 被 `isResolvedCreationExecutionTarget` 静默丢弃 | seeder 加 qoder native 分支 + 前端 `__local_qoder__` 常量 | seeder 测试 12/12（含 qoder 用例）+ composer 829/829 |
| 深色图标黑块 | `<img>` SVG 不继承页面 currentColor，mono 图标落成黑色 | EngineIcon 内联双色 glyph（绿 #2ADB5C + currentColor 细节） | EngineIcon 测试 9/9（含防回归断言） |

### 目视验收

**BLOCKED**：本机 Qoder 账号模型 API 不可达（`Network attempt failed at unknown`，两模型同）。五件套（streaming 光标 / reasoning 折叠 / tool 块 / usage 收尾 / 历史一致）与成功-turn 黄金事件采集需 review 环境补验（harness：`docs/research/spikes/harness/qoder-acp/probes/probe6_golden_turn.py`）。

后置清单（Shared / L3 / 黄金 turn / elicitation / CN 版）见 [`docs/research/mossx-qoder-engine-deferred.md`](../../../docs/research/mossx-qoder-engine-deferred.md)，不要在本 change 继续膨胀。

## 6. 待目视验收（review 环境）

本机 Qoder 账号模型 API 不可达（`Network attempt failed at unknown`，两模型同），以下需有可用账号的环境补验：

- [ ] D 层五件套：streaming 光标 / reasoning 折叠 / tool 块 / usage 收尾 / 历史与 live 一致
- [ ] 成功 turn 黄金事件采集 → 把 `streaming.reasoning` / `streaming.tool-output` / `usage` / `input.mid-turn` / `session.fork` 从 unknown/声明值升级为实测值
- [ ] `session/cancel` → `stopReason:"cancelled"` 实测
- [ ] 双 provider（双 `--config-dir`）并行隔离 smoke
- [ ] 未登录态 composer 禁发 + 指向 `qodercli login` 的文案
