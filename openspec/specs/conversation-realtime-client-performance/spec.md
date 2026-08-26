# conversation-realtime-client-performance Specification

## Purpose

Defines the conversation-realtime-client-performance behavior contract, covering Realtime Conversation Client MUST Expose A Three-Engine Performance Budget.
## Requirements
### Requirement: Realtime Conversation Client MUST Expose A Three-Engine Performance Budget
The client MUST define a shared performance budget for Codex, Claude Code, and Gemini realtime conversation turns so optimization decisions are evaluated against the same observable contract.

#### Scenario: streaming turn records client-side budget evidence
- **WHEN** a Codex, Claude Code, or Gemini turn enters realtime streaming
- **THEN** the client MUST be able to correlate event ingress cadence, batching flush cadence, reducer derivation cost, render-visible text cadence, and composer responsiveness evidence to the same workspace/thread/turn identity
- **AND** this evidence MUST remain bounded for long streaming turns

#### Scenario: budget evidence distinguishes engine-specific symptoms from shared client amplification
- **WHEN** Gemini, Claude Code, or Codex shows slow or choppy visible output
- **THEN** diagnostics MUST distinguish provider/upstream delay, backend forwarding stall, client reducer amplification, render amplification, and composer responsiveness degradation
- **AND** the system MUST NOT classify a shared client hot-path issue as a provider-specific issue solely because one engine exposed it first

### Requirement: Streaming Optimizations MUST Preserve Send-Critical Composer State
Realtime conversation optimizations MUST isolate high-frequency live conversation props from the composer without delaying or rewriting user-owned input state.

#### Scenario: live curtain updates do not drive composer input source of truth
- **WHEN** a conversation is streaming and the user is typing in the composer
- **THEN** deferred or throttled live props MAY be used for advisory status, context usage, rate limits, stream activity, and message items
- **AND** draft text, selection, IME composition state, attachments, and final send payload MUST remain immediate and canonical

#### Scenario: streaming completion converges deferred composer props
- **WHEN** a streaming turn completes after composer-facing live props were deferred
- **THEN** the composer MUST naturally converge to the latest canonical status and usage data
- **AND** stale advisory props MUST NOT remain visible after the turn has settled

### Requirement: Realtime Client Performance Changes MUST Be Rollback-Safe
Each client performance optimization layer MUST have a safe rollback path that restores baseline-compatible semantics without breaking session continuity.

#### Scenario: rollback disables one optimization layer without disabling diagnostics
- **WHEN** batching, incremental derivation, render pacing, or mitigation profile changes are disabled by a rollback flag
- **THEN** the client MUST continue processing realtime events with baseline-compatible semantics
- **AND** diagnostics MUST continue collecting enough evidence to compare baseline and optimized behavior

#### Scenario: rollback remains scoped to affected engine or layer
- **WHEN** a Claude/Gemini/Codex-specific profile or fast path is rolled back
- **THEN** unrelated engines and unrelated optimization layers MUST keep their existing behavior
- **AND** disabling one layer MUST NOT silently disable all realtime performance protections

### Requirement: Realtime Diagnostics MUST Distinguish Terminal Settlement Failure
Realtime client diagnostics MUST distinguish upstream or runtime stalls from frontend terminal settlement failures that leave processing state visible after final output is rendered.

#### Scenario: final output visible but processing remains true is classified as settlement failure
- **WHEN** final assistant output has been accepted by the client
- **AND** the thread remains in processing mode after terminal completion handling
- **THEN** diagnostics MUST classify the issue as frontend terminal settlement failure unless evidence shows the runtime turn is still active
- **AND** diagnostics MUST include workspace, thread, turn, engine, active turn, alias, and processing state dimensions

#### Scenario: missing terminal event remains distinguishable from rejected terminal event
- **WHEN** a user reports a stuck generating state
- **THEN** diagnostics MUST allow troubleshooting to distinguish no `turn/completed` event received from a received event rejected by settlement guards
- **AND** the system MUST NOT classify both cases as generic render or provider delay

### Requirement: Client Scheduling MUST Respect Terminal Turn Fences
Client-side realtime batching, throttling, and scheduled rendering MUST preserve terminal lifecycle semantics by checking terminal turn fences at the point where queued work executes.

#### Scenario: batched realtime operations observe terminal state at flush time
- **WHEN** realtime delta operations are buffered for client-side batching
- **AND** the associated turn reaches terminal state before the batch flushes
- **THEN** the batch flush MUST drop operations for the terminal turn
- **AND** the flush MUST NOT re-open processing or append stale visible output for that turn

#### Scenario: scheduled normalized event observes terminal state at dispatch time
- **WHEN** a normalized realtime event is queued through client scheduling before terminal settlement
- **AND** the event executes after the same turn has reached terminal state
- **THEN** the scheduled dispatch MUST skip state mutation for the terminal turn
- **AND** the thread's completed, errored, or stalled lifecycle result MUST remain unchanged

#### Scenario: integration path preserves completed state after late normalized update
- **WHEN** a full `useThreads` realtime path processes final assistant completion and turn completion
- **AND** a late normalized update for the same turn arrives afterward
- **THEN** the thread MUST remain non-processing
- **AND** the previously visible final assistant output MUST NOT be replaced or extended by the stale update

### Requirement: Realtime Performance Routing MUST Preserve Exact Turn Filtering
Realtime client performance and fallback routing optimizations MUST preserve exact turn identity so terminal filtering remains correct under high-frequency or delayed event delivery.

#### Scenario: fallback routing keeps turn id through optional handler shapes
- **WHEN** fallback routing adapts an event to agent completion, reasoning, command output, terminal interaction, or file-change handlers
- **THEN** the adapted call MUST pass through the original `turnId` when present
- **AND** the handler signature MUST remain typechecked across call sites

