# Design: add-runtime-model-receipt-to-turn-badge

## Context

用户收口：去掉 Native CLI session 的 badge / 回执，只保留 Shared Session。

## Goals / Non-Goals

**Goals:**

1. Shared 发送瞬间用 `send.request` 种回执，对话立刻看见高亮 `→ R {requestModel}`。
2. Shared stream 真实模型只升级 receipt，不覆盖 snapshot.model。
3. 点回执在气泡内下滑展示出处。
4. Shared 适配图标保持原色。
5. Native CLI 会话不写 snapshot / receipt，UI 不渲染 badge。

**Non-Goals:**

- Native 历史 JSONL 回执。
- Native live sidecar 驱动 UI（Rust Claude sidecar 可保留，前端忽略非 Shared thread）。
- 重做 picker / send 权威。

## Decisions

### D1. Shared-only 写入

- Native send 不再调用 `rememberNativeTurnSnapshot` / `rememberRuntimeReceipt`。
- Shared send 仍冻 snapshot，并种 `runtimeReceipt.modelSource = "send.request"`。
- 事件 attach / capture / token window 只在 `shared:`（含 agent-canvas 投影到 Shared）上合并 receipt。

### D2. Native 历史不打身份

Native history parser / `normalizeHistorySnapshot` / `threadItems` 不再 stamp `executionTargetSnapshot` / `runtimeReceipt`。

### D3. UI 不变，靠数据关闭 Native

MessageRow 仍只在有 `executionTargetSnapshot` 时画 badge。Native 没有该字段即不显示。

### D4. Shared 投影

无 receipt 时用 snapshot.model 回退 `send.request`，避免 Shared 刷新丢箭头。
