// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSucceededWorkspaceIds,
  SessionManagementSection,
} from "./SessionManagementSection";
import type { AppSettings, WorkspaceInfo } from "../../../../../types";
import {
  archiveWorkspaceSessionsV2,
  deleteWorkspaceSessions,
  loadCodexSession,
  getWorkspaceSessionProjectionSummary,
  loadClaudeSession,
  loadGeminiSession,
  listWorkspaceSessionFolders,
  listGlobalCodexSessions,
  listProjectRelatedSessions,
  listWorkspaceSessions,
  resumeThread,
} from "../../../../../services/tauri";

vi.mock("../../../../../services/tauri", () => ({
  getWorkspaceSessionProjectionSummary: vi.fn(),
  listWorkspaceSessionFolders: vi.fn(),
  listGlobalCodexSessions: vi.fn(),
  listProjectRelatedSessions: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  archiveWorkspaceSessionsV2: vi.fn(),
  unarchiveWorkspaceSessionsV2: vi.fn(),
  deleteWorkspaceSessions: vi.fn(),
  loadClaudeSession: vi.fn(),
  loadCodexSession: vi.fn(),
  loadGeminiSession: vi.fn(),
  resumeThread: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const worktree: WorkspaceInfo = {
  id: "ws-2",
  name: "Workspace Worktree",
  path: "/tmp/worktree",
  connected: true,
  kind: "worktree",
  parentId: "ws-1",
  settings: { sidebarCollapsed: false },
};

const relatedAppSettings = {
  sessionAttributionMode: "related",
} as AppSettings;

function getEnabledButtonByName(name: string) {
  const button = screen
    .getAllByRole("button", { name })
    .find((candidate) => !(candidate as HTMLButtonElement).disabled);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function clickFirstEnabledButtonByName(name: string) {
  fireEvent.click(getEnabledButtonByName(name));
}

function getEnabledButtonByTestId(testId: string) {
  const button = screen
    .getAllByTestId(testId)
    .find((candidate) => !(candidate as HTMLButtonElement).disabled);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function getCheckboxByName(name: string) {
  const checkbox = screen.getAllByRole("checkbox", { name })[0];
  expect(checkbox).toBeTruthy();
  return checkbox as HTMLInputElement;
}

describe("SessionManagementSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1", "ws-2"],
      activeTotal: 0,
      archivedTotal: 0,
      allTotal: 0,
      filteredTotal: 0,
      partialSources: [],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValue({
      workspaceId: "ws-1",
      folders: [],
    });
    vi.mocked(listGlobalCodexSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listProjectRelatedSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(resumeThread).mockResolvedValue({
      thread: {
        turns: [],
      },
    });
    vi.mocked(loadClaudeSession).mockResolvedValue({ messages: [] });
    vi.mocked(loadCodexSession).mockResolvedValue(null);
    vi.mocked(loadGeminiSession).mockResolvedValue({ messages: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders and persists workspace session attribution mode", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        appSettings={relatedAppSettings}
        onUpdateAppSettings={onUpdateAppSettings}
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      screen.getByText("settings.sessionAttributionModeCurrent"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: /settings.sessionAttributionModeRelated/ })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(
      screen.getByRole("radio", {
        name: /settings.sessionAttributionModeWorkspaceOnly/,
      }),
    );

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionAttributionMode: "workspace-only",
        }),
      );
    });
  });

  it("shows an error when workspace session attribution mode save fails", async () => {
    const onUpdateAppSettings = vi
      .fn()
      .mockRejectedValue(new Error("settings save failed"));

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        appSettings={relatedAppSettings}
        onUpdateAppSettings={onUpdateAppSettings}
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(
      screen.getByRole("radio", {
        name: /settings.sessionAttributionModeWorkspaceOnly/,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("settings save failed")).toBeTruthy();
    });
  });

  it("passes workspace-only attribution mode into project catalog queries", async () => {
    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        appSettings={{
          sessionAttributionMode: "workspace-only",
        } as AppSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceSessions).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          query: expect.objectContaining({
            sessionAttributionMode: "workspace-only",
          }),
        }),
      );
      expect(getWorkspaceSessionProjectionSummary).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          query: expect.objectContaining({
            sessionAttributionMode: "workspace-only",
          }),
        }),
      );
    });
    expect(listProjectRelatedSessions).not.toHaveBeenCalled();
  });

  it("renders owner workspace label for aggregated project entries", async () => {
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1", "ws-2"],
      activeTotal: 2,
      archivedTotal: 0,
      allTotal: 2,
      filteredTotal: 2,
      partialSources: [],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-2",
          title: "Worktree session",
          updatedAt: 1710000000001,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Main session")).toBeTruthy();
      expect(screen.getByText("Worktree session")).toBeTruthy();
      expect(
        screen.getByText("settings.sessionManagementFilteredTotalCount"),
      ).toBeTruthy();
      expect(
        screen.getByText("settings.sessionManagementCurrentPageCount"),
      ).toBeTruthy();
    });
    screen
      .getAllByRole("button", {
        name: "settings.sessionManagementDetailToggle",
      })
      .forEach((button) => fireEvent.click(button));
    expect(screen.getAllByText("cli/codex")).toHaveLength(2);
  }, 10_000);

  it("renders workspace scope inside the left tree without a duplicate picker", async () => {
    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: /Ungrouped \/ settings\.sessionManagementScopeTagProject Workspace/,
      }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", {
        name: /Ungrouped \/ settings\.sessionManagementScopeTagWorktree Workspace Worktree/,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(
        "settings-project-sessions-workspace-picker-trigger",
      ),
    ).toBeNull();
  });

  it("renders the left project hierarchy and keeps user workspace switches as the active scope", async () => {
    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    const worktreeButton = await screen.findByRole("button", {
      name: /settings\.sessionManagementScopeTagWorktree Workspace Worktree/,
    });
    fireEvent.click(worktreeButton);

    await waitFor(() => {
      expect(listWorkspaceSessions).toHaveBeenCalledWith(
        "ws-2",
        expect.objectContaining({
          query: expect.objectContaining({ status: "active" }),
        }),
      );
    });
    await waitFor(() => {
      const lastWorkspaceListCall = vi
        .mocked(listWorkspaceSessions)
        .mock.calls.at(-1);
      expect(lastWorkspaceListCall?.[0]).toBe("ws-2");
    });
  });

  it("surfaces missing-on-disk rows for cleanup", async () => {
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1"],
      activeTotal: 0,
      archivedTotal: 1,
      allTotal: 1,
      filteredTotal: 1,
      partialSources: [],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex-missing",
          workspaceId: "ws-1",
          title: "Missing session",
          updatedAt: 42,
          engine: "codex",
          archivedAt: 42,
          threadKind: "native",
          existsOnDisk: false,
          inconsistencyCode: "missing-on-disk",
          deleteMode: "metadata-cleanup",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      await screen.findByText("settings.sessionManagementBadgeMissingOnDisk"),
    ).toBeTruthy();
  });

  it("opens an independent session curtain from the row icon", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:chat",
          workspaceId: "ws-1",
          title: "Chat session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(loadCodexSession).mockResolvedValueOnce({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Loaded assistant reply",
              },
            ],
          },
        },
      ],
    });
    vi.mocked(resumeThread).mockResolvedValueOnce({
      thread: {
        turns: [],
      },
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("Chat session")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementOpenCurtain",
      }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "settings.sessionManagementCurtainTitle",
      }),
    ).toBeTruthy();
    expect(await screen.findByText("Loaded assistant reply")).toBeTruthy();
    expect(loadCodexSession).toHaveBeenCalledWith("ws-1", "codex:chat");
    expect(resumeThread).toHaveBeenCalledWith("ws-1", "codex:chat");
  });

  it("falls back to codex resume history when local session has no visible items", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:chat",
          workspaceId: "ws-1",
          title: "Chat session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(loadCodexSession).mockResolvedValueOnce(null);
    vi.mocked(resumeThread).mockResolvedValueOnce({
      thread: {
        turns: [
          {
            items: [
              {
                id: "assistant-1",
                type: "agentMessage",
                text: "Loaded assistant reply",
              },
            ],
          },
        ],
      },
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("Chat session")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementOpenCurtain",
      }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "settings.sessionManagementCurtainTitle",
      }),
    ).toBeTruthy();
    expect(await screen.findByText("Loaded assistant reply")).toBeTruthy();
    expect(resumeThread).toHaveBeenCalledWith("ws-1", "codex:chat");
  });

  it("renders the session curtain as a read-only viewer", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:chat",
          workspaceId: "ws-1",
          title: "Chat session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(loadCodexSession).mockResolvedValueOnce({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Read-only history" }],
          },
        },
      ],
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("Chat session")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementOpenCurtain",
      }),
    );

    expect(await screen.findByText("Read-only history")).toBeTruthy();
    expect(
      screen.queryByLabelText(
        "settings.sessionManagementCurtainComposerPlaceholder",
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings.sessionManagementCurtainSend",
      }),
    ).toBeNull();
  });

  it("closes a loading session curtain when that session is deleted", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:chat",
          workspaceId: "ws-1",
          title: "Chat session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(loadCodexSession).mockReturnValueOnce(
      new Promise(() => undefined) as ReturnType<typeof loadCodexSession>,
    );
    vi.mocked(resumeThread).mockReturnValueOnce(
      new Promise(() => undefined) as ReturnType<typeof resumeThread>,
    );
    vi.mocked(deleteWorkspaceSessions).mockResolvedValue({
      results: [{ sessionId: "codex:chat", ok: true }],
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Chat session" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementOpenCurtain",
      }),
    );

    expect(
      await screen.findByText("settings.sessionManagementCurtainLoading"),
    ).toBeTruthy();
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );

    await waitFor(() => {
      expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
        "codex:chat",
      ]);
    });
    await waitFor(() => {
      expect(
        screen.queryByText("settings.sessionManagementCurtainLoading"),
      ).toBeNull();
      expect(
        screen.queryByRole("dialog", {
          name: "settings.sessionManagementCurtainTitle",
        }),
      ).toBeNull();
    });
  });

  it("keeps the codex curtain timeout visible when late sources return no messages", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:chat",
          workspaceId: "ws-1",
          title: "Chat session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    let resolveLocal!: (
      value: Awaited<ReturnType<typeof loadCodexSession>>,
    ) => void;
    let resolveResume!: (
      value: Awaited<ReturnType<typeof resumeThread>>,
    ) => void;
    vi.mocked(loadCodexSession).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLocal = resolve;
      }) as ReturnType<typeof loadCodexSession>,
    );
    vi.mocked(resumeThread).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResume = resolve;
      }) as ReturnType<typeof resumeThread>,
    );

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("Chat session")).toBeTruthy();
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementOpenCurtain",
      }),
    );

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      screen.getByText("settings.sessionManagementCurtainLoadTimeout"),
    ).toBeTruthy();

    await act(async () => {
      resolveLocal(null);
      resolveResume({ thread: { turns: [] } });
      await Promise.resolve();
    });

    expect(
      screen.getByText("settings.sessionManagementCurtainLoadTimeout"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings.sessionManagementCurtainEmpty"),
    ).toBeTruthy();
  });

  it("allows late codex curtain history to replace a timeout notice", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:chat",
          workspaceId: "ws-1",
          title: "Chat session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    let resolveLocal!: (
      value: Awaited<ReturnType<typeof loadCodexSession>>,
    ) => void;
    vi.mocked(loadCodexSession).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLocal = resolve;
      }) as ReturnType<typeof loadCodexSession>,
    );
    vi.mocked(resumeThread).mockReturnValueOnce(
      new Promise(() => undefined) as ReturnType<typeof resumeThread>,
    );

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("Chat session")).toBeTruthy();
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementOpenCurtain",
      }),
    );

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      screen.getByText("settings.sessionManagementCurtainLoadTimeout"),
    ).toBeTruthy();

    await act(async () => {
      resolveLocal({
        entries: [
          {
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Late assistant reply" }],
            },
          },
        ],
      });
      await Promise.resolve();
    });

    expect(screen.getByText("Late assistant reply")).toBeTruthy();
    expect(
      screen.queryByText("settings.sessionManagementCurtainLoadTimeout"),
    ).toBeNull();
  });

  it("renders selected project session folders and filters strict sessions by folder", async () => {
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1"],
      activeTotal: 20,
      archivedTotal: 0,
      allTotal: 20,
      filteredTotal: 20,
      folderCountsById: { "folder-a": 7, "folder-b": 3 },
      unassignedFolderCount: 10,
      partialSources: [],
    });
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValue({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-a",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "folder-b",
          workspaceId: "ws-1",
          parentId: "folder-a",
          name: "Bugs",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });
    const allFolderEntries = [
      {
        sessionId: "codex:folder",
        workspaceId: "ws-1",
        title: "Folder session",
        updatedAt: 1710000000000,
        engine: "codex",
        archivedAt: null,
        threadKind: "native",
        folderId: "folder-a",
      },
      {
        sessionId: "codex:root",
        workspaceId: "ws-1",
        title: "Root session",
        updatedAt: 1710000000001,
        engine: "codex",
        archivedAt: null,
        threadKind: "native",
        folderId: null,
      },
    ];
    vi.mocked(listWorkspaceSessions).mockImplementation(
      async (_workspaceId, options) => ({
        data:
          options?.query?.folderId === "folder-a"
            ? allFolderEntries.filter((entry) => entry.folderId === "folder-a")
            : allFolderEntries,
        nextCursor: null,
        partialSource: null,
      }),
    );

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      (await screen.findAllByText("settings.sessionManagementFolderAll"))
        .length,
    ).toBeGreaterThan(0);
    expect((await screen.findAllByText("Planning")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Bugs")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    const planningButton = (await screen.findAllByText("Planning"))[0].closest(
      "button",
    );
    expect(planningButton).toBeTruthy();
    fireEvent.click(planningButton as HTMLButtonElement);

    expect(await screen.findByText("Folder session")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Root session")).toBeNull();
    });
  });

  it("keeps child sessions visible when they inherit the parent folder", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValue({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-a",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:parent",
          workspaceId: "ws-1",
          title: "Parent session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          folderId: "folder-a",
        },
        {
          sessionId: "codex:child",
          parentSessionId: "codex:parent",
          workspaceId: "ws-1",
          title: "Child session",
          updatedAt: 1710000000001,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          folderId: null,
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Planning/ }));

    expect(await screen.findByText("Parent session")).toBeTruthy();
    expect(await screen.findByText("Child session")).toBeTruthy();
  });

  it("saves the workspace thread visibility count with clamping", async () => {
    const onUpdateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
        onUpdateWorkspaceSettings={onUpdateWorkspaceSettings}
      />,
    );

    expect(
      await screen.findByText("settings.sessionManagementCurrentPageCount"),
    ).toBeTruthy();

    const input = screen.getByTestId(
      "settings-project-sessions-visible-root-count-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.click(
      screen.getByTestId("settings-project-sessions-visible-root-count-save"),
    );

    await waitFor(() => {
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledWith("ws-1", {
        visibleThreadRootCount: 200,
      });
    });
  });

  it("does not partially parse invalid workspace thread visibility text", async () => {
    const onUpdateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
        onUpdateWorkspaceSettings={onUpdateWorkspaceSettings}
      />,
    );

    const input = screen.getByTestId(
      "settings-project-sessions-visible-root-count-input",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "12abc" } });
    });

    const saveButton = screen.getByTestId(
      "settings-project-sessions-visible-root-count-save",
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await act(async () => {
      fireEvent.blur(input);
    });

    expect(input.value).toBe("5");
    expect(onUpdateWorkspaceSettings).not.toHaveBeenCalled();
  });

  it("explains filtered total versus current page window for project scope", async () => {
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1", "ws-2"],
      activeTotal: 23,
      archivedTotal: 4,
      allTotal: 27,
      filteredTotal: 23,
      partialSources: ["codex-history-unavailable"],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: Array.from({ length: 3 }, (_, index) => ({
        sessionId: `codex:${index}`,
        workspaceId: "ws-1",
        title: `Session ${index}`,
        updatedAt: 1710000000000 + index,
        engine: "codex",
        archivedAt: null,
        threadKind: "native",
      })),
      nextCursor: "offset:3",
      requestedLimit: 100,
      effectiveLimit: 100,
      limitCapped: true,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("Session 0")).toBeTruthy();
    expect(
      screen.getAllByText("settings.sessionManagementFilteredTotalCount"),
    ).not.toHaveLength(0);
    expect(
      screen.getAllByText("settings.sessionManagementCurrentPageCount"),
    ).not.toHaveLength(0);
    expect(
      screen.getByText("settings.sessionManagementVisibleWindowHint"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings.sessionManagementActiveProjectionScopeHint"),
    ).toBeTruthy();
    expect(
      screen.getAllByText("settings.sessionManagementPartialSource"),
    ).not.toHaveLength(0);
    expect(
      screen.getByText("settings.sessionManagementPageLimitCapped"),
    ).toBeTruthy();
  });

  it("switches to global archive mode and renders unassigned history label", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listGlobalCodexSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:global",
          workspaceId: "__global_unassigned__",
          title: "Detached session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/openai",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    clickFirstEnabledButtonByName("settings.sessionManagementModeGlobal");

    expect(await screen.findByText("Detached session")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementDetailToggle",
      }),
    );
    expect(
      await screen.findByText("settings.sessionManagementWorkspaceUnassigned"),
    ).toBeTruthy();
    expect(listGlobalCodexSessions).toHaveBeenCalled();
  });

  it("renders missing timestamps as an unknown marker", async () => {
    vi.mocked(listGlobalCodexSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:global",
          workspaceId: "__global_unassigned__",
          title: "Missing timestamp session",
          updatedAt: 0,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    clickFirstEnabledButtonByName("settings.sessionManagementModeGlobal");

    expect(await screen.findByText("Missing timestamp session")).toBeTruthy();
    expect(await screen.findByText("--")).toBeTruthy();
  });

  it("keeps refresh available in global mode even when no workspace is selected", async () => {
    vi.mocked(listGlobalCodexSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[]}
        groupedWorkspaces={[]}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.sessionManagementModeGlobal",
      }),
    );

    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            name: "settings.projectSessionRefresh",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.projectSessionRefresh",
      }),
    );

    await waitFor(() => {
      expect(listGlobalCodexSessions).toHaveBeenCalledTimes(2);
    });
  });

  it("reloads the projection summary when project scope is refreshed", async () => {
    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(getWorkspaceSessionProjectionSummary).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.projectSessionRefresh",
      }),
    );

    await waitFor(() => {
      expect(getWorkspaceSessionProjectionSummary).toHaveBeenCalledTimes(2);
    });
  });

  it("explains strict empty state before redirecting users to the global archive", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      await screen.findByText(
        "settings.sessionManagementProjectEmptyStrictHint",
      ),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", {
        name: "settings.sessionManagementViewGlobalCta",
      }),
    ).toBeTruthy();
  });

  it("collects unique owner workspaces from successful mutation results", () => {
    expect(
      collectSucceededWorkspaceIds([
        {
          selectionKey: "ws-1::codex:1",
          sessionId: "codex:1",
          workspaceId: "ws-1",
          ok: true,
        },
        {
          selectionKey: "ws-2::codex:2",
          sessionId: "codex:2",
          workspaceId: "ws-2",
          ok: true,
        },
        {
          selectionKey: "ws-1::codex:3",
          sessionId: "codex:3",
          workspaceId: "ws-1",
          ok: true,
        },
        {
          selectionKey: "ws-3::codex:4",
          sessionId: "codex:4",
          workspaceId: "ws-3",
          ok: false,
          error: "failed",
          code: "DELETE_FAILED",
        },
      ]),
    ).toEqual(["ws-1", "ws-2"]);
  });

  it("renders related sessions in a dedicated inferred surface", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listProjectRelatedSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:related",
          workspaceId: "ws-2",
          matchedWorkspaceId: "ws-1",
          matchedWorkspaceLabel: "Workspace",
          attributionStatus: "inferred-related",
          attributionReason: "shared-worktree-family",
          attributionConfidence: "high",
          title: "Sibling worktree session",
          updatedAt: 1710000000002,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      await screen.findByText("settings.projectSessionEmpty"),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        "settings.sessionManagementProjectEmptyStrictHint",
      ),
    ).toBeTruthy();
    expect(
      await screen.findByText("settings.sessionManagementRelatedSectionTitle"),
    ).toBeTruthy();
    expect(await screen.findByText("Sibling worktree session")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.sessionManagementDetailToggle",
      }),
    );
    expect(
      await screen.findByText("settings.sessionManagementBadgeRelated"),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        "settings.sessionManagementAttributionReasonWorktreeFamily",
      ),
    ).toBeTruthy();
  });

  it("explains that project mode aggregates child worktrees", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      await screen.findByText("settings.sessionManagementProjectScopeHint"),
    ).toBeTruthy();
  });

  it("reloads related sessions after a successful related delete", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listProjectRelatedSessions)
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:related",
            workspaceId: "ws-2",
            matchedWorkspaceId: "ws-1",
            matchedWorkspaceLabel: "Workspace",
            attributionStatus: "inferred-related",
            attributionReason: "shared-worktree-family",
            attributionConfidence: "high",
            title: "Sibling worktree session",
            updatedAt: 1710000000002,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
        ],
        nextCursor: null,
        partialSource: null,
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: null,
        partialSource: null,
      });
    vi.mocked(deleteWorkspaceSessions).mockResolvedValue({
      results: [{ sessionId: "codex:related", ok: true }],
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Sibling worktree session" }),
    );
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );

    await waitFor(() => {
      expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-2", [
        "codex:related",
      ]);
    });
    await waitFor(() => {
      expect(listProjectRelatedSessions).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("checkbox", { name: "Sibling worktree session" }),
      ).toBeNull();
    });
  });

  it("keeps failed sessions selected after partial archive failure", async () => {
    vi.mocked(listWorkspaceSessions)
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:ok",
            workspaceId: "ws-1",
            title: "Ok session",
            updatedAt: 1710000000000,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
          {
            sessionId: "codex:failed",
            workspaceId: "ws-1",
            title: "Failed session",
            updatedAt: 1710000000001,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
        ],
        nextCursor: null,
        partialSource: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:failed",
            workspaceId: "ws-1",
            title: "Failed session",
            updatedAt: 1710000000001,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
        ],
        nextCursor: null,
        partialSource: null,
      });
    vi.mocked(archiveWorkspaceSessionsV2).mockResolvedValue({
      results: [
        { sessionId: "codex:ok", ok: true, archivedAt: 1710000000999 },
        {
          sessionId: "codex:failed",
          ok: false,
          error: "archive failed",
          code: "DELETE_FAILED",
        },
      ],
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Ok session" }),
    );
    fireEvent.click(getCheckboxByName("Failed session"));
    fireEvent.click(
      getEnabledButtonByName("settings.sessionManagementArchiveSelected"),
    );

    await waitFor(() => {
      expect(archiveWorkspaceSessionsV2).toHaveBeenCalledWith("ws-1", [
        { threadId: "codex:ok", engine: "codex" },
        { threadId: "codex:failed", engine: "codex" },
      ]);
    });

    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "Ok session" })).toBeNull();
    });

    expect(getCheckboxByName("Failed session").checked).toBe(true);
  });

  it("groups delete requests by entry owner workspace", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-2",
          title: "Worktree session",
          updatedAt: 1710000000001,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(deleteWorkspaceSessions)
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:main", ok: true }],
      })
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:worktree", ok: true }],
      });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Main session" }),
    );
    fireEvent.click(getCheckboxByName("Worktree session"));
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );

    await waitFor(() => {
      expect(deleteWorkspaceSessions).toHaveBeenNthCalledWith(1, "ws-1", [
        "codex:main",
      ]);
      expect(deleteWorkspaceSessions).toHaveBeenNthCalledWith(2, "ws-2", [
        "codex:worktree",
      ]);
    });
  });

  it("treats missing-session delete results as succeeded removals while keeping real failures selected", async () => {
    vi.mocked(listWorkspaceSessions)
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:missing",
            workspaceId: "ws-1",
            title: "Ghost session",
            updatedAt: 1710000000000,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
          },
          {
            sessionId: "codex:failed",
            workspaceId: "ws-1",
            title: "Protected session",
            updatedAt: 1710000000001,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
          },
        ],
        nextCursor: null,
        partialSource: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:failed",
            workspaceId: "ws-1",
            title: "Protected session",
            updatedAt: 1710000000001,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
          },
        ],
        nextCursor: null,
        partialSource: null,
      });
    vi.mocked(deleteWorkspaceSessions).mockResolvedValueOnce({
      results: [
        { sessionId: "codex:missing", ok: true },
        {
          sessionId: "codex:failed",
          ok: false,
          error: "permission denied",
          code: "DELETE_FAILED",
        },
      ],
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Ghost session" }),
    );
    fireEvent.click(getCheckboxByName("Protected session"));
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );

    await waitFor(() => {
      expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
        "codex:missing",
        "codex:failed",
      ]);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("checkbox", { name: "Ghost session" }),
      ).toBeNull();
    });

    expect(getCheckboxByName("Protected session").checked).toBe(true);
  });

  it("notifies every succeeded owner workspace after a cross-workspace delete", async () => {
    const onSessionsMutated = vi.fn();
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-2",
          title: "Worktree session",
          updatedAt: 1710000000001,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(deleteWorkspaceSessions)
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:main", ok: true }],
      })
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:worktree", ok: true }],
      });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace, worktree] },
        ]}
        initialWorkspaceId="ws-1"
        onSessionsMutated={onSessionsMutated}
      />,
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Main session" }),
    );
    fireEvent.click(getCheckboxByName("Worktree session"));
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );
    fireEvent.click(
      getEnabledButtonByTestId("settings-project-sessions-delete-selected"),
    );

    await waitFor(() => {
      expect(onSessionsMutated).toHaveBeenCalledTimes(2);
      expect(onSessionsMutated).toHaveBeenNthCalledWith(1, "ws-1", {
        deletedThreadIds: ["codex:main"],
      });
      expect(onSessionsMutated).toHaveBeenNthCalledWith(2, "ws-2", {
        deletedThreadIds: ["codex:worktree"],
      });
    });
    await waitFor(() => {
      expect(getWorkspaceSessionProjectionSummary).toHaveBeenCalledTimes(2);
    });
  });
});
