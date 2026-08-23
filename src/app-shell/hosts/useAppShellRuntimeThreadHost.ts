import { useThreads } from "../../features/threads/hooks/useThreads";
import { useAccountSwitching } from "../../features/app/hooks/useAccountSwitching";
import { useRuntimeThreadDomainHost } from "../domains/useRuntimeThreadDomainHost";
import { useGitStatusRefreshOnTurnSettle } from "../sections/useGitStatusRefreshOnTurnSettle";
import { useHostFields, usePublishHostSlice } from "./appShellHostBus";

const SESSION_FIELDS = [
  "activeWorkspace",
  "activeWorkspaceId",
  "addDebugEntry",
  "appSettings",
  "claudeThinkingVisible",
  "markWorkspaceConnected",
  "runWithCreateSessionLoading",
] as const;

const CATALOG_FIELDS = [
  "accessMode",
  "activeEngine",
  "handleCollaborationModeResolved",
  "prompts",
  "refreshModels",
  "resolveCollaborationRuntimeMode",
  "resolveCollaborationUiMode",
  "resolveComposerSelection",
  "resolveOpenCodeAgentForThread",
  "resolveOpenCodeVariantForThread",
] as const;

const GIT_FIELDS = ["alertError", "queueGitStatusRefresh"] as const;

const ignoreRetiredOpenCodeSelection = () => {};

