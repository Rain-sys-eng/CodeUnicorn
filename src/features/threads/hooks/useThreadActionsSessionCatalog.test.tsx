// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useThreadActionsSessionCatalog } from "./useThreadActionsSessionCatalog";

describe("useThreadActionsSessionCatalog", () => {
  it("loads the active project catalog with the full sidebar window", async () => {
    const listWorkspaceSessionsService = vi.fn().mockResolvedValueOnce({
      data: [
        {
          sessionId: "claude:first",
          workspaceId: "ws-1",
          engine: "claude",
          title: "First row",
          updatedAt: 30,
          threadKind: "native",
        },
        {
          sessionId: "claude:second",
          workspaceId: "ws-1",
          engine: "claude",
          title: "Second row",
          updatedAt: 20,
          threadKind: "native",
        },
      ],
      nextCursor: "offset:9999",
      sourceStatuses: [{ engine: "claude", completeness: "complete" }],
      partialSource: null,
    });

    const { result } = renderHook(() =>
      useThreadActionsSessionCatalog({
        canListWorkspaceSessions: true,
        listWorkspaceSessionsService,
        listWorkspaceSessionArchiveEvidenceService: null,
      }),
    );

    const catalog =
      await result.current.loadActiveProjectCatalogSessions("ws-1");

    expect(listWorkspaceSessionsService).toHaveBeenNthCalledWith(1, "ws-1", {
      query: {
        status: "active",
        sessionAttributionMode: "related",
        scanQuality: "preview",
      },
      cursor: null,
      limit: 5,
    });
    expect(listWorkspaceSessionsService).toHaveBeenCalledTimes(1);
    expect(catalog?.sessions.map((session) => session.sessionId)).toEqual([
      "claude:first",
      "claude:second",
    ]);
    expect(catalog?.nextCursor).toBe("offset:9999");
    expect(catalog?.partialSource).toBeNull();
  });

  it("preserves backend pagination cursors for large sidebar catalogs", async () => {
    const listWorkspaceSessionsService = vi.fn(
      async (_workspaceId, options) => ({
        data: [
          {
            sessionId: `claude:${options?.cursor ?? "root"}`,
            workspaceId: "ws-1",
            engine: "claude",
            title: "Page item",
            updatedAt: 1,
            threadKind: "native",
          },
        ],
        nextCursor: `cursor-${listWorkspaceSessionsService.mock.calls.length}`,
        partialSource: null,
      }),
    );

    const { result } = renderHook(() =>
      useThreadActionsSessionCatalog({
        canListWorkspaceSessions: true,
        listWorkspaceSessionsService,
        listWorkspaceSessionArchiveEvidenceService: null,
      }),
    );

    const catalog =
      await result.current.loadActiveProjectCatalogSessions("ws-1");

    expect(listWorkspaceSessionsService).toHaveBeenCalledTimes(1);
    expect(catalog?.nextCursor).toBe("cursor-1");
    expect(catalog?.partialSource).toBeNull();
  });

  it("passes workspace-only mode into active project catalog requests", async () => {
    const listWorkspaceSessionsService = vi.fn().mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    const { result } = renderHook(() =>
      useThreadActionsSessionCatalog({
        canListWorkspaceSessions: true,
        listWorkspaceSessionsService,
        listWorkspaceSessionArchiveEvidenceService: null,
      }),
    );

    await result.current.loadActiveProjectCatalogSessions(
      "ws-1",
      "workspace-only",
    );

    expect(listWorkspaceSessionsService).toHaveBeenCalledWith("ws-1", {
      query: {
        status: "active",
        sessionAttributionMode: "workspace-only",
        scanQuality: "preview",
      },
      cursor: null,
      limit: 5,
    });
  });

  it("preserves automatic session metadata from catalog rows", async () => {
    const autoSession = {
      sessionPurpose: "pull-request-question",
      visibility: "system-auto",
      ownerFeature: "git",
      autoArchive: false,
      createdBy: "system",
    };
    const listWorkspaceSessionsService = vi.fn().mockResolvedValueOnce({
      data: [
        {
          sessionId: "claude:system-auto",
          workspaceId: "ws-1",
          engine: "claude",
          title: "System trace",
          updatedAt: 20,
          threadKind: "native",
          folderId: "__system_auto__",
          autoSession,
        },
      ],
      nextCursor: null,
      partialSource: null,
      sourceStatuses: [{ engine: "claude", completeness: "complete" }],
      hiddenAutomaticSessionIds: [
        "claude:2b325056-0242-4450-a18e-1b7b29f718c1",
        "codex:commit-helper",
      ],
    });

    const { result } = renderHook(() =>
      useThreadActionsSessionCatalog({
        canListWorkspaceSessions: true,
        listWorkspaceSessionsService,
        listWorkspaceSessionArchiveEvidenceService: null,
      }),
    );

    const catalog =
      await result.current.loadActiveProjectCatalogSessions("ws-1");

    expect(catalog?.sessions[0]).toMatchObject({
      sessionId: "claude:system-auto",
      folderId: "__system_auto__",
      autoSession,
    });
    expect(catalog?.hiddenAutomaticSessionIds).toEqual([
      "claude:2b325056-0242-4450-a18e-1b7b29f718c1",
      "codex:commit-helper",
    ]);
  });

  it("treats archive evidence with missing source status as incomplete", async () => {
    const listWorkspaceSessionArchiveEvidenceService = vi
      .fn()
      .mockResolvedValue({
        archivedAtBySessionId: {},
        partialSource: null,
      });

    const { result } = renderHook(() =>
      useThreadActionsSessionCatalog({
        canListWorkspaceSessions: true,
        listWorkspaceSessionsService: null,
        listWorkspaceSessionArchiveEvidenceService,
      }),
    );

    const evidence = await result.current.loadArchivedSessionMap("ws-1");

    expect(listWorkspaceSessionArchiveEvidenceService).toHaveBeenCalledWith(
      "ws-1",
    );
    expect(evidence?.archivedAtBySessionId.size).toBe(0);
    expect(evidence?.partialSource).toBeNull();
    expect(evidence?.sourceStatuses).toEqual([]);
    expect(evidence?.isComplete).toBe(false);
  });
});
