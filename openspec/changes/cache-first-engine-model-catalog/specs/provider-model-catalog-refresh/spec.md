## ADDED Requirements

### Requirement: Expensive Engine Catalog Probes MUST Be Cache-First

本地 `get_engine_models` 对 catalog 探测需要 spawn CLI 进程的引擎(PI / Kimi / Grok)
MUST 采用 cache-first 语义,与 Claude/Codex 分支及 daemon remote 路径对齐:非
`force_refresh` 且 engine status 缓存含非空 models 时,MUST 直接返回缓存,MUST NOT
发起任何 CLI 探测进程。`force_refresh` 或缓存为空时 MUST 走完整 fresh 探测链;fresh
结果非空时 MUST 回写 engine status 缓存。

#### Scenario: cached catalog skips CLI probe

- **WHEN** picker 首次打开请求 PI catalog,且启动 detect 已填充非空缓存
- **THEN** backend MUST 直接返回缓存 models
- **AND** MUST NOT spawn `pi --mode rpc` / `pi --list-models` / `pi --version` 任何探测进程

#### Scenario: forced refresh bypasses cache and writes back

- **WHEN** 用户点击刷新按钮(`forceRefresh: true`)
- **THEN** backend MUST 绕过缓存执行完整 fresh 探测链
- **AND** fresh 结果非空时 MUST 返回 fresh 并回写缓存

#### Scenario: failed refresh preserves last-good

- **WHEN** fresh 探测返回空 models(RPC 超时且 `--list-models` 回退失败)
- **AND** 缓存中存在非空 last-good models
- **THEN** backend MUST 返回 last-good 缓存
- **AND** MUST NOT 用空结果覆盖缓存

#### Scenario: empty cache falls through to fresh probe

- **WHEN** 缓存为空(启动 detect 尚未完成)且非 `force_refresh`
- **THEN** backend MUST 执行 fresh 探测并返回其结果
- **AND** fresh 非空时 MUST 回写缓存供后续 cache-first 命中
