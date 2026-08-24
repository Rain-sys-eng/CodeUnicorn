import type { Dispatch, MutableRefObject } from "react";

import type { DebugEntry, ThreadSummary } from "../../../types";
import {
  archiveThread as archiveThreadService,
  deleteWorkspaceSessions as deleteWorkspaceSessionsService,
  renameThreadTitleKey as renameThreadTitleKeyService,
  setThreadTitle as setThreadTitleService,
  tombstoneSessionIndexRows,
} from "../../../services/tauri";
import { asNumber, asString } from "../utils/threadNormalize";
import { pickStableCreatedAt } from "../utils/threadSummarySort";
import {
  deleteSharedSession as deleteSharedSessionService,
  startSharedSession as startSharedSessionService,
} from "../../shared-session/services/sharedSessions";
import { hydrateSharedTargetState } from "../../shared-session/target/targetStore";
import {
  isResolvedExecutionTarget,
  resolveBackendAuthoritativeExecutionTarget,
  type ExecutionTarget,
} from "../../shared-session/target/types";
import type { SharedSessionSupportedEngine } from "../../shared-session/utils/sharedSessionEngines";

import {
  isGhostClientSessionIndexDeleteError,
  sessionIndexIdsForThreadTombstone,
} from "../utils/threadDelete";

import type { ThreadAction } from "./useThreadsReducer";

type ExtractThreadId = (
  response: Record<string, unknown> | null | undefined,
) => string;

type OnDebug = (entry: DebugEntry) => void;

export function createStartSharedSessionForWorkspace(params: {
  dispatch: Dispatch<ThreadAction>;
  extractThreadId: ExtractThreadId;
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  onDebug?: OnDebug;
  threadsByWorkspace: Record<string, ThreadSummary[] | undefined>;
}) {
  const {
    dispatch,
    extractThreadId,
    loadedThreadsRef,
    onDebug,
    threadsByWorkspace,
  } = params;

  return async (
    workspaceId: string,
    options?: {
      activate?: boolean;
      initialEngine?: SharedSessionSupportedEngine;
      initialTarget?: ExecutionTarget | null;
    },
  ) => {
    const shouldActivate = options?.activate !== false;
    const initialTarget = options?.initialTarget ?? null;
    if (!isResolvedExecutionTarget(initialTarget)) {
      throw new Error(
        "Shared Session 初始 Execution Target 不完整，请重新选择 Provider 和 Model。",
      );
    }
    const requestedInitialEngine = options?.initialEngine ?? initialTarget.engine;
    if (requestedInitialEngine !== initialTarget.engine) {
      throw new Error(
        `Shared Session 初始 Engine 与 Execution Target 不一致：${requestedInitialEngine} != ${initialTarget.engine}`,
      );
    }
    const initialEngine = initialTarget.engine;
    onDebug?.({
      id: `${Date.now()}-client-shared-thread-start`,
      timestamp: Date.now(),
      source: "client",
      label: "shared-session/start",
      payload: { workspaceId, initialEngine, initialTarget },
    });
    const response = await startSharedSessionService(workspaceId, initialTarget);
    const threadId = extractThreadId(response);
    if (!threadId) {
      return null;
    }
    const result =
      response?.result && typeof response.result === "object"
        ? (response.result as Record<string, unknown>)
        : response;
    const thread =
      result?.thread && typeof result.thread === "object"
        ? (result.thread as Record<string, unknown>)
        : null;
    const persistedInitialTarget = resolveBackendAuthoritativeExecutionTarget(
      response,
      initialTarget,
    );
    hydrateSharedTargetState(
      workspaceId,
      threadId,
      persistedInitialTarget,
    );
    const now = Date.now();
    const createdAt =
      pickStableCreatedAt(
        asNumber(thread?.createdAt ?? thread?.created_at),
        now,
      ) ?? now;
    const summary: ThreadSummary = {
      id: threadId,
      name: asString(thread?.name).trim() || "Shared Session",
      createdAt,
      updatedAt: asNumber(thread?.updatedAt ?? thread?.updated_at) || now,
      engineSource: initialEngine,
      threadKind: "shared",
      selectedEngine: initialEngine,
      nativeThreadIds: [],
    };
    dispatch({
      type: "setThreads",
      workspaceId,
      threads: [summary, ...(threadsByWorkspace[workspaceId] ?? [])],
    });
    if (shouldActivate) {
      dispatch({ type: "setActiveThreadId", workspaceId, threadId });
    }
    loadedThreadsRef.current[threadId] = true;
    return threadId;
  };
}

export function createArchiveThreadAction(params: { onDebug?: OnDebug }) {
  const { onDebug } = params;

  return async (workspaceId: string, threadId: string) => {
    try {
      await archiveThreadService(workspaceId, threadId);
    } catch (error) {
      onDebug?.({
        id: `${Date.now()}-client-thread-archive-error`,
        timestamp: Date.now(),
        source: "error",
        label: "thread/archive error",
        payload: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

export function createDeleteThreadForWorkspaceAction(params: {
  threadsByWorkspace: Record<string, ThreadSummary[] | undefined>;
}) {
  const { threadsByWorkspace } = params;

  return async (workspaceId: string, threadId: string) => {
    if (threadId.includes("-pending-")) {
      return;
    }
    const thread = (threadsByWorkspace[workspaceId] ?? []).find((entry) => entry.id === threadId);
    if (thread?.threadKind === "shared" || threadId.startsWith("shared:")) {
      await deleteSharedSessionService(workspaceId, threadId);
      return;
    }
    // 统一走后端 delete_workspace_sessions：owner workspace 解析、磁盘删除、
    // catalog 元数据清理、session index tombstone 都在一条链路完成。
    // 若 catalog 认不出归属（幽灵 Index 行），客户端自行 tombstone，不碰磁盘。
    const response = await deleteWorkspaceSessionsService(workspaceId, [threadId]);
    const result =
      response.results.find((item) => item.sessionId === threadId) ??
      response.results[0];
    if (!result) {
      throw new Error("Missing session delete result");
    }
    if (!result.ok) {
      if (isGhostClientSessionIndexDeleteError(result.error, result.code)) {
        // Catalog 认不出归属、磁盘也没删：只摘客户端 Index，避免侧栏幽灵行常驻。
        await tombstoneSessionIndexRows(
          sessionIndexIdsForThreadTombstone(threadId),
        ).catch(() => 0);
        return;
      }
      throw new Error(result.error ?? "Failed to delete session");
    }
  };
}

export function createRenameThreadTitleMappingAction(params: {
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  onRenameThreadTitleMapping?: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
}) {
  const { getCustomName, onRenameThreadTitleMapping } = params;

  return async (workspaceId: string, oldThreadId: string, newThreadId: string) => {
    try {
      await renameThreadTitleKeyService(workspaceId, oldThreadId, newThreadId);
      onRenameThreadTitleMapping?.(workspaceId, oldThreadId, newThreadId);
    } catch {
      const previousName = getCustomName(workspaceId, oldThreadId);
      if (!previousName) {
        return;
      }
      try {
        await setThreadTitleService(workspaceId, newThreadId, previousName);
        onRenameThreadTitleMapping?.(workspaceId, oldThreadId, newThreadId);
      } catch {
        // Best-effort persistence; ignore mapping failures.
      }
    }
  };
}