/** 刀 1 / 刀 3：threads + runtime projection 独立 Host。 */
export function useAppShellRuntimeThreadHost() {
  const session = useHostFields("session", SESSION_FIELDS);
  const catalog = useHostFields("catalog", CATALOG_FIELDS);
  const git = useHostFields("git", GIT_FIELDS);
  const activeWorkspace = session.activeWorkspace as any;
  const activeWorkspaceId = session.activeWorkspaceId as any;
  const addDebugEntry = session.addDebugEntry as any;
  const appSettings = session.appSettings as any;
  const claudeThinkingVisible = session.claudeThinkingVisible as any;
  const markWorkspaceConnected = session.markWorkspaceConnected as any;
  const runWithCreateSessionLoading = session.runWithCreateSessionLoading as any;
  const accessMode = catalog.accessMode as any;
  const activeEngine = catalog.activeEngine as any;
  const handleCollaborationModeResolved = catalog.handleCollaborationModeResolved as any;
  const prompts = catalog.prompts as any;
  const refreshModels = catalog.refreshModels as any;
  const resolveCollaborationRuntimeMode = catalog.resolveCollaborationRuntimeMode as any;
  const resolveCollaborationUiMode = catalog.resolveCollaborationUiMode as any;
  const resolveComposerSelection = catalog.resolveComposerSelection as any;
  const resolveOpenCodeAgentForThread = catalog.resolveOpenCodeAgentForThread as any;
  const resolveOpenCodeVariantForThread = catalog.resolveOpenCodeVariantForThread as any;
  const alertError = git.alertError as any;
  const queueGitStatusRefresh = git.queueGitStatusRefresh as (() => void) | undefined;

  const threadsController = useThreads({
    activeWorkspace,
    onWorkspaceConnected: markWorkspaceConnected,
    onWorkspaceModelsRefresh: refreshModels,
    onDebug: addDebugEntry,
    model: null,
    effort: null,
    collaborationMode: null,
    resolveComposerSelection,
    claudeThinkingVisible,
    accessMode,
    steerEnabled: appSettings.experimentalSteerEnabled,
    customPrompts: prompts,
    activeEngine,
    useNormalizedRealtimeAdapters: appSettings.chatCanvasUseNormalizedRealtime,
    useUnifiedHistoryLoader: appSettings.chatCanvasUseUnifiedHistoryLoader,
    sessionAttributionMode: appSettings.sessionAttributionMode,
    defaultVisibleThreadRootCount: appSettings.defaultVisibleThreadRootCount,
    resolveOpenCodeAgent: resolveOpenCodeAgentForThread,
    resolveOpenCodeVariant: resolveOpenCodeVariantForThread,
    resolveCollaborationUiMode,
    resolveCollaborationRuntimeMode,
    onCollaborationModeResolved: handleCollaborationModeResolved,
    runWithCreateSessionLoading,
  });
  const {
    setActiveThreadId,
    activeThreadId,
    activeItems,
    threadItemsByThread,
    historyRestoredAtMsByThread,
    approvals,
    userInputRequests,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
    completionEmailIntentByThread,
    toggleCompletionEmailIntent,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    accountByWorkspace,
    lastAgentMessageByThread,
    interruptTurn,
    removeThread,
    removeThreads,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    pinnedThreadsVersion,
    renameThread,
    triggerAutoThreadTitle,
    isThreadAutoNaming,
    startThreadForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    resetWorkspaceThreads,
    refreshThread,
    sendUserMessage,
    sendUserMessageToThread,
    handleFusionStalled,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    startSharedSessionForWorkspace,
    resolveCanonicalThreadId,
    reviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalBatchAccept,
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit,
    refreshAccountInfo,
    refreshAccountRateLimits,
  } = threadsController;

  const handleSelectOpenCodeAgent = ignoreRetiredOpenCodeSelection;
  const handleSelectOpenCodeVariant = ignoreRetiredOpenCodeSelection;
  const selectedOpenCodeAgent = null;
  const selectedOpenCodeVariant = null;

  const {
    activeThreadSummary,
    activeThreadEngine,
    activeThreadProviderProfileId,
    activeRateLimits,
    activeTokenUsage,
    timelinePlan,
    activePlan,
    canInterrupt,
    isProcessing,
    isReviewing,
    activeTurnId,
    hasPendingUserInput,
    runtimeThreadBoundary,
  } = useRuntimeThreadDomainHost({
    threads: threadsController,
    activeWorkspace,
    activeWorkspaceId,
    activeThreadId,
  });

  const {
    activeAccount,
    accountSwitching,
    handleSwitchAccount,
    handleCancelSwitchAccount,
  } = useAccountSwitching({
    activeWorkspaceId,
    accountByWorkspace,
    refreshAccountInfo,
    refreshAccountRateLimits,
    alertError,
  });

  useGitStatusRefreshOnTurnSettle({
    queueGitStatusRefresh: queueGitStatusRefresh ?? (() => {}),
    threadStatusById,
  });

  const runtime = {
    threadsController,
    setActiveThreadId,
    activeThreadId,
    activeItems,
    threadItemsByThread,
    historyRestoredAtMsByThread,
    approvals,
    userInputRequests,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
    completionEmailIntentByThread,
    toggleCompletionEmailIntent,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    accountByWorkspace,
    lastAgentMessageByThread,
    interruptTurn,
    removeThread,
    removeThreads,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    pinnedThreadsVersion,
    renameThread,
    triggerAutoThreadTitle,
    isThreadAutoNaming,
    startThreadForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    resetWorkspaceThreads,
    refreshThread,
    sendUserMessage,
    sendUserMessageToThread,
    handleFusionStalled,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    startSharedSessionForWorkspace,
    resolveCanonicalThreadId,
    reviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalBatchAccept,
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit,
    refreshAccountInfo,
    refreshAccountRateLimits,
    handleSelectOpenCodeAgent,
    handleSelectOpenCodeVariant,
    selectedOpenCodeAgent,
    selectedOpenCodeVariant,
    activeThreadSummary,
    activeThreadEngine,
    activeThreadProviderProfileId,
    activeRateLimits,
    activeTokenUsage,
    timelinePlan,
    activePlan,
    canInterrupt,
    isProcessing,
    isReviewing,
    activeTurnId,
    hasPendingUserInput,
    runtimeThreadBoundary,
    activeAccount,
    accountSwitching,
    handleSwitchAccount,
    handleCancelSwitchAccount,
  };
  usePublishHostSlice("runtime", runtime);
  return runtime;
}
