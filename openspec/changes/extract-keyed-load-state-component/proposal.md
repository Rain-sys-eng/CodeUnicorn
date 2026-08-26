# Change: extract-keyed-load-state-component

## Why

「异步加载失败 → 永远 loading、重试无效」是跨面板的全局性问题模式（`数据 === null && 无 error → 永远「加载中」`，错误被吞）。2026-08-25 pi 侧实证：`PiSessionTreePanel` 缺错误态曾让 RPC 闩中毒隐形 12.6 小时（`837b67870` 补了 `errorByKey` + 重试）；同日 0.9.3 用户反馈的工作区历史会话问题也命中同模式。

pi 侧的错误态 UI（标题 + 错误详情 + 重试按钮，`role="alert"`）是通用能力但当前手写内联在单个面板里。每新增一个需要错误态的面板就复制一遍结构与 i18n 接线，容易漏（历史会话面板即为漏网之例）。

## What Changes

- **F1 共享展示组件**：新建 `src/components/common/KeyedLoadState.tsx`——受控展示组件：props `error: string`（详情）、`onRetry: () => void`、`title?: string`（默认 `common.loadFailed` 新增 i18n 键）、`retryLabel?: string`（默认 `common.retry` 既有键）、`className / detailClassName / retryClassName`（消费方保留既有 CSS 钩子）。固定 `role="alert"` 语义。
- **F2 迁移首个消费方**：`PiSessionTreePanel.tsx` 错误分支改用 `KeyedLoadState`（保留 `pi-fs-load-error*` class 与 `piSession.tree.loadFailed` 标题），删除内联结构。
- **F3 i18n**：`common.loadFailed`（zh「加载失败」/ en「Load failed」）。
- **F4 测试**：新建 `KeyedLoadState.test.tsx`（渲染标题/详情/重试回调、默认与自定义文案）；`PiSessionTreePanel.test.tsx` 既有错误态用例保持绿（回归证明）。

## Capabilities

### New Capabilities

- `shared-keyed-load-state`：共享「加载失败 + 详情 + 重试」展示组件契约——固定 `role="alert"`、错误详情 MUST 可见、重试 MUST 回调消费方 reload。

### Modified Capabilities

- 无。`pi-session-fork-tree` 的「加载失败错误态」行为不变（该 requirement 尚在未归档 change `fix-pi-rpc-latch-cooldown-tree-error-state` 中，本 change 仅改实现路径，不动其 spec delta）。

### Non-Goals

- 不抽取 store 层（`errorByKey` 三件套仍由各 feature store 自管；待第三家消费方出现再评估 `createKeyedAsyncStore` 工厂）。
- 不改工作区历史会话侧栏列表的错误态（其加载链路为多源合并 + timeout fallback，错误态设计单独评估）。
- 不做自动重试退避。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | 新增 `KeyedLoadState.tsx` + 测试；`PiSessionTreePanel.tsx` 迁移；`zh/en common.ts` 各 +1 键 |
| 热路径 | 无（仅错误分支渲染） |
| 兼容性 | pi 面板 class/文案/交互不变（CSS 钩子保留） |

## Acceptance

1. `KeyedLoadState` 单测全绿（默认/自定义文案、重试回调、`role="alert"`）。
2. `PiSessionTreePanel` 既有测试全绿（错误态渲染 + 重试触发重新加载，行为不变）。
3. focused vitest 全绿；`openspec validate extract-keyed-load-state-component` 通过。