#### Scenario: event-handler prefilter avoids unnecessary scheduled work
- **WHEN** the event handler receives a raw item, normalized event, or agent delta for a turn already known as terminal
- **THEN** the handler MUST skip downstream realtime scheduling for that event
- **AND** no additional high-frequency client work MUST be created for the terminal turn

#### Scenario: rollback preserves baseline-compatible processing
- **WHEN** batching or scheduling optimizations are disabled by runtime flags
- **THEN** terminal turn filtering MUST still protect direct realtime execution paths
- **AND** the client MUST preserve baseline-compatible event handling for non-terminal turns

### Requirement: Realtime Performance Budget MUST Include Session Visibility
Realtime conversation performance evidence MUST include active, inactive, and restoring session visibility so regressions can distinguish provider delay from client render amplification.

#### Scenario: diagnostics correlate visibility with stream and render cost
- **WHEN** a Codex, Claude Code, or Gemini session is streaming
- **THEN** diagnostics MUST be able to correlate workspace, thread, engine, turn, visibility state, ingress cadence, buffer depth, flush latency, render cost, and long task evidence
- **AND** the evidence MUST remain bounded for long-running sessions

#### Scenario: background render amplification is distinguishable from upstream delay
- **WHEN** users report switching lag between running sessions
- **THEN** diagnostics MUST distinguish provider or backend first-token delay from runtime ingress delay, background buffer flush delay, React render amplification, and layout or scroll work
- **AND** the system MUST NOT classify background UI render amplification as an upstream provider issue without evidence

### Requirement: Background Scheduling Optimizations MUST Be Layer-Rollback Safe
Background session scheduling optimizations MUST be independently rollback-safe without breaking realtime session continuity.

#### Scenario: disabling render gating restores baseline rendering without disconnecting runtime
- **WHEN** background render gating is disabled by a rollback flag
- **THEN** the client MUST return to baseline-compatible realtime rendering behavior
- **AND** active runtime connections and in-flight session tasks MUST NOT be disconnected, restarted, or cancelled by that rollback

#### Scenario: disabling staged hydration preserves diagnostics
- **WHEN** staged hydration is disabled by a rollback flag
- **THEN** the client MAY restore baseline foreground rendering behavior for switched sessions
- **AND** diagnostics MUST continue collecting enough ingress, flush, render, and long task evidence to compare baseline and optimized behavior

### Requirement: Realtime Evidence MUST Correlate Visible-Lag Risk

Realtime performance reports MUST correlate first-token latency, inter-token jitter, batching behavior, terminal pressure, and visible-lag risk for the same scenario.

#### Scenario: realtime summary includes visible-lag risk
- **WHEN** realtime performance evidence is generated
- **THEN** the summary MUST include first-token latency and inter-token jitter where available
- **AND** the summary MUST classify visible-lag risk without hiding terminal-settlement pressure

#### Scenario: terminal pressure remains separate from provider delay
- **WHEN** realtime evidence shows terminal or batching pressure
- **THEN** the report MUST distinguish client-side terminal pressure from provider first-token delay
- **AND** it MUST NOT attribute all lag to the provider without correlated evidence

### Requirement: Realtime Performance Budget MUST Cover Single Long Live Assistant Rows

Realtime client performance evidence MUST include the cost of a single active assistant row growing to large text sizes, because list virtualization alone does not bound reducer, Markdown, layout, or scroll work inside that row. The P0 evidence target is Claude Code long output; other engines MAY opt in through the same budget.

#### Scenario: Claude Code long live row diagnostics distinguish local amplification
- **WHEN** Claude Code streams a long assistant message
- **AND** the assistant text grows beyond ordinary preview limits
- **THEN** diagnostics MUST be able to correlate delta ingress cadence, reducer merge cost, normalization cost, render cost, visible text growth, and long task evidence for the same turn
- **AND** diagnostics MUST distinguish local reducer or render amplification from upstream provider delay

#### Scenario: canonical text is not truncated on active append paths
- **WHEN** an active assistant message receives text deltas beyond the display preview budget
- **THEN** the reducer MUST preserve the canonical assistant text without applying preview truncation
- **AND** later deltas MUST merge onto the untruncated canonical body
 - **AND** this MUST hold for both reducer fast path normalization and fallback `prepareThreadItems` normalization

#### Scenario: rollback keeps diagnostics available
- **WHEN** long-row render fallback or shadow recovery is disabled by a rollback flag
- **THEN** realtime diagnostics MUST still record enough ingress, reducer, render, and visible-growth evidence to compare baseline and optimized behavior

### Requirement: Foreground Terminal Settlement Diagnostics MUST Identify The Failure Class
Realtime client diagnostics MUST emit enough structured evidence to classify foreground turns that render final output but remain in processing state.

#### Scenario: terminal event reaches frontend
- **WHEN** the app-server bridge receives `turn/completed`, `turn/error`, `turn/stalled`, or `runtime/ended` for a foreground conversation turn
- **THEN** diagnostics MUST record that the terminal event reached the frontend bridge
- **AND** the record MUST include workspace id, thread id, turn id when available, event type, and whether final content was present when known

#### Scenario: terminal event is rejected by settlement guard
- **WHEN** a terminal event reaches frontend turn settlement
- **AND** active turn identity or alias guards prevent clearing processing state
- **THEN** diagnostics MUST classify the result as rejected terminal settlement
- **AND** the record MUST include incoming turn id, current active turn id, target thread id, resolved alias when available, and processing state

#### Scenario: terminal event is deferred by lifecycle blockers
- **WHEN** a terminal completion event is intentionally deferred because lifecycle blockers still exist
- **THEN** diagnostics MUST classify the result as deferred terminal settlement
- **AND** the record MUST include blocker names or counts, assistant ingress evidence, and current active turn id

