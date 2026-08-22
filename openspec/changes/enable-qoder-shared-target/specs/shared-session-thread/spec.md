## MODIFIED Requirements

### Requirement: Shared Session Hidden Native Bindings Stay Internal

Native bindings owned by a `shared session` are runtime internals and MUST NOT become user-facing native conversations. This rule applies to every Shared-supported engine (`Claude`, `Codex`, `Kimi`, `Grok`, `OpenCode`, `PI`, and `Qoder`), not only `Claude` / `Codex`.

Ownership MUST include:

- 当前 durable binding id
- V0 `bindings_by_engine` / `bindings_by_target` 缺失或为空时，`shared_binding_state` 与 `binding.*` durable event 中按 Shared session 归属的 current / archived native id
- Shared 续跑新写的 native 文件 sessionId（Claude `{fileUuid}.jsonl` 与信封 `binding:` 不必相同）
- 首条真实 user 为 MOSSX 协议包的 session，即使预览标题已被抽成用户原话

#### Scenario: Qoder Shared binding and raw-parent pup stay hidden

- **WHEN** a Shared Qoder binding is materialized as `qoder:<sessionId>`
- **AND** a native row or child reports the same owner using bare `<sessionId>`
- **THEN** the Shared hide identity MUST treat both forms as the same internal owner
- **AND** the binding and its Shared-owned pup MUST NOT appear in sidebar native surfaces
- **AND** a Qoder Native Session whose id is absent from the Shared hide set MUST remain visible

#### Scenario: daemon Shared listing restores V2-only Qoder binding ownership

- **WHEN** a legacy Shared metadata record has empty `bindings_by_engine` and `bindings_by_target`
- **AND** `shared_binding_state` or a `binding.*` event records `qoder:<sessionId>` for that exact Shared session
- **THEN** daemon `list_shared_sessions` and catalog projection MUST return that identity only in the matching Shared summary's `nativeThreadIds`
- **AND** the existing sidebar hide set MUST hide the matching Qoder Native row and raw-parent pup
- **AND** V2 read failure MUST retain only available V0 binding facts, without title-based ownership inference or hiding an unrelated Qoder Native Session
