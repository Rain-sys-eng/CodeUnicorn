import type { TFunction } from "i18next";
import type { AccessMode, EngineType, ReviewTarget } from "../../../types";
import { primeThreadStreamLatencyContext } from "../utils/streamLatencyDiagnostics";
import {
  classifyNetworkError,
  parseFirstPacketTimeoutSeconds,
  stripBackendErrorPrefix,
} from "../utils/networkErrors";
import { classifyStaleThreadRecovery } from "../utils/stabilityDiagnostics";

export function normalizeCollaborationModeId(
  value: unknown,
): "plan" | "code" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "default") {
    return "code";
  }
  return normalized === "plan" || normalized === "code"
    ? normalized
    : null;
}

export function resolveCollaborationModeIdFromPayload(
  payload: Record<string, unknown> | null | undefined,
): "plan" | "code" | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return (
    normalizeCollaborationModeId(payload.mode) ??
    normalizeCollaborationModeId(payload.id) ??
    null
  );
}

export function normalizeAccessMode(
  mode:
    | AccessMode
    | "default"
    | "read-only"
    | "current"
    | "full-access"
    | undefined,
  engine: EngineType,
): "default" | "read-only" | "current" | "full-access" | undefined {
  if (mode === undefined) {
    return undefined;
  }
  if (mode === "default") {
    // Codex does not expose a dedicated "default" policy, so we keep legacy behavior there.
    return engine === "codex" ? "current" : "default";
  }
  return mode;
}

export function isUnknownEngineInterruptTurnMethodError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : (() => {
          try {
            return JSON.stringify(error);
          } catch {
            return String(error);
          }
        })();
  return message.toLowerCase().includes("unknown method: engine_interrupt_turn");
}

export function isLikelyForeignModelForGemini(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  // Allow custom Gemini aliases like "[L]gemini-3-pro-preview" even if they
  // are wrapped by proxy-specific prefixes.
  if (normalized.includes("gemini")) {
    return false;
  }
  if (normalized.startsWith("claude-")) {
    return true;
  }
  if (normalized.startsWith("gpt-") || normalized.includes("codex")) {
    return true;
  }
  return (
    normalized.startsWith("openai/")
    || normalized.startsWith("anthropic/")
    || normalized.startsWith("x-ai/")
    || normalized.startsWith("openrouter/")
    || normalized.startsWith("deepseek/")
    || normalized.startsWith("qwen/")
    || normalized.startsWith("meta/")
    || normalized.startsWith("mistral/")
  );
}

export function buildReviewCommandText(target: ReviewTarget): string {
  if (target.type === "uncommittedChanges") {
    return "/review";
  }
  if (target.type === "baseBranch") {
    return `/review base ${target.branch}`.trim();
  }
  if (target.type === "commit") {
    const title = target.title?.trim();
    return title
      ? `/review commit ${target.sha} ${title}`.trim()
      : `/review commit ${target.sha}`.trim();
  }
  return `/review custom ${target.instructions}`.trim();
}

export function isInvalidReviewThreadIdError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("invalid thread id")
    || normalized.includes("expected an optional prefix of `urn:uuid:`")
    || normalized.includes('expected an optional prefix of "urn:uuid:"')
  );
}

export function isCodexMissingThreadBindingError(message: string): boolean {
  const classification = classifyStaleThreadRecovery(message);
  return classification?.reasonCode === "stale-thread-binding";
}

export function isRecoverableCodexThreadBindingError(message: string): boolean {
  const classification = classifyStaleThreadRecovery(message);
  return (
    isInvalidReviewThreadIdError(message) ||
    classification?.reasonCode === "stale-thread-binding"
  );
}

export function mapNetworkErrorToUserMessage(
  rawMessage: string,
  t: TFunction,
): { message: string; isNetwork: boolean } {
  const timeoutSeconds = parseFirstPacketTimeoutSeconds(rawMessage);
  if (timeoutSeconds) {
    return {
      message: t("threads.firstPacketTimeout", { seconds: timeoutSeconds }),
      isNetwork: true,
    };
  }

  const networkKind = classifyNetworkError(rawMessage);
  if (networkKind) {
    if (networkKind === "timeout") {
      return {
        message: t("threads.requestTimeoutHint"),
        isNetwork: true,
      };
    }
    return {
      message:
        networkKind === "proxy"
          ? t("threads.networkProxyHint")
          : t("threads.networkConnectionHint"),
      isNetwork: true,
    };
  }

  return {
    message: stripBackendErrorPrefix(rawMessage),
    isNetwork: false,
  };
}

