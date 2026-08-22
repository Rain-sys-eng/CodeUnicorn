import { sharedSessionV2TurnState } from "../services/sharedSessions";

export type RecoveryOwner =
  | { kind: "attempt"; attemptId: string; bindingKey: string }
  | { kind: "binding"; bindingKey: string }
  | { kind: "clear" }
  | { kind: "ambiguous" };

const recoveryOwnerPrefetchByScope = new Map<string, Promise<RecoveryOwner>>();

export function recoveryOwnerCacheKey(
  workspaceId: string,
  threadId: string,
): string {
  return `${workspaceId}\u0000${threadId}`;
}

/**
 * 以 durable turn state 解析 recovery owner；任何不唯一的结果都 fail closed。
 * Shared StatusBar 与 queue pending-ack abandon 共用，避免从当前 UI target 推断 owner。
 */
export async function resolveSharedRecoveryOwner(
  workspaceId: string,
  threadId: string,
): Promise<RecoveryOwner> {
  const turnState = await sharedSessionV2TurnState(workspaceId, threadId);
  const inFlight = turnState.inFlightAttempts ?? [];
  if (inFlight.length > 1) {
    return { kind: "ambiguous" };
  }
  const attempt = inFlight[0];
  if (attempt) {
    const attemptId = attempt.attemptId?.trim();
    const bindingKey = attempt.bindingKey?.trim();
    return attemptId && bindingKey
      ? { kind: "attempt", attemptId, bindingKey }
      : { kind: "ambiguous" };
  }
  const recoveryBindings = (turnState.bindings ?? []).filter(
    (binding) => binding.provisioningState === "recovery-required",
  );
  if (recoveryBindings.length > 1) {
    return { kind: "ambiguous" };
  }
  const bindingKey = recoveryBindings[0]?.bindingKey?.trim();
  return bindingKey ? { kind: "binding", bindingKey } : { kind: "clear" };
}

export function prefetchRecoveryOwner(
  workspaceId: string,
  threadId: string,
  lookup: () => Promise<RecoveryOwner>,
): Promise<RecoveryOwner> {
  const key = recoveryOwnerCacheKey(workspaceId, threadId);
  const existing = recoveryOwnerPrefetchByScope.get(key);
  if (existing) {
    return existing;
  }
  const pending = lookup().catch((error: unknown) => {
    recoveryOwnerPrefetchByScope.delete(key);
    throw error;
  });
  recoveryOwnerPrefetchByScope.set(key, pending);
  return pending;
}

export async function takePrefetchedRecoveryOwner(
  workspaceId: string,
  threadId: string,
): Promise<RecoveryOwner | null> {
  const key = recoveryOwnerCacheKey(workspaceId, threadId);
  const pending = recoveryOwnerPrefetchByScope.get(key);
  if (!pending) {
    return null;
  }
  recoveryOwnerPrefetchByScope.delete(key);
  return pending;
}

export function invalidateRecoveryOwnerPrefetch(
  workspaceId: string,
  threadId: string,
): void {
  recoveryOwnerPrefetchByScope.delete(
    recoveryOwnerCacheKey(workspaceId, threadId),
  );
}

export function resetRecoveryOwnerPrefetchForTests(): void {
  recoveryOwnerPrefetchByScope.clear();
}

/** Yield one frame so the recovery click can paint before serial IPC. */
export function yieldRecoveryClickPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    queueMicrotask(resolve);
  });
}
