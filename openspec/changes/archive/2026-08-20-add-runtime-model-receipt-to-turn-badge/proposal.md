# Proposal: add-runtime-model-receipt-to-turn-badge

> OpenSpec change id: `add-runtime-model-receipt-to-turn-badge`
> 范围收口：只保留 Shared Session。Native CLI session 不再显示 turn badge / runtime 回执。
> 正交：`fix-model-picker-send-authority`（picker = send 权威，本 change 不反写 picker）

---

## Why

用户明确收口：Native CLI 会话不要这套「picker → 真实模型」标识。该能力只服务 Shared Session（跨 CLI 适配才需要对照请求名与运行时模型）。Native 继续只显示普通助手气泡，不挂 badge、不挂 `→` 回执。

Shared 仍需要：

1. 原始 picker 信息不能丢。
2. 返回信息必须有可见 `→` 标识，点开气泡内下滑看出处。
3. Shared 侧栏 / 顶栏适配图标保持原色，不用橘色。

## What Changes

- **Native CLI session：关闭。** 不冻 native snapshot，不种 native receipt，不从 native 历史 / raw 事件写回执，MessageRow 因没有 snapshot 而不渲染 badge。
- **Shared Session：保留。** 发送时冻 `executionTargetSnapshot` + `send.request` 回执；stream / turn completed / live window 升级 receipt；投影透传；点开下滑。
- Shared 适配图标保持 muted 原色。

**非 BREAKING**。picker / send 仍只信 resolver。回执不得反写 picker。

## 目标与边界

- **目标**：仅 Shared 助手气泡显示「你点了什么 → 实际/请求回执」。
- **边界**：Native Claude / Codex / Gemini / Grok / Kimi / OpenCode / PI / DSH 会话 MUST NOT 出现 turn badge 或 runtime 回执。

## 非目标

- 不把 runtime 模型写回 picker。
- 不在未知窗口上用 200K 假权威。
- 不提交 git commit。

## Capabilities

### New Capabilities

- `turn-target-runtime-receipt`: 仅 Shared 助手消息在有 snapshot 时显示 turn badge 与同行回执；发送时即有标识；stream 升级真实模型与窗口；点开下滑出处。Native CLI 不启用。Shared 适配图标保持原色。

## 验收标准

1. Native 任意 CLI 发送后，助手气泡 MUST NOT 出现 turn badge / `→` 回执。
2. Shared 发送后立刻出现 picker badge 与 `→ {request}`；stream 真实模型只升级右边。
3. 点击 Shared 回执下滑展示 请求 / 实际 / 来源 / 窗口。
4. 窗口未上报显示 `?`，不得显示 200K。
5. 侧栏 / 顶栏 Shared 图标不得使用 `#f59e0b`。
6. 相关 vitest 绿。
