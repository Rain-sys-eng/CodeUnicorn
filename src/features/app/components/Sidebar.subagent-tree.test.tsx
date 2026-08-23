// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRef } from "react";
import type { ReactNode, Ref, UIEventHandler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeClientStoreData } from "../../../services/clientStorage";
import {
  assignWorkspaceSessionFolder,
  assignWorkspaceSessionFolders,
  createWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
} from "../../../services/tauri";
import { Sidebar } from "./Sidebar";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "sidebar.addWorkspace": "Add workspace",
        "sidebar.workspaceSettings": "Workspace settings",
        "sidebar.workspaceSettingsTitle": "Workspace settings",
        "sidebar.workspaceSettingsDescription":
          "These preferences apply to every project.",
        "sidebar.workspaceSettingsVisibleCountLabel":
          "Default visible sessions",
        "sidebar.workspaceSettingsVisibleCountHint":
          "Default {{defaultCount}}, range {{min}}-{{max}}.",
        "sidebar.projects": "Projects",
        "sidebar.threadsSection": "Threads",
        "sidebar.quickNewThread": "Home",
        "sidebar.quickSearch": "Search",
        "sidebar.openHome": "Open home",
        "sidebar.emptyWorkspaceSessions": "No sessions yet.",
        "sidebar.newSessionInFolder": "New session in project",
        "sidebar.newSessionFolderIn": "New folder in project",
        "sidebar.renameSessionFolder": "Rename folder",
        "sidebar.deleteSessionFolder": "Delete folder",
        "sidebar.collapseSessionFolder": "Collapse folder",
        "sidebar.expandSessionFolder": "Expand folder",
        "sidebar.sessionFolderCount": "session count",
        "sidebar.sessionFolderNamePrompt": "Folder name",
        "sidebar.sessionFolderRenamePrompt": "Rename folder",
        "sidebar.sessionFolderDeleteTitle": "Delete folder",
        "sidebar.sessionFolderDeleteMessage": "Delete folder message",
        "sidebar.sessionFolderDeleteHint": "Clear non-empty folders first.",
        "threads.moveToFolder": "Move to folder",
        "threads.moveToProjectRoot": "Project root",
        "threads.searchFolderTargets": "Search folders...",
        "threads.hideExitedSessions": "Hide exited sessions",
        "threads.showExitedSessions": "Show exited sessions",
        "threads.subagentTreeExpand": "Expand subagent tree",
        "threads.subagentTreeCollapse": "Collapse subagent tree",
        "threads.more": "More...",
        "threads.loading": "Loading...",
        "threads.searchOlder": "Search older...",
        "threads.loadOlder": "Load older...",
        "workspace.engineClaudeCode": "Claude Code",
        "workspace.engineCodex": "Codex",
        "workspace.engineOpenCode": "OpenCode",
        "workspace.engineGemini": "Gemini",
        "workspace.engineKimi": "Kimi CLI",
        "settings.title": "Settings",
        "tabbar.primaryNavigation": "Primary navigation",
      };
      return translations[key] ?? key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

vi.mock("../../../services/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauri")>();
  return {
    ...actual,
    assignWorkspaceSessionFolder: vi.fn(),
    assignWorkspaceSessionFolders: vi.fn(),
    createWorkspaceSessionFolder: vi.fn(),
    deleteWorkspaceSessionFolder: vi.fn(),
    listWorkspaceSessionFolders: vi.fn(),
    renameWorkspaceSessionFolder: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ scaleFactor: () => 1 }),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    viewportRef,
    onViewportScroll,
    className,
  }: {
    children: ReactNode;
    viewportRef?: Ref<HTMLDivElement>;
    onViewportScroll?: UIEventHandler<HTMLDivElement>;
    className?: string;
  }) => (
    <div className={className} onScroll={onViewportScroll} ref={viewportRef}>
      {children}
    </div>
  ),
  ScrollBar: () => null,
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  writeClientStoreData("threads", {});
  writeClientStoreData("layout", {});
  vi.mocked(listWorkspaceSessionFolders).mockResolvedValue({
    workspaceId: "default",
    folders: [],
  });
  vi.mocked(assignWorkspaceSessionFolder).mockResolvedValue({
    sessionId: "default-session",
    folderId: null,
  });
  vi.mocked(assignWorkspaceSessionFolders).mockResolvedValue({
    results: [],
  });
  vi.mocked(createWorkspaceSessionFolder).mockResolvedValue({
    folder: {
      id: "created-folder",
      workspaceId: "default",
      parentId: null,
      name: "Created",
      createdAt: 1,
      updatedAt: 1,
    },
  });
  vi.mocked(renameWorkspaceSessionFolder).mockResolvedValue({
    folder: {
      id: "renamed-folder",
      workspaceId: "default",
      parentId: null,
      name: "Renamed",
      createdAt: 1,
      updatedAt: 2,
    },
  });
  vi.mocked(deleteWorkspaceSessionFolder).mockResolvedValue(undefined);
});

