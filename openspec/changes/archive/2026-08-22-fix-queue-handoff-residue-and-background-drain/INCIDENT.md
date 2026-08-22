# Incident: queue auto-drain resend flood (2026-08-11)

## Symptom

- Same user text spammed as many bubbles (`你在干啥呢` wall, `怎么样了` ×N).
- Multi-session + queue caused UI freeze / high CPU.

## Root causes (do not reintroduce)

1. **Fail/catch requeue without terminal-pulse gate** → immediate re-drain loop.
2. **Delete terminal-pulse before dispatch** → fail path unblocked.
3. **`isSharedSession` used to classify non-Shared owners** → ambiguous → requeue.
4. **Full `threadStatusById` in effect deps** → every heartbeat re-runs drain (CPU storm).
5. **`MAX_BACKGROUND_QUEUE_DRAIN = 3`** → three engines fully parallel under load.
6. **hasStarted in settlement deps** → setState self-oscillation.

## Safe S1 invariants (must hold)

| Invariant | Implementation |
|---|---|
| No same-id auto resend after success | `completedQueueDispatchIdsRef` |
| No fail hot-loop | terminal-pulse gate; never delete before dispatch |
| Shared classify only for Shared owners | `ownerIsShared` only |
| Drain effect not tied to full status table | `buildQueueDrainSignal` 纯函数；effect 只依赖 signal 字符串 |
| Unrelated session heartbeat | 不得改变 signal（有单测） |
| Background concurrency | `MAX_BACKGROUND_QUEUE_DRAIN = 1` |
| Background default | `getEnableBackgroundQueueDrain()` default **true** |
| Native next-item sequencing | inFlight until processing edge or **3s** fallback (no resend) |
| Missing non-active status | tryDrain hold；signal 记 unknown=busy，idle 落地可唤醒 |

## Reopen / rollback

- Disable background only via `__setEnableBackgroundQueueDrainForTests` / future settings flag — **not** by removing anti-resend gates.
- If flood recurs: set background gate false **and** keep completed-id + pulse gates.