#### Scenario: terminal handling leaves busy residue
- **WHEN** terminal event handling finishes for a foreground turn
- **AND** the thread remains in processing mode or keeps the same active turn id
- **THEN** diagnostics MUST classify the result as terminal settlement busy residue
- **AND** the record MUST distinguish this case from missing terminal event and provider streaming delay

### Requirement: Foreground Settlement Diagnostics MUST Stay Bounded And Content-Safe
Settlement diagnostics MUST be safe to collect during long conversations without storing prompt or assistant body text.

#### Scenario: diagnostic payload excludes conversation content
- **WHEN** frontend emits foreground settlement diagnostics
- **THEN** the payload MUST NOT include full user prompt, assistant response, tool output, command output, or file diff content
- **AND** it MAY include ids, event labels, counts, status strings, timestamps, booleans, and bounded reason strings

#### Scenario: repeated progress evidence remains bounded
- **WHEN** a long-running foreground turn receives many progress events before terminal settlement
- **THEN** diagnostics MUST retain the latest progress evidence source and timestamp rather than appending unbounded per-event content
- **AND** terminal settlement diagnostics MUST be able to reference that latest progress evidence

### Requirement: Settlement Diagnostics MUST Support Three-Evidence Dry-Run Decisions

Realtime diagnostics MUST support dry-run three-evidence settlement decisions before guarded settlement behavior is enabled.

#### Scenario: dry-run decision records why settlement would or would not occur

- **WHEN** the client receives terminal evidence, observes busy residue, evaluates a suspected stuck foreground turn, or requests reconciliation
- **THEN** diagnostics SHOULD record the dry-run settlement decision such as `wouldSettle`, `wouldReject`, `wouldDefer`, `wouldKeepRunning`, `wouldRequestReconciliation`, or `wouldCleanupResidue`
- **AND** the record MUST include the terminal/state/progress/reconciliation evidence classes and conversation scope match result used for the decision without full conversation content

#### Scenario: scope mismatch remains visible without touching current UI

- **WHEN** dry-run settlement sees terminal, progress, status-query, or replay evidence from another thread, another engine, an older turn, an older runtime lease, or a previous foreground owner
- **THEN** diagnostics MUST classify the decision as scope mismatch, stale evidence, or equivalent
- **AND** the foreground UI state MUST remain unchanged by that evidence

#### Scenario: long-task protection remains distinguishable from stuck settlement

- **WHEN** a foreground turn has no terminal evidence but has fresh progress evidence
- **THEN** diagnostics MUST classify the decision as progress-protected or equivalent
- **AND** the system MUST NOT report the case as completed, terminal settlement failure, or provider delay without additional evidence

#### Scenario: busy residue remains separate from provider or render delay

- **WHEN** final output is visible or terminal evidence was handled
- **AND** state evidence still shows processing residue
- **THEN** diagnostics MUST classify the issue as settlement busy residue or equivalent
- **AND** it MUST remain distinguishable from upstream provider delay, backend forwarding stall, event delivery failure, and client render amplification

#### Scenario: reconciliation outcome is visible

- **WHEN** the frontend requests authoritative turn status or missed terminal replay because terminal evidence is absent and progress is stale
- **THEN** diagnostics MUST record a bounded reconciliation outcome such as `status-completed`, `status-running`, `status-unknown`, `query-failed`, `replay-terminal`, or `replay-unscoped`
- **AND** the record MUST include scope match result and decision reason without full conversation content

#### Scenario: Phase 2 behavior is kill-switchable

- **WHEN** guarded busy-residue cleanup or stale-progress reconciliation application is enabled
- **THEN** diagnostics MUST identify whether the behavior was dry-run, feature-flagged active, or disabled by kill switch
- **AND** disabling the behavior MUST leave the original normal completion path available

### Requirement: Dry-Run Settlement Diagnostics MUST Be Bounded And Distinguishable

Phase 1 diagnostics MUST expose settlement arbitration outcomes without changing runtime or UI behavior.

#### Scenario: dry-run actions are recorded as would-decisions

- **WHEN** Phase 1 records a settlement arbitration result
- **THEN** diagnostics SHOULD map helper actions to dry-run labels such as `wouldSettle`, `wouldReject`, `wouldDefer`, `wouldKeepRunning`, `wouldRequestReconciliation`, or `wouldCleanupResidue`
- **AND** the record MUST include scope match result and decision reason without full conversation content

#### Scenario: busy residue remains diagnostic-only

- **WHEN** terminal evidence is matched but state evidence still indicates busy residue
- **THEN** Phase 1 diagnostics MAY record `wouldCleanupResidue`
- **AND** the integration MUST NOT perform cleanup or alter visible conversation state

#### Scenario: reconciliation-needed is separate from provider delay

- **WHEN** terminal evidence is absent and progress is stale or absent
- **THEN** diagnostics SHOULD record reconciliation-needed or equivalent
- **AND** the record MUST remain distinguishable from upstream provider delay, runtime still active, render delay, and normal long-task protection

#### Scenario: content safety is preserved

- **WHEN** dry-run settlement diagnostics are persisted or shown in debug entries
- **THEN** they MUST use bounded ids, booleans, counts, timestamps, enum status, and bounded reason strings
- **AND** they MUST NOT include full prompts, assistant responses, tool outputs, command outputs, file diffs, auth files, or secret values

### Requirement: Status Query Reconciliation Diagnostics MUST Be Bounded And Distinguishable

Phase 2a reconciliation diagnostics MUST make status-query attempts and outcomes visible without changing runtime or UI behavior.

#### Scenario: query attempt is distinguishable from provider delay