export function primeThreadStreamLatencyForSend(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
  model?: string | null,
) {
  void primeThreadStreamLatencyContext({
    workspaceId,
    threadId,
    engine,
    model: model ?? null,
  });
}

function normalizeSessionIdCandidate(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized && normalized !== "pending" ? normalized : null;
  }
  if (typeof value === "number") {
    const normalized = String(value).trim();
    return normalized && normalized !== "pending" ? normalized : null;
  }
  return null;
}

export function extractSessionIdFromEngineSendResponse(
  response: Record<string, unknown>,
): string | null {
  const result =
    response.result && typeof response.result === "object"
      ? (response.result as Record<string, unknown>)
      : null;
  const thread =
    result?.thread && typeof result.thread === "object"
      ? (result.thread as Record<string, unknown>)
      : null;
  const candidates = [
    response.sessionId,
    response.session_id,
    result?.sessionId,
    result?.session_id,
    thread?.sessionId,
    thread?.session_id,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSessionIdCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

type NativePendingEngine = "claude" | "gemini" | "grok" | "kimi" | "opencode" | "dsh" | "qoder";

export function resolveNativeSessionIdForSend(input: {
  engine: EngineType;
  threadId: string;
  pendingSessionByEngine: Partial<Record<NativePendingEngine, string | null | undefined>>;
}): string | null {
  const { engine, threadId, pendingSessionByEngine } = input;
  const prefix = `${engine}:`;
  const pendingPrefix = `${engine}-pending-`;
  if (threadId.startsWith(prefix)) {
    return threadId.slice(prefix.length);
  }
  if (threadId.startsWith(pendingPrefix)) {
    // Claude pending stays unbound until native confirmation; the send
    // path blocks separately instead of guessing a session id.
    if (engine === "claude") {
      return null;
    }
    return pendingSessionByEngine[engine as NativePendingEngine] ?? null;
  }
  return null;
}

/** mossx managed catalog prefix. DSH host has no adapter for this provider. */
const DSH_RESERVED_MOSSX_PROVIDERS = new Set(["ccgui"]);

export function isReservedMossxDshProvider(provider: string): boolean {
  return DSH_RESERVED_MOSSX_PROVIDERS.has(provider.trim().toLowerCase());
}

/**
 * Parse a DSH catalog id `provider/model`. First slash is the provider
 * boundary so model ids such as `ovh/Qwen2.5` stay intact.
 */
export function splitDshCatalogSelection(
  catalogOrModel: string | null | undefined,
): { provider: string; model: string } | null {
  const trimmed = catalogOrModel?.trim() || "";
  if (!trimmed) {
    return null;
  }
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return null;
  }
  const provider = trimmed.slice(0, slashIndex).trim();
  const model = trimmed.slice(slashIndex + 1).trim();
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

export function isTrustedDshCatalogId(
  catalogOrModel: string | null | undefined,
): boolean {
  const split = splitDshCatalogSelection(catalogOrModel);
  if (!split) {
    return false;
  }
  return !isReservedMossxDshProvider(split.provider);
}

export function resolveDshModelForSend(input: {
  catalogId?: string | null;
  runtimeModel?: string | null;
  fallbackCatalogId?: string | null;
}): string | null {
  for (const candidate of [
    input.catalogId,
    input.runtimeModel,
    input.fallbackCatalogId,
  ]) {
    const trimmed = candidate?.trim() || "";
    if (isTrustedDshCatalogId(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Global `composerEnginePrefs.dsh.modelId` is engine-wide, not thread-local.
 * Only first-send pending threads may fall back to it. An existing `dsh:`
 * session must omit the model so `selectModel` does not retarget another
 * thread's last DSH pick.
 */
export function resolveDshSendFallbackCatalogId(
  threadId: string,
  prefCatalogId?: string | null,
): string | null {
  if (!threadId.startsWith("dsh-pending-")) {
    return null;
  }
  const trimmed = prefCatalogId?.trim() || "";
  return trimmed || null;
}

type GeminiSessionSummary = {
  sessionId: string;
  updatedAt: number;
};

function normalizeGeminiSessionSummary(value: unknown): GeminiSessionSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sessionId = normalizeSessionIdCandidate(record.sessionId ?? record.session_id);
  if (!sessionId) {
    return null;
  }
  const rawUpdatedAt = record.updatedAt ?? record.updated_at;
  const updatedAt =
    typeof rawUpdatedAt === "number" && Number.isFinite(rawUpdatedAt)
      ? rawUpdatedAt
      : typeof rawUpdatedAt === "string"
        ? Number(rawUpdatedAt)
        : 0;
  return {
    sessionId,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

export function pickLikelyGeminiSessionId(
  payload: unknown,
  minUpdatedAt: number,
): string | null {
  const nestedSessions =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).sessions
      : null;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(nestedSessions)
      ? nestedSessions
      : [];
  const summaries = entries
    .map(normalizeGeminiSessionSummary)
    .filter((entry): entry is GeminiSessionSummary => entry !== null);
  if (summaries.length === 0) {
    return null;
  }
  const recents = summaries.filter((entry) => entry.updatedAt >= minUpdatedAt);
  // Safety first: only bind when there is exactly one plausible candidate.
  // This prevents cross-thread session hijack when multiple pending Gemini
  // conversations update around the same time in the same workspace.
  if (recents.length === 1) {
    return recents[0]?.sessionId ?? null;
  }
  if (recents.length > 1) {
    return null;
  }
  if (summaries.length === 1) {
    return summaries[0]?.sessionId ?? null;
  }
  return null;
}

export function pickLikelyKimiSessionId(
  payload: unknown,
  minUpdatedAt: number,
): string | null {
  // Kimi session summaries share the Gemini summary shape, so the same
  // single-candidate safety rule applies.
  return pickLikelyGeminiSessionId(payload, minUpdatedAt);
}

export function pickLikelyPiSessionId(
  payload: unknown,
  minUpdatedAt: number,
): string | null {
  return pickLikelyGeminiSessionId(payload, minUpdatedAt);
}

export function pickLikelyQoderSessionId(
  payload: unknown,
  minUpdatedAt: number,
): string | null {
  return pickLikelyGeminiSessionId(payload, minUpdatedAt);
}

export function collectOccupiedGrokSessionIds(input: {
  itemsByThread: Record<string, readonly unknown[] | undefined>;
  pendingSessionIdByThread: ReadonlyMap<string, string>;
  currentThreadId: string;
}): {
  occupiedSessionIds: Set<string>;
  hasOtherPendingWithItems: boolean;
} {
  const occupiedSessionIds = new Set<string>();
  let hasOtherPendingWithItems = false;

  for (const [threadId, items] of Object.entries(input.itemsByThread)) {
    if (threadId === input.currentThreadId) {
      continue;
    }
    if (threadId.startsWith("grok:")) {
      const sessionId = threadId.slice("grok:".length).trim();
      if (sessionId) {
        occupiedSessionIds.add(sessionId);
      }
    }
    if (
      threadId.startsWith("grok-pending-") &&
      Array.isArray(items) &&
      items.length > 0
    ) {
      hasOtherPendingWithItems = true;
    }
  }

  for (const [threadId, sessionId] of input.pendingSessionIdByThread) {
    if (threadId === input.currentThreadId) {
      continue;
    }
    const normalized = sessionId.trim();
    if (normalized) {
      occupiedSessionIds.add(normalized);
    }
  }

  return { occupiedSessionIds, hasOtherPendingWithItems };
}

function filterUnoccupiedGrokSessionPayload(
  payload: unknown,
  occupiedSessionIds: ReadonlySet<string>,
): unknown {
  const nestedSessions =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).sessions
      : null;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(nestedSessions)
      ? nestedSessions
      : [];
  return entries.filter((entry) => {
    const summary = normalizeGeminiSessionSummary(entry);
    return summary !== null && !occupiedSessionIds.has(summary.sessionId);
  });
}

export function pickLikelyGrokSessionId(
  payload: unknown,
  minUpdatedAt: number,
  occupiedSessionIds?: ReadonlySet<string>,
): string | null {
  // Grok session summaries share the Gemini summary shape, so the same
  // single-candidate safety rule applies. Occupied ids belong to another
  // mossx thread and must not be rebound onto a fresh pending tab.
  const filteredPayload =
    occupiedSessionIds && occupiedSessionIds.size > 0
      ? filterUnoccupiedGrokSessionPayload(payload, occupiedSessionIds)
      : payload;
  return pickLikelyGeminiSessionId(filteredPayload, minUpdatedAt);
}

export function resolveRecoverableCodexFirstPacketTimeout(
  engine: EngineType,
  rawMessage: string,
): number | null {
  if (engine !== "codex") {
    return null;
  }
  return parseFirstPacketTimeoutSeconds(rawMessage);
}
