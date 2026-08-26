# client-startup-orchestration Specification

## Purpose

Defines the client-startup-orchestration behavior contract, covering Client startup SHALL use phase-based orchestration.
## Requirements
### Requirement: Client startup SHALL use phase-based orchestration
The client SHALL route startup-time loading through a frontend Startup Orchestrator that assigns each task to exactly one startup phase: `critical`, `first-paint`, `active-workspace`, `idle-prewarm`, or `on-demand`.

#### Scenario: first paint is not blocked by heavy hydration
- **WHEN** the application opens the main client window
- **THEN** `critical` and `first-paint` tasks SHALL be the only phases allowed to block initial shell rendering
- **AND** thread/session full hydration, complete file tree loading, git diff preload, catalog prewarm, and dictation model status SHALL NOT block the initial shell render

#### Scenario: task declares orchestration metadata
- **WHEN** a startup-time load is registered with the Startup Orchestrator
- **THEN** the task SHALL declare `id`, `phase`, `priority`, `dedupeKey`, `concurrencyKey`, `timeoutMs`, `workspaceScope`, `cancelPolicy`, `traceLabel`, and fallback behavior
- **AND** the orchestrator SHALL reject or flag startup tasks that lack required metadata

#### Scenario: startup phases preserve active workspace priority
- **WHEN** the app has an active workspace during startup
- **THEN** active workspace minimal hydration SHALL run before idle prewarm for non-active workspaces
- **AND** non-active workspace scans SHALL wait for an idle slot or explicit user interaction

### Requirement: Startup orchestration SHALL separate critical loading from opportunistic prewarm
The client SHALL keep the critical startup path limited to data needed to render and operate the initial shell, while opportunistic preloads SHALL run only after first paint, during idle time, or after explicit user demand.

#### Scenario: critical path contains only shell prerequisites
- **WHEN** startup begins
- **THEN** the critical path SHALL include client store preload, app settings, workspace list, shell render readiness, and active workspace minimal state only
- **AND** heavy workspace scans SHALL be excluded from that path

#### Scenario: active workspace hydration is bounded
- **WHEN** the active workspace is hydrated after first paint
- **THEN** the client SHALL load only bounded first-page thread/session data, one git status snapshot, and minimal engine/model selection data required for the current workspace
- **AND** full history scans or complete catalog merges SHALL be deferred

#### Scenario: idle prewarm stays interruptible
- **WHEN** idle prewarm is running and the user switches active workspace or starts a foreground action
- **THEN** interruptible idle tasks SHALL yield, cancel, or downgrade according to their `cancelPolicy`
- **AND** foreground active workspace work SHALL receive priority

### Requirement: Startup tasks SHALL be deduplicated, cancellable, and timeout bounded
The Startup Orchestrator SHALL coalesce duplicate startup work, enforce task timeouts, and prevent stale workspace hydration from competing with current foreground work.

#### Scenario: duplicate task joins in-flight work
- **WHEN** multiple hooks, route transitions, or focus events request the same startup task with the same `dedupeKey`
- **THEN** the orchestrator SHALL run one in-flight task or share its result
- **AND** it SHALL NOT issue parallel equivalent IPC calls for the same workspace and task identity

#### Scenario: stale workspace hydration is cancelled
- **WHEN** a workspace-scoped hydration task is running for a workspace that is no longer active
- **AND** the task is marked cancellable
- **THEN** the orchestrator SHALL cancel or downgrade that task before scheduling new active workspace foreground hydration

#### Scenario: slow task settles through fallback
- **WHEN** a startup task exceeds its `timeoutMs`
- **THEN** the orchestrator SHALL record a timeout event and apply the task's fallback behavior
- **AND** the AppShell SHALL remain usable instead of waiting indefinitely

### Requirement: Startup orchestration SHALL enforce startup budgets and concurrency caps
The Startup Orchestrator SHALL enforce startup budgets for milestones, idle execution, phases, workspace scopes, and heavy command classes so orchestration does not concentrate startup I/O into a new bottleneck.

#### Scenario: startup milestones are recorded
- **WHEN** the application starts through the orchestrated path
- **THEN** startup trace SHALL record `shell-ready`, `input-ready`, and `active-workspace-ready` milestones
- **AND** each milestone SHALL be attributable to the tasks that completed, degraded, or timed out before it

#### Scenario: phase concurrency is capped
- **WHEN** multiple startup tasks are ready in the same phase
- **THEN** the orchestrator SHALL respect the configured phase concurrency cap
- **AND** excess tasks SHALL remain queued instead of starting unbounded parallel work

