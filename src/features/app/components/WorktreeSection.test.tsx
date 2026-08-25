// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorktreeSection } from "./WorktreeSection";

const worktree: WorkspaceInfo = {
  id: "wt-1",
  name: "Worktree One",
  path: "/tmp/worktree",
  connected: true,
  kind: "worktree",
  worktree: { branch: "feature/test" },
  settings: { sidebarCollapsed: false },
};

afterEach(() => {
  cleanup();
});

describe("WorktreeSection", () => {
  it("does not render older thread controls for worktrees", () => {
    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: "cursor" }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Search older..." }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Load older..." }),
    ).toBeNull();
  });

  it("shows neither an empty session message nor a loading skeleton for empty worktrees", () => {
    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: true }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    // 「暂无会话」占位已下线：空 worktree 不再渲染任何占位文案。
    expect(
      screen.queryByText(/No sessions yet\.|暂无会话|sidebar\.emptyWorkspaceSessions/i),
    ).toBeNull();
    expect(screen.queryByLabelText("Loading agents")).toBeNull();
  });

  it("renders no placeholder before worktree sessions hydrate", () => {
    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: true }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/No sessions yet\.|暂无会话|sidebar\.emptyWorkspaceSessions/i),
    ).toBeNull();
  });

  it("toggles the worktree section on double click only", () => {
    const onToggleSectionCollapse = vi.fn();

    const { container } = render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={onToggleSectionCollapse}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const header = container.querySelector(".worktree-header") as HTMLButtonElement | null;
    expect(header).toBeTruthy();
    if (!header) {
      throw new Error("Expected worktree header");
    }
    fireEvent.click(header);
    expect(onToggleSectionCollapse).not.toHaveBeenCalled();

    fireEvent.doubleClick(header);
    expect(onToggleSectionCollapse).toHaveBeenCalledWith("workspace-1");
  });

  it("toggles worktree agents on single click", () => {
    const onToggleWorkspaceCollapse = vi.fn();

    const { container } = render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const worktreeRow = container.querySelector(".worktree-row") as HTMLElement | null;
    expect(worktreeRow).toBeTruthy();
    if (!worktreeRow) {
      throw new Error("Expected worktree row");
    }

    fireEvent.click(worktreeRow);
    expect(onToggleWorkspaceCollapse).toHaveBeenCalledWith("wt-1", true);
  });

  it("renders a new session button for worktrees and does not toggle collapse when clicked", () => {
    const onShowWorktreeSessionMenu = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={onShowWorktreeSessionMenu}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const createSessionButton = screen.getByRole("button", {
      name: /新建会话|New session|New agent|sidebar\.sessionActionsGroup/i,
    });
    fireEvent.click(createSessionButton);

    expect(onShowWorktreeSessionMenu).toHaveBeenCalledTimes(1);
    expect(onShowWorktreeSessionMenu.mock.calls[0]?.[1]).toEqual(worktree);
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });

  it("passes worktree-scoped folder move targets to thread menus", () => {
    const onShowThreadMenu = vi.fn();
    const parentMoveTargets = [{ folderId: "parent-folder", label: "Parent Folder" }];
    const worktreeMoveTargets = [{ folderId: "worktree-folder", label: "Worktree Folder" }];
    const thread = {
      id: "claude:thread-1",
      name: "Worktree Session",
      updatedAt: 1000,
      engineSource: "claude" as const,
    };

    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [thread] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        moveFolderTargetsByWorkspaceId={{
          "workspace-1": parentMoveTargets,
          [worktree.id]: worktreeMoveTargets,
        }}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [{ thread, depth: 0 }],
          totalRoots: 1,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={onShowThreadMenu}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const threadRow = screen.getByText("Worktree Session").closest(".thread-row");
    expect(threadRow).toBeTruthy();
    if (!threadRow) {
      throw new Error("Expected worktree thread row");
    }
    fireEvent.contextMenu(threadRow);

    expect(onShowThreadMenu).toHaveBeenCalledTimes(1);
    expect(onShowThreadMenu.mock.calls[0]?.[1]).toBe(worktree.id);
    expect(onShowThreadMenu.mock.calls[0]?.[2]).toBe("claude:thread-1");
    expect(onShowThreadMenu.mock.calls[0]?.[5]).toBe(worktreeMoveTargets);
    expect(onShowThreadMenu.mock.calls[0]?.[5]).not.toBe(parentMoveTargets);
  });

  it("activates the worktree from the explicit main-panel action without toggling collapse", () => {
    const onSelectWorkspace = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const activateButton = screen.getByRole("button", {
      name: /切到主区|Open in main panel|sidebar\.activateWorkspace/i,
    });
    fireEvent.click(activateButton);

    expect(onSelectWorkspace).toHaveBeenCalledWith("wt-1");
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });

  it("shows a degraded refresh action for worktrees only when a reload handler exists", () => {
    const degradedWorktree: WorkspaceInfo = {
      ...worktree,
      id: "wt-degraded",
      worktree: { branch: "feature/degraded" },
    };

    const { rerender } = render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[degradedWorktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{
          [degradedWorktree.id]: [
            { id: "thread-1", name: "Alpha", updatedAt: 1000, isDegraded: true },
          ],
        }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [degradedWorktree.id]: false }}
        threadListPagingByWorkspace={{ [degradedWorktree.id]: false }}
        threadListCursorByWorkspace={{ [degradedWorktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 1,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={undefined}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Refresh incomplete thread list/i })).toBeNull();

    rerender(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[degradedWorktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{
          [degradedWorktree.id]: [
            { id: "thread-1", name: "Alpha", updatedAt: 1000, isDegraded: true },
          ],
        }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [degradedWorktree.id]: false }}
        threadListPagingByWorkspace={{ [degradedWorktree.id]: false }}
        threadListCursorByWorkspace={{ [degradedWorktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 1,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /threads\.degradedWorkspaceRefreshAriaLabel|Refresh incomplete thread list/i,
      }),
    ).toBeTruthy();
  });

  it("splits Windows-style worktree names into prefix and leaf labels", () => {
    const windowsWorktree: WorkspaceInfo = {
      ...worktree,
      id: "wt-win",
      worktree: { branch: "feature\\windows" },
    };

    const { container } = render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[windowsWorktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [windowsWorktree.id]: [] }}
        threadStatusById={{}}
        threadListLoadingByWorkspace={{ [windowsWorktree.id]: false }}
        threadListPagingByWorkspace={{ [windowsWorktree.id]: false }}
        threadListCursorByWorkspace={{ [windowsWorktree.id]: null }}
        threadListPageByWorkspace={{}}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          workspacePinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onQuickReloadWorkspaceThreads={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(container.querySelector(".worktree-label-prefix")?.textContent).toBe("feature");
    expect(container.querySelector(".worktree-label")?.textContent).toBe("windows");
  });
});
