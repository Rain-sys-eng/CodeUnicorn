import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConversationItem,
  EngineType,
  MessageSendOptions,
  QueuedMessage,
  WorkspaceInfo,
} from "../../../types";
import { pushErrorToast } from "../../../services/toasts";
import {
  clearComposerDraft,
  getComposerDraft,
  setComposerDraft,
} from "../../composer/hooks/composerDraftStore";
import { useComposerImages } from "../../composer/hooks/useComposerImages";
import { useQueuedSend } from "../../threads/hooks/useQueuedSend";
import type { ThreadMessageDispatchResult } from "../../threads/hooks/useThreadMessaging";
import { classifyNetworkError } from "../../threads/utils/networkErrors";

export function useComposerController({
  activeThreadId,
  activeTurnId,
  activeContinuationPulse,
  activeTerminalPulse,
  activeWorkspaceId,
  activeWorkspace,
  isProcessing,
  isReviewing,
  isContextCompacting,
  hasPendingUserInput,
  threadStatusById,
  activeItems,
  resolveWorkspace,
  steerEnabled,
  activeEngine,
  isSharedSession,
  resolveCanonicalThreadId,
  connectWorkspace,
  startThreadForWorkspace,
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
  startExport,
  startImport,
  startLsp,
  startShare,
  startCompact,
  startFast,
  startMode,
  setCodexCollaborationMode,
  getCodexCollaborationMode,
  getCodexCollaborationPayload,
  interruptTurn,
}: {
  activeThreadId: string | null;
  activeTurnId?: string | null;
  activeContinuationPulse?: number;
  activeTerminalPulse?: number;
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  isProcessing: boolean;
  isReviewing: boolean;
  isContextCompacting?: boolean;
  hasPendingUserInput?: boolean;
  threadStatusById?: Record<
    string,
    | {
        isProcessing?: boolean;
        isReviewing?: boolean;
        isContextCompacting?: boolean;
        terminalPulse?: number;
        continuationPulse?: number;
      }
    | undefined
  >;
  activeItems?: ConversationItem[];
  resolveWorkspace?: (workspaceId: string) => WorkspaceInfo | null;
  steerEnabled: boolean;
  activeEngine?: EngineType;
  isSharedSession?: boolean;
  resolveCanonicalThreadId: (threadId: string) => string;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: EngineType;
      folderId?: string | null;
    },
  ) => Promise<string | null>;
  sendUserMessage: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<ThreadMessageDispatchResult>;
  handleFusionStalled?: (
    threadId: string,
    options?: { message?: string | null },
  ) => void;
  startFork: (text: string, options?: MessageSendOptions) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  startSpecRoot: (text: string) => Promise<void>;
  startStatus: (text: string) => Promise<void>;
  startContext: (text: string) => Promise<void>;
  startExport: (text: string) => Promise<void>;
  startImport: (text: string) => Promise<void>;
  startLsp: (text: string) => Promise<void>;
  startShare: (text: string) => Promise<void>;
  startCompact: (text: string) => Promise<void>;
  startFast: (text: string) => Promise<void>;
  startMode: (text: string) => Promise<void>;
  setCodexCollaborationMode?: (mode: "plan" | "code") => void;
  getCodexCollaborationMode?: () => "plan" | "code" | null;
  getCodexCollaborationPayload?: () => Record<string, unknown> | null;
  interruptTurn?: (options?: {
    reason?: "user-stop" | "queue-fusion";
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [prefillDraft, setPrefillDraft] = useState<QueuedMessage | null>(null);
  const [composerInsert, setComposerInsert] = useState<QueuedMessage | null>(
    null,
  );

  const {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    setImagesForThread,
    removeImagesForThread,
  } = useComposerImages({ activeThreadId, activeWorkspaceId });

  const {
    activeQueue,
    activeQueuedHandoffBubble,
    handleSend,
    queueMessage,
    removeQueuedMessage,
    fuseQueuedMessage,
    canFuseActiveQueue,
    fuseDisabledReasonKey,
    activeFusingMessageId,
  } = useQueuedSend({
    activeThreadId,
    activeTurnId,
    activeContinuationPulse,
    activeTerminalPulse,
    isProcessing,
    isReviewing,
    isContextCompacting,
    hasPendingUserInput,
    threadStatusById,
    activeItems,
    resolveWorkspace,
    steerEnabled,
    activeWorkspace,
    activeEngine,
    isSharedSession,
    resolveCanonicalThreadId,
    connectWorkspace,
    startThreadForWorkspace,
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
    startExport,
    startImport,
    startLsp,
    startShare,
    startCompact,
    startFast,
    startMode,
    setCodexCollaborationMode,
    getCodexCollaborationMode,
    getCodexCollaborationPayload,
    interruptTurn,
    clearActiveImages,
  });

  // 草稿活在模块级 composerDraftStore 里,这里只暴露读写入口。写入不经 React state,
  // 因此按键不会再从 app-shell 根引发全树重渲染;需要草稿"值"的组件自行订阅 store。
  const getActiveDraft = useCallback(
    () => getComposerDraft(activeThreadId),
    [activeThreadId],
  );

  const handleDraftChange = useCallback(
    (next: string) => {
      setComposerDraft(activeThreadId, next);
    },
    [activeThreadId],
  );

  const handleSendPrompt = useCallback(
    (text: string) => {
      if (!text.trim()) {
        return;
      }
      void handleSend(text, []);
    },
    [handleSend],
  );

  const handleEditQueued = useCallback(
    (item: QueuedMessage) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, item.id);
      setImagesForThread(activeThreadId, item.images ?? []);
      setPrefillDraft(item);
    },
    [activeThreadId, removeQueuedMessage, setImagesForThread],
  );

  const handleDeleteQueued = useCallback(
    async (id: string, options?: { confirmedPendingAck?: boolean }) => {
      if (!activeThreadId) {
        return false;
      }
      const removed = await removeQueuedMessage(activeThreadId, id, options);
      if (
        !removed &&
        options?.confirmedPendingAck &&
        activeQueue.some(
          (item) =>
            item.id === id && item.sharedDispatchState === "pending-ack",
        )
      ) {
        pushErrorToast({
          title: t("sharedSend.recoverySkipFailedTitle"),
          message: t("sharedSend.recoveryErrorGenericSkip"),
        });
      }
      return removed;
    },
    [activeQueue, activeThreadId, removeQueuedMessage, t],
  );

  const handleFuseQueued = useCallback(
    async (id: string) => {
      if (!activeThreadId) {
        return;
      }
      try {
        await fuseQueuedMessage(activeThreadId, id);
      } catch (error) {
        const raw =
          error instanceof Error && error.message
            ? error.message
            : String(error ?? "");
        const networkKind = classifyNetworkError(raw);
        const message =
          networkKind === "connect" || networkKind === "timeout"
            ? t("chat.fuseFailedGatewayOrRuntime")
            : raw || t("chat.fuseQueuedMessageFailedDetail");
        pushErrorToast({
          title: t("chat.fuseQueuedMessageFailed"),
          message,
        });
      }
    },
    [activeThreadId, fuseQueuedMessage, t],
  );

  const clearDraftForThread = useCallback((threadId: string) => {
    clearComposerDraft(threadId);
  }, []);

  return {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    setImagesForThread,
    removeImagesForThread,
    activeQueue,
    activeQueuedHandoffBubble,
    handleSend,
    queueMessage,
    removeQueuedMessage,
    prefillDraft,
    setPrefillDraft,
    composerInsert,
    setComposerInsert,
    getActiveDraft,
    handleDraftChange,
    handleSendPrompt,
    handleEditQueued,
    handleDeleteQueued,
    handleFuseQueued,
    canFuseActiveQueue,
    fuseDisabledReasonKey,
    activeFusingMessageId,
    clearDraftForThread,
  };
}
