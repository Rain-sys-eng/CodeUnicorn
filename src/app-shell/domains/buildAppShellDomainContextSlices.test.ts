import { describe, expect, it } from "vitest";
import {
  buildCollaborationModeDomainContextSlice,
  buildModelSelectionDomainContextSlice,
  buildRuntimeDomainContextSlice,
  buildRuntimeThreadDomainContextSlice,
  buildSessionIdentityDomainContextSlice,
  buildWorkspaceCatalogDomainContextSlice,
  buildGitSurfaceDomainContextSlice,
  buildModeRoutingDomainContextSlice,
  buildAccountSurfaceDomainContextSlice,
  buildWorkspaceNavigationDomainContextSlice,
} from "./buildAppShellDomainContextSlices";

describe("buildAppShellDomainContextSlices", () => {
  it("builds runtimeThread slice with boundary and session hot fields", () => {
    const slice = buildRuntimeThreadDomainContextSlice({
      runtimeThreadBoundary: { activeThreadId: "t1" },
      // S4 PR-D：turn 级 conversation bags
      historyLoadingByThreadId: { t1: true },
      historyLoadingProgressByThreadId: { t1: 0.5 },
      historyRestoredAtMsByThread: { t1: 123 },
      threadListCursorByWorkspace: { "ws-1": "cursor" },
      threadListPagingByWorkspace: { "ws-1": true },
      threadParentById: { t1: "parent" },
      // S4 PR-C：conversation UI + review-prompt 流程
      handleCopyThread: () => {},
      handleDeleteThreadPromptCancel: () => {},
      handleDeleteThreadPromptConfirm: () => {},
      handleRenamePromptCancel: () => {},
      handleRenamePromptChange: () => {},
      handleRenamePromptConfirm: () => {},
      handleRenameThread: () => {},
      hydratedThreadListWorkspaceIds: ["ws-1"],
      isDeleteThreadPromptBusy: false,
      choosePreset: () => {},
      handleReviewPromptKeyDown: () => {},
      handleSelectCommit: () => {},
      handleSelectStatusPanelSubagent: () => {},
      highlightedBranchIndex: 0,
      highlightedCommitIndex: 0,
      highlightedPresetIndex: 0,
      // S4 PR-E：thread 级动作与 review/highlight setters（归位）
      isThreadAutoNaming: false,
      isThreadPinned: false,
      listThreadsForWorkspaceTracked: async () => {},
      loadOlderThreadsForWorkspace: async () => {},
      openDeleteThreadPrompt: () => {},
      pinThread: () => {},
      pinnedThreadsVersion: 0,
      refreshThread: async () => {},
      renamePrompt: null,
      setHighlightedBranchIndex: () => {},
      setHighlightedCommitIndex: () => {},
      setHighlightedPresetIndex: () => {},
      showPresetStep: () => {},
      startCompact: async () => {},
      toggleCompletionEmailIntent: () => {},
      triggerAutoThreadTitle: () => {},
      unpinThread: () => {},
      updateCustomInstructions: async () => {},
      userInputRequests: [],
      sessionHot: {
        activeItems: [],
        activePlan: null,
        activeRateLimits: null,
        activeTokenUsage: null,
        activeTurnId: "turn-1",
        canInterrupt: true,
        isProcessing: true,
        isReviewing: false,
        timelinePlan: null,
      },
    });
    expect(slice.legacy).toBeUndefined();
    expect(slice.handleToggleTerminalPanel).toBeUndefined();
    expect(slice.runtimeThreadBoundary).toEqual({ activeThreadId: "t1" });
    expect(slice.isProcessing).toBe(true);
    expect(slice.canInterrupt).toBe(true);
    expect(slice.activeTurnId).toBe("turn-1");
    expect(slice.historyLoadingByThreadId).toEqual({ t1: true });
    expect(slice.threadParentById).toEqual({ t1: "parent" });
    expect(slice.threadListCursorByWorkspace).toEqual({ "ws-1": "cursor" });
    // S4 PR-C：conversation UI / review-prompt keys 进入 runtimeThread slice
    expect(slice.hydratedThreadListWorkspaceIds).toEqual(["ws-1"]);
    expect(slice.highlightedPresetIndex).toBe(0);
    expect(typeof slice.handleCopyThread).toBe("function");
    expect(typeof slice.choosePreset).toBe("function");
  });

  it("builds model selection slice with only model keys", () => {
    const slice = buildModelSelectionDomainContextSlice({
      effectiveModels: [],
      effectiveReasoningSupported: true,
      effectiveSelectedModel: null,
      effectiveSelectedModelId: "m1",
      providerModelCatalogs: {},
      reasoningOptions: [],
      reasoningSupported: true,
      refreshEngineModels: () => {},
      resolvedEffort: null,
      resolvedModel: null,
      selectedEffort: null,
      selectedModelId: "m1",
      setSelectedEffort: () => {},
      setSelectedModelId: () => {},
      // S4 PR-C：模型/engine 选择动作
      availableEngines: ["claude"],
      handleOpenModelSettings: () => {},
      handleRefreshModelConfig: () => {},
      handleSelectModel: () => {},
      handleSelectOpenCodeAgent: () => {},
      handleSelectOpenCodeVariant: () => {},
      // S4 PR-E：engine 刷新（归位）
      refreshEngines: async () => {},
      isModelConfigRefreshing: false,
    });
    expect(Object.keys(slice).sort()).toEqual(
      [
        "availableEngines",
        "effectiveModels",
        "effectiveReasoningSupported",
        "effectiveSelectedModel",
        "effectiveSelectedModelId",
        "handleOpenModelSettings",
        "handleRefreshModelConfig",
        "handleSelectModel",
        "handleSelectOpenCodeAgent",
        "handleSelectOpenCodeVariant",
        "isModelConfigRefreshing",
        "providerModelCatalogs",
        "reasoningOptions",
        "reasoningSupported",
        "refreshEngines",
        "refreshEngineModels",
        "resolvedEffort",
        "resolvedModel",
        "selectedEffort",
        "selectedModelId",
        "setSelectedEffort",
        "setSelectedModelId",
      ].sort(),
    );
  });

  it("builds collaboration and runtime slices", () => {
    const collab = buildCollaborationModeDomainContextSlice({
      applySelectedCollaborationMode: () => {},
      collaborationModePayload: null,
      collaborationModes: [],
      collaborationModesEnabled: true,
      collaborationRuntimeModeByThread: {},
      collaborationUiModeByThread: {},
      handleCollaborationModeResolved: () => {},
      resolveCollaborationRuntimeMode: () => null,
      resolveCollaborationUiMode: () => null,
      selectedCollaborationMode: null,
      selectedCollaborationModeId: null,
      setCodexCollaborationMode: () => {},
      setCollaborationRuntimeModeByThread: () => {},
      setCollaborationUiModeByThread: () => {},
      setSelectedCollaborationModeId: () => {},
    });
    expect(collab.collaborationModesEnabled).toBe(true);

    const runtime = buildRuntimeDomainContextSlice({
      runtimeRunState: { phase: "idle" },
    });
    expect(runtime).toEqual({ runtimeRunState: { phase: "idle" } });
  });

  it("builds sessionIdentity slice with only identity keys (T1.2)", () => {
    const slice = buildSessionIdentityDomainContextSlice({
      RECENT_THREAD_LIMIT: 20,
      activeParentWorkspace: null,
      activePath: "/repo",
      activeThreadId: "thread-1",
      activeThreadIdForModeRef: { current: "thread-1" },
      activeThreadIdRef: { current: "thread-1" },
      activeWorkspace: { id: "ws-1" },
      activeWorkspaceId: "ws-1",
      activeWorkspaceIdRef: { current: "ws-1" },
      activeWorkspaceRef: { current: { id: "ws-1" } },
      activeWorkspaceThreads: [],
      // S4 PR-E：identity setters 与 state 同域
      setActiveThreadId: () => {},
      setActiveWorkspaceId: () => {},
      baseWorkspaceRef: { current: null },
    });
    expect(Object.keys(slice).sort()).toEqual(
      [
        "RECENT_THREAD_LIMIT",
        "activeParentWorkspace",
        "activePath",
        "activeThreadId",
        "activeThreadIdForModeRef",
        "activeThreadIdRef",
        "activeWorkspace",
        "activeWorkspaceId",
        "activeWorkspaceIdRef",
        "activeWorkspaceRef",
        "activeWorkspaceThreads",
        "setActiveThreadId",
        "setActiveWorkspaceId",
        "baseWorkspaceRef",
      ].sort(),
    );
    expect(slice.activeWorkspaceId).toBe("ws-1");
    expect(slice.activeThreadId).toBe("thread-1");
  });

  it("builds workspaceCatalog slice with catalog keys only (T1.3)", () => {
    const slice = buildWorkspaceCatalogDomainContextSlice({
      addCloneAgent: () => {},
      addWorkspace: () => {},
      addWorkspaceFromPath: async () => {},
      addWorktreeAgent: () => {},
      assignWorkspaceGroup: () => {},
      cancelClonePrompt: () => {},
      cancelWorktreePrompt: () => {},
      chooseCloneCopiesFolder: async () => {},
      clearCloneCopiesFolder: () => {},
      clonePrompt: null,
      closeWorktreeCreateResult: () => {},
      confirmClonePrompt: async () => {},
      confirmRenameWorktreeUpstream: async () => {},
      confirmWorktreePrompt: async () => {},
      connectWorkspace: async () => {},
      createWorkspaceGroup: () => {},
      deleteWorkspaceGroup: () => {},
      deletingWorktreeIds: new Set(),
      directories: [],
      directoryMetadata: {},
      ensureWorkspaceThreadListLoaded: async () => {},
      forkThreadForWorkspace: async () => {},
      forkSessionFromMessageForWorkspace: async () => {},
      forkClaudeSessionFromMessageForWorkspace: async () => {},
      getWorkspaceGroupName: () => "",
      getWorkspacePromptsDir: () => "",
      repositories: [],
      repositoriesLoading: false,
      isMultiRepository: false,
      // S4 PR-C：workspace/agent 入口与拖放 intake
      groupedWorkspaces: [],
      handleAddAgent: () => {},
      handleAddCloneAgent: () => {},
      handleAddWorkspace: () => {},
      handleAddWorktreeAgent: () => {},
      handleArchiveActiveThread: () => {},
      handleEnsureWorkspaceThreadsForSettings: async () => {},
      handleOpenNewWindow: () => {},
      handleWorkspaceDragEnter: () => {},
      handleWorkspaceDragLeave: () => {},
      handleWorkspaceDragOver: () => {},
      // S4 PR-E：worktree/clone/workspace 设置与目录态（归位）
      gitignoredDirectories: [],
      gitignoredFiles: [],
      homeWorkspaceSelectedId: null,
      isWorkspaceDropActive: false,
      isWorktreeWorkspace: false,
      launchScriptState: null,
      launchScriptsState: null,
      removeWorkspace: async () => {},
      removeWorktree: async () => {},
      moveWorkspaceGroup: () => {},
      renameWorkspaceGroup: () => {},
      setWorkspaceHomeWorkspaceId: () => {},
      ungroupedLabel: "Ungrouped",
      updateCloneCopyName: () => {},
      updateWorkspaceCodexBin: async () => {},
      updateWorkspaceSettings: async () => {},
      updateWorktreeBaseRef: () => {},
      updateWorktreeBranch: () => {},
      updateWorktreePublishToOrigin: () => {},
      updateWorktreeSetupScript: () => {},
      useSuggestedCloneCopiesFolder: () => {},
      workspaceGroups: [],
      workspaces: [],
      workspacesById: new Map(),
      workspacesByPath: new Map(),
      worktreeApplyError: null,
      worktreeApplyLoading: false,
      worktreeApplySuccess: null,
      worktreeCreateResult: null,
      worktreeLabel: null,
      worktreePrompt: null,
      worktreeRename: null,
      handleWorkspaceDrop: () => {},
    });
    expect(slice).toHaveProperty("addWorkspace");
    expect(slice).toHaveProperty("connectWorkspace");
    expect(slice).toHaveProperty("repositories");
    expect(slice).toHaveProperty("groupedWorkspaces");
    expect(slice).toHaveProperty("handleAddWorkspace");
    expect(slice).not.toHaveProperty("activeWorkspaceId");
    expect(slice).not.toHaveProperty("activeDiffs");
  });

  it("builds gitSurface slice with git keys only (T1.4)", () => {
    const slice = buildGitSurfaceDomainContextSlice({
      GitHubPanelData: null,
      activeDiffError: null,
      activeDiffLoading: false,
      activeDiffs: [],
      activeGitRoot: null,
      activeGitHistoryTabId: null,
      branchError: null,
      branches: [],
      clearGitOperationErrors: () => {},
      commitError: null,
      commitLoading: false,
      commitMessage: "",
      commitMessageError: null,
      commitMessageLoading: false,
      confirmBranch: async () => {},
      confirmCommit: async () => {},
      currentBranch: null,
      diffScrollRequestId: 0,
      diffSource: null,
      fileStatus: null,
      gitDiffListView: "list",
      gitDiffViewStyle: "unified",
      gitHistoryPanelHeight: 200,
      gitIssues: [],
      gitIssuesError: null,
      gitIssuesLoading: false,
      gitIssuesTotal: 0,
      gitLogAhead: 0,
      gitLogAheadEntries: [],
      gitLogBehind: 0,
      gitLogBehindEntries: [],
      gitLogEntries: [],
      gitLogError: null,
      gitLogLoading: false,
      gitLogTotal: 0,
      gitLogUpstream: null,
      gitPanelMode: "status",
      gitPullRequestComments: [],
      gitPullRequestCommentsError: null,
      gitPullRequestCommentsLoading: false,
      gitPullRequests: [],
      gitPullRequestsError: null,
      gitPullRequestsLoading: false,
      gitPullRequestsTotal: 0,
      gitRemoteUrl: null,
      gitRootCandidates: [],
      gitRootScanDepth: 2,
      gitRootScanError: null,
      gitRootScanHasScanned: false,
      gitRootScanLoading: false,
      gitStatus: null,
      localBranches: [],
      remoteBranches: [],
      repositoryError: null,
      repositoryStatuses: {},
      repositoryStatusesLoading: false,
      refreshRepositoryStatuses: async () => {},
      handleStageRepositoryFile: async () => {},
      handleUnstageRepositoryFile: async () => {},
      handleUnstageRepositoryAll: async () => {},
      handleUnstageRepositoryFiles: async () => {},
      handleRevertRepositoryFile: async () => {},
      handleRevertRepositoryFiles: async () => {},
      handleStageRepositoryAll: async () => {},
      handleCommitRepositories: async () => {},
      repositoryCommitSummary: null,
      selectRepository: () => {},
      // S4 PR-E：git state setters 与刷新动作（归位）
      queueGitStatusRefresh: () => {},
      refreshGitDiffs: async () => {},
      refreshGitLog: async () => {},
      setGitDiffListView: () => {},
      setGitDiffViewStyle: () => {},
      setGitRootScanDepth: () => {},
      selectedRepositoryRoot: null,
    } as any);
    expect(slice).toHaveProperty("gitStatus");
    expect(slice).toHaveProperty("activeDiffs");
    expect(slice).not.toHaveProperty("activeWorkspaceId");
    expect(slice).not.toHaveProperty("addWorkspace");
  });

  it("builds modeRouting slice with mode keys only (T1.5)", () => {
    const slice = buildModeRoutingDomainContextSlice({
      accessMode: "default",
      activeTab: "chat",
      appMode: "chat",
      centerMode: "chat",
      claudeAccessModeRef: { current: "default" },
      filePanelMode: "files",
      // S4 PR-C：UI 模式/面板路由与环境标志
      handleAppModeChange: () => {},
      handleDebugClick: () => {},
      handleLockPanel: () => {},
      handleResolvedClaudeThinkingVisibleChange: () => {},
      handleToggleRuntimeConsole: () => {},
      handleToggleTerminalPanel: () => {},
      handleUnlockPanel: () => {},
      hasActivePlan: false,
      isCompact: false,
      isMacDesktop: true,
      isPanelLocked: false,
      isPhone: false,
      // S4 PR-E：mode/surface 路由 setters 与环境标志（归位）
      exitDiffView: () => {},
      isTablet: false,
      isWindowsDesktop: false,
      setActiveTab: () => {},
      setAppMode: () => {},
      setCenterMode: () => {},
      setFilePanelMode: () => {},
      setHomeOpen: () => {},
      setIsSearchPaletteOpen: () => {},
      showExtensions: false,
      showGitHistory: false,
      showHome: false,
      showWorkspaceHome: false,
      isSearchPaletteOpen: false,
    });
    expect(Object.keys(slice).sort()).toEqual(
      [
        "accessMode",
        "activeTab",
        "appMode",
        "centerMode",
        "claudeAccessModeRef",
        "filePanelMode",
        "handleAppModeChange",
        "handleDebugClick",
        "handleLockPanel",
        "handleResolvedClaudeThinkingVisibleChange",
        "handleToggleRuntimeConsole",
        "handleToggleTerminalPanel",
        "handleUnlockPanel",
        "hasActivePlan",
        "isCompact",
        "isMacDesktop",
        "isPanelLocked",
        "isPhone",
        "isSearchPaletteOpen",
        "exitDiffView",
        "isTablet",
        "isWindowsDesktop",
        "setActiveTab",
        "setAppMode",
        "setCenterMode",
        "setFilePanelMode",
        "setHomeOpen",
        "setIsSearchPaletteOpen",
        "showExtensions",
        "showGitHistory",
        "showHome",
        "showWorkspaceHome",
      ].sort(),
    );
    expect(slice.appMode).toBe("chat");
    expect(slice).not.toHaveProperty("activeWorkspaceId");
  });

  it("builds accountSurface slice with account keys only (T1.6)", () => {
    const slice = buildAccountSurfaceDomainContextSlice({
      accountByWorkspace: {},
      accountSwitching: false,
      activeAccount: null,
      approvals: [],
      // S4 PR-C：账号切换 / 审批 / 邮件会话入口
      handleApprovalBatchAccept: () => {},
      handleApprovalDecision: () => {},
      handleApprovalRemember: () => {},
      handleCancelSwitchAccount: () => {},
      handleOpenMailSession: () => {},
      // S4 PR-E：账号 rate limit 刷新（归位）
      refreshAccountRateLimits: async () => {},
      handleSwitchAccount: () => {},
    });
    expect(Object.keys(slice).sort()).toEqual(
      [
        "accountByWorkspace",
        "accountSwitching",
        "activeAccount",
        "approvals",
        "handleApprovalBatchAccept",
        "handleApprovalDecision",
        "handleApprovalRemember",
        "handleCancelSwitchAccount",
        "handleOpenMailSession",
        "handleSwitchAccount",
        "refreshAccountRateLimits",
      ].sort(),
    );
    expect(slice.accountSwitching).toBe(false);
    expect(slice).not.toHaveProperty("appMode");
  });

  it("builds workspaceNavigation residual slice (T1.9)", () => {
    const slice = buildWorkspaceNavigationDomainContextSlice({
      SettingsView: null,
      activeEditorFilePath: null,
      activeEditorLineRange: null,
      activeEngine: null,
      fileCompareSession: null,
      fileHistoryTabs: [],
      activeRenamePrompt: null,
      agentTaskScrollRequest: null,
      activeTerminalId: null,
      addDebugEntry: () => {},
      alertError: () => {},
      appRootRef: { current: null },
      appSettings: {},
      appSettingsLoading: false,
      claudeThinkingVisible: false,
      clearDebugEntries: () => {},
      clearDraftForThread: () => {},
      closePlanPanel: () => {},
      checkForUpdates: () => {},
      closeReleaseNotes: () => {},
      closeReviewPrompt: () => {},
      closeSettings: () => {},
      closeTerminalPanel: () => {},
      collapseRightPanel: () => {},
      collapseSidebar: () => {},
      commands: [],
      completionEmailIntentByThread: {},
      completionTrackerBySessionRef: { current: {} },
      completionTrackerReadyRef: { current: false },
      confirmCustom: () => {},
      createPrompt: () => {},
      debugEntries: [],
      debugOpen: false,
      debugPanelHeight: 0,
      deletePrompt: () => {},
      deleteThreadPrompt: null,
      dismissErrorToast: () => {},
      dismissUpdate: () => {},
      doctor: null,
      claudeDoctor: null,
      kimiDoctor: null,
      grokDoctor: null,
      opencodeDoctor: null,
      piDoctor: null,
      qoderDoctor: null,
      editorHighlightTarget: null,
      editorNavigationTarget: null,
      editorSplitCompanion: null,
      editorSplitLayout: null,
      engineModelsAsOptions: [],
      engineSelectedModelIdByType: {},
      engineStatuses: {},
      ensureLaunchTerminal: () => {},
      ensureTerminalWithTitle: () => {},
      errorToasts: [],
      expandRightPanel: () => {},
      expandSidebar: () => {},
      fileReferenceMode: null,
      fileTreeLoadError: null,
      fileTreeSourceVersion: 0,
      files: [],
      getGlobalPromptsDir: () => "",
      getPinTimestamp: () => 0,
      getThreadRows: () => [],
      globalSearchFilesByWorkspace: {},
      // S4 PR-C：debug/updater 动作
      handleCopyDebug: () => {},
      // S4 PR-E：editor/appSettings setters 与 releaseNotes 态（归位）
      openReleaseNotes: () => {},
      releaseNotesActiveIndex: 0,
      releaseNotesEntries: [],
      releaseNotesError: null,
      releaseNotesLoading: false,
      releaseNotesOpen: false,
      setActiveEditorLineRange: () => {},
      setActiveEngine: () => {},
      setAppSettings: () => {},
      setEditorSplitCompanion: () => {},
      setEditorSplitLayout: () => {},
      setFileReferenceMode: () => {},
      handleTestNotificationSound: () => {},
    } as any);
    // S4 PR-F 咬实测：qoderDoctor 入账 workspaceNavigation 后 78 → 79（贴 navigation hard ≤ 79 顶）。
    expect(Object.keys(slice).length).toBe(79);
    expect(slice).toHaveProperty("appSettings");
    expect(slice).not.toHaveProperty("activeWorkspaceId");
    expect(slice).not.toHaveProperty("gitStatus");
    // S4 PR-C：composer 输入态已归 composerContext，不再污染 navigation
    expect(slice).not.toHaveProperty("activeImages");
    expect(slice).not.toHaveProperty("composerInsert");
    expect(slice).not.toHaveProperty("choosePreset");
  });
});
