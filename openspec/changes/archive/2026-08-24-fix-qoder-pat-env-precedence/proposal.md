# fix-qoder-pat-env-precedence

## Why

用户报告（Windows，0.9.3，Qoder 国际站 PAT 登录）：「用着用着就要我重新认证，用的新 token」。排查链：

1. mossx 每次 spawn `qodercli --acp`（每 turn、每次 status/models 探测）都通过 `QODER_PERSONAL_ACCESS_TOKEN` env 注入 PAT；qodercli 启动时拿 PAT 走 `POST /api/v1/jobToken/exchange` 换短期 access token（`persist:false`，进程内存态）。
2. PAT 被服务端拒绝（400/401/403）时，CLI 抛 "The QODER_PERSONAL_ACCESS_TOKEN environment variable contains a token that was rejected…"，用户感知为「又要重新认证」。
3. mossx 侧 `resolve_qoder_pat_for_spawn_for_distribution`（`src-tauri/src/engine/qoder_auth.rs`）在**进程 env 已存在同名变量时直接 return None**，子进程继承 mossx 进程的旧 env——设置页保存的新 PAT 根本不注入。Windows 系统环境变量对所有进程持久生效，用户按 qoder 官方文档配过旧 key 后，在 mossx 设置页换多少次新 token 都无效。

且当前存在三方自相矛盾：

| 事实源 | 表述 |
|--------|------|
| 代码行为 | 进程 env 优先，stored PAT 让位 |
| UI 文案（zh+en `envActiveHint`） | 「如需覆盖，请设置 PAT / Set a PAT to override it」 |
| `qoder_auth_status` state | stored 存在即报 `"configured"`，暗示 stored 生效 |

本机 Mac 实测（4.4 万次 exchange 全 200、0 次 token rejected）确认：Mac GUI 启动不继承 shell env，结构性不易触发；Windows 持久环境变量 + 终端启动 dev 版两条路径都会踩中。

## 目标与边界

### 目标

1. Spawn 注入优先级 MUST 为：stored PAT（`~/.ccgui/qoder-auth.json` / `qoder-cn-auth.json`）> 进程 env。stored 存在时显式 `cmd.env` 覆盖继承值；仅无 stored 时回退继承进程 env。
2. `qoder_auth_status` MUST 暴露 `envPresent`，使「stored 与 env 同时存在」对 UI 可见；设置页在该状态下 MUST 明确提示「进程环境变量中的 PAT 已被忽略，以保存的 PAT 为准」。
3. 行为、UI 文案、status state 三者语义 MUST 一致：谁生效就显示谁。

### 边界

- 不改 `qoder_has_pat_credential_for_distribution`（env OR stored 仍算有凭据），doctor / 登录判定语义不变。
- 不改另一 distribution env 的 `env_remove` 隔离逻辑。
- Global / CN 两 distribution 各自独立适用同一优先级规则。
- remote/daemon 路径复用同一 `qoder_auth` 模块（`engine_bridge.rs` 影子 include），自动获得修复，不另开实现。

## 非目标

- 不降低 status/models 探测的 spawn 频率（每次探测一次真实 exchange 的放大问题另行立项）。
- 不做 turn 错误「网络失败 vs 凭证被拒」分类提示（待拿到用户实际报错文本再定）。
- 不改 qodercli 自身行为（`persist:false` 每进程重新 exchange 是 CLI 既定设计）。

## What Changes

| 区域 | 变更 |
|------|------|
| `src-tauri/src/engine/qoder_auth.rs` | 优先级反转：stored PAT 优先；抽出纯函数便于单测；status 增加 `env_present` |
| `src/services/tauri/qoderAuth.ts` | `QoderAuthStatus` 增加 `envPresent: boolean` |
| `src/features/vendors/components/QoderAuthSection.tsx` | `configured && envPresent` 时展示「env PAT 已忽略」提示 |
| `src/i18n/locales/*/settings.ts`（10 语言） | 新增 `envIgnoredStoredWins` 文案 |
| OpenSpec | 本 change；`qoder-dual-distribution` capability 增补优先级 requirement |

## Impact

- 用户路径：Windows 上配过 `QODER_PERSONAL_ACCESS_TOKEN` 系统环境变量的用户，在设置页保存 PAT 立即生效，无需删除系统环境变量。
- 行为变化面：仅「stored 与 env 同时存在时谁赢」一种场景；仅 env、仅 stored、两者皆无三条路径不变。
- 基石文档：Qoder 校准行需补一条「PAT 注入优先级 stored > env」的事实源（收口时回写，见 tasks）。