- **WHEN** lifecycle arbitration requests authoritative status because terminal evidence is missing and progress is stale
- **THEN** diagnostics MUST record a bounded reconciliation-query attempt with a label or category distinct from upstream provider delay, render delay, normal long-task protection, and terminal busy residue
- **AND** the diagnostic MUST include scoped ids, status-query source, timestamps, progress age, and decision reason when available

#### Scenario: query result records conservative outcome

- **WHEN** authoritative status query returns `completed`, `running`, `failed`, `stalled`, `runtime-ended`, `unknown`, or `query-failed`
- **THEN** diagnostics MUST record the bounded status enum, scope match result, status source, and bounded reason
- **AND** diagnostics MUST show whether the response was accepted as Terminal Evidence candidate, kept running, rejected as stale, or deferred

#### Scenario: recovery context remains separate

- **WHEN** status reconciliation overlaps with runtime recovery quarantine, concurrent runtime acquire timeout, stale runtime cleanup, or stopping-runtime race
- **THEN** diagnostics MAY include bounded recovery context fields such as recovery state, acquire state, ended source, retry delay, and query failure reason
- **AND** those fields MUST remain separate from terminal status and MUST NOT imply completed settlement

#### Scenario: normal query consistency does not flood error log

- **WHEN** status query confirms a normal running or normally completed state without residue, stale scope, or query failure
- **THEN** the client SHOULD avoid persisting high-volume normal consistency records to the global error log
- **AND** abnormal outcomes such as stale scope, query failure, unknown status, terminal-confirmed busy residue, or rejected scope SHOULD be persistable as bounded core diagnostics

#### Scenario: reconciliation diagnostics exclude content

- **WHEN** reconciliation query diagnostics are persisted or shown in debug entries
- **THEN** they MUST use bounded ids, booleans, counts, timestamps, enum status, and bounded reason strings
- **AND** they MUST NOT include full prompts, assistant responses, tool outputs, command outputs, stdout, stderr, file diffs, auth files, or secret values

### Requirement: Phase 2a Reconciliation Diagnostics MUST Be Bounded And Persist Abnormal Outcomes

Status-query reconciliation diagnostics MUST be distinguishable from normal provider delay and must avoid content payloads.

#### Scenario: query attempt is logged

- **WHEN** frontend issues a status query because the pure helper requested reconciliation
- **THEN** it MUST emit a bounded `query-requested` diagnostic with scope ids and progress age

#### Scenario: query result is logged

- **WHEN** frontend receives a status query response
- **THEN** it MUST emit a bounded `query-resolved` diagnostic containing status enum, scope match, status source, bounded reason, and helper decision

#### Scenario: rejected or failed query is persistable

- **WHEN** status response scope is rejected, status is unknown, or the query fails
- **THEN** the diagnostic SHOULD be eligible for global error-log persistence
- **AND** it MUST exclude prompts, assistant text, command output, stdout, stderr, file diffs, auth data, and secrets

#### Scenario: hanging query receives bounded failed outcome

- **WHEN** a reconciliation status query does not return within the diagnostic timeout window
- **THEN** the frontend MUST emit a bounded `query-failed` diagnostic for the same workspace, engine, thread, turn, and query scope
- **AND** timeout failure MUST NOT clear processing state, active turn id, messages, blockers, runtime leases, or history

### Requirement: Realtime Composer Input SHALL Remain Responsive During Streaming

The client SHALL keep Composer user input on an immediate source-of-truth path while realtime conversation output is streaming.

#### Scenario: active typing does not wait for live timeline derivation
- **WHEN** a Codex, Claude Code, Gemini, or OpenCode turn is streaming
- **AND** the user types into the Composer
- **THEN** draft text, selection, IME composition state, attachments, and final send payload MUST update from immediate Composer state
- **AND** timeline grouping, message anchors, sticky header, status panel, or session catalog updates MUST NOT become prerequisites for accepting the input event

#### Scenario: advisory stream props may lag without corrupting send state
- **WHEN** stream activity, context usage, rate limits, account status, or status panel summary changes during active typing
- **THEN** the client MAY defer or reuse last-good advisory props
- **AND** the Composer MUST converge to canonical latest advisory props after typing idle or turn settlement
- **AND** the final send payload MUST NOT include stale or deferred draft text

### Requirement: Composer Adapter SHALL Ignore Structurally Equal Streaming Props

Composer adapter memoization SHALL treat structurally equal stream-facing props as no-op updates so object identity churn does not re-render the input subtree.

#### Scenario: equal advisory payloads do not re-render input subtree
- **WHEN** context usage, dual context usage, Claude context usage, account rate limits, stream activity, selected context chips, queue summaries, or status panel summary are rebuilt with equal user-visible values
- **THEN** the Composer adapter MUST treat the update as equivalent
- **AND** the ChatInputBox subtree MUST NOT re-render solely because those object or array references changed

#### Scenario: send-critical changes still re-render
- **WHEN** draft text, disabled state, selected engine, selected model, attachments, send readiness, permission mode, or selected agent actually changes
- **THEN** the Composer adapter MUST allow the update through
- **AND** the user-visible control state MUST remain correct

### Requirement: Status Projection SHALL Stay Out Of The Input Hot Path

Status panel and subagent projection SHALL avoid full multi-thread scans during active streaming input.

#### Scenario: scoped projection is used during streaming
- **WHEN** an active thread is streaming and the user is interacting with the Composer
- **THEN** status projection MUST use scoped indexes, cached summaries, deferred summaries, or active-root-only derivation
- **AND** it MUST NOT rebuild fallback parent maps or scan every thread item on each text delta

#### Scenario: status summary converges after interaction
- **WHEN** active typing or IME composition ends
- **THEN** deferred status projection MUST refresh from canonical thread state
- **AND** subagent counts, running status, file changes, commands, and navigation targets MUST converge without changing conversation state

