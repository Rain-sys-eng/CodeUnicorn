# shared-context-compiler Specification

## Purpose
TBD - created by archiving change add-shared-context-compiler. Update Purpose after archive.
## Requirements
### Requirement: Compiler MUST Select Projection Mode By Capability

The compiler MUST select the first applicable mode in this order: `native-delta`, `native-history-import`, `native-history-clone`, `portable-transcript`, `checkpoint`. Selection MUST use runtime capabilities and destination identity rather than engine-name branches. A Shared Codex target MUST NOT declare structured history import solely because its app-server exposes `thread/inject_items`.

#### Scenario: existing binding uses native delta

- **WHEN** destination binding identity is established and delta injection is supported
- **THEN** the compiler MUST select `native-delta`
- **AND** it MUST exclude entries natively owned by that binding

#### Scenario: structured import outranks transcript

- **WHEN** native delta is inapplicable and runtime capability reports structured history import
- **THEN** the compiler MUST select `native-history-import`
- **AND** it MUST NOT choose transcript merely because of engine type

#### Scenario: Codex Shared delivery avoids partial Responses item chains

- **WHEN** a Shared Codex target crosses into a Binding without native delta
- **THEN** the compiler MUST select `portable-transcript` or bounded `checkpoint`
- **AND** it MUST omit tool call/result exchanges as an atomic pair

#### Scenario: unsupported capability degrades explicitly

- **WHEN** import and clone are unsupported
- **THEN** the compiler MUST choose portable transcript if safe and within budget, otherwise checkpoint
- **AND** the Manifest MUST record the capability-driven reason

### Requirement: Compatibility Transformer MUST Preserve Semantic Closure

The transformer MUST process thinking, tool ids/results, images, aborted/error turns, provider-private metadata, and historical controls according to target capability.

#### Scenario: tool exchange is atomic

- **WHEN** a tool call and result cross the projection boundary
- **THEN** they MUST be included as a pair with consistently transformed ids or omitted as a pair
- **AND** an orphan call MUST NOT appear as a successful exchange

#### Scenario: private reasoning does not leak

- **WHEN** provider-private reasoning/signature is incompatible with the destination protocol
- **THEN** it MUST be omitted or replaced by a portable semantic block
- **AND** the Manifest MUST record the transformation

#### Scenario: unsupported image becomes artifact reference

- **WHEN** the source contains an image and the target does not support images
- **THEN** the package MUST contain a stable ArtifactRef or explicit not-retrievable omission
- **AND** it MUST NOT silently discard the image

#### Scenario: aborted assistant is not replayed as success

- **WHEN** an assistant block is aborted or failed
- **THEN** it MUST NOT be serialized as a successful assistant conclusion
- **AND** its outcome MUST remain auditable in the package or omission

### Requirement: Compression MUST Be Deterministic And Type-Aware

The compiler MUST apply deterministic category-specific folding for tool output, code/diff, logs, images/attachments, and portable turns. It MUST NOT use nondeterministic or ML compression.

#### Scenario: repeated log folding is stable

- **WHEN** identical repeated log input is compiled multiple times
- **THEN** the folded output and omission record MUST be byte-identical
- **AND** error/warning plus bounded head/tail evidence MUST be retained

### Requirement: destination-owned omission REQUIRES resumable destination native identity

The compiler MUST omit entries as `destination-owned` only when a destination native session identity is supplied for the compile **and** that identity is being treated as resumable for ownership dedupe. When the caller withholds destination native identity for rematerialization, the compiler MUST include portable history that would otherwise be destination-owned.

#### Scenario: rematerialize compile includes previously owned history

- **WHEN** compile is invoked with `destination_native_session_id = null` for rematerialization
- **AND** historical attempts were previously associated with the same binding key
- **THEN** those entries MUST NOT be dropped solely as `destination-owned`
- **AND** the resulting package MUST be allowed to carry transferable prompt-prefix or delta content

#### Scenario: resumable destination still dedupes owned attempts

- **WHEN** compile is invoked with a destination native session identity for a resumable binding
- **AND** an entry's attempt is owned by that binding
- **THEN** the entry MAY be omitted as `destination-owned`
- **AND** the omission MUST remain auditable in the ProjectionManifest

### Requirement: Compiler helpers MUST support needs-history detection

The system MUST be able to determine whether a session range contains portable history that would produce a non-empty transfer payload when compiled from the beginning without destination-owned omission. This determination drives empty-handoff guards.

#### Scenario: needs-history true when original user task exists

- **WHEN** Canonical events include a prior user task body in the session
- **AND** a full rematerialize compile would include that body in prompt-prefix or delta
- **THEN** needs-history MUST be true for empty-handoff evaluation on later continue turns

