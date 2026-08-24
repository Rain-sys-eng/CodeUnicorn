import type { ConversationItem } from "../../../types";
import {
  buildComparableUserMessageKey,
  isEquivalentUserObservation,
  normalizeComparableUserText,
  normalizeUserImages,
} from "../assembly/conversationNormalization";
import { isOptimisticUserMessageId } from "../utils/queuedHandoffBubble";
import { isProcessingGeneratedImageItem } from "../utils/generatedImagePlaceholder";

type MessageItem = Extract<ConversationItem, { kind: "message" }>;
type UserMessageItem = MessageItem & { role: "user" };
type GeneratedImageItem = Extract<ConversationItem, { kind: "generatedImage" }>;

function isUserMessageItem(item: ConversationItem | undefined): item is UserMessageItem {
  return item?.kind === "message" && item.role === "user";
}

function isOptimisticUserMessage(
  item: ConversationItem,
): item is UserMessageItem {
  return isUserMessageItem(item) && isOptimisticUserMessageId(item.id);
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

function userMessageHasVisualPayload(item: UserMessageItem): boolean {
  if (normalizeUserImages(item.images, item.text).length > 0) {
    return true;
  }
  return Array.isArray(item.deferredImages) && item.deferredImages.length > 0;
}

/**
 * 当前回合 hydrate：文案形状漂移（空 text + 图 vs 带 caption 的 optimistic）
 * 仍视为同一句。两侧都有非空且不同的可见文案时，禁止折叠成一条。
 */
export function isPlausibleSameTurnUserPayload(
  left: UserMessageItem,
  right: UserMessageItem,
): boolean {
  if (
    isEquivalentUserObservation(left, right) ||
    isTextEquivalentUserTurn(left, right)
  ) {
    return true;
  }
  const leftText = normalizeComparableUserText(left.text);
  const rightText = normalizeComparableUserText(right.text);
  if (leftText.length > 0 && rightText.length > 0 && leftText !== rightText) {
    return false;
  }
  return userMessageHasVisualPayload(left) && userMessageHasVisualPayload(right);
}

function bindTailTurnOptimisticReplacement(
  localItems: ConversationItem[],
  incomingItems: ConversationItem[],
  unmatchedOptimisticUsers: UserMessageItem[],
  unmatchedIncomingUsers: UserMessageItem[],
  replacementByOptimisticId: Map<string, string>,
) {
  const incomingNewUsers = unmatchedIncomingUsers.filter(
    (item) => !localItems.some((localItem) => localItem.id === item.id),
  );
  if (
    unmatchedOptimisticUsers.length === 0 ||
    incomingNewUsers.length === 0
  ) {
    return;
  }
  const tailOptimistic =
    unmatchedOptimisticUsers[unmatchedOptimisticUsers.length - 1]!;
  const incomingCandidate = incomingNewUsers[incomingNewUsers.length - 1]!;
  let lastRealUserIndex = -1;
  for (let index = localItems.length - 1; index >= 0; index -= 1) {
    const candidate = localItems[index];
    if (candidate && isUserMessageItem(candidate) && !isOptimisticUserMessage(candidate)) {
      lastRealUserIndex = index;
      break;
    }
  }
  const tailOptimisticIndex = localItems.findIndex(
    (item) => item.id === tailOptimistic.id,
  );
  if (
    lastRealUserIndex >= 0 &&
    tailOptimisticIndex >= 0 &&
    tailOptimisticIndex <= lastRealUserIndex
  ) {
    return;
  }
  const lastRealUser =
    lastRealUserIndex >= 0 ? localItems[lastRealUserIndex] : null;
  const lastRealIncomingIndex = lastRealUser
    ? incomingItems.findIndex((item) => item.id === lastRealUser.id)
    : -1;
  const incomingCandidateIndex = incomingItems.findIndex(
    (item) => item.id === incomingCandidate.id,
  );
  if (
    lastRealIncomingIndex >= 0 &&
    incomingCandidateIndex >= 0 &&
    incomingCandidateIndex <= lastRealIncomingIndex
  ) {
    return;
  }
  if (!isPlausibleSameTurnUserPayload(tailOptimistic, incomingCandidate)) {
    return;
  }
  replacementByOptimisticId.set(tailOptimistic.id, incomingCandidate.id);
}

function dropMatchingOptimisticUserMessage(
  list: ConversationItem[],
  incoming: UserMessageItem,
) {
  let matchedIndex = -1;
  const optimisticIndexes: number[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!item || !isOptimisticUserMessage(item)) {
      continue;
    }
    optimisticIndexes.push(index);
    // 含「同文案、图不一致」：Shared 投影补图前也能收敛双气泡
    if (
      isEquivalentUserObservation(item, incoming) ||
      isTextEquivalentUserTurn(item, incoming)
    ) {
      matchedIndex = index;
      break;
    }
  }
  if (matchedIndex >= 0) {
    return [...list.slice(0, matchedIndex), ...list.slice(matchedIndex + 1)];
  }
  // Conservative fallback: when there is only one optimistic user bubble and no
  // persisted real user messages yet, treat the first real user payload as its
  // authoritative replacement even if raw text shape differs.
  const hasRealUserMessage = list.some(
    (item) => isUserMessageItem(item) && !isOptimisticUserMessage(item),
  );
  if (!hasRealUserMessage && optimisticIndexes.length === 1) {
    const targetIndex = optimisticIndexes[0]!;
    return [...list.slice(0, targetIndex), ...list.slice(targetIndex + 1)];
  }
  return list;
}