### Requirement: Realtime Interactive Controls SHALL Remain Responsive During Streaming

Streaming conversation controls SHALL remain on an immediate interaction path even when live output, status projection, sidebar projection, or catalog hydration is busy.

#### Scenario: stop control does not wait for render-heavy derivations
- **WHEN** a realtime turn is streaming and the user activates Stop
- **THEN** the Stop action MUST be accepted from the current control state without waiting for timeline grouping, status projection, catalog hydration, sidebar projection, or scroll work to finish
- **AND** disabling or settling the control MUST follow canonical runtime state, not a deferred advisory snapshot

#### Scenario: message and context controls stay clickable during live output
- **WHEN** long assistant output is streaming
- **AND** the user clicks message toolbar actions, copy, fork, rewind, context controls, or scroll controls
- **THEN** the click handler MUST be reachable without depending on per-delta full timeline recomputation
- **AND** any deferred visual summary MUST converge after idle or turn settlement without dropping the user action

### Requirement: Thread Switching SHALL Prioritize Foreground Selection

The client SHALL split thread switching into foreground selection and deferred hydration so visible navigation is not blocked by catalog or history work.

#### Scenario: foreground transition commits first
- **WHEN** the user selects a different workspace thread
- **THEN** active workspace/thread identity and the visible chat shell MUST update before non-critical hydration work completes
- **AND** history restore, workspace thread-list hydration, related catalog prewarm, right-panel collapse, and non-active sidebar projection MAY run in transition, staged async work, or idle work

#### Scenario: stale switch work cannot overwrite current thread
- **WHEN** the user switches from thread A to thread B before thread A restore or hydration completes
- **THEN** late results for thread A MUST be ignored or scoped to thread A
- **AND** they MUST NOT replace thread B messages, processing state, active engine, draft text, or selected workspace

### Requirement: Realtime Interaction Evidence SHALL Include Input And Switch Metrics

Realtime performance diagnostics SHALL correlate streaming output with input responsiveness and thread switch responsiveness.

#### Scenario: streaming typing evidence is correlated by turn
- **WHEN** a streaming typing performance report is produced
- **THEN** the report MUST include workspace id, thread id, engine, turn id when available, input event cadence, adapter render count or equivalent, React commit cost where available, long task evidence, and visible text cadence
- **AND** the report MUST classify evidence as measured, proxy, manual-only, or unsupported

#### Scenario: thread switch evidence distinguishes foreground and hydration cost
- **WHEN** a thread switch performance report is produced
- **THEN** the report MUST separate foreground visible switch latency from history restore, catalog hydration, sidebar projection, and backend request cost
- **AND** it MUST NOT attribute all switch lag to provider or transcript loading without correlated evidence

### Requirement: Message Image Resources SHALL Have Bounded Renderer Lifetime

Conversation image rendering SHALL avoid retaining full image data URLs in React state or DOM longer than required for the current user-visible operation.

#### Scenario: deferred history image releases full resource after preview closes
- **WHEN** a user hydrates a deferred history image and opens it for preview
- **THEN** the full image resource MUST be available while the preview is visible
- **AND** closing the preview or unmounting the row MUST release transient full-resource state without removing the canonical deferred image locator

#### Scenario: inline image preview preserves original image access
- **WHEN** a message contains an inline data URL or local image path
- **THEN** the timeline MAY render a lightweight preview surface
- **AND** opening the image MUST still provide access to the original full image without compressing, cropping, or mutating the canonical message item

#### Scenario: image memory protection does not degrade send semantics
- **WHEN** a user sends, queues, forks, rewinds, or recovers a message with images
- **THEN** the original image list used by the send/retry/recovery payload MUST remain unchanged
- **AND** render-layer resource cleanup MUST NOT delete or rewrite canonical conversation image data

### Requirement: Multi-engine streaming deltas MUST be coalesced without blocking critical controls
The client SHALL coalesce high-frequency realtime output from multiple engines through a shared bounded update boundary while preserving immediate user-critical controls.

#### Scenario: concurrent engines stream realtime deltas
- **WHEN** Claude, Codex, Gemini, OpenCode, or custom provider turns stream deltas concurrently
- **THEN** the client MUST batch or coalesce non-critical render updates at a bounded cadence
- **AND** active assistant output MUST remain visibly live
- **AND** final turn settlement MUST flush the latest buffered content

#### Scenario: user-critical controls remain immediate
- **WHEN** realtime output is being coalesced
- **THEN** Composer draft text, IME composition, selection, attachments, Stop, message toolbar, copy, fork, rewind and scroll controls MUST remain on immediate action paths
- **AND** those controls MUST NOT wait for full timeline, status, catalog, diagnostics or sidebar projection recomputation

### Requirement: Realtime state MUST NOT pollute file editor hot paths

Realtime conversation state changes MUST NOT force file editor typing, line switching, or tab activation to depend on whole conversation status maps or reducer state.

#### Scenario: file editor receives only narrow render pressure

- **WHEN** a conversation is streaming while a file editor is open
- **THEN** the file editor MAY receive a narrow render pressure signal
- **AND** it MUST NOT receive `threadStatusById`, conversation items, or conversation reducer state as props or imports for rendering file content

#### Scenario: thread status map updates do not drive file typing path

- **WHEN** `threadStatusById` changes because a conversation progresses
- **AND** the user is typing in a file editor
- **THEN** the file typing hot path MUST NOT require recomputing file document state, CodeMirror extensions, file tree rows, or file preview snapshots because of that map update

#### Scenario: pressure signal only affects non-urgent file work

- **WHEN** active engine processing creates render pressure
- **THEN** file rendering MAY defer non-visible or non-urgent preview work
- **AND** it MUST NOT delay explicit user typing, cursor movement, save, or first useful active file viewport

