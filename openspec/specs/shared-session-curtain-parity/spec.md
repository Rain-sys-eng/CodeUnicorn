# shared-session-curtain-parity Specification

## Purpose

TBD - created by archiving change. Update Purpose for `shared-session-curtain-parity`.
## Requirements
### Requirement: Shared history final assistant metadata parity

Shared Session history projection SHALL stamp the same final assistant metadata fields consumed by the unified conversation canvas footer that Native sessions use when the underlying facts are available.

#### Scenario: Usage and duration stamp onto final assistant message

- **GIVEN** a Shared session with `TurnRequested`, `TurnCommitted` (assistant text final), and preferred `UsageRecorded` for the same attempt
- **WHEN** `SharedProjector` projects the session canvas
- **THEN** the final assistant `message` item includes `isFinal=true`, `finalCompletedAt`, `finalDurationMs` (committed_at − requested_at when non-negative), `finalInputTokens` (input + cached_input), and `finalOutputTokens`
- **AND** a `metadata` usage item may still be present for shadow/comparator consumers

#### Scenario: Missing usage does not invent tokens

- **GIVEN** a committed turn without any `UsageRecorded` fact
- **WHEN** projection runs
- **THEN** the final assistant message omits token fields rather than writing zeros

### Requirement: Shared history tool process presentation parity

Shared history tool projection SHALL produce ConversationItem-compatible tool fields so the shared Messages canvas can classify, group, hide bash/command cards, and drive fileEdit scenes consistently with Native process presentation.

#### Scenario: Edit-like tools map to fileChange presentation

- **GIVEN** an atomic tool exchange whose tool name is write/edit/patch/delete family
- **WHEN** projection emits the tool item
- **THEN** `toolType` is `fileChange` (or equivalent canvas file-edit type)
- **AND** when arguments summary JSON contains a path-like field, `changes` includes at least that path

#### Scenario: Command-like tools map to commandExecution

- **GIVEN** an atomic tool exchange whose tool name is bash/shell/command/terminal family
- **WHEN** projection emits the tool item
- **THEN** `toolType` is `commandExecution` so existing canvas hide policies can apply for supported engines

#### Scenario: Read/search tools keep semantic names

- **GIVEN** a Read/Grep-like tool name
- **WHEN** projection emits the tool item
- **THEN** title/toolType preserve the tool name so semantic classifiers can route Read/Search blocks

### Requirement: Unified Messages canvas remains the single renderer

Shared Session SHALL continue to render through the same Messages timeline as Native Session; parity work adjusts projection inputs, not a second row tree.

#### Scenario: No Shared-only row renderer

- **GIVEN** a Shared thread id (`shared:*`)
- **WHEN** history or live items are shown
- **THEN** presentation still flows through `Messages → Timeline → TimelineRowRenderer`
- **AND** no Shared-only message row component is introduced by this change

### Requirement: Shared user attachment display parity with Native user bubbles

Shared Session canvas MUST display user-attached images on the user message bubble using the same MessageRow / MessageImageGrid path as Native sessions when projection or optimistic items supply `images`. Shared MUST NOT rely on a separate attachment-only bubble that duplicates the user text.

#### Scenario: shared user message with images uses standard image grid

- **WHEN** a Shared thread ConversationItem has `kind=message`, `role=user`, non-empty `text`, and non-empty `images`
- **THEN** the unified Messages timeline renders a single user row with MessageImageGrid (or equivalent) plus text
- **AND** no Shared-only dual text bubble is introduced for the same item identity

#### Scenario: text-only shared user message unchanged

- **WHEN** a Shared user message has text and no images
- **THEN** rendering remains a single text user bubble as before this change

