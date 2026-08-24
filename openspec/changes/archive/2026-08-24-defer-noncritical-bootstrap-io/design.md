# Design: defer-noncritical-bootstrap-io

## 决策

### Critical vs deferred client stores

| Store | Phase | 理由 |
|---|---|---|
| `layout` | critical | 侧栏/面板尺寸、透明度、collapsed chrome，影响壳几何 |
| `app` | critical | `language`、workspace/open-app 偏好；i18n 与 Home 需要 |
| `composer` | deferred | textarea 高度 / per-thread model selection 可后补 |
| `threads` | deferred | sidebar snapshot / pins / customNames 不是画壳前提 |
| `leida` | deferred | Session Radar 历史，Home 可不带雷达完成记录先画 |
| `diagnostics` | deferred | renderer diagnostics persist，已有 `!isPreloaded()` buffer |

`isPreloaded()` 语义保持「全部 store 已 hydrate」。diagnostics flush / persist 继续等全量 ready，避免把 early buffer 写进尚未读盘的 diagnostics store。

### Write-before-hydrate merge

deferred store 在首屏可能被 hook 写入（composer height、radar persist、composer selection inherit）。preload 落地时：

- `pendingFullReplace`：保留内存全量，不覆盖。
- 否则：`disk ∪ dirtyKeys`（dirty 胜出）。
- 未 dirty 的内存 default 不得覆盖磁盘。

因此首屏 hook MUST：store 未 ready 时不 persist default；ready 后再读盘回填。

### i18n

- `i18nCriticalReady`：等 `app` store ready（cheap sync `isClientStoreReady("app")`，未就绪再 await），加载 `locales/<lng>/critical`，`i18n.init`。
- `i18nReady`：在 critical 之后加载 `locales/<lng>/deferred` 并 `addResourceBundle`。
- bootstrap 只 await `i18nCriticalReady`。
- `changeLanguage` 仍 await full pack，避免 settings / about raw keys。
- `files.loadingFiles` 已在 critical；`settings.sidebarBasic` 留在 deferred。打开 Settings 前 deferred 应已 idle 灌入；若用户极快点进 Settings，允许短暂 raw key，随后 bundle 到达即恢复。这是 P2-3 全量回退与 first-paint 之间的有意折中。

### Bootstrap 时序

```text
start: app import || critical stores || i18n critical (waits app store)
await all three
mount shell  → first-paint marker
schedule idle/first-interaction:
  deferred stores → maintenance → diagnostics flush
  deferred i18n
post-render (existing): migration, input history
```

不把 deferred store IPC 与 critical 并行：六路 Tauri `client_store_read` 会抢 critical `layout`/`app`。

### Hook 回填

`subscribeClientStoreHydrated(store, listener)`：已 ready 则同步 fire。

- `useWorkspaces` / `useThreads`：threads hydrate 后，仅当当前列表仍空时套用 sidebar snapshot。
- `useThreadStorage`：reload pins / aliases / activity / customNames。
- `useComposerEditorState`：未就绪不写；hydrate 后若用户未改高度则套用存储值。
- `useSelectedComposerSession`：未就绪只改内存；hydrate 后 `reloadSelectedComposerSelection`。
- `useSessionRadarFeed`：未就绪不 persist；hydrate 后重读 snapshot。

## 风险

| 风险 | 缓解 |
|---|---|
| sidebar 先空后有 snapshot | 已有 first-paint「先短后全」契约；只在空列表时回填 |
| composer 高度闪一下 | 默认 80，hydrate 后纠正；用户已拖动则不覆盖 |
| Settings 极早打开 raw keys | deferred idle timeout 短；switch language 仍等 full pack |
| 诊断在 deferred 前丢失 | `!isPreloaded()` 继续 early persist；deferred 后 flush |
