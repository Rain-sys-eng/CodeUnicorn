# add-dsh-agent-preset-picker

## Why

mossx 已把 DeepSeek Harness 接成 Native Engine，但 `session.create` 从不传 `agentPreset`。用户在 DSH Web 里能选的四种组装（标准 / PTC / 极简 / 创造）在 mossx composer 里完全看不见，新会话只能吃 host 默认 `standard`。这是 DSH 专属 create-time 合同缺口，不是权限模式，也不是 OpenCode agent。

## What Changes

- DSH composer 工具条增加方案 A：与模型 / reasoning 并列的 Agent Preset pill。
- 空白会话（尚无用户消息）可切换 `standard` / `code` / `minimal` / `cordis`。
- 发出第一条后锁定：pill 变只读，点击 toast 提示新开会话才能换。
- 新建走 `session.create({ agentPreset })`；续聊读 `session.list` header 的 `agentPreset`，不再次 select。
- 上次选择写入 `ComposerEnginePrefs.dshAgentPreset`，只影响下一场空白会话。

## Capabilities

### New Capabilities

- `dsh-agent-preset-picker`：DSH Agent Preset 的 create-time 选择、锁定态、发送合同与历史回填。

### Modified Capabilities

- `dsh-engine-runtime`：`session.create` 必须能带 `agentPreset`。

## Impact

- Affected code: `src-tauri/src/engine/dsh/{session,mod,history}.rs`、`engine/commands.rs`、daemon send 桥、`src/features/composer/**`、`src/features/threads/**`、`ComposerEnginePrefs`、zh/en composer i18n。
- 不改 Shared / Squad；DSH 不在 Shared 集合。
- 不调用 `agentPreset.read` / `copy` / `remove`，不写 DSH settings default。

## 目标与边界

- 目标：DSH 对话框用方案 A 选组装，并真正传到 host。
- 边界：只接 shipped 四档；自定义 user preset 若出现在历史 header 只展示、不可改。

## 非目标

- 不做空白会话四张卡（方案 B）。
- 不嵌 DSH Web UI，不管理 preset roster。
- 不把 `agent`（OpenCode）字段复用成 DSH preset。
- 不在已开聊会话上调用 `agentPreset.select`（host 会 `agent-preset-locked`）。
