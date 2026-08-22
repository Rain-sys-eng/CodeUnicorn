import type { ThreadSummary } from "../../../types";
import type {
  PendingAssistantCompletion,
  PendingMemoryCapture,
} from "./threadMemoryCaptureHelpers";
import {
  workspaceScopedDelete,
  workspaceScopedGet,
  workspaceScopedSet,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";

const THREAD_ITEM_CACHE_DEFAULT_MAX = 12;
export const THREAD_ITEM_CACHE_TRIM_WATERMARK = 2;

export type CodexOwnershipFallbackCandidateInput = {
  id: string;
  engineSource?: ThreadSummary["engineSource"] | null;
  selectedEngine?: ThreadSummary["selectedEngine"] | null;
  threadKind?: ThreadSummary["threadKind"] | null;
};

export type PendingMemoryCaptureBucket = Record<string, PendingMemoryCapture>;
export type PendingAssistantCompletionBucket = Record<
  string,
  PendingAssistantCompletion
>;

export function isCodexOwnershipFallbackCandidate(
  thread: CodexOwnershipFallbackCandidateInput,
): boolean {
  const explicitEngine = thread.engineSource ?? thread.selectedEngine;
  if (explicitEngine) {
    return explicitEngine === "codex";
  }
  const normalizedId = thread.id.trim().toLowerCase();
  if (normalizedId.startsWith("shared:")) {
    return false;
  }
  return !(
    normalizedId.startsWith("claude:") ||
    normalizedId.startsWith("claude-pending-") ||
    normalizedId.startsWith("gemini:") ||
    normalizedId.startsWith("gemini-pending-") ||
    normalizedId.startsWith("grok:") ||
    normalizedId.startsWith("grok-pending-") ||
    normalizedId.startsWith("kimi:") ||
    normalizedId.startsWith("kimi-pending-") ||
    normalizedId.startsWith("pi:") ||
    normalizedId.startsWith("pi-pending-") ||
    normalizedId.startsWith("qoder:") ||
    normalizedId.startsWith("qoder-pending-") ||
    normalizedId.startsWith("opencode:") ||
    normalizedId.startsWith("opencode-pending-") ||
    normalizedId.startsWith("dsh:") ||
    normalizedId.startsWith("dsh-pending-")
  );
}

// chat-stream-render-isolation-2026-06 task 5: LRU adaptive. When
// multiple threads stream in parallel we want the cache to grow so
// the reducer hot path does not thrash evicted thread items back into
// state. The formula is intentionally simple: in-flight count plus
// a baseline headroom. When no thread is processing, the formula
// returns the original `THREAD_ITEM_CACHE_DEFAULT_MAX` (backward-compat
// with the prior 12-entry budget).
export function computeThreadItemCacheMax(inFlightCount: number): number {
  if (!Number.isFinite(inFlightCount) || inFlightCount <= 0) {
    return THREAD_ITEM_CACHE_DEFAULT_MAX;
  }
  return Math.max(THREAD_ITEM_CACHE_DEFAULT_MAX, inFlightCount * 2 + 6);
}

export function getPendingMemoryEntries<T extends { threadId: string }>(
  store: WorkspaceScopedMap<Record<string, T>>,
  workspaceId: string | null | undefined,
  threadIds: readonly string[],
) {
  return threadIds.flatMap((threadId) => {
    const bucket = workspaceScopedGet(store, workspaceId, threadId);
    if (!bucket) {
      return [];
    }
    return Object.entries(bucket).map(([key, entry]) => ({ key, threadId, entry }));
  });
}

export function setPendingMemoryEntry<T>(
  store: WorkspaceScopedMap<Record<string, T>>,
  workspaceId: string | null | undefined,
  threadId: string,
  key: string,
  entry: T,
) {
  const bucket = {
    ...(workspaceScopedGet(store, workspaceId, threadId) ?? {}),
    [key]: entry,
  };
  workspaceScopedSet(store, workspaceId, threadId, bucket);
}

export function deletePendingMemoryEntry<T>(
  store: WorkspaceScopedMap<Record<string, T>>,
  workspaceId: string | null | undefined,
  threadId: string,
  key: string,
) {
  const bucket = workspaceScopedGet(store, workspaceId, threadId);
  if (!bucket || !(key in bucket)) {
    return;
  }
  const nextBucket = { ...bucket };
  delete nextBucket[key];
  if (Object.keys(nextBucket).length === 0) {
    workspaceScopedDelete(store, workspaceId, threadId);
    return;
  }
  workspaceScopedSet(store, workspaceId, threadId, nextBucket);
}

export function shouldKeepPendingCaptureForAdditionalAssistantSegments(
  pending: Pick<PendingMemoryCapture, "engine" | "threadId">,
) {
  return pending.engine === "codex" || !pending.threadId.includes(":");
}
