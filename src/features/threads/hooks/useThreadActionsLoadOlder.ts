import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
  WorkspaceSessionAttributionMode,
} from "../../../types";
import type { WorkspaceSessionCatalogPage } from "../../../services/tauri";
import {
  listThreadTitles as listThreadTitlesService,
  listThreads as listThreadsService,
  listSessionIndexForWorkspace as listSessionIndexForWorkspaceService,
} from "../../../services/tauri";
import { sessionIndexRowsToThreadSummaries } from "./sessionIndexThreadSummaries";
import { reconcilePiDerivedHideWithAuthoritativeRows } from "../../pi-session/store/piSessionStore";
import { expandHiddenSharedBindingIds } from "../../shared-session/runtime/sharedSessionSummaries";
import { threadIdInHiddenSharedBindingSet } from "./useThreadActions.helpers";
import { debugPiSummaryLayerDrops } from "../../pi-session/store/piSidebarDropDiagnostics";
import { getCollabWorkerNativeHideIds } from "../../multi-agent/runtime/collabNativeHideRegistry";
import {
  expandVisibilityHideSet,
  lastVerifiedSharedHide,
  unionHideSets,
} from "./sharedNativeVisibility";
import {
  getThreadTimestamp,
  previewThreadName,
} from "../../../utils/threadItems";
import { asString } from "../utils/threadNormalize";
import {
  collectKnownCodexThreadIds,
  normalizeComparableWorkspacePath,
} from "./useThreadActions.workspacePath";
import {
  extractThreadSizeBytes,
  isLocalSessionScanUnavailable,
  mergeCodexCatalogSessionSummaries,
  resolveThreadSourceMeta,
  shouldIncludeWorkspaceThreadEntry,
  withTimeout,
} from "./useThreadActions.helpers";
import { resolveVisibleThreadRootPageSize } from "../../app/constants";
import {
  CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
  SESSION_INDEX_LOAD_OLDER_TIMEOUT_MS,
  THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER,
  THREAD_LIST_MAX_FETCH_DURATION_MS,
  THREAD_LIST_MAX_TOTAL_PAGES,
  decodeSessionIndexThreadListCursor,
  decodeThreadListCursorState,
  encodeSessionIndexThreadListCursor,
  normalizeProjectCatalogSession,
  resolveThreadListCursorForDisplay,
  sortThreadSummariesForDisplay,
  type ProjectCatalogSessionSummary,
} from "./useThreadActions.threadList";
import type {
  ArchivedSessionMapResult,
  ListWorkspaceSessionsService,
} from "./useThreadActionsSessionCatalog";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

