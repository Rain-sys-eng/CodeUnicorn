import { seedDshComposerSelectionFromHost } from "../../../app-shell-parts/selectedComposerSession";
import type { ThreadTokenUsage } from "../../../types";
import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import { isTrustedDshCatalogId } from "../hooks/threadMessagingHelpers";
import {
  asNumber,
  asString,
  normalizeDshSessionStats,
  normalizeDshTodos,
} from "../utils/threadNormalize";
import type { HistoryLoadingProgressListener } from "../utils/historyLoadingProgress";
import { runNativeHistoryFetchAndParse } from "../utils/runNativeHistoryOpenStages";
import { subscribeMappedDshHistoryLoadProgress } from "../utils/subscribeMappedDshHistoryLoadProgress";
import { parseDshHistoryMessages } from "./dshHistoryParser";

export const DSH_UI_HISTORY_WINDOW = 200;

type DshHistoryLoadOptions = { limit?: number | null; before?: string | null };

type DshHistoryLoaderOptions = {
  workspaceId: string;
  workspacePath: string | null;
  loadDshSession: (
    workspacePath: string,
    sessionId: string,
    options?: DshHistoryLoadOptions,
  ) => Promise<unknown>;
  onProgress?: HistoryLoadingProgressListener;
};

export function createDshHistoryLoader({
  workspaceId,
  workspacePath,
  loadDshSession,
  onProgress,
}: DshHistoryLoaderOptions): HistoryLoader {
  return {
    engine: "dsh",
    async load(threadId: string) {
      const sessionId = threadId.startsWith("dsh:")
        ? threadId.slice("dsh:".length)
        : threadId;
      if (!workspacePath) {
        return normalizeHistorySnapshot({
          engine: "dsh",
          workspaceId,
          threadId,
          meta: {
            workspaceId,
            threadId,
            engine: "dsh",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
          },
        });
      }

      const report: HistoryLoadingProgressListener = (progress) => {
        onProgress?.(progress);
      };
      const stopPageProgress = subscribeMappedDshHistoryLoadProgress({
        threadId,
        hostSessionId: sessionId,
        onProgress: report,
      });
      try {
        const staged = await runNativeHistoryFetchAndParse({
          report,
          shouldContinue: () => true,
          load: () =>
            loadDshSession(workspacePath, sessionId, {
              limit: DSH_UI_HISTORY_WINDOW,
            }),
          extractMessages: (payload) =>
            (payload as { messages?: unknown } | null)?.messages ?? payload,
          parse: parseDshHistoryMessages,
        });
        const result = staged?.result ?? null;
        const items = staged?.items ?? [];
        const record = (result ?? {}) as {
          hasMore?: boolean;
          nextCursor?: string | null;
        };
        const currentModel = extractDshHistoryCurrentModel(result);
        if (currentModel) {
          seedDshComposerSelectionFromHost({
            workspaceId,
            threadId,
            catalogId: currentModel.catalogId,
            effort: currentModel.effort,
          });
        }
        return normalizeHistorySnapshot({
          engine: "dsh",
          workspaceId,
          threadId,
          items,
          plan: null,
          userInputQueue: [],
          tokenUsage: extractDshHistoryTokenUsage(result),
          meta: {
            workspaceId,
            threadId,
            engine: "dsh",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
            historyHasMore: record.hasMore === true,
            historyNextCursor: record.nextCursor ?? null,
          },
        });
      } finally {
        stopPageProgress();
      }
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function extractDshHistoryCurrentModel(
  result: unknown,
): { catalogId: string; effort: string | null } | null {
  const record = asRecord(result);
  const current = asRecord(record?.currentModel ?? record?.current_model);
  if (!current) {
    return null;
  }
  const provider = asString(current.provider).trim();
  const model = asString(current.model).trim();
  if (!provider || !model) {
    return null;
  }
  const catalogId = `${provider}/${model}`;
  if (!isTrustedDshCatalogId(catalogId)) {
    return null;
  }
  const effort = asString(
    current.reasoningEffort ?? current.reasoning_effort,
  ).trim();
  return {
    catalogId,
    effort: effort || null,
  };
}

export function extractDshHistoryTodos(result: unknown): ThreadTokenUsage["dshTodos"] | undefined {
  const record = asRecord(result);
  if (!record || !Object.prototype.hasOwnProperty.call(record, "todos")) {
    return undefined;
  }
  return normalizeDshTodos(record.todos) ?? [];
}

export function extractDshHistoryTokenUsage(result: unknown): ThreadTokenUsage | null {
  const record = asRecord(result);
  const usage = asRecord(record?.usage);
  const historyTodos = extractDshHistoryTodos(result);
  if (!usage && historyTodos === undefined) {
    return null;
  }
  const inputTokens = asNumber(usage?.inputTokens ?? usage?.input_tokens);
  const outputTokens = asNumber(usage?.outputTokens ?? usage?.output_tokens);
  const cachedInputTokens = asNumber(
    usage?.cacheReadInputTokens ?? usage?.cache_read_input_tokens,
  );
  const cacheWriteTokens = asNumber(
    usage?.cacheWriteInputTokens ?? usage?.cache_write_input_tokens,
  );
  const sessionStats = normalizeDshSessionStats(
    usage?.sessionStats ?? usage?.session_stats,
  );
  const contextUsedTokens = asNumber(
    usage?.contextUsedTokens ?? usage?.context_used_tokens,
  );
  const modelContextWindow = asNumber(
    usage?.modelContextWindow ?? usage?.model_context_window,
  );
  const contextUsedPercentRaw = usage
    ? Number(usage.contextUsedPercent ?? usage.context_used_percent)
    : Number.NaN;
  const contextUsedPercent = Number.isFinite(contextUsedPercentRaw)
    ? contextUsedPercentRaw
    : modelContextWindow > 0 && contextUsedTokens > 0
      ? (contextUsedTokens / modelContextWindow) * 100
      : null;
  const categoryUsages = Array.isArray(usage?.contextCategoryUsages)
    ? (usage?.contextCategoryUsages as Array<Record<string, unknown>>)
        .map((row) => {
          const name = typeof row.name === "string" ? row.name : "";
          const tokens = asNumber(row.tokens);
          return name ? { name, tokens } : null;
        })
        .filter((row): row is { name: string; tokens: number } => row !== null)
    : null;
  if (
    inputTokens <= 0 &&
    outputTokens <= 0 &&
    cachedInputTokens <= 0 &&
    cacheWriteTokens <= 0 &&
    !sessionStats &&
    contextUsedTokens <= 0 &&
    modelContextWindow <= 0 &&
    !categoryUsages &&
    historyTodos === undefined
  ) {
    return null;
  }
  const breakdown = {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningOutputTokens: 0,
  };
  const hasOccupancy = contextUsedTokens > 0 || modelContextWindow > 0 || Boolean(categoryUsages);
  return {
    total: breakdown,
    last: breakdown,
    modelContextWindow: modelContextWindow > 0 ? modelContextWindow : null,
    contextUsedTokens: contextUsedTokens > 0 ? contextUsedTokens : null,
    contextUsedPercent,
    contextRemainingPercent:
      contextUsedPercent !== null ? Math.max(100 - contextUsedPercent, 0) : null,
    contextCategoryUsages: categoryUsages,
    contextUsageSource: hasOccupancy ? "dsh-context-pressure" : "dsh_history",
    contextUsageFreshness: "restored",
    sessionStats,
    cacheWriteInputTokens: cacheWriteTokens > 0 ? cacheWriteTokens : null,
    ...(historyTodos !== undefined ? { dshTodos: historyTodos } : {}),
  };
}
