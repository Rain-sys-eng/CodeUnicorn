import { useWorkspaceRefreshOnFocus } from "../../features/workspaces/hooks/useWorkspaceRefreshOnFocus";
import { useWorkspaceRestore } from "../../features/workspaces/hooks/useWorkspaceRestore";
import { useWorktreePrompt } from "../../features/workspaces/hooks/useWorktreePrompt";
import { useWorkspaceSelection } from "../../features/workspaces/hooks/useWorkspaceSelection";
import { useWorkspaceActions } from "../../features/app/hooks/useWorkspaceActions";
import { useAppShellSearchRadarSection } from "../sections/useAppShellSearchRadarSection";
import { useAppShellWorkspaceFlowsSection } from "../sections/useAppShellWorkspaceFlowsSection";
import { useWorkspacePathsIntake } from "../sections/useWorkspacePathsIntake";
import { useAppShellWorktreeChromeSection } from "../sections/useAppShellWorktreeChromeSection";
import { useAppShellViewStateSection } from "../sections/useAppShellViewStateSection";
import { useAppShellDesktopChrome } from "../sections/useAppShellDesktopChrome";
import { useAppShellQuickSwitcherSection } from "../sections/useAppShellQuickSwitcherSection";
import { resolveAppShellFeatureActivation } from "./appShellFeatureActivation";
import { useHostFields, usePublishHostSlice } from "./appShellHostBus";

const SESSION_FIELDS = [
  "activeTab",
  "activeWorkspace",
  "activeWorkspaceId",
  "addCloneAgent",
  "addDebugEntry",
  "addWorkspace",
  "addWorkspaceFromPath",
  "addWorktreeAgent",
  "appMode",
  "appSettings",
  "closeSettings",
  "closeTerminalPanel",
  "collapseRightPanel",
  "composerInputRef",
  "completionTrackerBySessionRef",
  "completionTrackerReadyRef",
  "connectWorkspace",
  "expandRightPanel",
  "globalSearchFilesByWorkspace",
  "handleToggleTerminal",
  "hasLoaded",
  "hideLoadingProgressDialog",
  "homeOpen",
  "homeWorkspaceDefaultId",
  "isCompact",
  "isPhone",
  "isSearchPaletteOpen",
  "isTablet",
  "openSettings",
  "openTerminal",
  "queueSaveSettings",
  "refreshWorkspaces",
  "rightPanelCollapsed",
  "renameWorktree",
  "renameWorktreeUpstream",
  "searchContentFilters",
  "searchPaletteQuery",
  "searchScope",
  "setActiveTab",
  "setActiveWorkspaceId",
  "setAgentTaskScrollRequest",
  "setAppMode",
  "setAppSettings",
  "setGlobalSearchFilesByWorkspace",
  "setHomeOpen",
  "setIsSearchPaletteOpen",
  "showLoadingProgressDialog",
  "t",
  "tabletTab",
  "terminalOpen",
  "updateWorkspaceSettings",
  "workspaces",
  "workspacesById",
] as const;

const CATALOG_FIELDS = [
  "activeEngine",
  "commands",
  "directories",
  "fileTreeSourceVersion",
  "files",
  "isFilesLoading",
  "selectedCollaborationMode",
  "setActiveEngine",
  "skills",
] as const;

const GIT_FIELDS = [
  "activeEditorFilePath",
  "alertError",
  "centerMode",
  "filePanelMode",
  "gitPanelMode",
  "handleOpenFile",
  "setCenterMode",
  "setFilePanelMode",
  "setSelectedDiffPath",
] as const;

const RUNTIME_FIELDS = [
  "activeItems",
  "activePlan",
  "activeThreadId",
  "isProcessing",
  "lastAgentMessageByThread",
  "listThreadsForWorkspace",
  "refreshThread",
  "resetWorkspaceThreads",
  "setActiveThreadId",
  "startThreadForWorkspace",
  "threadItemsByThread",
  "threadListLoadingByWorkspace",
  "threadParentById",
  "threadStatusById",
  "threadsByWorkspace",
] as const;

const COMPOSER_FIELDS = [
  "clearDraftForThread",
  "getActiveDraft",
  "handleDraftChange",
  "removeImagesForThread",
] as const;

