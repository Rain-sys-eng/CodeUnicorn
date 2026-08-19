import type { ConversationItem } from "../../../types";
import {
  buildComparableUserMessageKey,
  buildMessagePresentationMetadata,
  isEquivalentUserObservation,
  normalizeComparableUserText,
  normalizeUserImages,
} from "../assembly/conversationNormalization";
import { isProcessingGeneratedImageItem } from "../utils/generatedImagePlaceholder";
import { shouldPreserveProcessingGeneratedImage } from "../utils/generatedImagePlaceholderMatching";
import { isOptimisticUserMessageId } from "../utils/queuedHandoffBubble";
import {
  insertUnmatchedIncomingByNeighbor,
  isUnmatchedExploreOrInProgressCommand,
} from "./insertUnmatchedIncomingByNeighbor";
import {
  buildOptimisticUserReplacementMap,
  insertGeneratedImagesAfterAnchors,
  retargetGeneratedImageAnchor,
} from "./threadReducerOptimisticUserReconciliation";

type MessageItem = Extract<ConversationItem, { kind: "message" }>;
type UserMessageItem = MessageItem & { role: "user" };
type AssistantMessageItem = MessageItem & { role: "assistant" };
type GeneratedImageItem = Extract<ConversationItem, { kind: "generatedImage" }>;
const CODEX_COMPACTION_MESSAGE_ID_PREFIX = "context-compacted-codex-compact-";
type CodexCompactionLifecycleState = "idle" | "compacting" | "completed";

function isUserMessageItem(item: ConversationItem | undefined): item is UserMessageItem {
  return item?.kind === "message" && item.role === "user";
}

function isAssistantMessageItem(
  item: ConversationItem | undefined,
): item is AssistantMessageItem {
  return item?.kind === "message" && item.role === "assistant";
}

function isOptimisticUserMessage(
  item: ConversationItem,
): item is UserMessageItem {
  return isUserMessageItem(item) && isOptimisticUserMessageId(item.id);
}

function userMessageImageList(item: UserMessageItem): string[] {
  return normalizeUserImages(item.images, item.text);
}

function isTextEquivalentUserTurn(
  left: Pick<UserMessageItem, "text">,
  right: Pick<UserMessageItem, "text">,
) {
  return (
    normalizeComparableUserText(left.text) ===
    normalizeComparableUserText(right.text)
  );
}

function resolveVisibleUserIntentText(item: UserMessageItem): string {
  const metadata =
    item.presentationMetadata ?? buildMessagePresentationMetadata(item);
  const sticky = metadata.stickyCandidateText.trim().replace(/\s+/g, " ");
  if (sticky.length > 0) {
    return sticky;
  }
  return normalizeComparableUserText(item.text);
}

function isSameVisibleUserIntent(
  left: UserMessageItem,
  right: UserMessageItem,
): boolean {
  if (
    isEquivalentUserObservation(left, right) ||
    isTextEquivalentUserTurn(left, right)
  ) {
    return true;
  }
  const leftVisible = resolveVisibleUserIntentText(left);
  const rightVisible = resolveVisibleUserIntentText(right);
  return leftVisible.length > 0 && leftVisible === rightVisible;
}

function findMatchingRealUserMessage(
  list: ConversationItem[],
  candidate: UserMessageItem,
) {
  return list.some((item) => {
    if (!isUserMessageItem(item)) {
      return false;
    }
    if (isOptimisticUserMessageId(item.id)) {
      return false;
    }
    // 全文+图等价，或同 turn 文案等价（Shared 投影曾丢图时仍要收敛双气泡）
    return isSameVisibleUserIntent(item, candidate);
  });
}

/**
 * 尾巴上的 optimistic 若前面已有同一句可见提问，丢掉尾巴。
 * 只删 optimistic-user-*，不动两条真实 user。
 */
export function dropRedundantTailOptimisticUsers(
  items: readonly ConversationItem[],
): ConversationItem[] {
  const dropIds = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || !isOptimisticUserMessage(item)) {
      continue;
    }
    const hasEarlierVisibleMatch = items.slice(0, index).some((candidate) => {
      if (
        !isUserMessageItem(candidate) ||
        isOptimisticUserMessage(candidate)
      ) {
        return false;
      }
      return isSameVisibleUserIntent(candidate, item);
    });
    if (hasEarlierVisibleMatch) {
      dropIds.add(item.id);
    }
  }
  if (dropIds.size === 0) {
    return items as ConversationItem[];
  }
  return items.filter((item) => !dropIds.has(item.id));
}

