# dsh-session-stats Specification

## Purpose
TBD - created by archiving change show-dsh-session-stats. Update Purpose after archive.
## Requirements
### Requirement: DSH composer shows host session speed stats

When the active engine is `dsh` and the host has produced `sessionStats` and/or billed `tokenUsage`, mossx SHALL render the compact speed line in the composer branch row between the git branch control and the trailing usage indicator.

The line MUST use the DSH Web wording and grouping:

- `首 token 平均 {duration}` when `ttftSteps > 0`
- `{throughput} tok/s` when `decodeMs > 0` and `decodeTokens` is present
- `缓存命中 {percent}%` when billed input tokens > 0
- speed items joined by ` · `, then ` | ` before cache hit

mossx MUST NOT invent these numbers from the paged curtain; it MUST use host projections.

#### Scenario: Live DSH turn updates the red-box stats

- **WHEN** DSH mux emits `session/projection` for `sessionStats` and `tokenUsage`
- **THEN** the composer branch row SHALL show the available speed items in the middle slot
- **AND** SHALL NOT replace existing token counts when only `sessionStats` arrives

#### Scenario: Resume a DSH session after restart

- **WHEN** the user opens `dsh:<sessionId>` whose history tail page has `projections.values.sessionStats` and `tokenUsage`
- **THEN** mossx SHALL hydrate those values into `ThreadTokenUsage`
- **AND** the composer red-box line SHALL render without waiting for the next turn

#### Scenario: No DSH projection yet

- **WHEN** the session has no `ttftSteps`, no decode throughput, and no billed input
- **THEN** mossx SHALL render no stats node in the red-box slot

#### Scenario: Non-DSH engines keep the empty middle slot

- **WHEN** the active engine is not `dsh`
- **THEN** mossx SHALL NOT render the DSH speed line

