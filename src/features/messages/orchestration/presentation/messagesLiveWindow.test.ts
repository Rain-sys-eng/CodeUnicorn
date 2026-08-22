import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../../types";
import {
  buildAssistantFinalBoundarySet,
  buildLiveTailWorkingSet,
  buildMessagesPresentationScopeKey,
  buildRenderedItemsWindow,
  resolveMessagesPresentationMode,
  resolveStreamingPresentationItems,
  suppressCompletedExploreItemsBetweenLatestUserTurns,
  suppressOrphanExploringItemsBeforeLatestUserTurn,
} from "./messagesLiveWindow";
import { STREAMING_VISIBLE_WINDOW } from "../../utils/messagesRenderUtils";

function userMessage(id: string, text = id): Extract<ConversationItem, { kind: "message" }> {
  return {
    id,
    kind: "message",
    role: "user",
    text,
  };
}

function assistantMessage(id: string, text = id): Extract<ConversationItem, { kind: "message" }> {
  return {
    id,
    kind: "message",
    role: "assistant",
    text,
  };
}

function reasoningItem(id: string, content = id): Extract<ConversationItem, { kind: "reasoning" }> {
  return {
    id,
    kind: "reasoning",
    summary: "",
    content,
  };
}

describe("messages live window", () => {
  it("separates realtime/static and collapsed/expanded presentation modes", () => {
    expect(
      resolveMessagesPresentationMode({
        historyExpansionMode: null,
        isWorking: true,
        showAllHistoryItems: false,
        visibleCollapsedHistoryItemCount: 12,
      }),
    ).toBe("realtime-collapsed-tail");
    expect(
      resolveMessagesPresentationMode({
        historyExpansionMode: null,
        isWorking: true,
        showAllHistoryItems: false,
        visibleCollapsedHistoryItemCount: 0,
      }),
    ).toBe("realtime-full-tail");
    expect(
      resolveMessagesPresentationMode({
        historyExpansionMode: "manual",
        isWorking: false,
        showAllHistoryItems: true,
        visibleCollapsedHistoryItemCount: 0,
      }),
    ).toBe("static-expanded-history-manual");
    expect(
      resolveMessagesPresentationMode({
        historyExpansionMode: "jump",
        isWorking: false,
        showAllHistoryItems: true,
        visibleCollapsedHistoryItemCount: 0,
      }),
    ).toBe("static-expanded-history-jump");
  });

  it("includes presentation mode, collapsed count, and visible window identity in the presentation scope", () => {
    const baseScope = "ws-1\u0000thread-1";
    const collapsedScope = buildMessagesPresentationScopeKey({
      scopeKey: baseScope,
      mode: "static-collapsed-history",
      collapsedHistoryItemCount: 40,
      itemCount: 30,
      firstItemId: "message-41",
      lastItemId: "message-70",
    });
    const expandedScope = buildMessagesPresentationScopeKey({
      scopeKey: baseScope,
      mode: "static-expanded-history-manual",
      collapsedHistoryItemCount: 0,
      itemCount: 70,
      firstItemId: "message-1",
      lastItemId: "message-70",
    });
    const liveScope = buildMessagesPresentationScopeKey({
      scopeKey: baseScope,
      mode: "realtime-collapsed-tail",
      collapsedHistoryItemCount: 40,
      itemCount: 30,
      firstItemId: "message-41",
      lastItemId: "message-70",
    });

    expect(collapsedScope).not.toBe(expandedScope);
    expect(collapsedScope).not.toBe(liveScope);
    expect(expandedScope).toContain("static-expanded-history-manual");
  });

  it("builds a bounded live tail working set and preserves the latest user row", () => {
    const items: ConversationItem[] = [
      userMessage("user-old", "早期问题"),
      ...Array.from({ length: 68 }, (_, index) =>
        assistantMessage(`assistant-${index}`, `回复 ${index}`),
      ),
      userMessage("user-latest", "最新问题"),
      assistantMessage("assistant-live", "正在回答"),
    ];

    const workingSet = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: false,
      visibleWindow: 30,
    });

    expect(workingSet.items.length).toBeLessThan(items.length);
    expect(workingSet.items.some((item) => item.id === "user-latest")).toBe(true);
    expect(workingSet.items.at(-1)?.id).toBe("assistant-live");
    expect(workingSet.preservedUserMessageId).toBe("user-latest");
    expect(workingSet.omittedBeforeWorkingSetCount).toBeGreaterThan(0);
  });

  it("keeps full history when show all is enabled during streaming", () => {
    const items: ConversationItem[] = [
      userMessage("user-latest", "最新问题"),
      ...Array.from({ length: 80 }, (_, index) =>
        assistantMessage(`assistant-${index}`, `回复 ${index}`),
      ),
    ];

    const streaming = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: true,
      visibleWindow: 30,
    });

    expect(streaming.items).toBe(items);
    expect(streaming.omittedBeforeWorkingSetCount).toBe(0);
    expect(streaming.preservedUserMessageId).toBeNull();
  });

  it("adds omitted prefix count to rendered collapsed history count", () => {
    const items = [
      userMessage("user-latest", "最新问题"),
      ...Array.from({ length: 60 }, (_, index) =>
        assistantMessage(`assistant-${index}`, `回复 ${index}`),
      ),
    ];
    const workingSet = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: false,
      visibleWindow: 30,
    });
    const localCollapsedCount = Math.max(0, workingSet.items.length - 30);
    const renderedWindow = buildRenderedItemsWindow(
      workingSet.items,
      localCollapsedCount,
      workingSet.preservedUserMessageId,
    );

    expect(
      renderedWindow.visibleCollapsedHistoryItemCount
        + workingSet.omittedBeforeWorkingSetCount,
    ).toBe(items.length - renderedWindow.renderedItems.length);
    expect(renderedWindow.renderedItems.some((item) => item.id === "user-latest")).toBe(true);
  });

  it("keeps a deferred presentation snapshot stable while appending newly inserted live items", () => {
    const deferredItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出"),
    ];
    const currentItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出后续增量"),
      assistantMessage("assistant-2", "新的 live 尾项"),
    ];

    const resolvedItems = resolveStreamingPresentationItems(
      deferredItems,
      currentItems,
      true,
    );

    expect(resolvedItems).toEqual([
      deferredItems[0],
      deferredItems[1],
      currentItems[2],
    ]);
  });

  it("does not append current live items to a deferred snapshot from another thread", () => {
    const deferredItems = [
      userMessage("user-a", "A 会话问题"),
      assistantMessage("assistant-a", "A 会话总结"),
    ];
    const currentItems = [
      userMessage("user-b", "B 会话问题"),
      assistantMessage("assistant-b", "B 会话输出"),
    ];

    const resolvedItems = resolveStreamingPresentationItems(
      deferredItems,
      currentItems,
      true,
      undefined,
      {
        deferredScopeKey: "ws-1\u0000thread-a",
        currentScopeKey: "ws-1\u0000thread-b",
      },
    );

    expect(resolvedItems).toBe(currentItems);
  });

  it("reuses the deferred presentation snapshot reference when streaming only updates existing ids", () => {
    const deferredItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出"),
    ];
    const currentItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出后续增量"),
    ];

    const resolvedItems = resolveStreamingPresentationItems(
      deferredItems,
      currentItems,
      true,
    );

    expect(resolvedItems).toBe(deferredItems);
  });

  it("refreshes an active live item with the same id while preserving the deferred history snapshot", () => {
    const deferredItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出"),
    ];
    const currentItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "完成后的 live 输出"),
    ];

    const resolvedItems = resolveStreamingPresentationItems(
      deferredItems,
      currentItems,
      true,
      new Set(["assistant-1"]),
    );

    expect(resolvedItems).toEqual([
      deferredItems[0],
      currentItems[1],
    ]);
  });

  it("does not replace a deferred item when a live override reuses the id for another item kind", () => {
    const deferredItems = [
      userMessage("user-1", "问题"),
      reasoningItem("shared-1", "推理过程"),
    ];
    const currentItems = [
      userMessage("user-1", "问题"),
      assistantMessage("shared-1", "实时正文"),
    ];

    const resolvedItems = resolveStreamingPresentationItems(
      deferredItems,
      currentItems,
      true,
      new Set(["shared-1"]),
    );

    expect(resolvedItems).toBe(deferredItems);
  });

  it("keeps only the latest final assistant in each user turn as a final boundary", () => {
    const boundarySet = buildAssistantFinalBoundarySet([
      userMessage("user-1", "问题 1"),
      assistantMessage("assistant-1a", "阶段一"),
      {
        ...assistantMessage("assistant-1b", "最终回答 1"),
        isFinal: true,
      },
      userMessage("user-2", "问题 2"),
      {
        ...assistantMessage("assistant-2a", "最终回答 2-a"),
        isFinal: true,
      },
      assistantMessage("assistant-2b", "处理中"),
      {
        ...assistantMessage("assistant-2c", "最终回答 2-c"),
        isFinal: true,
      },
    ]);

    expect(Array.from(boundarySet)).toEqual(["assistant-1b", "assistant-2c"]);
  });

  it("production STREAMING_VISIBLE_WINDOW<=0 keeps full list while streaming (jetbrains smooth mode)", () => {
    // 2026-08：生产默认 STREAMING_VISIBLE_WINDOW=0，流式/idle 均全量，避免结束瞬间高度暴涨。
    expect(STREAMING_VISIBLE_WINDOW).toBeLessThanOrEqual(0);
    const items: ConversationItem[] = [
      userMessage("user-latest", "最新问题"),
      ...Array.from({ length: 120 }, (_, index) =>
        assistantMessage(`assistant-${index}`, `回复 ${index}`),
      ),
    ];

    const streaming = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: false,
      visibleWindow: STREAMING_VISIBLE_WINDOW,
    });
    expect(streaming.items).toBe(items);
    expect(streaming.omittedBeforeWorkingSetCount).toBe(0);

    const idle = buildLiveTailWorkingSet(items, {
      isThinking: false,
      showAllHistoryItems: false,
      visibleWindow: STREAMING_VISIBLE_WINDOW,
    });
    expect(idle.items).toBe(items);
    expect(idle.omittedBeforeWorkingSetCount).toBe(0);
  });

  it("still supports optional tail crop when visibleWindow>0 (legacy performance path)", () => {
    const windowSize = 30;
    const total = windowSize * 2 + 40;
    const items: ConversationItem[] = [
      userMessage("user-latest", "最新问题"),
      ...Array.from({ length: total }, (_, index) =>
        assistantMessage(`assistant-${index}`, `回复 ${index}`),
      ),
    ];

    const streaming = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: false,
      visibleWindow: windowSize,
    });
    expect(streaming.items.length).toBeLessThan(items.length);
    expect(streaming.items.length).toBeLessThanOrEqual(windowSize * 2 + 1);
    expect(streaming.items.some((item) => item.id === "user-latest")).toBe(true);
    expect(streaming.omittedBeforeWorkingSetCount).toBeGreaterThan(0);
  });

  it("drops exploring leftovers when the canvas has no user turn", () => {
    const leftoverExplore: ConversationItem = {
      id: "foreign-explore",
      kind: "explore",
      status: "exploring",
      entries: [{ kind: "list", label: "remnants" }],
    };
    const secondLeftover: ConversationItem = {
      id: "foreign-explore-2",
      kind: "explore",
      status: "exploring",
      entries: [{ kind: "list", label: "remnants" }],
    };
    const items: ConversationItem[] = [leftoverExplore, secondLeftover];

    expect(
      suppressOrphanExploringItemsBeforeLatestUserTurn(items).map((item) => item.id),
    ).toEqual([]);
  });

  it("keeps explored cards on an empty canvas that never had a user turn", () => {
    const explored: ConversationItem = {
      id: "kept-explored",
      kind: "explore",
      status: "explored",
      entries: [{ kind: "read", label: "routes.ts" }],
    };

    const items: ConversationItem[] = [explored];
    expect(suppressOrphanExploringItemsBeforeLatestUserTurn(items)).toBe(items);
  });

  it("drops orphan exploring cards that sit above the latest user turn", () => {
    const leftoverExplore: ConversationItem = {
      id: "foreign-explore",
      kind: "explore",
      status: "exploring",
      entries: [{ kind: "list", label: "Downloads" }],
    };
    const items: ConversationItem[] = [
      leftoverExplore,
      userMessage("user-latest", "在吗"),
      assistantMessage("assistant-greeting", "你好"),
    ];

    const filtered = suppressOrphanExploringItemsBeforeLatestUserTurn(items);

    expect(filtered.map((item) => item.id)).toEqual([
      "user-latest",
      "assistant-greeting",
    ]);
  });

  it("keeps current-turn exploring that follows the latest user", () => {
    const liveExplore: ConversationItem = {
      id: "live-explore",
      kind: "explore",
      status: "exploring",
      entries: [{ kind: "list", label: "Downloads" }],
    };
    const items: ConversationItem[] = [
      userMessage("user-latest", "在吗"),
      liveExplore,
    ];

    expect(suppressOrphanExploringItemsBeforeLatestUserTurn(items)).toBe(items);
  });

  it("does not drop explored cards that precede the latest user", () => {
    const explored: ConversationItem = {
      id: "kept-explored",
      kind: "explore",
      status: "explored",
      entries: [{ kind: "read", label: "routes.ts" }],
    };
    const items: ConversationItem[] = [
      explored,
      userMessage("user-latest", "在吗"),
    ];

    expect(suppressOrphanExploringItemsBeforeLatestUserTurn(items)).toBe(items);
  });

  it("still only drops completed explore cards between two user turns", () => {
    const explored: ConversationItem = {
      id: "between-explored",
      kind: "explore",
      status: "explored",
      entries: [{ kind: "read", label: "routes.ts" }],
    };
    const items: ConversationItem[] = [
      userMessage("user-1", "第一问"),
      explored,
      userMessage("user-2", "第二问"),
    ];

    expect(
      suppressCompletedExploreItemsBetweenLatestUserTurns(items).map(
        (item) => item.id,
      ),
    ).toEqual(["user-1", "user-2"]);
  });
});