function enrichRealUserImagesFromOptimistic(
  incomingItems: ConversationItem[],
  localItems: ConversationItem[],
): ConversationItem[] {
  const optimisticUsers = localItems.filter(isOptimisticUserMessage);
  if (optimisticUsers.length === 0) {
    return incomingItems;
  }
  return incomingItems.map((item) => {
    if (!isUserMessageItem(item) || isOptimisticUserMessageId(item.id)) {
      return item;
    }
    if (userMessageImageList(item).length > 0) {
      return item;
    }
    const matchedOptimistic = optimisticUsers.find(
      (optimistic) =>
        isTextEquivalentUserTurn(optimistic, item) &&
        userMessageImageList(optimistic).length > 0,
    );
    if (!matchedOptimistic) {
      return item;
    }
    return {
      ...item,
      images: matchedOptimistic.images,
    };
  });
}

function isCodexCompactionMessage(
  item: ConversationItem | undefined,
): item is AssistantMessageItem {
  return (
    isAssistantMessageItem(item)
    && item.id.startsWith(CODEX_COMPACTION_MESSAGE_ID_PREFIX)
  );
}

export function mergeThreadItemsPreservingOptimisticUsers(
  localItems: ConversationItem[],
  incomingItems: ConversationItem[],
  options: {
    isProcessing: boolean;
    codexCompactionLifecycleState?: CodexCompactionLifecycleState;
  },
) {
  const {
    isProcessing,
    codexCompactionLifecycleState = "idle",
  } = options;
  const hasSelectedAgentName = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  const hasSelectedAgentIcon = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  const hasSelectedAgentMetadata = (item: UserMessageItem) =>
    hasSelectedAgentName(item.selectedAgentName) ||
    hasSelectedAgentIcon(item.selectedAgentIcon);
  const toComparableUserMessageSequence = (items: ConversationItem[]) =>
    items
      .filter(isUserMessageItem)
      .map((item) => buildComparableUserMessageKey(item));
  const areSameSequence = (left: string[], right: string[]) => {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  };
  const localUserSequence = toComparableUserMessageSequence(localItems);
  const incomingUserSequence = toComparableUserMessageSequence(incomingItems);
  const hasUserSequenceDrift = !areSameSequence(localUserSequence, incomingUserSequence);
  // Shared 投影若暂时无图：先把 optimistic 附图补到 text 等价的真实用户消息上，再收敛。
  const incomingWithImageEnrichment = enrichRealUserImagesFromOptimistic(
    incomingItems,
    localItems,
  );
  const optimisticUserReplacementById = buildOptimisticUserReplacementMap(
    localItems,
    incomingWithImageEnrichment,
  );
  const localUserMessageMetadataBuckets = new Map<
    string,
    Array<Pick<UserMessageItem, "selectedAgentName" | "selectedAgentIcon">>
  >();
  for (const item of localItems) {
    if (!isUserMessageItem(item) || !hasSelectedAgentMetadata(item)) {
      continue;
    }
    const key = buildComparableUserMessageKey(item);
    const bucket = localUserMessageMetadataBuckets.get(key) ?? [];
    bucket.push({
      selectedAgentName: item.selectedAgentName ?? null,
      selectedAgentIcon: item.selectedAgentIcon ?? null,
    });
    localUserMessageMetadataBuckets.set(key, bucket);
  }

  let mergedItems = incomingWithImageEnrichment.map((item) => {
    if (!isUserMessageItem(item)) {
      return item;
    }
    const key = buildComparableUserMessageKey(item);
    const bucket = localUserMessageMetadataBuckets.get(key);
    if (!bucket || bucket.length === 0) {
      return item;
    }
    if (hasUserSequenceDrift && bucket.length > 1) {
      return item;
    }
    const matchedLocalMetadata = bucket.shift();
    if (!matchedLocalMetadata) {
      return item;
    }
    if (bucket.length === 0) {
      localUserMessageMetadataBuckets.delete(key);
    } else {
      localUserMessageMetadataBuckets.set(key, bucket);
    }
    const incomingHasName = hasSelectedAgentName(item.selectedAgentName);
    const incomingHasIcon = hasSelectedAgentIcon(item.selectedAgentIcon);
    if (incomingHasName && incomingHasIcon) {
      return item;
    }
    return {
      ...item,
      selectedAgentName: incomingHasName
        ? item.selectedAgentName
        : matchedLocalMetadata.selectedAgentName,
      selectedAgentIcon: incomingHasIcon
        ? item.selectedAgentIcon
        : matchedLocalMetadata.selectedAgentIcon,
    };
  });

  if (
    localItems.length === 0 &&
    !mergedItems.some(isUserMessageItem)
  ) {
    // 空幕布没有 user turn：incoming 里的 explore / in-progress command
    // 是别的会话残留，不是本 tab 的首屏历史。
    mergedItems = mergedItems.filter(
      (item) => !isUnmatchedExploreOrInProgressCommand(item),
    );
  }

  if (localItems.length > 0) {
    let lastRealUserIndex = -1;
    for (let index = localItems.length - 1; index >= 0; index -= 1) {
      const candidate = localItems[index];
      if (
        isUserMessageItem(candidate) &&
        !isOptimisticUserMessage(candidate)
      ) {
        lastRealUserIndex = index;
        break;
      }
    }
    const optimisticCandidates = localItems
      .map((item, index) => ({ item, index }))
      .filter(
        (entry): entry is { item: UserMessageItem; index: number } =>
          isOptimisticUserMessage(entry.item) && entry.index > lastRealUserIndex,
      )
      .map((entry) => entry.item);
    const preservedOptimisticUsers = optimisticCandidates.filter(
      (item) => !findMatchingRealUserMessage(mergedItems, item),
    );
    const preservedLocalOnlyItemIds = new Set(
      preservedOptimisticUsers.map((item) => item.id),
    );
    const shouldPreserveLatestCompactionMessage =
      codexCompactionLifecycleState === "compacting" ||
      (codexCompactionLifecycleState === "completed" && !isProcessing);
    let latestPreservedCompactionMessageId: string | null = null;
    if (shouldPreserveLatestCompactionMessage) {
      localItems.forEach((item) => {
        if (
          isCodexCompactionMessage(item) &&
          !mergedItems.some((candidate) => candidate.id === item.id)
        ) {
          latestPreservedCompactionMessageId = item.id;
        }
      });
    }
    if (latestPreservedCompactionMessageId) {
      preservedLocalOnlyItemIds.add(latestPreservedCompactionMessageId);
    }
    if (preservedLocalOnlyItemIds.size > 0) {
      const mergedById = new Map(mergedItems.map((item) => [item.id, item]));
      const orderedItems: ConversationItem[] = [];
      const emittedIds = new Set<string>();
      localItems.forEach((localItem) => {
        if (preservedLocalOnlyItemIds.has(localItem.id)) {
          if (!emittedIds.has(localItem.id)) {
            orderedItems.push(localItem);
            emittedIds.add(localItem.id);
          }
          return;
        }
        const mergedCandidate = mergedById.get(localItem.id);
        if (mergedCandidate && !emittedIds.has(localItem.id)) {
          orderedItems.push(mergedCandidate);
          emittedIds.add(localItem.id);
        }
      });
      const leftoverIncoming: ConversationItem[] = [];
      mergedItems.forEach((item) => {
        if (emittedIds.has(item.id)) {
          return;
        }
        leftoverIncoming.push(item);
      });
      mergedItems = insertUnmatchedIncomingByNeighbor(
        orderedItems,
        leftoverIncoming,
        mergedItems,
      );
    }
  }

  const incomingIds = new Set(mergedItems.map((item) => item.id));

  if (isProcessing) {
    const preservedProcessingGeneratedImages = localItems
      .map((item) =>
        isProcessingGeneratedImageItem(item)
          ? retargetGeneratedImageAnchor(item, optimisticUserReplacementById)
          : item,
      )
      .filter(
        (item): item is GeneratedImageItem =>
          isProcessingGeneratedImageItem(item) &&
          shouldPreserveProcessingGeneratedImage(
            item,
            mergedItems,
            incomingIds,
          ),
      );
    if (preservedProcessingGeneratedImages.length > 0) {
      mergedItems = insertGeneratedImagesAfterAnchors(
        mergedItems,
        preservedProcessingGeneratedImages,
      );
    }
  }

  if (isProcessing) {
    // Keep locally generated requestUserInput submitted records visible while
    // the thread is still processing and backend snapshot may lag.
    const preservedSubmittedItems = localItems.filter(
      (item) =>
        item.kind === "tool" &&
        item.toolType === "requestUserInputSubmitted" &&
        !incomingIds.has(item.id),
    );
    if (preservedSubmittedItems.length > 0) {
      mergedItems = [...mergedItems, ...preservedSubmittedItems];
    }
  }

  return dropRedundantTailOptimisticUsers(mergedItems);
}
