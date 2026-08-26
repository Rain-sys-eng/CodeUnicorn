import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import type { HistoryLoadingProgressListener } from "../utils/historyLoadingProgress";
import { runNativeHistoryFetchAndParse } from "../utils/runNativeHistoryOpenStages";
import {
  collectPiHistoryBackgroundTasks,
  parsePiHistoryMessages,
} from "./piHistoryParser";
import { hydrateBackgroundTasksFromHistory } from "../../messages/utils/backgroundTaskStore";

type PiHistoryLoaderOptions = {
  workspaceId: string;
  workspacePath: string | null;
  loadPiSession: (workspacePath: string, sessionId: string) => Promise<unknown>;
  onProgress?: HistoryLoadingProgressListener;
};

export function createPiHistoryLoader({
  workspaceId,
  workspacePath,
  loadPiSession,
  onProgress,
}: PiHistoryLoaderOptions): HistoryLoader {
  return {
    engine: "pi",
    async load(threadId: string) {
      const sessionId = threadId.startsWith("pi:")
        ? threadId.slice("pi:".length)
        : threadId;
      if (!workspacePath) {
        return normalizeHistorySnapshot({
          engine: "pi",
          workspaceId,
          threadId,
          meta: {
            workspaceId,
            threadId,
            engine: "pi",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
          },
        });
      }

      let rawMessages: unknown = null;
      const staged = await runNativeHistoryFetchAndParse({
        report: (progress) => {
          onProgress?.(progress);
        },
        shouldContinue: () => true,
        load: () => loadPiSession(workspacePath, sessionId),
        extractMessages: (payload) => {
          rawMessages =
            ((payload ?? {}) as { messages?: unknown }).messages ?? payload;
          return rawMessages;
        },
        parse: parsePiHistoryMessages,
      });
      const items = staged?.items ?? [];
      // 1.5/pill 联动：历史合并任务回灌会话级状态表，重开会话后
      // composer 后台任务 pill 仍出现（只补缺，不动 live 记录）。
      hydrateBackgroundTasksFromHistory(
        workspaceId,
        threadId,
        collectPiHistoryBackgroundTasks(rawMessages),
      );

      return normalizeHistorySnapshot({
        engine: "pi",
        workspaceId,
        threadId,
        items,
        plan: null,
        userInputQueue: [],
        meta: {
          workspaceId,
          threadId,
          engine: "pi",
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
