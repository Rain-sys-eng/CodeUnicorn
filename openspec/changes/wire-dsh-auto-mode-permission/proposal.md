# wire-dsh-auto-mode-permission

## Why

mossx composer 的「自动模式」(`bypassPermissions` → `full-access`) 对 DSH 只是 UI 状态。发送路径丢掉 `accessMode`，host 仍按默认 `workspace-write + ask` 跑。模型一旦把 `pwsh`/`bash` 升到 `danger-full-access`，就会弹出 sandbox 升级审批卡，用户会以为自动模式坏了。

这是 DSH 专属 permission 合同缺口，不是 Agent Preset，也不是 Claude/Codex 的 bypass。Grok / Pi 不在本 change：Grok headless 已强制 `--always-approve`；Pi `--print` 没有这条审批通道。

## What Changes

- DSH ModeSelect 开放两档：默认模式 ↔ 自动模式。
- 发送前把 `full-access` 映射成 DSH permission preset `danger-full-access`（sandbox 全开 + `approval: never`）。
- 非自动模式映射 `workspace-write`（workspace 可写 + `approval: ask`）。
- 续聊在 `session.prompt` 前调用 `commands/execute`，对当前 session 执行 `/permission <preset>`。
- 不把 Claude/Codex permission mode 复用成 DSH Agent Preset；也不在 mossx 侧自动点批准。

## Capabilities

### New Capabilities

- `dsh-auto-mode-permission`：DSH 自动模式与 host permission preset 的映射、发送合同与 ModeSelect。

### Modified Capabilities

- `dsh-engine-runtime`：`send_user_turn` 必须按 access mode 切换当前 session 的 permission preset。

## Impact

- Affected code: `src-tauri/src/engine/dsh/{session,mod}.rs`、`engine/commands.rs`、daemon send 桥、`ModeSelect`、zh/en `dshModes` i18n。
- 不改 Shared / Squad；DSH 不在 Shared 集合。
- 不写 DSH Settings `permissionPresets.defaultPreset`（那只影响下一场新会话，且 Full access 在 Web 要额外确认）。

## 目标与边界

- 目标：DSH 选自动模式后，host 进入 `danger-full-access`，不再为 sandbox 升级弹审批卡。
- 边界：只映射 shipped 两档 preset；`question/requested` 仍要人答；`never` 不是自动批准升级，而是 session 已处于 full access 所以不再升级。

## 非目标

- 不改 Grok / Pi / Kimi 自动模式。
- 不接 DSH Plan mode。
- 不在 mossx 前端按 allowlist 自动点 DSH 审批卡。
- 不把自动模式写进 DSH Web Settings 的未来会话默认值。
