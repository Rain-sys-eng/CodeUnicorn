## MODIFIED Requirements

### Requirement: Shared Session Uses Explicit Manual Engine Selection

Within a `shared session`, the system MUST let the user explicitly choose the execution target
before sending a turn. The selector MUST be a four-level target picker
(CLI → Provider → Model → Reasoning); the engine-only selector is superseded. Provider and
model items MUST preserve Provider Profile scope instead of inferring the target from model id
alone. The picker MUST be locked whenever the shared session composer is in any non-idle state.
Claude Code、Codex CLI、Kimi CLI、Grok CLI、OpenCode CLI、PI CLI 与 Qoder CLI MUST be
selectable Shared targets；registered engines outside this set MUST remain unavailable.

#### Scenario: shared composer exposes seven supported CLIs

- **WHEN** the user focuses the composer inside a `shared session`
- **THEN** the four-level picker MUST enable Claude Code、Codex CLI、Kimi CLI、Grok CLI、
  OpenCode CLI、PI CLI and Qoder CLI
- **AND** each enabled CLI MUST expose its Provider-scoped Model catalog

#### Scenario: provider profile scopes its model catalog

- **WHEN** the user opens a Provider Profile inside the shared target picker
- **THEN** the system MUST show models resolved for that exact Engine and Provider Profile
- **AND** selecting a model MUST atomically preserve the Engine, Provider Profile, and Model identity
- **AND** an equal model id in another Provider Profile MUST NOT change or satisfy the selection

#### Scenario: unavailable engine remains explainable

- **WHEN** a registered CLI is not included in the supported Shared target set
- **THEN** the picker MUST keep the CLI unavailable
- **AND** MUST expose a human-readable reason rather than route through it

#### Scenario: picker update is metadata-only before send

- **WHEN** the user changes the shared-session target picker but does not submit a message yet
- **THEN** the system MUST update only the selected next target state for that shared session
- **AND** the system MUST NOT dispatch a turn, create a binding, or start an extra user-visible native conversation solely due to picker change

#### Scenario: submitted turn uses the user-selected target

- **WHEN** the user submits a message from a `shared session`
- **THEN** the system MUST dispatch that turn to the full target currently selected by the user
- **AND** the dispatch result MUST remain attributable to that selected target snapshot

#### Scenario: picker locks outside idle state

- **WHEN** the shared session composer is in any state other than `idle`
- **THEN** the target picker MUST be locked against changes
- **AND** the system MUST NOT apply a new target selection to the in-flight turn

### Requirement: Shared Qoder Target Uses Kimi-Tier Ack Semantics

`qoder` Shared target SHALL run with `inputAck: "first-event"`（弱语义，显式标注）、typed
terminal（ACP prompt response `stopReason`）与 typed cancel（`stopReason:"cancelled"`）。
Context delivery SHALL use the user channel（`user_channel_transcript: true`）with
`strong_context_ack: false`；structured import / native delta / native clone SHALL remain
disabled until probed. Shared Attempt/Binding recovery SHALL NOT fall back to the Qoder
Native `session/resume` re-attach path；ACK 不确定 MUST 进入 `recovery-required` 并等待显式
rebuild。`session/list` MAY be used as a read-only existence probe for recovery 定性。

#### Scenario: Qoder Shared turn settles from typed terminal

- **WHEN** a Shared turn targets `qoder`
- **THEN** logical settlement MUST be derived from the ACP prompt response `stopReason`
- **AND** process cleanup MUST NOT block the Shared composer idle transition

#### Scenario: Qoder Shared cancel resolves exactly once

- **WHEN** the user stops an in-flight `qoder` Shared turn
- **THEN** `session/cancel` 的 typed `cancelled` response MUST settle the exact Attempt as `cancelled`
- **AND** 已抢先完成的合法 terminal MAY 保持 `completed`
- **AND** 最终结算 MUST be exactly-once

#### Scenario: Qoder ACK uncertainty fails closed

- **WHEN** a `qoder` Shared turn 的 ACK 不确定
- **THEN** provisioning MUST 进入 `recovery-required`
- **AND** the system MUST NOT blindly rebuild the binding
- **AND** MUST NOT invoke the Qoder Native resume path as Shared recovery

#### Scenario: Qoder binding survives process respawn

- **WHEN** a `qoder` Shared binding 已持有真实 sessionId
- **AND** runtime 以 spawn-per-turn 在新进程 `session/resume` re-attach
- **THEN** the native session history MUST 保持连续（probe10 实测形态）
- **AND** `--config-dir` provider profile 隔离 MUST NOT break re-attach（probe11 实测形态）
