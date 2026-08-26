# Delta: pi-rpc-session-runtime

## ADDED Requirements

### Requirement: PI Send MUST NOT Return Started When Engine Is Known Unrecoverable

`engine_send_message`（PI 分支）MUST NOT 在引擎已知不可恢复不可用时返回 `started`：当 RPC spawn disabled latch 处于冷却期**且** print-json fallback 亦不可用（busy / 被拒）时，MUST 返回结构化 error（code `pi_engine_unavailable`），使前端走既有 rpcError 路径快速失败，MUST NOT 让消息进入 turn 状态机后静默孤儿化。

detached send task 的失败 MUST 有事件兜底：`send_message` 返回 Err 时依赖 pi.rs 内部 `emit_error`；task panic MUST 被 catch 并向该 turn 发出 TurnError，MUST NOT 静默吞掉 panic 留下无回执的孤儿 turn。

#### Scenario: double-evidence send gate rejects fast

- **WHEN** RPC spawn latch 处于冷却期 AND print-json fallback 因同 session busy 被拒
- **THEN** `engine_send_message` MUST 返回带 `pi_engine_unavailable` code 的结构化 error
- **AND** MUST NOT 返回 `started`，前端不进入零事件等待窗口

#### Scenario: single evidence still dispatches

- **WHEN** 仅 latch 生效（fallback 可用）或仅 fallback busy（RPC 可用）
- **THEN** send MUST 按既有路径正常 dispatch，MUST NOT 被 gate 拦截

#### Scenario: detached send panic emits TurnError

- **WHEN** detached send task 内 `send_message` 发生 panic
- **THEN** panic MUST 被 catch
- **AND** MUST 向该 turn 发出 TurnError（事件回传），前端 turn MUST 能 settle