/** 刀 3：workspace flows / radar / worktree / restore Host。 */
export function useAppShellWorkspaceFlowsHost() {
  const session = useHostFields("session", SESSION_FIELDS);
  const catalog = useHostFields("catalog", CATALOG_FIELDS);
  const git = useHostFields("git", GIT_FIELDS);
  const runtime = useHostFields("runtime", RUNTIME_FIELDS);
  const composer = useHostFields("composer", COMPOSER_FIELDS);
  const pick = (bag: Record<string, unknown>, key: string) => bag[key] as any;
  const activeTab = pick(session, "activeTab");
  const activeWorkspace = pick(session, "activeWorkspace");
  const activeWorkspaceId = pick(session, "activeWorkspaceId");
  const addCloneAgent = pick(session, "addCloneAgent");
  const addDebugEntry = pick(session, "addDebugEntry");
  const addWorkspace = pick(session, "addWorkspace");
  const addWorkspaceFromPath = pick(session, "addWorkspaceFromPath");
  const addWorktreeAgent = pick(session, "addWorktreeAgent");
  const appMode = pick(session, "appMode");
  const appSettings = pick(session, "appSettings");
  const closeSettings = pick(session, "closeSettings");
  const closeTerminalPanel = pick(session, "closeTerminalPanel");
  const collapseRightPanel = pick(session, "collapseRightPanel");
  const composerInputRef = pick(session, "composerInputRef");
  const completionTrackerBySessionRef = pick(session, "completionTrackerBySessionRef");
  const completionTrackerReadyRef = pick(session, "completionTrackerReadyRef");
  const connectWorkspace = pick(session, "connectWorkspace");
  const expandRightPanel = pick(session, "expandRightPanel");
  const globalSearchFilesByWorkspace = pick(session, "globalSearchFilesByWorkspace");
  const handleToggleTerminal = pick(session, "handleToggleTerminal");
  const hasLoaded = pick(session, "hasLoaded");
  const hideLoadingProgressDialog = pick(session, "hideLoadingProgressDialog");
  const homeOpen = pick(session, "homeOpen");
  const homeWorkspaceDefaultId = pick(session, "homeWorkspaceDefaultId");
  const isCompact = pick(session, "isCompact");
  const isPhone = pick(session, "isPhone");
  const isSearchPaletteOpen = pick(session, "isSearchPaletteOpen");
  const isTablet = pick(session, "isTablet");
  const openSettings = pick(session, "openSettings");
  const openTerminal = pick(session, "openTerminal");
  const queueSaveSettings = pick(session, "queueSaveSettings");
  const refreshWorkspaces = pick(session, "refreshWorkspaces");
  const rightPanelCollapsed = pick(session, "rightPanelCollapsed");
  const renameWorktree = pick(session, "renameWorktree");
  const renameWorktreeUpstream = pick(session, "renameWorktreeUpstream");
  const searchContentFilters = pick(session, "searchContentFilters");
  const searchPaletteQuery = pick(session, "searchPaletteQuery");
  const searchScope = pick(session, "searchScope");
  const setActiveTab = pick(session, "setActiveTab");
  const setActiveWorkspaceId = pick(session, "setActiveWorkspaceId");
  const setAgentTaskScrollRequest = pick(session, "setAgentTaskScrollRequest");
  const setAppMode = pick(session, "setAppMode");
  const setAppSettings = pick(session, "setAppSettings");
  const setGlobalSearchFilesByWorkspace = pick(session, "setGlobalSearchFilesByWorkspace");
  const setHomeOpen = pick(session, "setHomeOpen");
  const setIsSearchPaletteOpen = pick(session, "setIsSearchPaletteOpen");
  const showLoadingProgressDialog = pick(session, "showLoadingProgressDialog");
  const t = pick(session, "t");
  const tabletTab = pick(session, "tabletTab");
  const terminalOpen = pick(session, "terminalOpen");
  const updateWorkspaceSettings = pick(session, "updateWorkspaceSettings");
  const workspaces = pick(session, "workspaces");
  const workspacesById = pick(session, "workspacesById");
  const activeEngine = pick(catalog, "activeEngine");
  const commands = pick(catalog, "commands");
  const directories = pick(catalog, "directories");
  const fileTreeSourceVersion = pick(catalog, "fileTreeSourceVersion");
  const files = pick(catalog, "files");
  const isFilesLoading = pick(catalog, "isFilesLoading");
  const selectedCollaborationMode = pick(catalog, "selectedCollaborationMode");
  const setActiveEngine = pick(catalog, "setActiveEngine");
  const skills = pick(catalog, "skills");
  const activeEditorFilePath = pick(git, "activeEditorFilePath");
  const alertError = pick(git, "alertError");
  const centerMode = pick(git, "centerMode");
  const filePanelMode = pick(git, "filePanelMode");
  const handleOpenFile = pick(git, "handleOpenFile");
  const setCenterMode = pick(git, "setCenterMode");
  const setFilePanelMode = pick(git, "setFilePanelMode");
  const setGitPanelMode = pick(git, "setGitPanelMode");
  const setSelectedDiffPath = pick(git, "setSelectedDiffPath");
  const activeItems = pick(runtime, "activeItems");
  const activeThreadId = pick(runtime, "activeThreadId");
  const isProcessing = pick(runtime, "isProcessing");
  const lastAgentMessageByThread = pick(runtime, "lastAgentMessageByThread");
  const listThreadsForWorkspace = pick(runtime, "listThreadsForWorkspace");
  const refreshThread = pick(runtime, "refreshThread");
  const resetWorkspaceThreads = pick(runtime, "resetWorkspaceThreads");
  const setActiveThreadId = pick(runtime, "setActiveThreadId");
  const startThreadForWorkspace = pick(runtime, "startThreadForWorkspace");
  const threadItemsByThread = pick(runtime, "threadItemsByThread");
  const threadListLoadingByWorkspace = pick(runtime, "threadListLoadingByWorkspace");
  const threadParentById = pick(runtime, "threadParentById");
  const threadStatusById = pick(runtime, "threadStatusById");
  const threadsByWorkspace = pick(runtime, "threadsByWorkspace");
  const clearDraftForThread = pick(composer, "clearDraftForThread");
  const getActiveDraft = pick(composer, "getActiveDraft");
  const handleDraftChange = pick(composer, "handleDraftChange");
  const removeImagesForThread = pick(composer, "removeImagesForThread");
  const activation = resolveAppShellFeatureActivation({
    appMode,
    isSearchPaletteOpen: Boolean(isSearchPaletteOpen),
  });

  const { exitDiffView, selectWorkspace, selectHome } = useWorkspaceSelection({
    workspaces,
    isCompact,
    activeWorkspaceId,
    setActiveTab,
    setActiveWorkspaceId,
    updateWorkspaceSettings,
    setCenterMode,
    setSelectedDiffPath,
  });

  const activePlan = pick(runtime, "activePlan");
  const {
    closePlanPanel,
    hasActivePlan,
    isPlanMode,
    isPlanPanelDismissed,
    openPlanPanel,
    setWorkspaceHomeWorkspaceId,
    showGitHistory,
    showExtensions,
    showHome,
    showWorkspaceHome,
  } = useAppShellViewStateSection({
    activePlan,
    activeTab,
    activeThreadId,
    activeEditorFilePath,
    activeWorkspace,
    activeWorkspaceId,
    appMode,
    expandRightPanel,
    homeOpen,
    homeWorkspaceDefaultId,
    isCompact,
    isTablet,
    selectedCollaborationMode,
    setActiveThreadId,
    setActiveWorkspaceId,
    setHomeOpen,
    tabletTab,
  });

  const {
    activePath,
    activeWorkspaceThreads,
    ensureWorkspaceThreadListLoaded,
    handleEnsureWorkspaceThreadsForSettings,
    handleInsertComposerText,
    hydratedThreadListWorkspaceIds,
    listThreadsForWorkspaceTracked,
    lockLiveSessions,
    RECENT_THREAD_LIMIT,
    recentThreads,
    searchApiHydrationStatus,
    searchFileHydrationStatus,
    searchResults,
    sessionRadarFeed,
    workspaceActivity,
  } = useAppShellSearchRadarSection({
    activeItems,
    activeThreadId,
    activeWorkspace,
    activeWorkspaceId,
    appSettings,
    commands,
    composerInputRef,
    completionTrackerBySessionRef,
    completionTrackerReadyRef,
    directories,
    filePanelMode,
    fileTreeSourceVersion,
    files,
    getActiveDraft,
    globalSearchFilesByWorkspace,
    handleDraftChange,
    isCompact,
    isFilesLoading,
    isProcessing,
    isSearchPaletteOpen: activation.isSearchQueryEnabled,
    lastAgentMessageByThread,
    listThreadsForWorkspace,
    rightPanelCollapsed,
    searchContentFilters,
    searchPaletteQuery,
    searchScope,
    setGlobalSearchFilesByWorkspace,
    skills,
    t,
    threadItemsByThread,
    threadListLoadingByWorkspace,
    threadParentById,
    threadStatusById,
    threadsByWorkspace,
    workspaces,
    workspacesById,
  });
  const {
    renameWorktreePrompt,
    renameWorktreeNotice,
    renameWorktreeUpstreamPrompt,
    confirmRenameWorktreeUpstream,
    handleOpenRenameWorktree,
    handleRenameWorktreeChange,
    handleRenameWorktreeCancel,
    handleRenameWorktreeConfirm,
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureLaunchTerminal,
    ensureTerminalWithTitle,
    restartTerminalSession,
    launchScriptState,
    runtimeRunState,
    handleToggleRuntimeConsole,
    handleToggleTerminalPanel,
    launchScriptsState,
    handleWorktreeCreated,
    resolveCloneProjectContext,
    handleSelectOpenAppId,
    handleOpenMailSession,
    handleOpenClaudeTui,
    handleSelectStatusPanelSubagent,
    openAppIconById,
    clonePrompt,
    openClonePrompt,
    confirmClonePrompt,
    cancelClonePrompt,
    updateCloneCopyName,
    chooseCloneCopiesFolder,
    useSuggestedCloneCopiesFolder,
    clearCloneCopiesFolder,
    handleArchiveActiveThread,
  } = useAppShellWorkspaceFlowsSection({
    activeThreadId,
    activeEditorFilePath,
    activeWorkspace,
    activeWorkspaceId,
    addCloneAgent,
    addDebugEntry,
    alertError,
    appSettings,
    clearDraftForThread,
    closeSettings,
    closeTerminalPanel,
    collapseRightPanel,
    connectWorkspace,
    centerMode,
    exitDiffView,
    handleToggleTerminal,
    isCompact,
    listThreadsForWorkspaceTracked,
    openTerminal,
    queueSaveSettings: (nextSettings) =>
      queueSaveSettings({
        ...appSettings,
        ...nextSettings,
      }),
    refreshThread,
    removeImagesForThread,
    ensureWorkspaceThreadListLoaded,
    renameWorktree,
    renameWorktreeUpstream,
    resetWorkspaceThreads,
    selectWorkspace,
    setActiveEngine,
    setActiveTab,
    setActiveThreadId,
    setAgentTaskScrollRequest,
    setAppMode,
    setAppSettings: (updater: unknown) => {
      setAppSettings((current: Record<string, unknown>) => {
        const nextSettings =
          typeof updater === "function"
            ? (updater as (value: Record<string, unknown>) => Record<string, unknown>)(
                current,
              )
            : (updater as Record<string, unknown>);
        return {
          ...current,
          ...nextSettings,
        };
      });
    },
    setCenterMode,
    setHomeOpen,
    t,
    terminalOpen,
    threadsByWorkspace,
    updateWorkspaceSettings,
    workspaces,
  });

  const {
    worktreePrompt,
    worktreeCreateResult,
    openPrompt: openWorktreePrompt,
    confirmPrompt: confirmWorktreePrompt,
    cancelPrompt: cancelWorktreePrompt,
    closeWorktreeCreateResult,
    updateBranch: updateWorktreeBranch,
    updateBaseRef: updateWorktreeBaseRef,
    updatePublishToOrigin: updateWorktreePublishToOrigin,
    updateSetupScript: updateWorktreeSetupScript,
  } = useWorktreePrompt({
    addWorktreeAgent,
    updateWorkspaceSettings,
    connectWorkspace,
    onSelectWorkspace: selectWorkspace,
    onWorktreeCreated: handleWorktreeCreated,
    onCompactActivate: isCompact ? () => setActiveTab("codex") : undefined,
    onError: (message) => {
      addDebugEntry({
        id: `${Date.now()}-client-add-worktree-error`,
        timestamp: Date.now(),
        source: "error",
        label: "worktree/add error",
        payload: message,
      });
    },
  });

  const {
    activeParentWorkspace,
    activeRenamePrompt,
    baseWorkspaceRef,
    isWorktreeWorkspace,
    worktreeLabel,
    worktreeRename,
  } = useAppShellWorktreeChromeSection({
    activeTab,
    activeWorkspace,
    confirmRenameWorktreeUpstream,
    handleOpenRenameWorktree,
    handleRenameWorktreeCancel,
    handleRenameWorktreeChange,
    handleRenameWorktreeConfirm,
    isPhone,
    isTablet,
    renameWorktreeNotice,
    renameWorktreePrompt,
    renameWorktreeUpstreamPrompt,
    setActiveTab,
    workspacesById,
  });

  const { isMacDesktop, isWindowsDesktop } =
    useAppShellDesktopChrome(activeWorkspace);

  useWorkspaceRestore({
    workspaces,
    hasLoaded,
    activeWorkspaceId,
    restoreThreadsOnlyOnLaunch:
      appSettings.runtimeRestoreThreadsOnlyOnLaunch !== false,
    listThreadsForWorkspace: listThreadsForWorkspaceTracked,
  });
  useWorkspaceRefreshOnFocus({
    workspaces,
    refreshWorkspaces,
    activeWorkspaceId,
    listThreadsForWorkspace: listThreadsForWorkspaceTracked,
  });

  const {
    handleAddWorkspace,
    handleOpenNewWindow,
    handleAddWorkspaceFromPath,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
  } = useWorkspaceActions({
    activeWorkspace,
    isCompact,
    activeEngine,
    newAgentShortcut: appSettings.newAgentShortcut,
    setActiveEngine,
    addWorkspace,
    addWorkspaceFromPath,
    connectWorkspace,
    startThreadForWorkspace,
    setActiveThreadId,
    setActiveTab,
    exitDiffView,
    selectWorkspace,
    openWorktreePrompt,
    openClonePrompt,
    composerInputRef,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    onDebug: addDebugEntry,
  });

  const {
    handleWorkspaceDragEnter,
    handleWorkspaceDragLeave,
    handleWorkspaceDragOver,
    handleWorkspaceDrop,
    isWorkspaceDropActive,
    workspaceDropTargetRef,
  } = useWorkspacePathsIntake({
    handleAddWorkspaceFromPath,
  });

  const quickSwitcherSection = useAppShellQuickSwitcherSection({
    activeWorkspaceId,
    activityTimeline: workspaceActivity.timeline,
    expandRightPanel,
    handleOpenFile,
    handleToggleTerminalPanel,
    isCompact,
    isSearchPaletteOpen,
    openSettings,
    runningSessions: sessionRadarFeed.runningSessions,
    selectWorkspace,
    setActiveTab,
    setActiveThreadId,
    setAppMode,
    setCenterMode,
    setFilePanelMode,
    setGitPanelMode,
    setHomeOpen,
    setIsSearchPaletteOpen,
    setWorkspaceHomeWorkspaceId,
    threadsByWorkspace,
    workspaces,
  });

  const flows = {
    exitDiffView,
    selectWorkspace,
    selectHome,
    closePlanPanel,
    hasActivePlan,
    isPlanMode,
    isPlanPanelDismissed,
    openPlanPanel,
    setWorkspaceHomeWorkspaceId,
    showGitHistory,
    showExtensions,
    showHome,
    showWorkspaceHome,
    activePath,
    activeWorkspaceThreads,
    ensureWorkspaceThreadListLoaded,
    handleEnsureWorkspaceThreadsForSettings,
    handleInsertComposerText,
    hydratedThreadListWorkspaceIds,
    listThreadsForWorkspaceTracked,
    lockLiveSessions,
    RECENT_THREAD_LIMIT,
    recentThreads,
    searchApiHydrationStatus,
    searchFileHydrationStatus,
    searchResults,
    sessionRadarFeed,
    workspaceActivity,
    renameWorktreePrompt,
    renameWorktreeNotice,
    renameWorktreeUpstreamPrompt,
    confirmRenameWorktreeUpstream,
    handleOpenRenameWorktree,
    handleRenameWorktreeChange,
    handleRenameWorktreeCancel,
    handleRenameWorktreeConfirm,
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureLaunchTerminal,
    ensureTerminalWithTitle,
    restartTerminalSession,
    launchScriptState,
    runtimeRunState,
    handleToggleRuntimeConsole,
    handleToggleTerminalPanel,
    launchScriptsState,
    handleWorktreeCreated,
    resolveCloneProjectContext,
    handleSelectOpenAppId,
    handleOpenMailSession,
    handleOpenClaudeTui,
    handleSelectStatusPanelSubagent,
    openAppIconById,
    clonePrompt,
    openClonePrompt,
    confirmClonePrompt,
    cancelClonePrompt,
    updateCloneCopyName,
    chooseCloneCopiesFolder,
    useSuggestedCloneCopiesFolder,
    clearCloneCopiesFolder,
    handleArchiveActiveThread,
    worktreePrompt,
    worktreeCreateResult,
    openWorktreePrompt,
    confirmWorktreePrompt,
    cancelWorktreePrompt,
    closeWorktreeCreateResult,
    updateWorktreeBranch,
    updateWorktreeBaseRef,
    updateWorktreePublishToOrigin,
    updateWorktreeSetupScript,
    activeParentWorkspace,
    activeRenamePrompt,
    baseWorkspaceRef,
    isWorktreeWorkspace,
    worktreeLabel,
    worktreeRename,
    isMacDesktop,
    isWindowsDesktop,
    handleAddWorkspace,
    handleOpenNewWindow,
    handleAddWorkspaceFromPath,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    handleWorkspaceDragEnter,
    handleWorkspaceDragLeave,
    handleWorkspaceDragOver,
    handleWorkspaceDrop,
    isWorkspaceDropActive,
    workspaceDropTargetRef,
    quickSwitcherSection,
  };
  usePublishHostSlice("flows", flows);
  return flows;
}
