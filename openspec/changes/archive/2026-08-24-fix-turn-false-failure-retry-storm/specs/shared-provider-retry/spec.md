## ADDED Requirements

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
