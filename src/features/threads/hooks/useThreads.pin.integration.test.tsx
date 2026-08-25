// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import type { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import { useThreadRows } from "../../app/hooks/useThreadRows";
import { writeClientStoreData } from "../../../services/clientStorage";
import { useThreads } from "./useThreads";

type AppServerHandlers = Parameters<typeof useAppServerEvents>[0];

vi.mock("../../app/hooks/useAppServerEvents", () => ({
  useAppServerEvents: (_incoming: AppServerHandlers) => {},
}));

vi.mock("../../../services/tauri", () => ({
  respondToServerRequest: vi.fn(),
  respondToUserInputRequest: vi.fn(),
  connectWorkspace: vi.fn().mockResolvedValue(undefined),
  listThreadTitles: vi.fn(),
  setThreadTitle: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  generateThreadTitle: vi.fn(),
  rememberApprovalRule: vi.fn(),
  sendUserMessage: vi.fn(),
  startReview: vi.fn(),
  startThread: vi.fn(),
  listThreads: vi.fn(),
  resumeThread: vi.fn(),
  archiveThread: vi.fn(),
  deleteWorkspaceSessions: vi.fn(),
  tombstoneSessionIndexRows: vi.fn(),
  getAccountRateLimits: vi.fn(),
  getAccountInfo: vi.fn(),
  interruptTurn: vi.fn(),
  approveToolCall: vi.fn(),
  denyToolCall: vi.fn(),
  executeSlashCommand: vi.fn(),
  branchWorkspace: vi.fn(),
  startMcpSession: vi.fn(),
  startSpecRootSession: vi.fn(),
  startStatusSession: vi.fn(),
  startContextSession: vi.fn(),
  startFastSession: vi.fn(),
  startModeSession: vi.fn(),
  startExportSession: vi.fn(),
  startImportSession: vi.fn(),
  startLspSession: vi.fn(),
  startShareSession: vi.fn(),
  listWorkspacePlugins: vi.fn(),
  addWorkspacePlugin: vi.fn(),
  removeWorkspacePlugin: vi.fn(),
  listWorkspaceProviderProfiles: vi.fn(),
  saveWorkspaceProviderProfile: vi.fn(),
  removeWorkspaceProviderProfile: vi.fn(),
  saveWorkspaceProviderSelection: vi.fn(),
  listWorkspaceOpenCodeAgents: vi.fn(),
  projectMemoryUpdate: vi.fn(),
  projectMemoryCreate: vi.fn(),
  getEmailInboundListenerStatus: vi.fn().mockResolvedValue({
    enabled: false,
    readOnly: true,
    connectionState: "disabled",
    lastCheckedAt: null,
    nextCheckAt: null,
    acceptedCount: 0,
    queuedCount: 0,
    needsConfirmationCount: 0,
    rejectedCount: 0,
    ignoredCount: 0,
    pollingIntervalSeconds: 300,
  }),
  checkEmailInbox: vi.fn(),
  claimNextEmailMailCommand: vi.fn().mockResolvedValue({ command: null }),
  completeEmailMailCommand: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "ccgui",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const mapThreadIds = (rows: { thread: { id: string } }[]) =>
  rows.map((entry) => entry.thread.id);

describe("useThreads pin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeClientStoreData("threads", {});
  });

  it("keeps pin state/version and thread row partition in sync", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );
    await act(async () => {});
    const rowsHook = renderHook(() => useThreadRows(result.current.threadParentById));

    const threads = [
      { id: "thread-a", name: "A", updatedAt: 10 },
      { id: "thread-b", name: "B", updatedAt: 20 },
    ];

    const initialRows = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    expect(initialRows.pinnedRows).toHaveLength(0);
    expect(mapThreadIds(initialRows.unpinnedRows)).toEqual([
      "thread-b",
      "thread-a",
    ]);

    const initialVersion = result.current.pinnedThreadsVersion;
    let pinResult = false;
    await act(async () => {
      pinResult = result.current.pinThread(workspace.id, "thread-a");
    });
    expect(pinResult).toBe(true);
    expect(result.current.isThreadPinned(workspace.id, "thread-a")).toBe(true);
    expect(result.current.pinnedThreadsVersion).toBe(initialVersion + 1);
    expect(result.current.getPinTimestamp(workspace.id, "thread-a")).not.toBeNull();

    const pinnedRows = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    expect(mapThreadIds(pinnedRows.pinnedRows)).toEqual(["thread-a"]);
    expect(mapThreadIds(pinnedRows.unpinnedRows)).toEqual(["thread-b"]);

    await act(async () => {
      result.current.unpinThread(workspace.id, "thread-a");
    });
    expect(result.current.isThreadPinned(workspace.id, "thread-a")).toBe(false);
    expect(result.current.getPinTimestamp(workspace.id, "thread-a")).toBeNull();
    expect(result.current.pinnedThreadsVersion).toBe(initialVersion + 2);

    const unpinnedRowsAgain = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    expect(unpinnedRowsAgain.pinnedRows).toHaveLength(0);
    expect(mapThreadIds(unpinnedRowsAgain.unpinnedRows)).toEqual([
      "thread-b",
      "thread-a",
    ]);
  });

  it("keeps project-scoped pins at the workspace list top and out of the global bucket", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );
    await act(async () => {});
    const rowsHook = renderHook(() =>
      useThreadRows(result.current.threadParentById),
    );

    const threads = [
      { id: "thread-a", name: "A", updatedAt: 10 },
      { id: "thread-b", name: "B", updatedAt: 20 },
      { id: "thread-c", name: "C", updatedAt: 30 },
    ];

    let pinResult = false;
    await act(async () => {
      pinResult = result.current.pinThread(
        workspace.id,
        "thread-a",
        "workspace",
      );
    });
    expect(pinResult).toBe(true);
    expect(
      result.current.isThreadPinned(workspace.id, "thread-a", "workspace"),
    ).toBe(true);
    expect(result.current.isThreadPinned(workspace.id, "thread-a")).toBe(false);

    const rows = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    // 项目内置顶：不进全局桶，排 workspace 列表顶部，不占 unpinned 序
    expect(rows.pinnedRows).toHaveLength(0);
    expect(mapThreadIds(rows.workspacePinnedRows)).toEqual(["thread-a"]);
    expect(mapThreadIds(rows.unpinnedRows)).toEqual(["thread-c", "thread-b"]);

    // 互斥：迁入全局后离开项目内置顶桶
    await act(async () => {
      result.current.pinThread(workspace.id, "thread-a");
    });
    const migrated = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    expect(mapThreadIds(migrated.pinnedRows)).toEqual(["thread-a"]);
    expect(migrated.workspacePinnedRows).toHaveLength(0);
    expect(
      result.current.isThreadPinned(workspace.id, "thread-a", "workspace"),
    ).toBe(false);
  });
});
