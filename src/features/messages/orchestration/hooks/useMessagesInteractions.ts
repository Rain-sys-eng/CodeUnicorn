import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { AccessMode, ConversationItem } from "../../../../types";
import { copyTextToClipboard } from "../../../../utils/clipboard";
import type { MessagesCoreProps } from "../../contracts/messagesInput";
import { useConversationNoteCaptureMenu } from "../../hooks/useConversationNoteCaptureMenu";
import { useFileLinkOpener } from "../../hooks/useFileLinkOpener";
import { collapseExpandedExploreItems } from "../presentation/messagesLiveWindow";

function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

type UseMessagesInteractionsInput = {
  canvasRootRef: RefObject<HTMLDivElement | null>;
  effectiveItems: ConversationItem[];
  isThinking: boolean;
  items: ConversationItem[];
  onCaptureNote: MessagesCoreProps["interactions"]["onCaptureNote"];
  onSaveAsPrompt: MessagesCoreProps["interactions"]["onSaveAsPrompt"];
  onExitPlanModeExecute: MessagesCoreProps["interactions"]["onExitPlanModeExecute"];
  onOpenWorkspaceFile: MessagesCoreProps["interactions"]["onOpenWorkspaceFile"];
  openTargets: MessagesCoreProps["presentation"]["openTargets"];
  renderSourceItems: ConversationItem[];
  selectedOpenAppId: MessagesCoreProps["presentation"]["selectedOpenAppId"];
  threadId: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
};

export function useMessagesInteractions({
  canvasRootRef,
  effectiveItems,
  isThinking,
  items,
  onCaptureNote,
  onSaveAsPrompt,
  onExitPlanModeExecute,
  onOpenWorkspaceFile,
  openTargets,
  renderSourceItems,
  selectedOpenAppId,
  threadId,
  workspaceId,
  workspacePath,
}: UseMessagesInteractionsInput) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const [selectedExitPlanExecutionByItemKey, setSelectedExitPlanExecutionByItemKey] = useState<
    Record<string, Extract<AccessMode, "default" | "full-access">>
  >({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const lastAutoExpandedIdRef = useRef<string | null>(null);

  const {
    openFileLink,
    openHtmlFileInBrowser,
    showFileLinkMenu,
    fileLinkMenu,
    closeFileLinkMenu,
  } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
    onOpenWorkspaceFile,
    workspaceId,
  );
  const {
    menu: noteCaptureMenu,
    closeMenu: closeNoteCaptureMenu,
    handleContextMenu: handleConversationContextMenu,
    openMenuFromTrigger: openNoteCaptureMenuFromTrigger,
  } = useConversationNoteCaptureMenu({
    canvasRootRef,
    items,
    threadId,
    onCaptureNote,
    onSaveAsPrompt,
  });

  useEffect(() => {
    if (isThinking) {
      return;
    }
    setExpandedItems((previous) => collapseExpandedExploreItems(previous, effectiveItems));
  }, [effectiveItems, isThinking]);
  useEffect(() => {
    if (!isThinking) {
      lastAutoExpandedIdRef.current = null;
      return;
    }
    const reasoningIds = renderSourceItems
      .filter((item) => item.kind === "reasoning")
      .map((item) => item.id);
    const lastReasoningId = reasoningIds.at(-1) ?? null;
    if (!lastReasoningId || lastReasoningId === lastAutoExpandedIdRef.current) {
      return;
    }
    const reasoningIdSet = new Set(reasoningIds);
    setExpandedItems((previous) => {
      const next = new Set<string>([lastReasoningId]);
      for (const id of previous) {
        if (!reasoningIdSet.has(id)) {
          next.add(id);
        }
      }
      return areStringSetsEqual(previous, next) ? previous : next;
    });
    lastAutoExpandedIdRef.current = lastReasoningId;
  }, [isThinking, renderSourceItems]);
  useEffect(
    () => () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    },
    [],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const collapseExpandedIds = useCallback((ids: ReadonlySet<string>) => {
    setExpandedItems((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const id of ids) {
        if (next.delete(id)) {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);
  const collapseExploreItems = useCallback((sourceItems: ConversationItem[]) => {
    setExpandedItems((previous) => collapseExpandedExploreItems(previous, sourceItems));
  }, []);
  const handleExitPlanModeExecuteForItem = useCallback(
    async (
      itemId: string,
      mode: Extract<AccessMode, "default" | "full-access">,
    ) => {
      const selectionKey = `${threadId ?? "no-thread"}:${itemId}`;
      setSelectedExitPlanExecutionByItemKey((previous) => {
        if (previous[selectionKey] === mode) {
          return previous;
        }
        return { ...previous, [selectionKey]: mode };
      });
      await onExitPlanModeExecute?.(mode);
    },
    [onExitPlanModeExecute, threadId],
  );
  const handleCopyMessage = useCallback(
    async (
      item: Extract<ConversationItem, { kind: "message" }>,
      copyText?: string,
    ) => {
      if (!(await copyTextToClipboard(copyText ?? item.text))) {
        return;
      }
      setCopiedMessageId(item.id);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        copyTimeoutRef.current = null;
        setCopiedMessageId(null);
      }, 1200);
    },
    [],
  );
  const resetInteractionScope = useCallback(() => {
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    setCopiedMessageId((previous) => (previous === null ? previous : null));
    setExpandedItems((previous) => (previous.size === 0 ? previous : new Set()));
  }, []);
  const getPendingInteractionResourceCount = useCallback(
    () => (copyTimeoutRef.current !== null ? 1 : 0),
    [],
  );

  return {
    closeFileLinkMenu,
    closeNoteCaptureMenu,
    collapseExpandedIds,
    collapseExploreItems,
    copiedMessageId,
    expandedItems,
    fileLinkMenu,
    getPendingInteractionResourceCount,
    handleConversationContextMenu,
    handleCopyMessage,
    handleExitPlanModeExecuteForItem,
    noteCaptureMenu,
    openFileLink,
    openHtmlFileInBrowser,
    resetInteractionScope,
    selectedExitPlanExecutionByItemKey,
    showFileLinkMenu,
    timelineOpenNoteCaptureMenu: onCaptureNote ? openNoteCaptureMenuFromTrigger : undefined,
    toggleExpanded,
  };
}
