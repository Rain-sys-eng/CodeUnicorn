# dsh-followup-model-ledger Specification

## Purpose

DSH follow-up send 的 model 账本必须留在 DSH catalog 命名空间。mossx 不得把 managed provider `ccgui`（Grok / Kimi / OpenCode catalog id）转发给 `session.selectModel`；stay-on-thread 时 picker 也不得把外国 catalog id 写进当前 DSH thread ledger。

## Requirements

### Requirement: DSH send rejects mossx managed provider namespace

When mossx sends a turn on a DSH thread, the catalog id passed to `session.selectModel` MUST be a `{provider}/{model}` pair whose provider is not the mossx managed namespace `ccgui` (case-insensitive). mossx MUST NOT forward Grok / Kimi / OpenCode managed catalog ids such as `ccgui/grok-4.5` to the DSH host.

If no trusted DSH catalog id is available, mossx MUST omit the model and
MUST NOT call `session.selectModel` for that turn, so the existing session
keeps its current provider/model. Global `composerEnginePrefs.dsh.modelId`
MAY be used only as a first-send fallback on `dsh-pending-*`. An existing
`dsh:<session>` follow-up MUST NOT retarget `selectModel` from that
engine-global pref.

#### Scenario: Follow-up resolver leaks a Grok CLI catalog id

- **WHEN** the active thread is `dsh:<session>`
- **AND** composer resolver id is `ccgui/grok-4.5`
- **AND** the user sends a follow-up
- **THEN** mossx SHALL NOT call `session.selectModel` with provider `ccgui`
- **AND** mossx SHALL omit the model even if `composerEnginePrefs.dsh.modelId`
  holds another trusted DSH catalog id

#### Scenario: Pending first send may use the dsh engine pref

- **WHEN** the active thread is `dsh-pending-*`
- **AND** the resolver is untrusted
- **AND** `composerEnginePrefs.dsh.modelId` is a trusted DSH catalog id
- **THEN** mossx SHALL pass that pref catalog id to `session.selectModel`

#### Scenario: Trusted DSH catalog id still selects

- **WHEN** the resolver is `ggggg/grok-4.6` or
  `deepseek-official/deepseek-v4-flash`
- **THEN** mossx SHALL pass that catalog id through to `session.selectModel`

#### Scenario: Backend fail-closed

- **WHEN** a reserved mossx provider still reaches `send_user_turn`
- **THEN** mossx SHALL return an error before `session.selectModel`
- **AND** the error SHALL name the reserved provider

### Requirement: DSH thread ledger stays on DSH catalog ids

When the user is on a `dsh:` or `dsh-pending-` thread and `handleSelectModel` matches a foreign engine catalog by exact id, mossx MUST persist that id under the owning engine pref only. mossx MUST NOT write that foreign catalog id onto the current DSH thread composer selection or the in-flight resolver used by DSH send. The skip axis is thread ownership (`threadEngine === "dsh" && targetEngine !== "dsh"`), not whether `activeEngine` currently matches the pick.

Same-catalog DSH picks and explicit engine-group switches keep existing
behavior.

#### Scenario: Exact Grok CLI id while viewing a DSH thread

- **WHEN** `activeThreadId` is `dsh:session-1`
- **AND** the user selects `ccgui/grok-4.5` from the Grok catalog
- **THEN** mossx SHALL persist the Grok engine pref
- **AND** mossx SHALL NOT persist `ccgui/grok-4.5` as the DSH thread model

#### Scenario: Drifted activeEngine still skips foreign ledger writes

- **WHEN** `activeThreadId` is `dsh:session-1`
- **AND** `activeEngine` is already `grok`
- **AND** the user selects `ccgui/grok-4.5`
- **THEN** mossx SHALL persist the Grok engine pref
- **AND** mossx SHALL NOT overwrite the DSH thread ledger or send resolver

#### Scenario: Drifted activeEngine still accepts a DSH catalog pick

- **WHEN** `activeThreadId` is `dsh:session-1`
- **AND** `activeEngine` is already `grok`
- **AND** the user selects `ggggg/grok-4.6` from the DSH catalog
- **THEN** mossx SHALL persist that id as the DSH thread model
