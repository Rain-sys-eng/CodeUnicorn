# Tasks: extract-keyed-load-state-component

## 1. 共享组件

- [x] 新建 `src/components/common/KeyedLoadState.tsx`：`error` / `onRetry` / `title?`（默认 `t("common.loadFailed")`）/ `retryLabel?`（默认 `t("common.retry")`）/ `className?` / `detailClassName?` / `retryClassName?`；容器固定 `role="alert"`。
- [x] i18n：`src/i18n/locales/zh/common.ts` + `en/common.ts` 补 `loadFailed`。

## 2. 迁移 pi 面板

- [x] `PiSessionTreePanel.tsx`：错误分支改用 `KeyedLoadState`（`title={t("piSession.tree.loadFailed")}`，保留 `pi-fs-empty pi-fs-load-error` / `pi-fs-load-error-detail` / `pi-fs-load-error-retry` class），删除内联 `<p>`/`<button>` 结构。

## 3. 测试

- [x] 新建 `KeyedLoadState.test.tsx`：默认标题/详情/重试回调/role=alert；自定义 title 与 className 透传。
- [x] focused vitest：`KeyedLoadState.test.tsx` + `PiSessionTreePanel.test.tsx` + `piSessionStore.test.ts` 全绿。

## 4. OpenSpec

- [x] `openspec validate extract-keyed-load-state-component` 通过。
