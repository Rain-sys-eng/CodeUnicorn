# shared-context-delivery Specification

## Purpose
TBD - created by archiving change add-shared-context-compiler. Update Purpose after archive.
## Requirements
### Requirement: Context Delivery MUST Use Two-Phase Cursor

Each target Binding MUST persist separate `acceptedThroughSequence` and `committedThroughSequence` values plus a durable pending delivery. Compile, acceptance, and canonical commit MUST advance only their own boundary.

#### Scenario: compile failure advances nothing

- **WHEN** context compilation fails before delivery preparation commits
- **THEN** no pending delivery MUST be written
- **AND** accepted and committed cursors MUST remain unchanged

#### Scenario: context ack advances accepted only

- **WHEN** the runtime-specific Adapter explicitly accepts a package
- **THEN** `context.deliveryAccepted` MUST be appended and accepted cursor advanced
- **AND** committed cursor MUST remain unchanged until terminal canonical commit

#### Scenario: accepted run failure does not replay package

- **WHEN** a package was accepted and the subsequent run fails
- **THEN** accepted cursor MUST NOT roll back
- **AND** retry MUST NOT inject the same package again

#### Scenario: terminal commit clears pending

- **WHEN** `conversation.turnCommitted` is durably committed for the attempt
- **THEN** committed cursor MUST advance through the accepted package
- **AND** matching pending delivery MUST be cleared

### Requirement: Pending Delivery MUST Be Crash Recoverable

Pending delivery MUST record package/checksum, sequence, operation, phase, client identity, native identity when known, timestamps, and probe attempts.

#### Scenario: ack ambiguity fails closed

- **WHEN** runtime delivery may have succeeded but its ACK is lost
- **THEN** pending delivery MUST remain in an ambiguous recoverable phase
- **AND** the system MUST probe before retrying the external side effect

#### Scenario: restart restores pending state

- **WHEN** the app restarts with a prepared or sent-awaiting-ack delivery
- **THEN** the Shared composer MUST restore a non-idle recovery state
- **AND** another target MUST NOT bypass the linear pending operation

### Requirement: Runtime Context ACK MUST Match Adapter Evidence

Adapters MUST use their declared capability evidence and MUST NOT treat process spawn, stdin write, or first token as universal context acceptance.

#### Scenario: Codex import requires JSON-RPC success

- **WHEN** Codex uses `thread/inject_items`
- **THEN** context accepted MUST be recorded only after a successful JSON-RPC response
- **AND** timeout/disconnect MUST remain ambiguous rather than fallback-send a duplicate

#### Scenario: Claude transcript requires checksum echo

- **WHEN** Claude receives transcript/checkpoint context with a package checksum marker
- **THEN** acceptance MUST require a matching replay echo
- **AND** a mismatched or missing echo MUST enter recovery-required

#### Scenario: weak Kimi ack is explicit

- **WHEN** Kimi capability does not expose a strong context ACK
- **THEN** the Adapter MUST report weak or unsupported fidelity
- **AND** the system MUST NOT claim exactly-once acceptance

### Requirement: Delivery Facts MUST Use The Canonical Writer Envelope

`context.deliveryPrepared` and `context.deliveryAccepted` MUST be serialized and appended through
the canonical writer boundary with their complete tagged envelope. Their event append and Binding
state update MUST remain atomic.

#### Scenario: delivery prepared is durably written

- **WHEN** context delivery enters the prepared phase
- **THEN** the stored payload MUST contain `type=context.deliveryPrepared`
- **AND** the row `fact_type` MUST contain the same value
- **AND** the pending Binding update MUST commit in the same transaction

#### Scenario: delivery acceptance is durably written

- **WHEN** runtime evidence accepts the prepared context package
- **THEN** the stored payload MUST contain `type=context.deliveryAccepted`
- **AND** the row `fact_type` MUST contain the same value
- **AND** the accepted cursor and pending phase MUST commit atomically with the fact

#### Scenario: duplicate delivery fact remains idempotent

- **WHEN** the same attempt and delivery fact are appended again
- **THEN** the canonical writer MUST resolve the existing sequence through its durable idempotency
  boundaries
- **AND** it MUST NOT append a second logical delivery fact

### Requirement: Accepted no-replay applies only while native context trust is trusted

The rule that an accepted package MUST NOT be replayed after a failed run applies while the binding's native context trust is `trusted`. When trust is `dirty`, the system MUST allow a new Context Package identity that rematerializes required Shared history for the next delivery.

#### Scenario: dirty trust allows rematerialized package after prior accept

- **WHEN** a prior package was accepted for the binding
- **AND** trust is later marked `dirty`
- **AND** the next prepare detects zero-transfer with needs-history
- **THEN** prepare_delivery MUST be allowed to create a new full package
- **AND** it MUST NOT claim `no-context-transfer-required` solely because the accepted cursor advanced

#### Scenario: trusted keep no-replay for empty incremental packages

- **WHEN** trust is `trusted`
- **AND** empty-handoff rematerialize is not required
- **THEN** retry MUST NOT re-inject the previously accepted full package as a blind replay

### Requirement: no-context-transfer-required MUST be honest under trust

The system MUST record `no-context-transfer-required` only when the package is zero-transfer and either needs-history is false, or needs-history is true and trust is `trusted` (native-held history assumption). Needs-history + `dirty` MUST rematerialize or fail closed, including when the incremental package is non-empty but incomplete.

#### Scenario: dirty continue-only package is not no-transfer-required

- **WHEN** needs-history is true
- **AND** trust is `dirty`
- **AND** the incremental package only contains short continue turns after the accepted cursor
- **THEN** delivery MUST rematerialize a full package or return a primary `empty-context-handoff:` error
- **AND** MUST NOT set context evidence to `no-context-transfer-required`

### Requirement: Codex Structured Context Import MUST Require Protocol-Safe Capability Evidence

Codex Shared Context delivery MUST NOT use `thread/inject_items` merely because the JSON-RPC method exists. Method availability alone is insufficient evidence that the destination provider accepts reconstructed assistant, reasoning, and tool-item dependencies.

#### Scenario: method-only Codex capability uses portable delivery

- **WHEN** a Codex app-server reports `thread/inject_items` but no protocol-safe item-chain evidence exists
- **THEN** Shared Context delivery MUST use prompt-prefix transcript/checkpoint delivery
- **AND** it MUST NOT record `thread/inject_items-jsonrpc-success` as Context acceptance evidence