#### Scenario: heavy command classes are capped
- **WHEN** startup tasks target heavy command classes such as file tree, git diff, thread/session catalog, or engine/model catalog
- **THEN** the orchestrator SHALL enforce `concurrencyKey` limits for those command classes
- **AND** heavy idle prewarm SHALL NOT starve active workspace foreground work

#### Scenario: idle work yields within budget
- **WHEN** idle-prewarm tasks are running
- **THEN** each idle slice SHALL respect the configured wall-time budget
- **AND** remaining idle work SHALL yield to later idle slots when the budget is exhausted

### Requirement: Cancellation semantics SHALL distinguish hard cancellation from stale-result suppression
The Startup Orchestrator SHALL represent cancellation semantics explicitly so tasks that cannot interrupt an underlying Tauri or backend command still prevent stale results from mutating current UI state.

#### Scenario: stale result is ignored after workspace switch
- **WHEN** a workspace-scoped backend command cannot be hard cancelled
- **AND** the active workspace changes before the command settles
- **THEN** the orchestrator SHALL treat the result as stale unless its generation and workspace scope still match the active target
- **AND** stale results SHALL NOT overwrite the current active workspace state

#### Scenario: hard abort is used only when supported
- **WHEN** a task declares hard-abort cancellation
- **THEN** the task implementation SHALL support a real abort mechanism such as AbortSignal or backend cooperative abort
- **AND** tasks without such support SHALL use soft-ignore or yield-only cancellation semantics

#### Scenario: cancellation outcome is traced
- **WHEN** a task is cancelled, yielded, downgraded, or stale-result ignored
- **THEN** startup trace SHALL record the actual cancellation mode
- **AND** diagnostics SHALL NOT report soft-ignore as a successful hard abort

### Requirement: Focus and visibility refresh SHALL be coalesced through startup orchestration
The client SHALL route foreground return, focus, and visibility refresh work through the Startup Orchestrator instead of allowing each hook to independently rescan workspace, thread, git, or file state.

#### Scenario: repeated focus events are coalesced
- **WHEN** the app receives multiple focus or visibility events within the configured cooldown window
- **THEN** refresh work with the same `dedupeKey` SHALL be coalesced
- **AND** only the latest valid refresh intent SHALL be retained

#### Scenario: focus refresh respects active workspace scope
- **WHEN** the app returns to foreground with an active workspace
- **THEN** active workspace refresh tasks SHALL be scheduled before non-active workspace refresh tasks
- **AND** non-active refresh SHALL require idle budget or explicit visibility in the UI

### Requirement: Heavy startup data SHALL be loaded on demand or within idle budget
The client SHALL defer heavy startup data sources unless the relevant UI is visible, the user explicitly requests the data, or idle budget is available, and deferred file tree hydration SHALL remain discoverable through explicit unknown or partial directory state.

#### Scenario: git diffs are not preloaded unconditionally
- **WHEN** the app starts and the Git diff panel is not visible
- **THEN** git diff preload SHALL NOT run in the critical or first-paint phases
- **AND** git diff loading SHALL require panel visibility, explicit user action, or an idle-prewarm budget

#### Scenario: complete file tree is not loaded unconditionally
- **WHEN** a workspace has a large file tree or the file panel is not visible
- **THEN** complete file tree loading SHALL be deferred to on-demand or idle-prewarm work
- **AND** the visible shell MAY use cached, shallow, or skeleton file state while hydration continues
- **AND** any visible directory whose children are not fully known SHALL remain discoverable as unknown or partial rather than being rendered as permanently empty

#### Scenario: visible file tree first paint uses shallow root data
- **WHEN** a workspace opens with the file tree visible
- **THEN** the client SHALL be allowed to render the file tree from a shallow workspace-root child query
- **AND** the client MUST NOT keep the file tree in an initial loading-only state until complete recursive workspace tree hydration finishes
- **AND** file tree startup MUST NOT automatically call complete recursive workspace tree hydration

#### Scenario: workspace switching does not stack full file scans
- **WHEN** the active workspace changes repeatedly
- **THEN** the client SHALL refresh the visible file tree with bounded directory-child queries
- **AND** the file tree path MUST NOT automatically start `list_workspace_files` for the previous or next workspace during the normal success path

