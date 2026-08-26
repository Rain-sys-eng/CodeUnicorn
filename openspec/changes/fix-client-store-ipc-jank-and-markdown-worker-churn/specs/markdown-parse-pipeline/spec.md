# Delta: markdown-parse-pipeline

## MODIFIED Requirements

### Requirement: Large Final Markdown MUST Use Worker-Capable Precompute Or Explicit Fallback

Large final assistant Markdown MUST move serializable heavy precompute off the main thread when thresholds are met, while preserving safe main-thread rich rendering for React-bound features. Worker failure MUST be contained: fallback results MUST be negatively cached per request identity, and a repeatedly crashing worker MUST be re-created under exponential backoff instead of on every request.

#### Scenario: large final message uses worker precompute

- **WHEN** a final assistant message exceeds the documented size or complexity threshold
- **THEN** serializable Markdown precompute MUST run in a worker when worker support is available
- **AND** diagnostics MUST report worker-precompute mode, duration, threshold reason, and evidence class.
- **AND** worker diagnostics MUST include pending request count and fallback count without raw Markdown content

#### Scenario: React-bound rich render remains safe

- **WHEN** Markdown requires React components, sanitized raw HTML, KaTeX, Mermaid, file links, or custom code-block actions
- **THEN** the final rich render MAY still execute through the existing React renderer on the main path
- **AND** worker output MUST NOT be treated as trusted DOM or a substitute for sanitization.

#### Scenario: small final message stays on main path

- **WHEN** a final message is below the documented threshold and lacks heavy complexity signals
- **THEN** the renderer MAY use the existing main path
- **AND** diagnostics MUST make the parse/precompute mode visible.

#### Scenario: worker failure falls back safely

- **WHEN** worker creation fails, worker support is unavailable, or precompute exceeds the documented timeout
- **THEN** the renderer MUST fall back to the existing readable main path
- **AND** fallback reason MUST be reported in diagnostics and runtime evidence.

#### Scenario: worker failure result is negatively cached

- **WHEN** a worker precompute request fails (runtime error, timeout, or invalid response) for a given request identity
- **THEN** the fallback result MUST be cached under the same content/options identity as a successful one
- **AND** a repeated call with the same identity MUST NOT issue another worker roundtrip and MUST return a cache hit that preserves the original fallback reason
- **AND** the negative cache MUST NOT outlive the existing LRU cache bounds.

#### Scenario: crashing worker is re-created under backoff

- **WHEN** the shared worker terminates with consecutive runtime errors
- **THEN** the first crash MAY re-create the worker immediately, while the second and later consecutive crashes MUST defer re-creation with exponential backoff (bounded, starting at tens of seconds)
- **AND** during the backoff window precompute MUST take the existing worker-unavailable path without spawning a worker
- **AND** a successful worker response MUST reset the crash counter so re-creation resumes.

#### Scenario: stale worker result is dropped

- **WHEN** a worker result resolves after a newer content hash or source version exists for the same message
- **THEN** the stale result MUST be ignored
- **AND** it MUST NOT replace newer visible content.
- **AND** diagnostics MUST identify whether the drop was detected by the worker adapter or by the hook/caller latest-source guard

### Requirement: Markdown Worker Requests MUST Have Bounded Lifecycle Diagnostics

The existing fast Markdown worker adapter MUST expose bounded diagnostics for worker lifecycle, pending requests, fallback, stale result drops, and dispose behavior. Worker crash diagnostics MUST carry a content-safe message fingerprint so crashes are attributable without exposing message text.

#### Scenario: pending worker requests are observable

- **WHEN** Markdown worker precompute requests are in flight
- **THEN** diagnostics MUST expose `pendingRequestCount`
- **AND** diagnostics MUST NOT include raw Markdown body, prompt text, assistant body text, tool output, or file content

#### Scenario: disposing worker rejects pending requests

- **WHEN** `disposeFastMarkdownWorker()` is called while requests are pending
- **THEN** every pending request MUST be rejected with a bounded error
- **AND** `pendingRequestCount` MUST return to zero
- **AND** diagnostics MUST increment `disposedCount`

#### Scenario: stale worker result is ignored at the owning layer

- **WHEN** a worker result arrives for an older content hash, options hash, schema version, or request ordinal
- **THEN** the result MUST be dropped by the layer that owns latest-source knowledge
- **AND** worker adapter diagnostics MUST only increment adapter-level stale counters when the adapter has an explicit latest-source registry
- **AND** hook/caller diagnostics MUST report hook-level stale visible-result drops when request ordinal guards ignore obsolete promise resolutions
- **AND** visible content MUST remain based on the latest source

#### Scenario: adapter lifecycle diagnostics do not infer UI state

- **WHEN** the worker adapter receives an unknown request id, dispose event, worker error, or postMessage failure
- **THEN** adapter diagnostics MAY update pending, disposed, fallback, unknown-response, or bounded error counters
- **AND** it MUST NOT claim a visible-content stale drop unless it has explicit latest-source inputs

#### Scenario: fallback reason is bounded

- **WHEN** worker creation, worker execution, or worker response handling falls back to the main path
- **THEN** diagnostics MUST include a bounded fallback reason
- **AND** the fallback reason MUST NOT contain conversation or file content

#### Scenario: worker crash diagnostics carry a message fingerprint

- **WHEN** the worker terminates with an uncaught runtime error
- **THEN** the persisted worker-failure diagnostic MUST include a short alphanumeric `messageHash` fingerprint and `messageLength`
- **AND** the full raw error message MUST NOT be persisted into renderer diagnostics
- **AND** the full message MAY be surfaced via `console.warn` for local attribution
