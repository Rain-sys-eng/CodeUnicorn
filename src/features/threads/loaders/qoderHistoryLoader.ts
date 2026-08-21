import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import type { HistoryLoadingProgressListener } from "../utils/historyLoadingProgress";
import { runNativeHistoryFetchAndParse } from "../utils/runNativeHistoryOpenStages";
import { parseQoderHistoryMessages } from "./qoderHistoryParser";

type QoderHistoryLoaderOptions = {
  workspaceId: string;
  workspacePath: string | null;
  loadQoderSession: (workspacePath: string, sessionId: string) => Promise<unknown>;
  onProgress?: HistoryLoadingProgressListener;
};

export function createQoderHistoryLoader({
  workspaceId,
  workspacePath,
  loadQoderSession,
  onProgress,
}: QoderHistoryLoaderOptions): HistoryLoader {
  return {
    engine: "qoder",
    async load(threadId: string) {
      const sessionId = threadId.startsWith("qoder:")
        ? threadId.slice("qoder:".length)
        : threadId;
      if (!workspacePath) {
        return normalizeHistorySnapshot({
          engine: "qoder",
          workspaceId,
          threadId,
          meta: {
            workspaceId,
            threadId,
            engine: "qoder",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
          },
        });
      }

      const staged = await runNativeHistoryFetchAndParse({
        report: (progress) => {
          onProgress?.(progress);
        },
        shouldContinue: () => true,
        load: () => loadQoderSession(workspacePath, sessionId),
        extractMessages: (payload) =>
          ((payload ?? {}) as { messages?: unknown }).messages ?? payload,
        parse: parseQoderHistoryMessages,
      });
      const items = staged?.items ?? [];

      return normalizeHistorySnapshot({
        engine: "qoder",
        workspaceId,
        threadId,
        items,
        plan: null,
        userInputQueue: [],
        meta: {
          workspaceId,
          threadId,
          engine: "qoder",
          activeTurnId: null,
          isThinking: false,
          heartbeatPulse: null,
          historyRestoredAtMs: Date.now(),
          historyHasMore: false,
          historyNextCursor: null,
        },
      });
    },
  };
}
