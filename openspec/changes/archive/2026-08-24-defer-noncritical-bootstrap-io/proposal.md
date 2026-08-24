# defer-noncritical-bootstrap-io

## Summary / 摘要

缩短 renderer first-paint critical path：`bootstrap()` 只等待壳层必需的 `layout` / `app` store 与 current-locale **critical** i18n pack；`threads` / `diagnostics` / `leida` / `composer` 与 deferred locale 在 shell mount 之后用 `requestIdleCallback` / 首次交互再灌。禁止再用全量 `preloadClientStores` 或 `i18nReady` 挡住第一帧。

## Problem / 问题

`bootstrap()` 已并行 kick-off `import("./App")` 与 i18n，但 mount 仍串行等待：

1. `preloadClientStores()` 一次拉 6 个 store（`layout` / `composer` / `threads` / `app` / `leida` / `diagnostics`），全部走 Tauri IPC。
2. `await module.i18nReady` 加载 current locale **full pack**（critical + deferred），而 locales 已按 `critical.ts` / `deferred.ts` 拆好。

壳层画出 `StartupGate` + `Home` 只需要 `layout` + `app`。`threads` / `diagnostics` / `leida` 以及 settings / about 等 deferred copy 不该挡 first paint。

对应 skill：`async-defer-await` / `async-cheap-condition-before-await` / `async-suspense-boundaries`。

## Goals / 目标

- First shell render 只等待 critical subset：`layout` + `app` store、current-locale critical pack、`import("./App")`。
- 非关键 store 与 deferred locale 在 mount 后 idle / 首次交互灌入。
- 未 hydrate 的 store 上若已有 in-memory write，deferred preload MUST merge（dirty / full-replace 胜出），禁止用磁盘快照覆盖。
- 首屏 hook 不得在 deferred store 未就绪时把 default 值 echo-write 进磁盘。
- `i18nReady` 仍表示 full pack，但 bootstrap 不得再用它挡第一帧。
- language switch 仍在 commit 前加载完整目标 locale（含 deferred），避免 settings raw keys。

## Non-Goals / 非目标

- 不重写 Startup Orchestrator / first-paint thread list hydration。
- 不改 client store schema、migration 语义或 diagnostics persist budget。
- 不把 settings / about 等 deferred keys 并回 critical pack。
- 不在本 change 处理 AppShell 层 4 渲染单价。

## Approach / 方案

1. 将 `ALL_CLIENT_STORES` 拆成 `CRITICAL_CLIENT_STORES`（`layout` / `app`）与 `DEFERRED_CLIENT_STORES`。
2. bootstrap 并行启动 App import、critical store preload、`i18nCriticalReady`；`Promise.all` 后立刻 mount。
3. mount 后用 idle / first interaction 灌 deferred stores，再跑 `runClientStoreMaintenance`。
4. i18n 启动只 `import(locales/<lng>/critical)`；deferred pack 后置 `addResourceBundle`。
5. 为 composer / threads / leida 等首屏 reader 增加 store-hydrated 订阅，hydrate 后再读；未就绪禁止 persist default。

## Capabilities

### Modified Capabilities

- `client-startup-orchestration`：收紧 renderer bootstrap 的 critical store / critical locale 定义，明确 deferred I/O 不得挡 first paint。
