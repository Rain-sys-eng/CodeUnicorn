# shared-context-package Specification

## Purpose
TBD - created by archiving change add-shared-context-compiler. Update Purpose after archive.
## Requirements
### Requirement: Context Package MUST Be Versioned And Auditable

The system MUST compile Shared canonical entries into `ContextPackage schemaVersion=1` with a deterministic package id, source checksum, destination target, projection manifest, and compression report.

#### Scenario: identical source range compiles identically

- **WHEN** the same canonical source range, destination target, binding identity, capabilities, and budget are compiled twice
- **THEN** both packages MUST have the same package id and source checksum
- **AND** their stable prefix MUST be byte-identical

#### Scenario: package records measured compression

- **WHEN** source content is folded, artifactized, or omitted
- **THEN** `ContextCompressionReport` MUST record source/package token estimates and per-category strategy
- **AND** every lossy operation MUST appear in `ProjectionManifest.omitted`

### Requirement: Projection Manifest MUST Make Omissions Explicit

Every manifest MUST record compiler version, projection mode, included entry ids, typed omissions, disposition, cursor semantics, and source checksum.

#### Scenario: irretrievable omission is visible

- **WHEN** incompatible content cannot be preserved or stored as a retrievable artifact
- **THEN** the omission MUST use `disposition=not-retrievable`
- **AND** Shared send MUST require explicit degraded-context confirmation

#### Scenario: retrievable omission stays reference-only

- **WHEN** omitted content has an ArtifactRef or retrievableRef
- **THEN** the manifest MUST use `disposition=retrievable-on-demand`
- **AND** later packages MUST NOT automatically inline the omitted content

### Requirement: Consecutive Packages MUST Preserve Stable Prefixes

For the same conversation and destination Binding, checkpoint headers and deterministic facts MUST remain byte-stable; new delta facts MUST only append after the stable prefix.

#### Scenario: later handoff appends delta

- **WHEN** a second package adds canonical entries without changing stable facts
- **THEN** the first package stable prefix MUST be an exact byte prefix of the second
- **AND** previously stable sections MUST NOT be reordered or rewritten

### Requirement: Context Package MUST Identify Native History Sources

`ContextPackage` 来源为 Native Session 时 MUST 记录 `kind=native-history`、reader identity、
source session/native identity、provider profile、source fingerprint 与 cursor range；source
checksum MUST 覆盖这些字段和 normalized entries。

#### Scenario: identical frozen native source compiles identically

- **WHEN** 同一 Reader、source fingerprint、cursor range、normalized entries、destination 与
  capabilities 被编译两次
- **THEN** 两个 Context Package MUST 具有相同 package id 与 source checksum

#### Scenario: source fingerprint changes package identity

- **WHEN** normalized text 相同但 authoritative source fingerprint 或 cursor range 不同
- **THEN** Context Package identity MUST 不同
- **AND** retry MUST NOT 把它们视为同一 materialization

### Requirement: Context Package Identity MUST Cover Delivery Semantics

`packageId` MUST cover compiler version, destination identity, destination capabilities,
effective budget, source range, and Binding identity. Inputs that can change projection or
delivery semantics MUST NOT reuse an existing package identity.

#### Scenario: delivery input changes package identity

- **WHEN** destination, destination native identity, capabilities, effective budget, or compiler version changes
- **THEN** the resulting package id MUST differ
- **AND** artifact lookup MUST NOT reuse the prior package

### Requirement: Zero-transfer packages MUST be distinguishable in audit

A Context Package with empty `prompt_prefix` and empty `delta` MUST remain a valid package shape, but delivery orchestration MUST treat it as zero-transfer and MUST NOT imply that Shared history was delivered.

#### Scenario: zero-transfer package id still deterministic

- **WHEN** the same empty source range and destination inputs compile twice
- **THEN** package identity MAY still be deterministic
- **AND** delivery MUST still apply empty-handoff rules based on transfer payload emptiness, not package id alone

### Requirement: Rematerialized packages MUST change identity when projection inputs change

When rematerialization changes `from_sequence_exclusive` and/or clears destination native identity for projection, the resulting package id MUST differ from the incremental empty package id so artifact storage and acceptance do not collide with the rejected empty handoff.

#### Scenario: rematerialize gets new package id

- **WHEN** an incremental compile yields zero-transfer package A
- **AND** rematerialize compile includes full history as package B
- **THEN** package B id MUST differ from package A id
- **AND** deliveryPrepared MUST reference package B

