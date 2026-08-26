# add-dsh-agent-preset-picker design

## 合同

DSH host：

| 时机 | RPC | 说明 |
|---|---|---|
| 新会话 / pending 首发 | `session.create({ workspaceId, agentPreset? })` | 省略则 host 用 settings default（网页默认 `standard`） |
| 空白已存在的 session | `agentPreset.select` | mossx 当前不预创建空白 session，本 change 不走这条 |
| 已开聊 | 禁止 select | host 回 `agent-preset-locked` |
| 续聊 | 读 `session.list[].agentPreset` | header 已写入，resume 重建同一组装 |

未知 id → `agent-preset-not-found`，按现有 send 错误 toast。

## UI（方案 A）

DSH 引擎时，composer 工具条在 ModeSelect 与 ReasoningSelect 之间放一枚 `selector-button`：

- 空白：短名 + chevron，菜单四项（名称 + 描述 + 右侧 id），选中打勾。
- 开聊：锁图标 + 短名，无 chevron；点击 toast「会话已开聊，组装锁定。新开会话才能换 preset。」
- 非 DSH 不渲染。

锁定口径：已有 `dsh:` 会话一律按 header 锁定，不看当前 items 是否已 hydrate。`dsh-pending-*` 仅在已有 user message 后锁定。首页 create-session 仍算空白。切会话时不得回落到全局 `ComposerEnginePrefs.dshAgentPreset`。

Resume 展示：`session.list.agentPreset` 写入 `ThreadSummary.dshAgentPreset` 后，index / live merge / rename 必须保留该字段。index 行没有 preset 时不得覆盖 live header。全局 prefs 只播种空白会话。缺 header 时不得把猜的 `standard` 写回 live summary；本 change 不扩 session_index schema。

## 数据流

```text
空白选择
  → Composer draft + ComposerEnginePrefs.dshAgentPreset
  → MessageSendOptions.dshAgentPreset
  → engine_send_message(dshAgentPreset)
  → send_user_turn → session.create({ agentPreset })

续聊
  → session.list.agentPreset
  → DshSessionSummary.agentPreset
  → ThreadSummary.dshAgentPreset
  → Composer 只读 pill
```

`dshAgentPreset` 是独立 send 字段，不复用 OpenCode `agent`。

## 默认值

空白会话：`prefs.dshAgentPreset` → 否则 `standard`。只持久化 shipped 四档。

## 测试

- Rust：create payload 带 / 不带 `agentPreset`。
- Frontend：空白可选、开聊锁定 toast、send options 带 id、prefs normalize。