### Requirement: Realtime Evidence MUST Measure Codex Post-Ack First Delta Wait
Realtime performance evidence MUST distinguish Codex post-ack first-delta wait from frontend turn-start acknowledgement and renderer visible text latency when timing data is available.

#### Scenario: post-ack first-delta metric is reported
- **WHEN** a Codex turn has measured `turn/start` response acknowledgement and measured first text delta ingress timing
- **THEN** runtime performance reports MUST include a measured `codexPostAckFirstDeltaP95`
- **AND** the report MUST preserve `turnStartAckLatencyP95` and `firstDeltaLatencyP95` as separate metrics

#### Scenario: post-ack residual guides next action
- **WHEN** post-ack first-delta wait is high while visible lag and reducer amplification are healthy
- **THEN** the report MUST identify the next investigation area as backend/provider/startup before renderer optimization

#### Scenario: post-ack phase breakdown is reported when available
- **WHEN** Codex app-server diagnostics include first runtime event and first assistant text delta phase timings
- **THEN** runtime performance reports MUST include measured `codexPostAckFirstRuntimeEventP95`
- **AND** runtime performance reports MUST include measured `codexFirstRuntimeEventToFirstTextDeltaP95`
- **AND** runtime performance reports SHOULD include measured `codexFirstRuntimeEventToFirstAssistantItemP95` and `codexFirstAssistantItemToFirstTextDeltaP95` when assistant item phase fields are available
- **AND** turn-level diagnostics MUST expose bounded `methodsBeforeFirstTextDelta` and event counters without prompt, assistant text, tool output, terminal output, or file content
- **AND** missing phase fields from older artifacts MUST remain `unsupported` rather than being approximated

#### Scenario: provider first-response dominance is identified
- **WHEN** `firstRuntimeEventToFirstAssistantItemEventMs` accounts for most of `firstRuntimeEventToFirstTextDeltaMs`
- **AND** `firstAssistantItemEventToFirstTextDeltaMs` is small
- **THEN** runtime performance reports MUST emit a content-safe `providerFirstResponseDominates` note
- **AND** the note MUST guide investigation toward provider/model first-response phase before renderer optimization

### Requirement: V0511 Realtime Input Render Budget MUST Be Producer Backed

Realtime input render budget evidence MUST be generated from reducer/profile fixtures rather than handwritten report rows.

#### Scenario: reducer burst fixture records fast path evidence

- **WHEN** a 1000-delta streaming burst fixture runs through the thread reducer
- **THEN** the producer MUST emit `S-IO-RR/prepareThreadItems_calls_per_1000_delta`
- **AND** the value MUST reflect the reducer profile counter rather than an assumed constant

#### Scenario: realtime route timing remains bounded or unsupported

- **WHEN** reducer flush or realtime route timing cannot be measured by the fixture
- **THEN** the producer MUST emit an explicit unsupported row
- **AND** the row MUST include the missing timing source as its reason

### Requirement: Live Assistant Delta Commits MUST Avoid Transition Lag
The realtime client MUST treat flushed live assistant text deltas as latency-critical reducer work once batching has decided to deliver them.

#### Scenario: cadence-flushed live assistant delta commits urgently
- **WHEN** `appendAgentMessageDelta` events have been coalesced by the realtime event batcher
- **AND** the batcher emits a `cadence`, `manual`, or `first-token` flush
- **THEN** the client MUST dispatch the reducer mutation without wrapping that live delta in transition scheduling
- **AND** the reducer path MUST preserve existing terminal turn filtering before mutating state

#### Scenario: terminal and heavier normalized events keep guarded scheduling
- **WHEN** normalized realtime events are terminal completions, tool events, reasoning events, snapshots, or other non-live assistant delta work
- **THEN** the client MUST preserve the existing ordering and terminal-fence semantics
- **AND** it MUST NOT broaden urgent scheduling to unrelated heavy event classes without separate evidence and tests

#### Scenario: reducer fast path remains bounded
- **WHEN** a long Codex, Gemini, or OpenCode assistant message receives many live text deltas
- **THEN** reducer commits for the live delta path MUST avoid `prepareThreadItems`
- **AND** batching/coalescing MUST remain available to bound dispatch count under streaming pressure

### Requirement: Lightweight Markdown Visible Text MUST Track Live Assistant Growth
When a live assistant row uses lightweight Markdown streaming, the client MUST keep visible-text diagnostics aligned with the current assistant item even if Markdown's rendered-value callback is delayed by throttling or progressive reveal.

#### Scenario: Codex recovery row reports current visible text during callback delay
- **WHEN** `codex-markdown-stream-recovery` is active for a streaming Codex assistant row
- **AND** the row remains on lightweight Markdown rather than plain text
- **AND** Markdown does not immediately call `onRenderedValueChange` for the latest `displayText`
- **THEN** the row MUST still report the current assistant `itemId` and text to `onAssistantVisibleTextRender`
- **AND** the report MUST NOT force the final completed message to bypass full Markdown rendering

#### Scenario: visible stall classification stays evidence based
- **WHEN** no `realtime.turnTrace.summary` is emitted after a hot-start validation turn
- **AND** raw renderer diagnostics emit `visible-output-stall-after-first-delta`
- **THEN** the next optimization target MUST be selected from the visible render/reporting evidence rather than assuming reducer commit lag persisted

### Requirement: Realtime Evidence MUST Report First Delta Latency Separately

Realtime performance evidence MUST expose first-delta latency as a separate measured metric when correlated turn trace summaries provide `sendToFirstDeltaMs`.

#### Scenario: first-delta latency is reported separately from visible lag

