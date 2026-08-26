# Delta: shared-keyed-load-state

## ADDED Requirements

### Requirement: Keyed Load Failure State MUST Surface Error And Retry

共享展示组件 `KeyedLoadState` MUST 以 `role="alert"` 渲染加载失败态：失败标题、后端错误详情（消费方传入的 error message）MUST 均可见；MUST 提供重试按钮，点击 MUST 调用消费方传入的 `onRetry` 回调。

组件 MUST NOT 自带加载/数据逻辑（store 层 errorByKey 等状态管理仍归各 feature）；MUST 允许消费方保留既有 CSS 钩子（className 透传）与自定义标题文案。

#### Scenario: renders error detail and retries via callback

- **WHEN** 消费方以非空 `error` 与 `onRetry` 渲染 `KeyedLoadState`
- **THEN** 面板 MUST 显示失败标题与错误详情（`role="alert"`）
- **AND** 点击重试按钮 MUST 恰好调用一次 `onRetry`

#### Scenario: default and custom copy

- **WHEN** 消费方未传 `title` / `retryLabel`
- **THEN** 组件 MUST 使用 `common.loadFailed` / `common.retry` i18n 默认值
- **AND** 传入自定义文案时 MUST 优先渲染自定义文案