#### Scenario: root child query failure can use compatibility fallback
- **WHEN** the shallow root directory-child query fails
- **AND** the client has no cached or visible root snapshot for the active workspace
- **THEN** the client MAY attempt a single legacy `list_workspace_files` fallback
- **AND** fallback success SHALL clear the visible file-list error state
- **AND** fallback failure SHALL keep the root query error visible for retry
- **AND** any fallback data stored in the root snapshot cache MUST be reduced to root-level files, root-level directories, and root-level directory metadata

#### Scenario: recently loaded workspace root state is restored from cache
- **WHEN** the user switches back to a recently loaded workspace
- **THEN** the client SHOULD restore its cached shallow root snapshot before showing a loading-only state
- **AND** the cache MUST be bounded and MUST NOT store a complete recursive workspace tree

#### Scenario: pending root queries are reused during fast switch-back
- **WHEN** a root directory-child query for a workspace is still in flight
- **AND** the user switches away from that workspace and back before the query resolves
- **THEN** the client SHOULD reuse the existing in-flight query
- **AND** it SHOULD NOT issue a duplicate root directory-child RPC for the same workspace

#### Scenario: late responses after unmount are ignored
- **WHEN** a file tree root request resolves after the hook consumer has unmounted
- **THEN** the client MUST NOT mutate visible hook state from that response
- **AND** it MUST still clear request-local in-flight bookkeeping

#### Scenario: shallow file tree polling avoids recursive scan pressure
- **WHEN** periodic file tree polling refreshes visible workspace file state
- **THEN** the polling path SHOULD refresh shallow root state or otherwise stay bounded
- **AND** it MUST NOT repeatedly require complete recursive workspace tree scans while the user is only browsing visible root/lazy-loaded nodes

#### Scenario: visible file tree recovers deferred children on expansion
- **WHEN** the visible file tree contains a directory from cached, shallow, or partial file state
- **AND** the user expands that directory
- **THEN** the client SHALL load direct children on demand within the file tree interaction path
- **AND** the action SHALL NOT require waiting for complete workspace tree hydration

#### Scenario: catalog prewarm runs after shell interactivity
- **WHEN** skills, prompts, commands, collaboration modes, agents, dictation model status, engine model catalog, or non-active session catalogs are loaded opportunistically
- **THEN** those tasks SHALL run after the shell is interactive
- **AND** they SHALL not block active workspace minimal hydration

### Requirement: Startup trace SHALL expose task timing and degradation evidence
The system SHALL expose diagnostic evidence for startup tasks so slow startup can be attributed to specific phases, tasks, workspace scopes, and backend commands.

#### Scenario: task lifecycle is traced
- **WHEN** a startup task is queued, started, completed, failed, timed out, cancelled, or degraded
- **THEN** startup trace SHALL record the task id, phase, trace label, workspace scope, lifecycle state, timestamps, duration, and fallback status

#### Scenario: heavy backend command is attributable
- **WHEN** a startup task invokes a backend command that can perform file, git, engine, model, thread, or session work
- **THEN** trace evidence SHALL retain enough command labeling to attribute the task duration to that backend command class

#### Scenario: diagnostics survive partial startup failure
- **WHEN** one startup task fails or degrades
- **THEN** startup trace SHALL preserve the failure evidence
- **AND** unrelated startup phases SHALL continue when their dependencies are still satisfied

### Requirement: React integration SHALL avoid render amplification
The Startup Orchestrator SHALL expose startup state through stable subscriptions or selectors rather than directly driving broad React component state updates for every task lifecycle event.

#### Scenario: shell subscribes only to shell-level startup state
- **WHEN** startup task trace events are emitted
- **THEN** AppShell SHALL subscribe only to shell milestones and degraded states required for rendering
- **AND** trace-only events SHALL NOT force broad AppShell re-renders

#### Scenario: feature panels subscribe to scoped task status
- **WHEN** a feature panel needs startup or hydration status
- **THEN** the panel SHALL subscribe to task status scoped to that feature or workspace
- **AND** unrelated startup task events SHALL NOT update that panel's React state

### Requirement: Migration SHALL prevent legacy and orchestrated startup double-loading
During migration, each startup-time IPC or heavy data source SHALL have one active owner so legacy hooks and orchestrated tasks do not issue duplicate work for the same startup intent.

#### Scenario: migrated startup command has a single owner
- **WHEN** a startup command is migrated into the Startup Orchestrator
- **THEN** the legacy mount-time hook SHALL stop issuing the same command for the same startup intent
- **AND** tests or trace evidence SHALL show only one owner for that command path