const workspace = {
  id: "ws-1",
  name: "codemoss",
  path: "/tmp/codemoss",
  connected: true,
  kind: "main" as const,
  settings: {
    sidebarCollapsed: false,
    worktreeSetupScript: null,
  },
};

const baseProps = {
  workspaces: [workspace],
  groupedWorkspaces: [{ id: null, name: "Ungrouped", workspaces: [workspace] }],
  hasWorkspaceGroups: false,
  deletingWorktreeIds: new Set<string>(),
  threadsByWorkspace: {},
  activeItems: [],
  threadParentById: {},
  threadStatusById: {},
  hydratedThreadListWorkspaceIds: new Set<string>(["ws-1"]),
  threadListLoadingByWorkspace: {},
  threadListPagingByWorkspace: {},
  threadListCursorByWorkspace: {},
  activeWorkspaceId: "ws-1",
  activeThreadId: "claude:parent-session",
  accountRateLimits: null,
  usageShowRemaining: false,
  accountInfo: null,
  onSwitchAccount: vi.fn(),
  onCancelSwitchAccount: vi.fn(),
  accountSwitching: false,
  onOpenSettings: vi.fn(),
  onOpenDebug: vi.fn(),
  showDebugButton: false,
  onAddWorkspace: vi.fn(),
  onSelectHome: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onConnectWorkspace: vi.fn(),
  onAddAgent: vi.fn(),
  onAddWorktreeAgent: vi.fn(),
  onAddCloneAgent: vi.fn(),
  onToggleWorkspaceCollapse: vi.fn(),
  onSelectThread: vi.fn(),
  onDeleteThread: vi.fn(),
  onArchiveThread: vi.fn(),
  onSyncThread: vi.fn(),
  pinThread: vi.fn(() => false),
  unpinThread: vi.fn(),
  isThreadPinned: vi.fn(() => false),
  isThreadAutoNaming: vi.fn(() => false),
  getPinTimestamp: vi.fn(() => null),
  pinnedThreadsVersion: 0,
  onRenameThread: vi.fn(),
  onAutoNameThread: vi.fn(),
  onDeleteWorkspace: vi.fn(),
  onDeleteWorktree: vi.fn(),
  onRenameWorkspaceAlias: vi.fn(),
  onLoadOlderThreads: vi.fn(),
  onReloadWorkspaceThreads: vi.fn(),
  onQuickReloadWorkspaceThreads: vi.fn(),
  workspaceDropTargetRef: createRef<HTMLElement>(),
  isWorkspaceDropActive: false,
  workspaceDropText: "Drop Project Here",
  onWorkspaceDragOver: vi.fn(),
  onWorkspaceDragEnter: vi.fn(),
  onWorkspaceDragLeave: vi.fn(),
  onWorkspaceDrop: vi.fn(),
  appMode: "chat" as const,
  onAppModeChange: vi.fn(),
  onOpenHomeChat: vi.fn(),
  onOpenMemory: vi.fn(),
  onLockPanel: vi.fn(),
  onOpenProjectMemory: vi.fn(),
  onOpenReleaseNotes: vi.fn(),
  onOpenGlobalSearch: vi.fn(),
  globalSearchShortcut: "cmd+o",
  openChatShortcut: "cmd+j",
  onOpenSpecHub: vi.fn(),
  onOpenWorkspaceHome: vi.fn(),
};

