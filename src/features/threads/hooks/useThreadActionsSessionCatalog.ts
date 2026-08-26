import { useCallback } from "react";
import type {
  WorkspaceSessionArchiveEvidence,
  WorkspaceSessionCatalogPage,
  WorkspaceSessionCatalogQuery,
  WorkspaceSessionCatalogSourceStatus,
} from "../../../services/tauri";
import type { WorkspaceSessionAttributionMode } from "../../../types";
import { withTimeout } from "./useThreadActions.helpers";
import { normalizeGlobalVisibleThreadRootCount } from "../../app/constants";
import {
  CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
  SESSION_CATALOG_INITIAL_PAGE_SIZE,
  normalizeProjectCatalogSession,
  type ProjectCatalogSessionSummary,
} from "./useThreadActions.threadList";

export type ListWorkspaceSessionsService = (
  workspaceId: string,
  options: {
    query?: WorkspaceSessionCatalogQuery | null;
    cursor?: string | null;
    limit?: number | null;
  },
) => Promise<WorkspaceSessionCatalogPage>;

export type ListWorkspaceSessionArchiveEvidenceService = (
  workspaceId: string,
) => Promise<WorkspaceSessionArchiveEvidence>;

export type ArchivedSessionMapResult = {
  archivedAtBySessionId: Map<string, number>;
  partialSource: string | null;
  sourceStatuses: WorkspaceSessionCatalogSourceStatus[];
  isComplete: boolean;
};

type UseThreadActionsSessionCatalogOptions = {
  canListWorkspaceSessions: boolean;
  listWorkspaceSessionsService: ListWorkspaceSessionsService | null;
  listWorkspaceSessionArchiveEvidenceService: ListWorkspaceSessionArchiveEvidenceService | null;
  defaultVisibleThreadRootCount?: number | null;
};

function mergeFirstPartialSource(
  current: string | null,
  incoming: string | null | undefined,
): string | null {
  if (current) {
    return current;
  }
  const normalized = typeof incoming === "string" ? incoming.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function sourceStatusMergeKey(status: WorkspaceSessionCatalogSourceStatus): string {
  return `${status.engine.trim().toLowerCase()}::${(status.sourceKind ?? "")
    .trim()
    .toLowerCase()}`;
}

function mergeSourceStatusesBySource(
  current: WorkspaceSessionCatalogSourceStatus[],
  incoming: WorkspaceSessionCatalogSourceStatus[] | null | undefined,
): WorkspaceSessionCatalogSourceStatus[] {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return current;
  }
  const bySource = new Map(
    current.map((status) => [sourceStatusMergeKey(status), status]),
  );
  incoming.forEach((status) => {
    if (!status.engine) {
      return;
    }
    bySource.set(sourceStatusMergeKey(status), status);
  });
  return Array.from(bySource.values());
}

export function useThreadActionsSessionCatalog({
  canListWorkspaceSessions,
  listWorkspaceSessionsService,
  listWorkspaceSessionArchiveEvidenceService,
  defaultVisibleThreadRootCount = null,
}: UseThreadActionsSessionCatalogOptions) {
  const loadArchivedSessionMap = useCallback(
    async (workspaceId: string): Promise<ArchivedSessionMapResult | null> => {
      if (
        !canListWorkspaceSessions ||
        !listWorkspaceSessionArchiveEvidenceService
      ) {
        return null;
      }
      try {
        const response = await withTimeout(
          listWorkspaceSessionArchiveEvidenceService(workspaceId),
          CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
        );
        if (!response) {
          return {
            archivedAtBySessionId: new Map(),
            partialSource: "session-catalog-archive-evidence-timeout",
            sourceStatuses: [],
            isComplete: false,
          };
        }
        const archivedAtBySessionId = new Map<string, number>();
        Object.entries(response.archivedAtBySessionId ?? {}).forEach(
          ([sessionId, archivedAt]) => {
            if (
              typeof archivedAt !== "number" ||
              !Number.isFinite(archivedAt)
            ) {
              return;
            }
            if (archivedAt > 0) {
              archivedAtBySessionId.set(sessionId, archivedAt);
            }
          },
        );
        const sourceStatuses = Array.isArray(response.sourceStatuses)
          ? response.sourceStatuses
          : [];
        const isComplete =
          !response.partialSource &&
          sourceStatuses.length > 0 &&
          sourceStatuses.every(
            (status) =>
              status.completeness === "complete" ||
              status.completeness === "authoritative_empty",
          );
        return {
          archivedAtBySessionId,
          partialSource: response.partialSource ?? null,
          sourceStatuses,
          isComplete,
        };
      } catch {
        return {
          archivedAtBySessionId: new Map(),
          partialSource: "session-catalog-archive-evidence-error",
          sourceStatuses: [],
          isComplete: false,
        };
      }
    },
    [canListWorkspaceSessions, listWorkspaceSessionArchiveEvidenceService],
  );

  const loadActiveProjectCatalogSessions = useCallback(
    async (
      workspaceId: string,
      sessionAttributionMode: WorkspaceSessionAttributionMode = "related",
    ): Promise<{
      sessions: ProjectCatalogSessionSummary[];
      partialSource: string | null;
      nextCursor: string | null;
      sourceStatuses: WorkspaceSessionCatalogSourceStatus[];
      hiddenAutomaticSessionIds: string[];
    } | null> => {
      if (!canListWorkspaceSessions || !listWorkspaceSessionsService) {
        return null;
      }
      const response: WorkspaceSessionCatalogPage | null = await withTimeout(
        listWorkspaceSessionsService(workspaceId, {
          query: {
            status: "active",
            sessionAttributionMode,
            scanQuality: "preview",
          },
          cursor: null,
          // First-paint catalog page matches sidebar initial page (default 5).
          limit: normalizeGlobalVisibleThreadRootCount(
            defaultVisibleThreadRootCount ?? SESSION_CATALOG_INITIAL_PAGE_SIZE,
          ),
        }),
        CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
      );
      if (!response) {
        return {
          sessions: [],
          partialSource: "session-catalog-timeout",
          nextCursor: null,
          sourceStatuses: [],
          hiddenAutomaticSessionIds: [],
        };
      }
      const sessionsById = new Map<string, ProjectCatalogSessionSummary>();
      response.data
        .map((entry: unknown) => normalizeProjectCatalogSession(entry))
        .filter((entry): entry is ProjectCatalogSessionSummary =>
          Boolean(entry),
        )
        .forEach((entry) => {
          const stableKey = entry.stableSessionKey?.trim();
          const dedupeKey =
            stableKey || `${entry.workspaceId ?? ""}::${entry.sessionId}`;
          if (!sessionsById.has(dedupeKey)) {
            sessionsById.set(dedupeKey, entry);
          }
        });
      const partialSource = mergeFirstPartialSource(
        null,
        response.partialSource,
      );
      const sourceStatuses = mergeSourceStatusesBySource(
        [],
        response.sourceStatuses,
      );
      const sessions = Array.from(sessionsById.values());
      const hiddenAutomaticSessionIds = Array.isArray(
        response.hiddenAutomaticSessionIds,
      )
        ? response.hiddenAutomaticSessionIds
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        : [];
      return {
        sessions,
        partialSource,
        nextCursor: response.nextCursor ?? null,
        sourceStatuses,
        hiddenAutomaticSessionIds,
      };
    },
    [
      canListWorkspaceSessions,
      defaultVisibleThreadRootCount,
      listWorkspaceSessionsService,
    ],
  );

  return {
    loadActiveProjectCatalogSessions,
    loadArchivedSessionMap,
  };
}
