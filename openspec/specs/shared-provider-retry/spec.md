# shared-provider-retry Specification

## Purpose
Defines the Shared-session provider failure auto-retry contract: which vendor failures are retryable, how per-session-CLI retry settings are clamped and stored, and how the wait/send/exhausted series renders on the canvas.
## Requirements
### Requirement: Shared Provider Failures MUST Retry On The Same Target

Shared V2 MUST treat a committed vendor-pool / timeout / rate-limit / overload failure as a finished attempt, then MAY start a new attempt on the same CLI / Provider / Model with the configured resume prompt.

#### Scenario: pool 403 starts a countdown then resends

- **GIVEN** a Shared session whose last attempt committed failed with `API Key is not assigned to any group`
- **AND** retry is enabled with `maxAttempts >= 1`
- **WHEN** the send path unlocks the composer
- **THEN** the canvas MUST show a one-line wait hint
- **AND** after the first delay the client MUST send the resume prompt as a new user message on the same target
- **AND** the client MUST NOT replay the previous user text or images

#### Scenario: vendor 401 invalid key is treated as pool rotation

- **GIVEN** a Shared session whose last attempt committed failed with `unexpected status 401 Unauthorized` and `INVALID_API_KEY`
- **AND** retry is enabled with `maxAttempts >= 1`
- **WHEN** the send path unlocks the composer
- **THEN** the classifier MUST treat it as retryable pool failure
- **AND** the canvas MUST start the same wait-then-resend series as a pool 403

#### Scenario: silent CLI process exit is treated as a temporary interrupt

- **GIVEN** a Shared session whose last attempt committed failed with `Claude exited with status: exit code: 1` and `No stdout/stderr diagnostics were observed`
- **AND** retry is enabled with `maxAttempts >= 1`
- **AND** the current attempt was not interrupted by the local stop control
- **WHEN** the send path unlocks the composer
- **THEN** the classifier MUST treat it as retryable `soft-cancel`
- **AND** the canvas MUST start the same wait-then-resend series as other vendor-temporary failures
- **AND** SIGINT / SIGTERM style exits (`130` / `137` / `143`) MUST stay fail-closed

#### Scenario: user stop does not auto-resend

- **GIVEN** the current attempt was interrupted by the local stop control
- **WHEN** the failed or cancelled terminal arrives
- **THEN** the client MUST NOT start an automatic retry series

#### Scenario: recovery-required stays on the recovery bar

- **GIVEN** Shared send state is `recovery-required` or `target-unavailable`
- **WHEN** a vendor-looking error text is also present
- **THEN** the provider-retry overlay MUST NOT start
- **AND** the existing Shared recovery bar remains the only control

### Requirement: Retry Settings MUST Be Per Shared Session CLI And Memory-Only

Each Shared session CLI MUST have its own in-memory retry settings, copied from compiled defaults on first use. Refreshing the process MUST restore defaults.

#### Scenario: Claude and Codex settings do not overwrite each other

- **GIVEN** the current Shared session is on Claude with `maxAttempts = 5`
- **WHEN** the user switches the same session to Codex
- **THEN** Codex MUST start from the compiled default
- **AND** switching back to Claude MUST restore `maxAttempts = 5` for that session

#### Scenario: another session does not inherit overrides

- **GIVEN** session A changed Codex `resumePrompt`
- **WHEN** the user opens session B on Codex
- **THEN** session B MUST use the compiled default prompt

### Requirement: Retry Status MUST Stay On The Canvas

Retry wait / sending / exhausted copy MUST render in the conversation canvas, not in the composer status bar. Canvas hint buttons MUST be compact text actions on one row.

#### Scenario: wait hint sits under the failed turn

- **WHEN** a retryable failure enters `wait`
- **THEN** the hint MUST appear in the messages scroll area
- **AND** the composer input chrome MUST NOT grow a retry status bar
- **AND** the actions MUST be inline text buttons `立即` and `停止`

### Requirement: Composer Retry Settings MUST Sit Beside Collaboration

Shared composer MUST expose a retry pill to the right of the collaboration pill. The popover edits the current session CLI settings only.

#### Scenario: Shared footer shows the retry pill

- **GIVEN** the active thread is a resolved Shared session
- **WHEN** the composer footer renders
- **THEN** a retry pill MUST appear beside collaboration
- **AND** opening it MUST edit only that session's current CLI settings

### Requirement: Quota-insufficiency failures MUST classify as permanent

Shared provider retry 分类器 MUST 把余额 / 配额不足类失败判定为 permanent（kind `quota`，reason「配额不足」），且判定 MUST 先于 pool 类 retryable 规则。同 key 重试无法修复余额不足，auto-resume MUST NOT 启动。

#### Scenario: 预扣费 403 判为配额不足

- **GIVEN** 一次失败消息为 `Failed to authenticate. API Error: 403 预扣费额度失败, 用户剩余额度: ＄0.378004, 需要预扣费额度: ＄0.800000`
- **WHEN** 分类器处理该消息
- **THEN** 结果 MUST 为 `permanent` / kind `quota` / reason 「配额不足」
- **AND** canvas MUST 显示 permanent 提示而非 retry countdown

#### Scenario: 英文配额变体同样命中

- **WHEN** 失败消息包含 `insufficient balance` / `insufficient quota` / `insufficient credit` / `quota exceeded` / `balance insufficient` 之一
- **THEN** 结果 MUST 为 `permanent` / kind `quota`

#### Scenario: 无配额关键词的 401/403 保持 pool retryable

- **WHEN** 失败消息为 `unexpected status 401 Unauthorized` + `INVALID_API_KEY`，或 `failed to authenticate` + bare `403`（无余额/配额关键词）
- **THEN** 分类 MUST 维持 retryable pool（号池）行为不变

### Requirement: Identical failure signatures MUST trip a circuit breaker

同一 retry series 内，连续 3 次 identical failure signature（`kind` + normalized message 前缀）的 retryable 失败 MUST 直接终止 series 并进入 `exhausted`，不再 auto-send。signature 不同的失败不累计。本规则独立于 `maxAttempts` 生效。

#### Scenario: 同签名三连败熔断

- **GIVEN** retry 已开启且 `maxAttempts >= 3`
- **WHEN** 同一 series 连续 3 次 turn 以相同 kind + 相同消息文本失败
- **THEN** 第 3 次 settle 后 overlay MUST 进入 `exhausted`
- **AND** MUST NOT 再启动 countdown / auto-send

#### Scenario: 签名不同不熔断

- **WHEN** 连续失败的 kind 或消息文本不同
- **THEN** series MUST 按现有 backoff 继续，直至 `maxAttempts`

#### Scenario: 熔断后手动发送恢复

- **GIVEN** series 已因熔断进入 `exhausted`
- **WHEN** 用户手动发送新消息
- **THEN** 既有 series 状态 MUST 清理，后续失败允许开启新 series

### Requirement: Deterministic Context Protocol Failures MUST Not Retry The Same Binding

Shared provider retry MUST fail closed when an `invalid_request_error` states that a message is missing its required reasoning item. The error represents an incomplete provider-native Context chain rather than a transient provider failure.

#### Scenario: missing reasoning item stops automatic retry

- **WHEN** a Shared terminal error contains `required reasoning item`
- **THEN** the retry classifier MUST mark it permanent
- **AND** it MUST NOT schedule another attempt on the same CLI / Provider / Model Binding