describe("Sidebar subagent tree", () => {
  it("projects live Claude Agent tools as pending child rows under the active parent", () => {
    const onSelectThread = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        activeItems={[
          {
            id: "toolu_agent_1",
            kind: "tool",
            toolType: "agent",
            title: "Tool: Agent",
            detail: JSON.stringify({
              subagent_type: "分析",
              description: "km-chat-new-web 项目",
            }),
            status: "running",
            engineSource: "claude",
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "claude:parent-session",
              name: "同时启动2个子 agent",
              updatedAt: 500,
              engineSource: "claude",
              threadKind: "native",
            },
          ],
        }}
        onSelectThread={onSelectThread}
      />,
    );

    const parentRow = screen.getByText("同时启动2个子 agent").closest(".thread-row");
    // Subagent trees collapse by default; expand to reveal the pending child row.
    fireEvent.click(parentRow?.querySelector(".thread-tree-expander") as HTMLElement);
    const childRow = screen.getByText("分析 km-chat-new-web 项目").closest(".thread-row");
    expect(parentRow?.classList.contains("is-subagent-parent")).toBe(true);
    expect(parentRow?.classList.contains("is-active-subagent-parent")).toBe(true);
    expect(parentRow?.querySelector(".thread-tree-expander")).toBeTruthy();
    expect(childRow?.classList.contains("is-subagent")).toBe(true);
    expect(childRow?.classList.contains("is-active-subagent-group")).toBe(true);
    expect(childRow?.classList.contains("is-pending-subagent")).toBe(true);
    expect(childRow?.querySelector(".thread-subagent-branch")).toBeNull();
    expect(childRow?.querySelector(".thread-engine-badge")).toBeNull();
    expect(childRow?.querySelector(".thread-subagent-tag")).toBeTruthy();

    if (!childRow) {
      throw new Error("Missing pending child row");
    }
    fireEvent.click(childRow);
    expect(onSelectThread).toHaveBeenCalledWith("ws-1", "claude:parent-session");
  });

  it("replaces completed pending Claude child rows when the real subagent transcript exists", () => {
    render(
      <Sidebar
        {...baseProps}
        activeItems={[
          {
            id: "toolu_agent_1",
            kind: "tool",
            toolType: "agent",
            title: "Tool: Agent",
            detail: JSON.stringify({
              subagent_type: "分析",
              description: "km-chat-new-web 项目",
            }),
            status: "completed",
            output: "done",
            engineSource: "claude",
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "claude:parent-session",
              name: "同时启动2个子 agent",
              updatedAt: 500,
              engineSource: "claude",
              threadKind: "native",
            },
            {
              id: "claude:subagent:parent-session:a5e6403f261113239",
              name: "真实子会话",
              updatedAt: 510,
              engineSource: "claude",
              threadKind: "native",
              parentThreadId: "claude:parent-session",
            },
          ],
        }}
      />,
    );

    // Subagent trees collapse by default; expand the parent to reveal the real child.
    fireEvent.click(
      screen
        .getByText("同时启动2个子 agent")
        .closest(".thread-row")
        ?.querySelector(".thread-tree-expander") as HTMLElement,
    );
    const childRow = screen.getByText("真实子会话").closest(".thread-row");
    expect(childRow?.classList.contains("is-subagent")).toBe(true);
    expect(childRow?.classList.contains("is-pending-subagent")).toBe(false);
    expect(childRow?.querySelector(".thread-engine-badge")).toBeNull();
    expect(childRow?.querySelector(".thread-subagent-tag")).toBeTruthy();
    expect(screen.queryByText("分析 km-chat-new-web 项目")).toBeNull();
  });

  it("keeps catalog child sessions with null folder inside the parent session folder", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-123",
          workspaceId: "ws-1",
          parentId: null,
          name: "123",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    render(
      <Sidebar
        {...baseProps}
        activeThreadId="claude:parent-session"
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "claude:parent-session",
              name: "请同时启动2个子 a",
              updatedAt: 500,
              engineSource: "claude",
              threadKind: "native",
              folderId: "folder-123",
            },
            {
              id: "claude:subagent:parent-session:child-a",
              name: "你负责分析 `/Users`",
              updatedAt: 510,
              engineSource: "claude",
              threadKind: "native",
              parentThreadId: "claude:parent-session",
              folderId: null,
            },
          ],
        }}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "123" });
    const folderGroup = folderRow.closest(".workspace-session-folder-group") as HTMLElement | null;
    expect(folderGroup).toBeTruthy();
    if (!folderGroup) {
      throw new Error("Missing folder group");
    }
    expect(within(folderGroup).getByText("请同时启动2个子 a")).toBeTruthy();
    // Subagent trees collapse by default; expand to reveal the child inside the folder.
    fireEvent.click(
      within(folderGroup)
        .getByText("请同时启动2个子 a")
        .closest(".thread-row")
        ?.querySelector(".thread-tree-expander") as HTMLElement,
    );
    expect(within(folderGroup).getByText("你负责分析 `/Users`")).toBeTruthy();
  });

  it("moves a parent session folder assignment across its subagent descendants", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-old",
          workspaceId: "ws-1",
          parentId: null,
          name: "Old",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "folder-target",
          workspaceId: "ws-1",
          parentId: null,
          name: "Target",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });
    vi.mocked(assignWorkspaceSessionFolders).mockResolvedValue({
      results: [
        { sessionId: "claude:parent", ok: true },
        { sessionId: "claude:child-a", ok: true },
        { sessionId: "claude:child-b", ok: true },
      ],
    });

    render(
      <Sidebar
        {...baseProps}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "claude:parent",
              name: "Parent",
              updatedAt: 30,
              engineSource: "claude",
            },
            {
              id: "claude:child-a",
              name: "Child A",
              updatedAt: 20,
              engineSource: "claude",
              parentThreadId: "claude:parent",
              folderId: "folder-old",
            },
            {
              id: "claude:child-b",
              name: "Child B",
              updatedAt: 10,
              engineSource: "claude",
              parentThreadId: "claude:parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    expect(await screen.findByRole("treeitem", { name: "Target" })).toBeTruthy();
    const parentRow = await screen.findByText("Parent");
    await act(async () => {
      fireEvent.contextMenu(parentRow.closest(".thread-row") as HTMLElement);
    });
    const threadMenu = await screen.findByRole("menu", { name: "threads.threadActions" });
    await act(async () => {
      fireEvent.mouseEnter(
        within(threadMenu).getByRole("menuitem", { name: "Move to folder" }),
      );
    });
    const targetFolderItem = await screen.findByRole("menuitem", {
      name: "Target",
    });

    await act(async () => {
      fireEvent.click(targetFolderItem);
    });

    const getTargetFolderGroup = () => {
      const group = screen
        .getByRole("treeitem", { name: "Target" })
        .closest(".workspace-session-folder-group");
      if (!group) {
        throw new Error("Missing target folder group");
      }
      return group as HTMLElement;
    };

    await waitFor(() => {
      expect(assignWorkspaceSessionFolders).toHaveBeenCalledWith(
        "ws-1",
        ["claude:parent", "claude:child-a", "claude:child-b"],
        "folder-target",
      );
      expect(within(getTargetFolderGroup()).getByText("Parent")).toBeTruthy();
    });

    // The parent lands collapsed in the target folder; expand to reveal its descendants.
    fireEvent.click(
      within(getTargetFolderGroup())
        .getByText("Parent")
        .closest(".thread-row")
        ?.querySelector(".thread-tree-expander") as HTMLElement,
    );

    await waitFor(() => {
      const targetFolderGroup = getTargetFolderGroup();
      expect(within(targetFolderGroup).getByText("Child A")).toBeTruthy();
      expect(within(targetFolderGroup).getByText("Child B")).toBeTruthy();
    });
    expect(assignWorkspaceSessionFolder).not.toHaveBeenCalled();
  });
});
