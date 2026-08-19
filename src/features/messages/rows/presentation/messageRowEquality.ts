import type { ReactNode } from "react";
import type { ConversationItem, QueuedMessage } from "../../../../types";
import type { PresentationProfile } from "../../../../conversation-presentation/presentationProfile";
import type { RuntimeReconnectRecoveryCallbackResult } from "../../../../runtime-recovery/runtimeReconnect";
import type { MessagesEngine } from "../../utils/messagesRenderUtils";
import type { StreamMitigationProfile } from "./messagesStreamingComplexity";

type MessageRowOutlineEntry = {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  startLine: number;
  endLine: number;
  anchor: string;
  ordinal: number;
};

export type MessageItem = Extract<ConversationItem, { kind: "message" }>;

export type MessageRowEqualityProps = {
  item: MessageItem;
  workspaceId?: string | null;
  threadId?: string | null;
  isStreaming?: boolean;
  activeEngine?: MessagesEngine;
  activeCollaborationModeId?: string | null;
  enableCollaborationBadge?: boolean;
  presentationProfile?: PresentationProfile | null;
  nativeRuntimeRecoveryEnabled?: boolean;
  showRuntimeReconnectCard?: boolean;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onThreadRecoveryFork?: () =>
    | Promise<RuntimeReconnectRecoveryCallbackResult>
    | RuntimeReconnectRecoveryCallbackResult;
  retryMessage?: Pick<QueuedMessage, "text" | "images"> | null;
  isCopied?: boolean;
  onCopy?: (item: MessageItem, copyText?: string) => void;
  userActionNode?: ReactNode;
  codeBlockCopyUseModifier?: boolean;
  onOpenFileLink?: (path: string) => void;
  onOpenHtmlInBrowser?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
  streamMitigationProfile?: StreamMitigationProfile | null;
  onAssistantVisibleTextRender?: (payload: {
    itemId: string;
    visibleText: string;
  }) => void;
  suppressMemorySummaryCard?: boolean;
  suppressNoteCardSummaryCard?: boolean;
  /**
   * Shared turn-target badge visibility. Default true for standalone renders;
   * timeline passes false for consecutive same-target assistants within a turn.
   */
  showTurnTargetBadge?: boolean;
  onOutlineReady?: (outline: MessageRowOutlineEntry[]) => void;
};

export function areMessageImagesEqual(
  previous: MessageItem["images"],
  next: MessageItem["images"],
) {
  if (previous === next) {
    return true;
  }
  if (!previous?.length && !next?.length) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  return previous.every((image, index) => image === next[index]);
}

function areDeferredMessageImagesEqual(
  previous: MessageItem["deferredImages"],
  next: MessageItem["deferredImages"],
) {
  if (previous === next) {
    return true;
  }
  if (!previous?.length && !next?.length) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  return previous.every((image, index) => {
    const nextImage = next[index];
    return (
      nextImage?.workspacePath === image.workspacePath &&
      nextImage.mediaType === image.mediaType &&
      nextImage.estimatedByteSize === image.estimatedByteSize &&
      nextImage.reason === image.reason &&
      nextImage.locator.sessionId === image.locator.sessionId &&
      nextImage.locator.lineIndex === image.locator.lineIndex &&
      nextImage.locator.blockIndex === image.locator.blockIndex &&
      nextImage.locator.messageId === image.locator.messageId &&
      nextImage.locator.mediaType === image.locator.mediaType
    );
  });
}

function areIntentCanvasAttachmentsEqual(
  previous: MessageItem["intentCanvasContextAttachments"],
  next: MessageItem["intentCanvasContextAttachments"],
) {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  return previous.every((attachment, index) => attachment === next[index]);
}

export function areMessageItemsEqual(previous: MessageItem, next: MessageItem) {
  return (
    previous === next ||
    (
      previous.id === next.id &&
      previous.role === next.role &&
      previous.text === next.text &&
      previous.engineSource === next.engineSource &&
      previous.executionTargetSnapshot === next.executionTargetSnapshot &&
      previous.isFinal === next.isFinal &&
      previous.finalCompletedAt === next.finalCompletedAt &&
      previous.finalDurationMs === next.finalDurationMs &&
      previous.finalInputTokens === next.finalInputTokens &&
      previous.finalOutputTokens === next.finalOutputTokens &&
      previous.selectedAgentName === next.selectedAgentName &&
      previous.selectedAgentIcon === next.selectedAgentIcon &&
      previous.originKind === next.originKind &&
      previous.providerRetryAttempt === next.providerRetryAttempt &&
      previous.providerRetryAtMs === next.providerRetryAtMs &&
      previous.browserContextAttachment === next.browserContextAttachment &&
      areIntentCanvasAttachmentsEqual(
        previous.intentCanvasContextAttachments,
        next.intentCanvasContextAttachments,
      ) &&
      areMessageImagesEqual(previous.images, next.images) &&
      areDeferredMessageImagesEqual(previous.deferredImages, next.deferredImages)
    )
  );
}

export function areMessageRowPropsEqual(
  previous: MessageRowEqualityProps,
  next: MessageRowEqualityProps,
) {
  const compareStreamingOnlyProps =
    previous.isStreaming === true || next.isStreaming === true;
  const compareRuntimeReconnectProps =
    previous.showRuntimeReconnectCard === true || next.showRuntimeReconnectCard === true;
  return (
    areMessageItemsEqual(previous.item, next.item) &&
    previous.workspaceId === next.workspaceId &&
    previous.threadId === next.threadId &&
    previous.isStreaming === next.isStreaming &&
    previous.activeEngine === next.activeEngine &&
    previous.activeCollaborationModeId === next.activeCollaborationModeId &&
    previous.enableCollaborationBadge === next.enableCollaborationBadge &&
    previous.presentationProfile === next.presentationProfile &&
    previous.nativeRuntimeRecoveryEnabled === next.nativeRuntimeRecoveryEnabled &&
    previous.showRuntimeReconnectCard === next.showRuntimeReconnectCard &&
    previous.userActionNode === next.userActionNode &&
    (
      !compareRuntimeReconnectProps ||
      (
        previous.onRecoverThreadRuntime === next.onRecoverThreadRuntime &&
        previous.onRecoverThreadRuntimeAndResend === next.onRecoverThreadRuntimeAndResend &&
        previous.onThreadRecoveryFork === next.onThreadRecoveryFork &&
        previous.retryMessage?.text === next.retryMessage?.text &&
        areMessageImagesEqual(previous.retryMessage?.images, next.retryMessage?.images)
      )
    ) &&
    previous.codeBlockCopyUseModifier === next.codeBlockCopyUseModifier &&
    previous.onOpenFileLink === next.onOpenFileLink &&
    previous.onOpenHtmlInBrowser === next.onOpenHtmlInBrowser &&
    previous.onOpenFileLinkMenu === next.onOpenFileLinkMenu &&
    previous.onOutlineReady === next.onOutlineReady &&
    (
      !compareStreamingOnlyProps ||
      (
        previous.streamMitigationProfile === next.streamMitigationProfile &&
        previous.onAssistantVisibleTextRender === next.onAssistantVisibleTextRender
      )
    ) &&
    previous.suppressMemorySummaryCard === next.suppressMemorySummaryCard &&
    previous.suppressNoteCardSummaryCard === next.suppressNoteCardSummaryCard &&
    (previous.showTurnTargetBadge ?? true) === (next.showTurnTargetBadge ?? true)
  );
}