export function buildOptimisticUserReplacementMap(
  localItems: ConversationItem[],
  incomingItems: ConversationItem[],
) {
  const localOptimisticUsers = localItems.filter(isOptimisticUserMessage);
  const incomingRealUsers = incomingItems.filter(
    (item): item is UserMessageItem =>
      isUserMessageItem(item) && !isOptimisticUserMessage(item),
  );
  const optimisticBucketsByKey = new Map<string, UserMessageItem[]>();
  localOptimisticUsers.forEach((item) => {
    const key = buildComparableUserMessageKey(item);
    const bucket = optimisticBucketsByKey.get(key) ?? [];
    bucket.push(item);
    optimisticBucketsByKey.set(key, bucket);
  });

  const replacementByOptimisticId = new Map<string, string>();
  const matchedIncomingIds = new Set<string>();
  const takeOptimisticByKey = (key: string): UserMessageItem | null => {
    const bucket = optimisticBucketsByKey.get(key);
    if (!bucket || bucket.length === 0) {
      return null;
    }
    const matchedOptimisticUser = bucket.shift() ?? null;
    if (!matchedOptimisticUser) {
      return null;
    }
    if (bucket.length === 0) {
      optimisticBucketsByKey.delete(key);
    } else {
      optimisticBucketsByKey.set(key, bucket);
    }
    return matchedOptimisticUser;
  };
  incomingRealUsers.forEach((incomingUser) => {
    const fullKey = buildComparableUserMessageKey(incomingUser);
    let matchedOptimisticUser = takeOptimisticByKey(fullKey);
    // text-only fallback：projection 丢图时 fullKey 对不上
    if (!matchedOptimisticUser) {
      const textKey = `${normalizeComparableUserText(incomingUser.text)}\u0000`;
      for (const [key] of optimisticBucketsByKey) {
        if (!key.startsWith(textKey)) {
          continue;
        }
        matchedOptimisticUser = takeOptimisticByKey(key);
        break;
      }
    }
    if (!matchedOptimisticUser) {
      return;
    }
    replacementByOptimisticId.set(matchedOptimisticUser.id, incomingUser.id);
    matchedIncomingIds.add(incomingUser.id);
  });

  const hasLocalRealUser = localItems.some(
    (item) => isUserMessageItem(item) && !isOptimisticUserMessage(item),
  );
  const unmatchedOptimisticUsers = localOptimisticUsers.filter(
    (item) => !replacementByOptimisticId.has(item.id),
  );
  const unmatchedIncomingUsers = incomingRealUsers.filter(
    (item) => !matchedIncomingIds.has(item.id),
  );
  if (
    !hasLocalRealUser &&
    unmatchedOptimisticUsers.length > 0 &&
    unmatchedIncomingUsers.length > 0
  ) {
    replacementByOptimisticId.set(
      unmatchedOptimisticUsers[unmatchedOptimisticUsers.length - 1]!.id,
      unmatchedIncomingUsers[unmatchedIncomingUsers.length - 1]!.id,
    );
    return replacementByOptimisticId;
  }

  bindTailTurnOptimisticReplacement(
    localItems,
    incomingItems,
    unmatchedOptimisticUsers,
    unmatchedIncomingUsers,
    replacementByOptimisticId,
  );

  return replacementByOptimisticId;
}