- **WHEN** `realtime.turnTrace.summary` contains measured `deltas.sendToFirstDeltaMs`
- **THEN** runtime performance evidence MUST include first-delta latency as a distinct metric or summary field
- **AND** it MUST NOT merge first-delta latency into visible text lag, reducer amplification, batch flush duration, or terminal settlement metrics

#### Scenario: slow first delta with healthy visible path points to upstream investigation

- **WHEN** first-delta latency is high for a Codex, Claude Code, or Gemini turn
- **AND** visible text latency is within budget
- **AND** reducer amplification does not show client-side amplification
- **THEN** the report MUST identify upstream/provider/startup phase investigation as the next action
- **AND** it MUST NOT recommend client render or row memo optimization as the primary action

### Requirement: Realtime Evidence MUST Distinguish Turn Start Ack Latency

Realtime performance evidence MUST distinguish Codex turn-start acknowledgement latency from first-delta latency when both are available.

#### Scenario: turn-start ack latency is reported separately

- **WHEN** Codex `send_user_message` completes or fails after invoking backend `turn/start`
- **THEN** diagnostics MUST record bounded turn-start acknowledgement latency
- **AND** runtime performance reports MUST NOT merge it into first-delta latency or visible text latency

#### Scenario: first-delta residual remains visible after ack

- **WHEN** first-delta latency is high and turn-start ack latency is available
- **THEN** the report MUST preserve enough data to estimate post-ack first-delta wait
- **AND** the next action MUST distinguish backend ack delay from provider/startup waiting after ack

### Requirement: Realtime Performance Budget MUST Include Shell Invalidation Evidence
Realtime client performance diagnostics SHALL distinguish Canvas render pressure from Shell control invalidation.

#### Scenario: Active canvas updates do not broadcast through the shell
- **WHEN** an active stream repeatedly mutates canvas-only state such as `activeItems`, `threadItemsByThread`, live status maps, token usage, or rate-limit snapshots
- **THEN** canvas rendering MAY update or coalesce according to the canvas lane policy
- **AND** non-canvas Shell controls SHALL observe only narrow summary or selector-derived facts
- **AND** unchanged selector results SHALL NOT trigger subscribers.

#### Scenario: Live advisory panels preserve urgent input state
- **WHEN** Composer and StatusPanel consume active stream advisory data through selectors
- **THEN** deferred live props MAY lag behind the active canvas snapshot
- **AND** Composer draft text, IME state, attachments, selected model/provider, and send callbacks SHALL remain urgent local/layout props
- **AND** StatusPanel dock rendering SHALL use selector-derived live content without forcing unrelated Shell controls to consume full active canvas objects.

### Requirement: Realtime Canvas Work MUST Not Hydrate Hidden Surfaces
Realtime conversation updates SHALL not force inactive heavy surfaces to hydrate or recompute.

#### Scenario: Background canvas burst does not wake hidden panels
- **WHEN** a high-frequency realtime burst updates active conversation canvas data
- **THEN** hidden heavy surfaces MUST stay paused
- **AND** their heavy computations MUST NOT run until their activation state changes

#### Scenario: Surface activation reads latest canonical state
- **WHEN** a paused heavy surface becomes active after realtime updates occurred
- **THEN** it MUST read the latest canonical state or snapshot
- **AND** it MUST NOT rely on having processed every hidden intermediate realtime update

### Requirement: Root render hot paths MUST avoid per-delta derived work

Realtime client performance optimizations MUST keep high-frequency assistant text deltas out of root-mounted derived work when a transient visible-text path can preserve the user-visible live surface.

#### Scenario: live assistant deltas do not force root conversation churn

- **WHEN** a streaming assistant body receives high-frequency text deltas
- **THEN** the client SHOULD route visible body growth through a bounded live-text subscription path
- **AND** the root conversation reducer MUST NOT be required to mutate for every text delta solely to update the latest visible row

#### Scenario: Git status refresh waits for turn settlement

- **WHEN** a conversation is processing and message activity occurs repeatedly
- **THEN** the root app shell MUST NOT trigger Git status refresh for every message activity event
- **AND** Git status refresh SHOULD run when a thread transitions from processing to settled
- **AND** existing periodic Git polling MAY remain as the fallback for external repository changes

#### Scenario: root-mounted local stores prefer broadcast updates over short polling

- **WHEN** debug, task-run, or orchestration store data changes inside the current webview
- **THEN** root-mounted consumers SHOULD update from write-broadcast events
- **AND** fallback polling MUST be slow enough to avoid continuous root render pressure
- **AND** unchanged snapshots MUST preserve object identity through equality guards

### Requirement: Live Assistant Text Channel MUST Publish At A Bounded Cadence

The realtime client MUST accumulate every accepted live assistant text delta losslessly while exposing a stable published snapshot to React subscribers. The first text for a new active item MUST publish immediately; subsequent growth MUST publish at a per-thread throttle with a trailing update, without byte-size bypasses that defeat the cadence.

#### Scenario: first text publishes immediately

- **WHEN** a thread receives the first live assistant text for a new item
- **THEN** the channel MUST publish that complete first entry immediately
- **AND** the subscriber MUST NOT wait for the trailing cadence timer

#### Scenario: rapid growth coalesces to the latest snapshot

- **WHEN** multiple monotonic text updates for the same thread and item arrive inside one 48ms publish window
- **THEN** the channel MUST continue accumulating every update
- **AND** it MUST expose at most one trailing published snapshot for that window
- **AND** that snapshot MUST contain the latest complete accumulated text

#### Scenario: snapshot stays stable between notifications

- **WHEN** accumulated text changes but the next publish window has not fired
- **THEN** `getLiveAssistantTextSnapshot` MUST retain the previously published object
- **AND** the channel MUST NOT expose an unpublished snapshot without notifying subscribers

### Requirement: Live Assistant Text Terminal Operations MUST Be Lossless

