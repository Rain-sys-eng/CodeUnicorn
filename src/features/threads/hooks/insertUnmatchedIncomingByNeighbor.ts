import type { ConversationItem } from "../../../types";

/**
 * 把未匹配的 incoming leftover 按 incoming 邻居相对插入已 emit 的 local 序。
 * 禁止读 Date / timestamp；append 只作无邻居兜底。
 *
 * 0.8.9 对照：当时 leftover 一律 push 末尾，在 prefix-grow-to-complete 下 leftover
 * 几乎都是「比 local 更新」的尾。0.9 尾窗 / 迟到 80 页让 leftover 变成更早项，
 * 再 append 就会跑到 optimistic 后面。本函数恢复「旧在上、新在下」的相对序。
 */
export function insertUnmatchedIncomingByNeighbor(
  orderedItems: readonly ConversationItem[],
  leftoverIncoming: readonly ConversationItem[],
  incomingItems: readonly ConversationItem[],
): ConversationItem[] {
  if (leftoverIncoming.length === 0) {
    return [...orderedItems];
  }

  const result = [...orderedItems];
  const emittedIds = new Set(result.map((item) => item.id));
  const incomingIndexById = new Map<string, number>();
  incomingItems.forEach((item, index) => {
    incomingIndexById.set(item.id, index);
  });

  const firstMatchedIncomingIndex = incomingItems.findIndex((item) =>
    emittedIds.has(item.id),
  );

  for (const leftover of leftoverIncoming) {
    if (emittedIds.has(leftover.id)) {
      continue;
    }
    // 整段 incoming 都对不上时，explore / 未完成 command 是别的会话残留，
    // 插到 optimistic 前面会变成新 tab 顶上的 Exploring 串线。
    // user / assistant leftover 仍走 B3 相对插入，禁止在这里丢掉。
    if (
      firstMatchedIncomingIndex < 0 &&
      isUnmatchedExploreOrInProgressCommand(leftover)
    ) {
      continue;
    }
    const insertAt = resolveLeftoverInsertIndex({
      leftoverIndex: incomingIndexById.get(leftover.id),
      incomingItems,
      result,
      emittedIds,
      firstMatchedIncomingIndex,
    });
    result.splice(insertAt, 0, leftover);
    emittedIds.add(leftover.id);
  }

  return result;
}

function resolveLeftoverInsertIndex({
  leftoverIndex,
  incomingItems,
  result,
  emittedIds,
  firstMatchedIncomingIndex,
}: {
  leftoverIndex: number | undefined;
  incomingItems: readonly ConversationItem[];
  result: readonly ConversationItem[];
  emittedIds: ReadonlySet<string>;
  firstMatchedIncomingIndex: number;
}): number {
  if (leftoverIndex === undefined) {
    return result.length;
  }

  for (let index = leftoverIndex - 1; index >= 0; index -= 1) {
    const predecessor = incomingItems[index];
    if (predecessor && emittedIds.has(predecessor.id)) {
      const predecessorResultIndex = result.findIndex(
        (item) => item.id === predecessor.id,
      );
      return predecessorResultIndex >= 0
        ? predecessorResultIndex + 1
        : result.length;
    }
  }

  for (let index = leftoverIndex + 1; index < incomingItems.length; index += 1) {
    const successor = incomingItems[index];
    if (successor && emittedIds.has(successor.id)) {
      const successorResultIndex = result.findIndex(
        (item) => item.id === successor.id,
      );
      return successorResultIndex >= 0 ? successorResultIndex : result.length;
    }
  }

  // leftover 整段都在第一个已匹配 incoming 之前，或 incoming 完全对不上
  // （迟到更早窗 + 本地 optimistic 尾）：插到结果开头，禁止落到最新后面。
  if (
    firstMatchedIncomingIndex < 0 ||
    leftoverIndex < firstMatchedIncomingIndex
  ) {
    return 0;
  }

  return result.length;
}

function isInProgressCommandExecution(item: ConversationItem): boolean {
  if (item.kind !== "tool" || item.toolType !== "commandExecution") {
    return false;
  }
  const normalized = (item.status ?? "").toLowerCase();
  return /(pending|running|processing|started|in[_ -]?progress|inprogress)/.test(
    normalized,
  );
}

export function isUnmatchedExploreOrInProgressCommand(item: ConversationItem): boolean {
  return item.kind === "explore" || isInProgressCommandExecution(item);
}