#### Scenario: new startup IPC must register an owner
- **WHEN** new code introduces IPC that can run during startup or foreground return
- **THEN** the code SHALL either register a Startup Orchestrator task descriptor or explicitly document why the call is not startup-time work
- **AND** unowned heavy startup IPC SHALL be treated as a regression

### Requirement: Startup orchestration implementation SHALL remain cross-platform and CI-gate clean
Startup Orchestrator implementation, diagnostics, and tests SHALL remain compatible with Windows, macOS, and Linux and SHALL NOT introduce new warning noise, large-file governance debt, or heavy-test-noise sentry failures.

#### Scenario: implementation remains platform-neutral
- **WHEN** startup orchestration code handles paths, timers, idle scheduling, IPC labels, diagnostics, or test fixtures
- **THEN** it SHALL avoid assumptions that only hold on one operating system
- **AND** behavior SHALL remain valid on Windows, macOS, and Linux CI runners

#### Scenario: tests avoid platform-specific instability
- **WHEN** orchestrator tests assert scheduling, timeout, cancellation, trace, or diagnostics behavior
- **THEN** they SHALL use deterministic time and platform-neutral path/log expectations
- **AND** they SHALL NOT depend on filesystem case sensitivity, path separators, default shell behavior, locale, timezone, or wall-clock timing jitter

#### Scenario: large file governance remains clean
- **WHEN** the change adds trace fixtures, diagnostics samples, generated outputs, or tests
- **THEN** the implementation SHALL continue to pass `node --test scripts/check-large-files.test.mjs`
- **AND** it SHALL continue to pass `npm run check:large-files:near-threshold` and `npm run check:large-files:gate`

#### Scenario: heavy test noise remains clean
- **WHEN** the change adds startup trace, scheduler tests, diagnostics logs, or backend command instrumentation
- **THEN** the implementation SHALL continue to pass `node --test scripts/check-heavy-test-noise.test.mjs scripts/test-batched.test.mjs`
- **AND** it SHALL continue to pass `npm run check:heavy-test-noise`

#### Scenario: no new warning noise is introduced
- **WHEN** frontend, backend, or test validation runs for startup orchestration changes
- **THEN** the change SHALL NOT introduce new TypeScript, ESLint, Vitest, Node test, Rust compiler, or Rust test warnings
- **AND** if existing baseline warnings are present, the implementation SHALL provide evidence that the warning count and categories did not increase

### Requirement: Renderer Bootstrap MUST Separate Critical And Post-Render Work

renderer bootstrap path MUST 区分 first shell render 必需 work、可并行 work、以及 shell mount 后执行的 post-render work。

#### Scenario: non-critical input history does not block first render

- **WHEN** app starts and composer input history is not required to render initial composer
- **THEN** input history restore MUST NOT block root render
- **AND** composer MUST remain usable before history hydration completes
- **AND** history navigation MUST become available after hydration settles

#### Scenario: best-effort migration does not block shell when safe

- **WHEN** localStorage migration is not required for initial shell correctness
- **THEN** migration SHOULD run after root render or in a non-blocking background phase
- **AND** migration failure MUST be recorded as bounded diagnostics instead of preventing shell render
- **AND** any migration proven critical MUST document the invariant that requires blocking

#### Scenario: app import and current locale load run in parallel where safe

- **WHEN** bootstrap starts
- **THEN** `import("./App")`, critical store preload, and current-locale **critical** i18n loading SHOULD begin without unnecessary serial waits
- **AND** root render MUST wait only for the critical subset needed to render shell correctly

#### Scenario: non-critical client stores do not block first paint

- **WHEN** bootstrap starts
- **THEN** root render MUST wait only for `layout` and `app` client stores
- **AND** `threads`, `diagnostics`, `leida`, and `composer` MUST NOT be required before first shell render
- **AND** those deferred stores SHOULD hydrate after mount via idle time or first user interaction
- **AND** a write that landed in memory before deferred hydrate MUST win over the disk snapshot for dirty keys

#### Scenario: full locale pack does not block first paint

- **WHEN** bootstrap starts with a stored or default locale
- **THEN** root render MUST wait only for that locale's critical resource pack
- **AND** deferred locale resources MUST NOT block first shell render
- **AND** `i18nReady` MAY still represent the full pack for tests and post-mount consumers
- **AND** a language switch after startup MUST still load the target locale's full pack before the visible language change commits

### Requirement: Startup Locale Loading MUST Load Only The Current Locale Initially

i18n startup path MUST avoid importing all supported locales before first render；startup only needs active locale resources。

