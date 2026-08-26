import { describe, expect, it } from "vitest";

import { buildWorkspaceSessionSelectionKey } from "../../settings/components/settings-view/hooks/useWorkspaceSessionCatalog";
import {
  SESSION_CATALOG_INITIAL_PAGE_SIZE,
  SESSION_INDEX_PAGE_SIZE,
  THREAD_LIST_INITIAL_PAGE_SIZE,
  THREAD_LIST_INITIAL_TARGET_COUNT,
  THREAD_LIST_LOAD_OLDER_PAGE_SIZE,
  THREAD_LIST_LOAD_OLDER_TARGET_COUNT,
  decodeSessionIndexThreadListCursor,
  encodeSessionIndexThreadListCursor,
  normalizeProjectCatalogSession,
  resolveInitialThreadListTargetCount,
  resolveThreadListCursorForDisplay,
} from "./useThreadActions.threadList";
import type { WorkspaceInfo } from "../../../types";

describe("useThreadActions.threadList", () => {
  it("preserves additive catalog source fields during normalization", () => {
    expect(
      normalizeProjectCatalogSession({
        sessionId: "claude:session-1",
        stableSessionKey: "claude:child-ws:session-1",
        canonicalSessionId: "session-1",
        workspaceId: "child-ws",
        matchedWorkspaceId: "child-ws",
        engine: "claude",
        title: "Child workspace session",
        nativeTitle: "Agent 12",
        updatedAt: 1_730_500_000_000,
        sourceCompleteness: "complete",
        sourceStatusReason: null,
        folderId: "folder-1",
      }),
    ).toMatchObject({
      sessionId: "claude:session-1",
      stableSessionKey: "claude:child-ws:session-1",
      workspaceId: "child-ws",
      matchedWorkspaceId: "child-ws",
      engine: "claude",
      nativeTitle: "Agent 12",
      sourceCompleteness: "complete",
      sourceStatusReason: null,
      folderId: "folder-1",
    });
  });

  it("keeps catalog createdAt when the source provides it", () => {
    expect(
      normalizeProjectCatalogSession({
        sessionId: "codex:session-created",
        title: "Created",
        createdAt: 40,
        updatedAt: 90,
      }),
    ).toMatchObject({
      sessionId: "codex:session-created",
      createdAt: 40,
      updatedAt: 90,
    });
    expect(
      normalizeProjectCatalogSession({
        sessionId: "codex:session-snake",
        title: "Created",
        created_at: 55,
        updatedAt: 90,
      }),
    ).toMatchObject({
      createdAt: 55,
    });
  });

  it("keeps provider continuation lineage separate from parentSessionId", () => {
    expect(
      normalizeProjectCatalogSession({
        sessionId: "target-1",
        workspaceId: "ws-1",
        engine: "codex",
        title: "Continued session",
        updatedAt: 1,
        parentSessionId: null,
        originKind: "provider-continuation",
        sourceSessionId: "claude:source-1",
        familyId: "claude:ws-1:source-1",
        familyRootSessionId: "claude:ws-1:source-1",
        lineageParentSessionId: "claude:source-1",
        lineageKind: "provider-continuation",
        lineageDepth: 1,
      }),
    ).toMatchObject({
      parentSessionId: null,
      originKind: "provider-continuation",
      sourceSessionId: "claude:source-1",
      lineageParentSessionId: "claude:source-1",
      lineageDepth: 1,
    });
  });

  it("keeps sidebar and Session Management keys aligned for aggregate child rows", () => {
    const catalogEntry = {
      sessionId: "claude:session-1",
      stableSessionKey: "claude:child-ws:session-1",
      canonicalSessionId: "session-1",
      workspaceId: "child-ws",
      matchedWorkspaceId: "child-ws",
      engine: "claude",
      title: "Child workspace session",
      updatedAt: 1_730_500_000_000,
      sourceCompleteness: "complete",
      sourceStatusReason: null,
      folderId: "folder-1",
    };

    const sidebarSession = normalizeProjectCatalogSession(catalogEntry);

    expect(sidebarSession).toMatchObject({
      sessionId: "claude:session-1",
      stableSessionKey: "claude:child-ws:session-1",
      workspaceId: "child-ws",
    });
    expect(buildWorkspaceSessionSelectionKey(catalogEntry)).toBe(
      "child-ws::claude:child-ws:session-1",
    );
  });

  it("normalizes optional catalog strings and rejects invalid source completeness", () => {
    expect(
      normalizeProjectCatalogSession({
        sessionId: " claude:session-2 ",
        stableSessionKey: " claude:child-ws:session-2 ",
        workspaceId: " child-ws ",
        matchedWorkspaceId: "",
        engine: " claude ",
        title: " Session with whitespace ",
        updatedAt: Number.POSITIVE_INFINITY,
        sourceCompleteness: "definitely_empty",
        sourceStatusReason: " ",
        folderId: " folder-1 ",
      }),
    ).toMatchObject({
      sessionId: "claude:session-2",
      stableSessionKey: "claude:child-ws:session-2",
      workspaceId: "child-ws",
      matchedWorkspaceId: null,
      engine: "claude",
      updatedAt: 0,
      sourceCompleteness: null,
      sourceStatusReason: null,
      folderId: "folder-1",
    });
  });

  it("does not expose load-older cursor for catalog partial source without next cursor", () => {
    expect(
      resolveThreadListCursorForDisplay({
        catalogCursor: null,
        catalogPartialSource: "claude-scan-cap-reached",
        runtimeCursor: null,
      }),
    ).toBeNull();
    expect(
      resolveThreadListCursorForDisplay({
        catalogCursor: "offset:200",
        catalogPartialSource: "claude-scan-cap-reached",
        runtimeCursor: null,
      }),
    ).toBe("catalog::offset:200");
  });

  it("falls back to a session-index keyset cursor when catalog and runtime are empty", () => {
    expect(
      resolveThreadListCursorForDisplay({
        catalogCursor: null,
        catalogPartialSource: null,
        runtimeCursor: null,
        sessionIndexHasMore: true,
        sessionIndexOldestKey: {
          updatedAt: 1_730_500_000_000,
          sessionId: "sess-old",
        },
      }),
    ).toBe("session-index::1730500000000:sess-old");
    expect(
      decodeSessionIndexThreadListCursor("1730500000000:sess-old"),
    ).toEqual({
      updatedAt: 1_730_500_000_000,
      sessionId: "sess-old",
    });
    expect(
      encodeSessionIndexThreadListCursor({
        updatedAt: 1_730_500_000_000,
        sessionId: "sess-old",
      }),
    ).toBe("session-index::1730500000000:sess-old");
    expect(
      resolveThreadListCursorForDisplay({
        catalogCursor: null,
        catalogPartialSource: null,
        runtimeCursor: null,
        sessionIndexHasMore: false,
        sessionIndexOldestKey: {
          updatedAt: 1_730_500_000_000,
          sessionId: "sess-old",
        },
      }),
    ).toBeNull();
  });

  it("first-paint list target defaults to expose=fetch 5 and matches sidebar page size", () => {
    expect(THREAD_LIST_INITIAL_TARGET_COUNT).toBe(5);
    expect(THREAD_LIST_INITIAL_PAGE_SIZE).toBe(5);
    expect(SESSION_CATALOG_INITIAL_PAGE_SIZE).toBe(5);
    expect(SESSION_INDEX_PAGE_SIZE).toBe(5);
    expect(THREAD_LIST_LOAD_OLDER_TARGET_COUNT).toBe(50);
    expect(THREAD_LIST_LOAD_OLDER_PAGE_SIZE).toBe(50);

    const workspace = {
      id: "ws-1",
      name: "ws",
      path: "/tmp/ws",
      connected: true,
      settings: { sidebarCollapsed: false },
    } as WorkspaceInfo;
    expect(resolveInitialThreadListTargetCount(workspace)).toBe(5);
    expect(resolveInitialThreadListTargetCount(workspace, 8)).toBe(8);
    expect(
      resolveInitialThreadListTargetCount(
        {
          ...workspace,
          settings: { ...workspace.settings, visibleThreadRootCount: 200 },
        },
        5,
      ),
    ).toBe(200);
  });
});