Channel cleanup and identity migration MUST use the authoritative accumulated entry rather than a potentially stale published snapshot, and MUST leave no timer capable of publishing deleted or obsolete state.

#### Scenario: interruption drains unpublished text

- **WHEN** interruption drains a thread while a trailing publish is pending
- **THEN** `drainLiveAssistantTextTail` MUST return every accumulated character beyond the reducer shell
- **AND** it MUST cancel pending publication and clear both accumulated and published state

#### Scenario: clear prevents stale timer publication

- **WHEN** terminal settlement or thread deletion clears an active live entry
- **THEN** the channel MUST cancel the thread's pending timer
- **AND** no later callback MAY republish the cleared entry

#### Scenario: pending thread is renamed

- **WHEN** a pending thread id is replaced by its canonical thread id while publication is pending
- **THEN** accumulated and published state MUST migrate to the canonical id
- **AND** the old timer MUST NOT publish to the previous id
- **AND** subscribers on both ids MUST converge to the migrated state

### Requirement: Scheduled Live Markdown Commits MUST Not Remain Indefinitely Interruptible

Once live text has crossed the channel publish cadence or a Markdown scheduler timer has fired, the corresponding row and Markdown state update MUST use a deterministic commit path rather than adding another transition that can be repeatedly restarted by newer streaming values.

#### Scenario: channel-backed row receives published text

- **WHEN** an actively streaming assistant row reads text from `liveAssistantTextChannel`
- **THEN** the row MUST use the published text without applying an additional `useDeferredValue` delay
- **AND** non-channel message paths MAY preserve their existing deferred behavior

#### Scenario: Markdown throttle timer fires

- **WHEN** the bounded Markdown throttle or progressive reveal timer fires
- **THEN** its scheduled value MUST commit without being wrapped in `startTransition`
- **AND** the existing throttle interval and progressive chunk limits MUST remain available to bound render cost

### Requirement: Shared Owner Deferral MUST Expose Bounded Attribution

Shared runtime ingress that intentionally defers UI fan-out MUST expose whether it is waiting for exact owner identity or waiting behind an opened replay barrier. Unowned queue overflow MUST expose bounded cumulative drop evidence without logging message text, prompt text, tool output, or full event payloads.

#### Scenario: ingress waits for exact owner identity

- **WHEN** held Shared ingress cannot yet resolve an exact attempt owner
- **THEN** its observation MUST report `awaiting-owner-identity`
- **AND** it MUST include the bounded current unowned queue depth

#### Scenario: ingress waits behind replay barrier

- **WHEN** exact owner binding exists but replay remains in progress
- **THEN** its observation MUST report `replay-barrier`
- **AND** it MUST include the bounded barrier queue depth

#### Scenario: unowned queue reaches its cap

- **WHEN** another held ingress arrives after the unowned queue reaches its fixed limit
- **THEN** overflow evidence MUST increment a saturating cumulative drop count
- **AND** warning logs MUST be rate-bounded
- **AND** the authoritative owner and replay barrier semantics MUST remain unchanged

### Requirement: Settlement Terminal Events MUST Preserve Causal Predecessors

Every accepted app-server event pipeline MUST deliver prior events from the same workspace to the scheduled frontend consumer before delivering a settlement terminal for that workspace. Critical delivery MAY bypass timer latency and lossy/coalescing policy, but settlement MUST NOT overtake accepted message deltas, item snapshots, or item completion events.

#### Scenario: Codex batched sink receives a terminal

- **WHEN** a Codex sink has queued `item/agentMessage/delta` or `item/completed` events for a workspace and then receives `turn/completed`, `turn/error`, or `runtime/ended`
- **THEN** it MUST emit the queued events followed by the terminal in one ordered workspace batch
- **AND** periodic drain ownership and critical emission MUST be serialized until the drained batch has been emitted
- **AND** queues belonging to other workspaces MUST remain queued

#### Scenario: unified frontend backpressure receives a terminal

- **WHEN** the frontend backpressure queue contains events for the terminal's workspace
- **THEN** it MUST transfer those predecessors to the existing scheduled consumer before the terminal
- **AND** it MUST NOT synchronously execute their reducer or render work
- **AND** events for unrelated workspaces MUST remain isolated

#### Scenario: single-channel or non-Codex engine emits in source order

- **WHEN** a Codex single-channel fallback or another engine adapter emits content followed by a settlement terminal
- **THEN** the unified frontend barrier MUST preserve that observed source order
- **AND** no engine-specific duplicate terminal guard MAY be required

#### Scenario: interactive critical event arrives

- **WHEN** an approval, requestUserInput, or collaboration-mode control event arrives
- **THEN** it MAY retain urgent bypass behavior
- **AND** it MUST NOT be treated as turn settlement solely because it is critical

#### Scenario: Shared projected turn settles

- **WHEN** Shared owner projection emits replayed or live content followed by an authoritative terminal
- **THEN** the same frontend terminal barrier MUST preserve the projected event order
- **AND** this requirement MUST NOT weaken or duplicate the Shared owner replay barrier

### Requirement: Working-indicator live tokens MUST stay off the Messages root lane

Working indicator 展示 live token 时，token usage 抖动 MUST 只使 indicator 小树或 canvas selector 订阅者失效。它 MUST NOT 把 `activeTokenUsage` 并入 Messages 根 props，也 MUST NOT 为了刷新 token 文案重建 `TimelineLiveModel`。

#### Scenario: token usage updates do not invalidate Messages root props

- **WHEN** 活跃线程收到新的 `thread/tokenUsage/updated` 且幕布 items / thinking 状态未变
- **THEN** `conversationCanvasNode` 送给 `Messages` 的 selector 切片 MUST 保持不变
- **AND** live token 文案仍 MAY 在 WorkingIndicator 内更新

