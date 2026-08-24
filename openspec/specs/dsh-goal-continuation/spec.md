# dsh-goal-continuation Specification

## Purpose
TBD - created by archiving change adapt-dsh-goal-continuation. Update Purpose after archive.
## Requirements
### Requirement: DSH completed hop does not unbind mux

mossx SHALL keep the DSH mux session binding after a completed `turn/end`.
The first completed or failed `turn/end` MAY still complete the oneshot
waiter used by sync `collect_turn_text`. mossx SHALL unbind only on
cancelled / aborted / error / failed `turn/end`, user interrupt, session
archive, or host shutdown.

This requirement applies only to engine `dsh`. Other engines SHALL keep
their existing terminal contracts.

#### Scenario: Ordinary completed turn stays bound

- **WHEN** a DSH session without an active Goal receives `turn/end` with
  `reason.kind === "completed"`
- **THEN** mossx SHALL emit `TurnCompleted` so the composer becomes idle
- **AND** mossx SHALL still complete the turn waiter
- **AND** mossx SHALL NOT remove the mux binding for that session

#### Scenario: Cancelled or failed hop unbinds

- **WHEN** a DSH session receives `turn/end` with
  `reason.kind` in `cancelled | aborted | error | failed`
- **THEN** mossx SHALL emit `TurnError`
- **AND** mossx SHALL unbind that session from the mux hub

### Requirement: Active Goal suppresses TurnCompleted

While the latest DSH `goal/change` snapshot for a bound session has `phase === "active"`, mossx SHALL NOT emit `TurnCompleted` for a completed hop `turn/end`. The composer MUST remain in a running / processing state so the host-owned Goal loop can start the next hop.

When the Goal phase becomes `paused`, `complete`, or a clear tombstone,
mossx SHALL emit `TurnCompleted` (on that `goal/change` if a completed hop
was already suppressed, or on the hop `turn/end` itself). When the phase
becomes `blocked`, mossx SHALL emit `TurnCompleted` so the user can act,
but SHALL keep the mux binding.

If no `goal/change` has been observed, mossx SHALL treat a completed
`turn/end` as an ordinary settle (`TurnCompleted`) without unbinding.

#### Scenario: Goal-active hop does not idle the composer

- **WHEN** mux has applied a `goal/change` with `phase === "active"`
- **AND** the same session later receives `turn/end` with
  `reason.kind === "completed"`
- **THEN** mossx SHALL NOT emit `TurnCompleted`
- **AND** mossx SHALL keep the mux binding
- **AND** the next hop `turn/start` and `assistant/chunk` events SHALL still
  reach the curtain

#### Scenario: Goal completion settles a suppressed hop

- **WHEN** mossx suppressed `TurnCompleted` because Goal was `active`
- **AND** mux later delivers `goal/change` with `phase === "complete"`
  or a clear tombstone
- **THEN** mossx SHALL emit the deferred `TurnCompleted`
- **AND** the composer SHALL become idle

#### Scenario: Goal blocked lets the user act

- **WHEN** mux delivers `goal/change` with `phase === "blocked"`
- **THEN** mossx SHALL emit `TurnCompleted` if a hop is waiting to settle
- **AND** mossx SHALL keep the mux binding

#### Scenario: Unknown Goal state settles but stays bound

- **WHEN** a DSH session has never received `goal/change`
- **AND** it receives `turn/end` with `reason.kind === "completed"`
- **THEN** mossx SHALL emit `TurnCompleted`
- **AND** mossx SHALL keep the mux binding so a later unexpected hop
  `turn/start` can remount processing

### Requirement: Goal injection is a collapsible card

mossx SHALL project a DSH `user/message` whose `source.kind === "goal"` as
a visible collapsible context card, not as a user chat bubble and not as a
hidden row. The card title MUST be the localized “上下文注入” string plus
the source label `goal`. The card MUST start collapsed and MUST reveal the
original injection text when expanded.

Other present non-`user` source kinds (`agent-instructions`, `plugin`, …)
MUST stay hidden. When `source` is absent, mossx MAY still hide rows whose
text is only a runtime-context envelope.

This presentation MUST use `presentationMetadata` with context
`kind: "dsh-goal"` on an existing `kind: "message"` item. mossx SHALL NOT
introduce a new ConversationItem kind for this change.

#### Scenario: History shows the Goal card

- **WHEN** `session.history` contains a `user/message` with
  `source.kind === "goal"` and a later assistant reply
- **THEN** the curtain MUST render a collapsible card titled
  “上下文注入 · goal”
- **AND** MUST NOT render that injection as a user bubble
- **AND** MUST still render the real `source.kind === "user"` prompt and
  the assistant text

#### Scenario: Live Goal injection appears mid-session

- **WHEN** mux delivers `user/message` with `source.kind === "goal"` on a
  bound DSH session
- **THEN** mossx SHALL project a live curtain item with
  `presentationMetadata.contexts[].kind === "dsh-goal"`
- **AND** the card MUST be visible without waiting for history reload

#### Scenario: Other injected context stays hidden

- **WHEN** history or mux contains `user/message` rows with
  `source.kind` in `agent-instructions | plugin` or a sourceless
  runtime-context snapshot
- **THEN** mossx MUST NOT render those rows as bubbles or Goal cards

### Requirement: Goal text is not a sidebar title

mossx SHALL NOT use a DSH Goal injection (`source.kind === "goal"` or a
title/first_message that is only a `<goal_round>` envelope) as the sidebar
display name.

#### Scenario: Goal round prompt does not name the thread

- **WHEN** a DSH session title or `first_message` is only a `<goal_round>`
  envelope
- **THEN** mossx MUST NOT use that string as the sidebar display name

