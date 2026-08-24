# Tasks / 任务

## Planning / 规划

- [x] 1. 盘点 `bootstrapApp`、`preloadClientStores`、`i18nReady`、首屏 store reader/writer。
- [x] 2. 标定 critical store = `layout` + `app`；其余 deferred。
- [x] 3. 确认 i18n `critical.ts` / `deferred.ts` 边界与 P2-3 raw-key 回归点。

## Implementation / 实施

- [x] 4. 拆分 critical / deferred store preload，并实现 write-before-hydrate merge 与 hydrated 订阅。
- [x] 5. bootstrap 只 await critical stores + `i18nCriticalReady` + App import；mount 后再灌 deferred。
- [x] 6. i18n 启动只加载 critical pack；`i18nReady` / `changeLanguage` 负责 deferred。
- [x] 7. 首屏 hook 在 store 未就绪时禁止 persist default，hydrate 后回填。

## Validation / 验证

- [x] 8. 更新 `clientStorage` / `bootstrapApp` / `i18n` focused tests。
- [x] 9. 运行相关 vitest + 变更文件 typecheck / lint。
