import type {
  RuntimeModelReceipt,
  RuntimeModelReceiptSource,
} from "../../../types";
import { sanitizeRuntimeReceiptModel } from "../../../utils/turnBadge";

type PendingReceipt = RuntimeModelReceipt;

const receipts = new Map<string, PendingReceipt>();

const SOURCE_RANK: Record<RuntimeModelReceiptSource, number> = {
  "send.request": 1,
  "turn.completed": 2,
  "system.init.model": 3,
  "assistant.message.model": 4,
};

const WINDOW_SOURCE_RANK: Record<
  NonNullable<RuntimeModelReceipt["contextWindowSource"]>,
  number
> = {
  unknown: 1,
  init: 2,
  live: 3,
};

function keyOf(workspaceId: string, threadId: string): string {
  return workspaceId + "" + threadId;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function extractRuntimeModelFromPayload(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) {
    return null;
  }
  const nestedMessage = asRecord(payload.message);
  const nestedResult = asRecord(payload.result);
  const nestedData = asRecord(payload.data);
  return sanitizeRuntimeReceiptModel(
    (typeof payload.model === "string" && payload.model) ||
      (typeof nestedMessage?.model === "string" && nestedMessage.model) ||
      (typeof nestedResult?.model === "string" && nestedResult.model) ||
      (typeof nestedData?.model === "string" && nestedData.model) ||
      null,
  );
}

function preferredSource(
  existing: RuntimeModelReceiptSource | undefined,
  incoming: RuntimeModelReceiptSource | undefined,
): RuntimeModelReceiptSource {
  const left = existing ?? "send.request";
  const right = incoming ?? left;
  return SOURCE_RANK[right] >= SOURCE_RANK[left] ? right : left;
}

export function mergeRuntimeReceipt(
  existing: RuntimeModelReceipt | null | undefined,
  incoming: Partial<RuntimeModelReceipt> & { model?: string | null },
): RuntimeModelReceipt | null {
  const incomingModel = sanitizeRuntimeReceiptModel(incoming.model);
  const existingModel = sanitizeRuntimeReceiptModel(existing?.model);
  const incomingRank = incoming.modelSource
    ? SOURCE_RANK[incoming.modelSource]
    : 0;
  const existingRank = existing?.modelSource
    ? SOURCE_RANK[existing.modelSource]
    : 0;
  const model =
    incomingModel && incomingRank >= existingRank
      ? incomingModel
      : incomingModel && !existingModel
        ? incomingModel
        : existingModel;
  const incomingWindow =
    typeof incoming.contextWindowTokens === "number" &&
    Number.isFinite(incoming.contextWindowTokens) &&
    incoming.contextWindowTokens > 0
      ? incoming.contextWindowTokens
      : null;
  const incomingWindowSource =
    incoming.contextWindowSource ??
    (incomingWindow != null ? "unknown" : null);
  const existingWindow = existing?.contextWindowTokens ?? null;
  const existingWindowSource = existing?.contextWindowSource ?? null;
  const incomingWindowRank = incomingWindowSource
    ? WINDOW_SOURCE_RANK[incomingWindowSource]
    : 0;
  const existingWindowRank = existingWindowSource
    ? WINDOW_SOURCE_RANK[existingWindowSource]
    : 0;
  const takeIncomingWindow =
    incomingWindow != null &&
    (existingWindow == null || incomingWindowRank >= existingWindowRank);
  const contextWindowTokens = takeIncomingWindow
    ? incomingWindow
    : existingWindow;
  const contextWindowSource = takeIncomingWindow
    ? incomingWindowSource
    : existingWindowSource;
  if (!model && contextWindowTokens == null) {
    return existing ?? null;
  }
  if (!model) {
    return {
      model: existing?.model ?? "",
      modelSource: existing?.modelSource ?? "send.request",
      contextWindowTokens,
      contextWindowSource,
    };
  }
  const next: RuntimeModelReceipt = {
    model,
    modelSource: preferredSource(existing?.modelSource, incoming.modelSource),
    contextWindowTokens,
    contextWindowSource,
  };
  if (
    existing &&
    existing.model === next.model &&
    existing.modelSource === next.modelSource &&
    existing.contextWindowTokens === next.contextWindowTokens &&
    existing.contextWindowSource === next.contextWindowSource
  ) {
    return existing;
  }
  return next;
}

export function rememberRuntimeReceipt(
  workspaceId: string,
  threadId: string,
  incoming: Partial<RuntimeModelReceipt> & { model?: string | null },
): RuntimeModelReceipt | null {
  if (!workspaceId || !threadId) {
    return null;
  }
  const key = keyOf(workspaceId, threadId);
  // send.request starts a new turn: do not keep the previous runtime id/window.
  const existing =
    incoming.modelSource === "send.request" ? null : receipts.get(key) ?? null;
  const next = mergeRuntimeReceipt(existing, incoming);
  if (!next) {
    if (incoming.modelSource === "send.request") {
      receipts.delete(key);
    }
    return null;
  }
  receipts.set(key, next);
  return next.model ? next : null;
}

export function getRuntimeReceipt(
  workspaceId: string,
  threadId: string,
): RuntimeModelReceipt | null {
  if (!workspaceId || !threadId) {
    return null;
  }
  const receipt = receipts.get(keyOf(workspaceId, threadId)) ?? null;
  return receipt?.model ? receipt : null;
}

export function renameRuntimeReceipt(
  workspaceId: string,
  oldThreadId: string,
  newThreadId: string,
): void {
  if (!workspaceId || !oldThreadId || !newThreadId || oldThreadId === newThreadId) {
    return;
  }
  const current = receipts.get(keyOf(workspaceId, oldThreadId));
  if (!current) {
    return;
  }
  receipts.delete(keyOf(workspaceId, oldThreadId));
  const existing = receipts.get(keyOf(workspaceId, newThreadId));
  const merged = mergeRuntimeReceipt(existing, current);
  if (merged) {
    receipts.set(keyOf(workspaceId, newThreadId), merged);
  }
}

export function resetRuntimeReceiptsForTests(): void {
  receipts.clear();
}