type UseLoadOlderThreadsForWorkspaceOptions = {
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  applySessionArchiveState: (
    summaries: ThreadSummary[],
    archivedEvidence: ArchivedSessionMapResult | null,
  ) => ThreadSummary[];
  canListWorkspaceSessions: boolean;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  latestThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[] | undefined>
  >;
  listWorkspaceSessionsService: ListWorkspaceSessionsService | null;
  loadArchivedSessionMap: (
    workspaceId: string,
  ) => Promise<ArchivedSessionMapResult | null>;
  onDebug?: (entry: DebugEntry) => void;
  onThreadTitleMappingsLoaded?: (
    workspaceId: string,
    titles: Record<string, string>,
  ) => void;
  sessionAttributionMode: WorkspaceSessionAttributionMode;
  defaultVisibleThreadRootCount?: number | null;
  threadListCursorByWorkspace: ThreadState["threadListCursorByWorkspace"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  workspacePathsByIdRef: MutableRefObject<Record<string, string>>;
};

export function useLoadOlderThreadsForWorkspace({
  activeThreadIdByWorkspace,
  applySessionArchiveState,
  canListWorkspaceSessions,
  dispatch,
  getCustomName,
  latestThreadsByWorkspaceRef,
  listWorkspaceSessionsService,
  loadArchivedSessionMap,
  onDebug,
  onThreadTitleMappingsLoaded,
  sessionAttributionMode,
  defaultVisibleThreadRootCount = null,
  threadListCursorByWorkspace,
  threadsByWorkspace,
  workspacePathsByIdRef,
}: UseLoadOlderThreadsForWorkspaceOptions) {
  return useCallback(
    async (workspace: WorkspaceInfo) => {
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const pageSize = resolveVisibleThreadRootPageSize(
        workspace.settings.visibleThreadRootCount,
        defaultVisibleThreadRootCount,
      );
      const encodedNextCursor =
        threadListCursorByWorkspace[workspace.id] ?? null;
      if (!encodedNextCursor) {
        return;
      }
      const cursorState = decodeThreadListCursorState(encodedNextCursor);
      const workspacePath = normalizeComparableWorkspacePath(workspace.path);
      const existing = threadsByWorkspace[workspace.id] ?? [];
      const activeThreadId = activeThreadIdByWorkspace[workspace.id] ?? "";
      const knownCodexThreadIds = collectKnownCodexThreadIds(
        existing,
        activeThreadId,
      );
      dispatch({
        type: "setThreadListPaging",
        workspaceId: workspace.id,
        isLoading: true,
      });
      onDebug?.({
        id: `${Date.now()}-client-thread-list-older`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list older",
        payload: {
          workspaceId: workspace.id,
          cursor: encodedNextCursor,
          cursorSource: cursorState.source,
        },
      });
      try {
        let mappedTitles: Record<string, string> = {};
        const archivedSessionMapPromise = loadArchivedSessionMap(workspace.id);
        try {
          mappedTitles = await listThreadTitlesService(workspace.id);
          onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
        } catch {
          mappedTitles = {};
        }
        if (cursorState.source === "session-index") {
          const keyset = decodeSessionIndexThreadListCursor(cursorState.cursor);
          if (!keyset || typeof listSessionIndexForWorkspaceService !== "function") {
            dispatch({
              type: "setThreadListCursor",
              workspaceId: workspace.id,
              cursor: null,
            });
            return;
          }
          const page = await withTimeout(
            listSessionIndexForWorkspaceService(workspace.id, {
              limit: pageSize + 1,
              syncIfNeeded: false,
              forceSync: false,
              beforeUpdatedAt: keyset.updatedAt,
              beforeSessionId: keyset.sessionId,
            })
              .then((value) => value ?? null)
              .catch(() => null),
            SESSION_INDEX_LOAD_OLDER_TIMEOUT_MS,
          );
          if (page && Array.isArray(page.data)) {
            const hasMore = page.data.length > pageSize;
            const pageRows = hasMore
              ? page.data.slice(0, pageSize)
              : page.data;
            const visibility = page.visibility ?? null;
            const hideSet = unionHideSets(
              expandVisibilityHideSet(visibility),
              lastVerifiedSharedHide(workspace.id),
              expandHiddenSharedBindingIds([
                ...getCollabWorkerNativeHideIds(),
              ]),
            );
            // Hide unreadiness must not drop indexed natives to PI-only.
            // ThreadList expands the in-memory page first; this IPC only
            // runs after that page is exhausted.
            reconcilePiDerivedHideWithAuthoritativeRows(pageRows);
            const indexSummaries = sessionIndexRowsToThreadSummaries(pageRows, {
              workspaceId: workspace.id,
              mappedTitles,
              getCustomName,
              hiddenSharedBindingIds: hideSet,
            });
            debugPiSummaryLayerDrops(
              "index-load-older",
              pageRows,
              new Set(indexSummaries.map((summary) => summary.id)),
              (threadId) =>
                threadIdInHiddenSharedBindingSet(threadId, hideSet)
                  ? "shared/collab-hide-set"
                  : "title-gate",
            );
            const existingIds = new Set(existing.map((thread) => thread.id));
            const additions = indexSummaries.filter(
              (summary) => !existingIds.has(summary.id),
            );
            const archivedSessionMap = await archivedSessionMapPromise;
            const merged = sortThreadSummariesForDisplay(
              applySessionArchiveState(
                [...existing, ...additions],
                archivedSessionMap,
              ),
            );
            const mergedSignature = merged
              .map((thread) => thread.id)
              .join("\u0000");
            const existingSignature = existing
              .map((thread) => thread.id)
              .join("\u0000");
            if (mergedSignature !== existingSignature) {
              dispatch({
                type: "setThreads",
                workspaceId: workspace.id,
                threads: merged,
              });
              latestThreadsByWorkspaceRef.current = {
                ...latestThreadsByWorkspaceRef.current,
                [workspace.id]: merged,
              };
            }
            const oldest = pageRows[pageRows.length - 1] ?? null;
            const nextKey =
              hasMore && oldest
                ? {
                    updatedAt: Number(oldest.updatedAt) || 0,
                    sessionId: String(oldest.sessionId ?? "").trim(),
                  }
                : null;
            dispatch({
              type: "setThreadListCursor",
              workspaceId: workspace.id,
              cursor:
                nextKey && nextKey.sessionId
                  ? encodeSessionIndexThreadListCursor(nextKey)
                  : null,
            });
            onDebug?.({
              id: `${Date.now()}-client-thread-list-older-index`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list older session-index",
              payload: {
                workspaceId: workspace.id,
                keyset,
                rowCount: pageRows.length,
                additions: additions.length,
                hasMore,
              },
            });
          }
          return;
        }
        let catalogCursor: string | null = null;
        let didLoadCatalogPage = false;
        let catalogSessions: ProjectCatalogSessionSummary[] = [];
        let catalogPartialSource: string | null = null;
        if (
          canListWorkspaceSessions &&
          listWorkspaceSessionsService &&
          cursorState.source === "catalog"
        ) {
          const response: WorkspaceSessionCatalogPage | null =
            await withTimeout(
              listWorkspaceSessionsService(workspace.id, {
                query: {
                  status: "active",
                  sessionAttributionMode,
                  scanQuality: "preview",
                },
                cursor: cursorState.cursor,
                limit: pageSize,
              }),
              CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
            );
          if (response) {
            didLoadCatalogPage = true;
            catalogCursor = response.nextCursor ?? null;
            catalogPartialSource = response.partialSource ?? null;
            catalogSessions = response.data
              .map((entry) => normalizeProjectCatalogSession(entry))
              .filter((entry): entry is ProjectCatalogSessionSummary =>
                Boolean(entry),
              );
          } else {
            catalogPartialSource = "session-catalog-load-older-timeout";
          }
        }
        const matchingThreads: Record<string, unknown>[] = [];
        const targetCount = pageSize;
        const maxPagesWithoutMatch = THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER;
        let pagesFetched = 0;
        const fetchStartedAt = Date.now();
        let runtimeCursor: string | null = null;
        if (cursorState.source === "runtime") {
          runtimeCursor = cursorState.cursor;
          do {
            pagesFetched += 1;
            const response = (await listThreadsService(
              workspace.id,
              runtimeCursor,
              pageSize,
            )) as Record<string, unknown>;
            onDebug?.({
              id: `${Date.now()}-server-thread-list-older`,
              timestamp: Date.now(),
              source: "server",
              label: "thread/list older response",
              payload: response,
            });
            const result = (response.result ?? response) as Record<
              string,
              unknown
            >;
            const data = Array.isArray(result?.data)
              ? (result.data as Record<string, unknown>[])
              : [];
            const allowKnownCodexWithoutCwd =
              isLocalSessionScanUnavailable(result);
            const next = (result?.nextCursor ?? result?.next_cursor ?? null) as
              | string
              | null;
            matchingThreads.push(
              ...data.filter((thread) =>
                shouldIncludeWorkspaceThreadEntry(
                  thread,
                  workspacePath,
                  knownCodexThreadIds,
                  allowKnownCodexWithoutCwd,
                ),
              ),
            );
            runtimeCursor = next;
            if (
              matchingThreads.length === 0 &&
              pagesFetched >= maxPagesWithoutMatch
            ) {
              break;
            }
            if (pagesFetched >= THREAD_LIST_MAX_TOTAL_PAGES) {
              break;
            }
            if (
              Date.now() - fetchStartedAt >=
              THREAD_LIST_MAX_FETCH_DURATION_MS
            ) {
              break;
            }
          } while (runtimeCursor && matchingThreads.length < targetCount);
        }

        const existingIds = new Set(existing.map((thread) => thread.id));
        const additions: ThreadSummary[] = [];
        matchingThreads.forEach((thread) => {
          const id = String(thread?.id ?? "");
          if (!id || existingIds.has(id)) {
            return;
          }
          const preview = asString(thread?.preview ?? "").trim();
          const mappedTitle = mappedTitles[id];
          const customName = getCustomName(workspace.id, id) || mappedTitle;
          const fallbackName = `Agent ${existing.length + additions.length + 1}`;
          const name = customName
            ? customName
            : preview.length > 0
              ? previewThreadName(preview, fallbackName)
              : fallbackName;
          additions.push({
            id,
            name,
            updatedAt: getThreadTimestamp(thread),
            sizeBytes: extractThreadSizeBytes(thread),
            ...resolveThreadSourceMeta(thread),
          });
          existingIds.add(id);
        });

        const visibleAdditions = applySessionArchiveState(
          additions,
          await archivedSessionMapPromise,
        );

        const mergedCatalogThreads = mergeCodexCatalogSessionSummaries(
          [...existing, ...visibleAdditions],
          catalogSessions,
          workspace.id,
          mappedTitles,
          getCustomName,
        );
        const visibleMergedThreads = sortThreadSummariesForDisplay(
          applySessionArchiveState(
            mergedCatalogThreads,
            await archivedSessionMapPromise,
          ),
        );

        const visibleMergedIds = visibleMergedThreads
          .map((thread) => thread.id)
          .join("\u0000");
        const existingIdsSignature = existing
          .map((thread) => thread.id)
          .join("\u0000");
        if (visibleMergedIds !== existingIdsSignature) {
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: visibleMergedThreads,
          });
          latestThreadsByWorkspaceRef.current = {
            ...latestThreadsByWorkspaceRef.current,
            [workspace.id]: visibleMergedThreads,
          };
        }
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor: didLoadCatalogPage
            ? resolveThreadListCursorForDisplay({
                catalogCursor,
                catalogPartialSource,
                runtimeCursor: null,
              })
            : resolveThreadListCursorForDisplay({
                catalogCursor: null,
                catalogPartialSource: null,
                runtimeCursor,
              }),
        });
        if (catalogPartialSource) {
          onDebug?.({
            id: `${Date.now()}-client-thread-list-older-catalog-partial`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/list older catalog partial",
            payload: {
              workspaceId: workspace.id,
              partialSource: catalogPartialSource,
            },
          });
        }
        matchingThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          const preview = asString(thread?.preview ?? "").trim();
          if (!threadId || !preview) {
            return;
          }
          dispatch({
            type: "setLastAgentMessage",
            threadId,
            text: preview,
            timestamp: getThreadTimestamp(thread),
          });
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-older-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list older error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatch({
          type: "setThreadListPaging",
          workspaceId: workspace.id,
          isLoading: false,
        });
      }
    },
    [
      activeThreadIdByWorkspace,
      applySessionArchiveState,
      canListWorkspaceSessions,
      dispatch,
      getCustomName,
      latestThreadsByWorkspaceRef,
      listWorkspaceSessionsService,
      loadArchivedSessionMap,
      onDebug,
      onThreadTitleMappingsLoaded,
      sessionAttributionMode,
      defaultVisibleThreadRootCount,
      threadListCursorByWorkspace,
      threadsByWorkspace,
      workspacePathsByIdRef,
    ],
  );
}
