import type {
  MessageSendOptions,
  QueuedMessage,
  SharedQueuedExecutionTarget,
} from "../../../types";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import {
  isResolvedExecutionTarget,
  normalizePersistedExecutionTarget,
} from "../../shared-session/target/types";

const STORE_NAME = "composer";
const STORE_KEY = "sharedQueuedFollowUps.v1";

function queueKey(workspaceId: string, threadId: string): string {
  return JSON.stringify([workspaceId, threadId]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneFrozenTarget(value: unknown): SharedQueuedExecutionTarget | null {
  const normalized = normalizePersistedExecutionTarget(value);
  if (!isResolvedExecutionTarget(normalized)) {
    return null;
  }
  return {
    engine: normalized.engine,
    providerProfileId: normalized.providerProfileId?.trim() || null,
    modelCatalogEntryId: normalized.modelCatalogEntryId,
    model: normalized.model,
    reasoning: normalized.reasoning
      ? { effort: normalized.reasoning.effort }
      : null,
    providerProfileNameSnapshot: normalized.providerProfileNameSnapshot,
    providerProfileSource: normalized.providerProfileSource,
  };
}

function normalizeSendOptions(value: unknown): MessageSendOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  try {
    const cloned = structuredClone(value) as Record<string, unknown>;
    // frozen Target 由 queue envelope 单独校验，不能从 options 旁路恢复。
    delete cloned.sharedExecutionTarget;
    return cloned as MessageSendOptions;
  } catch {
    return undefined;
  }
}

function normalizeOwnerId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function normalizeQueuedMessage(value: unknown): QueuedMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const text = typeof value.text === "string" ? value.text : "";
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? value.createdAt
      : 0;
  const sharedExecutionTarget = cloneFrozenTarget(value.sharedExecutionTarget);
  if (!id || !text.trim() || createdAt <= 0 || !sharedExecutionTarget) {
    return null;
  }
  const images = Array.isArray(value.images)
    ? value.images.filter(
        (image): image is string =>
          typeof image === "string" && image.trim().length > 0,
      )
    : [];
  const sharedPredecessorAttemptId =
    typeof value.sharedPredecessorAttemptId === "string"
      ? value.sharedPredecessorAttemptId.trim() || null
      : null;
  return {
    id,
    text,
    createdAt,
    images: images.length > 0 ? images : undefined,
    sendOptions: normalizeSendOptions(value.sendOptions),
    sharedExecutionTarget,
    sharedPredecessorAttemptId,
    ownerWorkspaceId: normalizeOwnerId(value.ownerWorkspaceId),
    ownerThreadId: normalizeOwnerId(value.ownerThreadId),
    sharedDispatchState:
      value.sharedDispatchState === "pending-ack" ? "pending-ack" : undefined,
  };
}

function readEnvelope(): Record<string, unknown> {
  const stored = getClientStoreSync<unknown>(STORE_NAME, STORE_KEY);
  return isRecord(stored) ? stored : {};
}

export function readSharedQueuedFollowUps(
  workspaceId: string,
  threadId: string,
): QueuedMessage[] {
  const storedQueue = readEnvelope()[queueKey(workspaceId, threadId)];
  if (!Array.isArray(storedQueue)) {
    return [];
  }
  return storedQueue
    .map(normalizeQueuedMessage)
    .filter((item): item is QueuedMessage => item !== null);
}

export function writeSharedQueuedFollowUps(
  workspaceId: string,
  threadId: string,
  queue: QueuedMessage[],
): void {
  const key = queueKey(workspaceId, threadId);
  const envelope = { ...readEnvelope() };
  if (queue.length === 0) {
    delete envelope[key];
  } else {
    envelope[key] = queue;
  }
  writeClientStoreValue(STORE_NAME, STORE_KEY, envelope, {
    immediate: true,
  });
}