#### Scenario: startup loads stored or default locale only

- **WHEN** app starts with stored locale or default locale
- **THEN** startup MUST load active locale resources required for first render
- **AND** startup MUST NOT statically import every supported full locale resource into startup module path

#### Scenario: language switch loads target locale before commit

- **WHEN** user switches language after startup
- **THEN** target locale resource MUST load before visible language change is committed
- **AND** existing `saveLanguage` behavior MUST remain unchanged
- **AND** missing key fallback behavior MUST remain deterministic

### Requirement: Bootstrap Trace MUST Attribute Startup Delay To Concrete Milestones

startup trace MUST 记录足够 milestone timing，使 slow startup 可以归因到具体 bootstrap phase。

#### Scenario: granular milestones are recorded

- **WHEN** renderer starts through bootstrap path
- **THEN** startup trace MUST record start and end timing for storage preload, migration, input history, i18n, app import, root render, and shell readiness where those phases execute
- **AND** trace payloads MUST contain timing/status metadata rather than prompt, assistant, tool, or file content

### Requirement: V0511 Startup Marker Evidence MUST Flow Into Cold Start Baseline

Startup marker snapshots MUST be consumable by cold-start baseline generation.

#### Scenario: marker extraction writes normalized snapshot

- **WHEN** `scripts/perf-startup-marker-snapshot.mjs` receives diagnostics containing `perf.startup.markers`
- **THEN** it MUST write a normalized snapshot containing only `first-paint` and `first-interactive` marker timings
- **AND** the snapshot MUST exclude unrelated runtime diagnostics content

#### Scenario: cold start baseline consumes normalized snapshot

- **WHEN** `scripts/perf-cold-start-baseline.mjs` receives the normalized startup marker snapshot
- **THEN** it MUST use the marker timings for `S-CS-COLD/firstPaintMs` and `S-CS-COLD/firstInteractiveMs`
- **AND** it MUST preserve bundle gzip metrics in the same output

### Requirement: Main client startup MUST default to no global startup gate overlay with explicit local test opt-in

主窗口启动 composition MUST 默认直接渲染 `AppShell` 且不 mount `StartupGateOverlay`。系统 MAY 通过“其他设置”中默认关闭的本机测试开关，在下次 main window mount 时显式恢复 overlay。startup orchestration、first-paint hydration、`startup-gate-ready` 与后台 full-catalog flow MUST 继续由既有 owner 独立运行。

#### Scenario: Main window defaults to no startup gate

- **WHEN** application 打开 main client window 且 test flag 缺失、关闭或值无效
- **THEN** `AppRouter` MUST render `AppShell`
- **AND** `AppRouter` MUST NOT instantiate `StartupGateOverlay`
- **AND** 用户 MUST NOT 看到或被全屏 startup gate 阻断

#### Scenario: Explicit test opt-in restores startup gate on next start

- **WHEN** 用户在“其他设置”开启 startup loading test switch
- **AND** application 后续创建新的 main `AppRouter` mount
- **THEN** `AppRouter` MUST render `AppShell`
- **AND** `AppRouter` MUST mount the retained `StartupGateOverlay`
- **AND** overlay MUST continue using its existing platform guard、force-enter 与 absolute ceiling behavior

#### Scenario: Toggle does not interrupt the current settings session

- **WHEN** 用户在当前 main window 修改 startup loading test switch
- **THEN** selection MUST persist locally
- **AND** current `AppRouter` mount MUST NOT immediately add or remove the overlay
- **AND** UI copy MUST state that the change takes effect on the next app start

#### Scenario: Background startup orchestration remains active

- **WHEN** main window 不再 mount `StartupGateOverlay`
- **THEN** bounded first-paint hydration 与后续 startup tasks MUST continue through their existing owners
- **AND** implementation MUST NOT 通过删除 milestone、hydration 或 stale-cancellation logic 来隐藏 overlay

#### Scenario: Startup gate implementation remains recoverable

- **WHEN** startup gate presentation 被隐藏
- **THEN** `StartupGateOverlay` component、diagnostic helper、compatibility export 与 focused unit tests MUST remain in the codebase
- **AND** 恢复展示 MUST NOT require data migration or dependency installation

#### Scenario: Detached window routing remains unchanged

- **WHEN** application 打开 about、file explorer、Spec Hub、client documentation 或 Browser Agent detached window，无论 test flag 是否开启
- **THEN** existing route-specific view MUST render as before
- **AND** change MUST NOT mount startup gate into those windows