export function applyOptimisticVisibleTextToReplacements(
  incomingItems: ConversationItem[],
  localItems: ConversationItem[],
  replacementByOptimisticId: ReadonlyMap<string, string>,
): ConversationItem[] {
  if (replacementByOptimisticId.size === 0) {
    return incomingItems;
  }
  const optimisticById = new Map(
    localItems.filter(isOptimisticUserMessage).map((item) => [item.id, item]),
  );
  const incomingIdToOptimistic = new Map<string, UserMessageItem>();
  for (const [optimisticId, incomingId] of replacementByOptimisticId) {
    const optimistic = optimisticById.get(optimisticId);
    if (optimistic) {
      incomingIdToOptimistic.set(incomingId, optimistic);
    }
  }
  if (incomingIdToOptimistic.size === 0) {
    return incomingItems;
  }
  return incomingItems.map((item) => {
    if (!isUserMessageItem(item)) {
      return item;
    }
    const optimistic = incomingIdToOptimistic.get(item.id);
    if (!optimistic) {
      return item;
    }
    if (normalizeComparableUserText(item.text).length > 0) {
      return item;
    }
    const optimisticText = optimistic.text.trim();
    if (!optimisticText) {
      return item;
    }
    return {
      ...item,
      text: optimistic.text,
    };
  });
}

export function retargetGeneratedImageAnchor(
  item: GeneratedImageItem,
  replacementByOptimisticUserId: Map<string, string>,
): GeneratedImageItem {
  const anchorUserMessageId = item.anchorUserMessageId;
  if (!anchorUserMessageId) {
    return item;
  }
  const replacementAnchorId = replacementByOptimisticUserId.get(anchorUserMessageId);
  if (!replacementAnchorId) {
    return item;
  }
  return {
    ...item,
    anchorUserMessageId: replacementAnchorId,
  };
}

export function insertGeneratedImagesAfterAnchors(
  items: ConversationItem[],
  generatedImages: GeneratedImageItem[],
) {
  if (generatedImages.length === 0) {
    return items;
  }
  const next = [...items];
  const insertCountByAnchorId = new Map<string, number>();
  generatedImages.forEach((generatedImage) => {
    const anchorUserMessageId = generatedImage.anchorUserMessageId;
    const anchorIndex = anchorUserMessageId
      ? next.findIndex((item) => item.id === anchorUserMessageId)
      : -1;
    if (anchorIndex < 0 || !anchorUserMessageId) {
      next.push(generatedImage);
      return;
    }
    const previousInsertCount = insertCountByAnchorId.get(anchorUserMessageId) ?? 0;
    next.splice(anchorIndex + 1 + previousInsertCount, 0, generatedImage);
    insertCountByAnchorId.set(anchorUserMessageId, previousInsertCount + 1);
  });
  return next;
}

export function replaceOptimisticUserAndExtractAnchoredGeneratedImages(
  items: ConversationItem[],
  incomingUser: UserMessageItem,
) {
  const replacementByOptimisticUserId = buildOptimisticUserReplacementMap(
    items,
    [incomingUser],
  );
  if (replacementByOptimisticUserId.size === 0) {
    return {
      items: dropMatchingOptimisticUserMessage(items, incomingUser),
      generatedImagesToReinsert: [],
    };
  }

  const replacedOptimisticUserIds = new Set(replacementByOptimisticUserId.keys());
  const generatedImagesToReinsert: GeneratedImageItem[] = [];
  const nextItems: ConversationItem[] = [];
  items.forEach((item) => {
    if (isUserMessageItem(item) && replacedOptimisticUserIds.has(item.id)) {
      return;
    }
    const nextItem = isProcessingGeneratedImageItem(item)
      ? retargetGeneratedImageAnchor(item, replacementByOptimisticUserId)
      : item;
    if (
      isProcessingGeneratedImageItem(nextItem) &&
      nextItem.anchorUserMessageId === incomingUser.id
    ) {
      generatedImagesToReinsert.push(nextItem);
      return;
    }
    nextItems.push(nextItem);
  });

  return {
    items: nextItems,
    generatedImagesToReinsert,
  };
}
