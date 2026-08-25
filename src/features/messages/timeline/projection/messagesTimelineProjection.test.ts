import { describe, expect, it } from "vitest";
import { groupToolItems } from "../../utils/groupToolItems";
import { buildLongListFixture } from "../../../../test-fixtures/perf/longListFixtureFactory";
import {
  buildTimelineProjectionRows,
  findTimelineProjectionRowIndexByItemId,
  getGroupedEntryProjectionKey,
} from "./messagesTimelineProjection";

describe("messagesTimelineProjection", () => {
  it("preserves grouped entry identity and order for long lists", () => {
    const entries = groupToolItems(buildLongListFixture(1000));
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      processPhaseChips: [],
      effectiveItemsCount: 1000,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: false,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    expect(rows.filter((row) => row.kind === "entry").map((row) => row.key)).toEqual(
      entries.map(getGroupedEntryProjectionKey),
    );
    expect(rows.at(-1)?.kind).toBe("bottomAnchor");
  });

  it("keeps editGroup projection key stable when the group grows", () => {
    const first = {
      id: "edit-1",
      kind: "tool" as const,
      toolType: "edit" as const,
      title: "Tool: edit",
      detail: JSON.stringify({ file_path: "a.ts", old_string: "a", new_string: "b" }),
      status: "completed" as const,
    };
    const second = {
      id: "edit-2",
      kind: "tool" as const,
      toolType: "edit" as const,
      title: "Tool: edit",
      detail: JSON.stringify({ file_path: "b.ts", old_string: "a", new_string: "b" }),
      status: "completed" as const,
    };

    const small = groupToolItems([first]);
    const grown = groupToolItems([first, second]);
    expect(small[0]?.kind).toBe("editGroup");
    expect(grown[0]?.kind).toBe("editGroup");
    expect(getGroupedEntryProjectionKey(small[0]!)).toBe(
      getGroupedEntryProjectionKey(grown[0]!),
    );
    expect(getGroupedEntryProjectionKey(grown[0]!)).toBe("editGroup:edit-1");
  });

  it("marks active user input anchor without moving the owning entry", () => {
    const entries = groupToolItems(buildLongListFixture(9));
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: "message-6",
      approvalVisible: true,
      claudeDockedReasoningItemIds: ["reasoning-live"],
      processPhaseChips: [],
      effectiveItemsCount: 9,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: false,
      isHistoryLoading: false,
      isThinking: true,
      shouldRenderUserInputAtTail: false,
    });

    expect(
      rows.find((row) => row.kind === "entry" && row.hasActiveUserInputAnchor),
    ).toMatchObject({
      kind: "entry",
      itemIds: expect.arrayContaining(["message-6"]),
    });
    expect(rows.map((row) => row.kind)).toContain("dockedReasoning");
    expect(rows.map((row) => row.kind)).not.toContain("liveMiddleCollapsed");
    expect(rows.map((row) => row.kind)).toContain("approval");
  });

  it("parks the drawer header above assistant prose when process rows are unmounted", () => {
    // Collapsed hard-unmount: only user + assistant remain in grouped entries.
    const entries = groupToolItems([
      {
        id: "user-anchor",
        kind: "message",
        role: "user",
        text: "你好",
      },
      {
        id: "assistant-after",
        kind: "message",
        role: "assistant",
        text: "回复",
      },
    ]);
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      processPhaseChips: [
        {
          phaseKey: "assistant-after",
          count: 2,
          expanded: false,
          durationMs: 63_000,
          breakdown: { reasoningCount: 0, toolCount: 2, exploreCount: 0 },
          insertBeforeItemId: "tool-a",
          assistantItemId: "assistant-after",
          hiddenItemIds: ["tool-a", "tool-b"],
        },
      ],
      effectiveItemsCount: 2,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: false,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    const chipIndex = rows.findIndex((row) => row.kind === "liveMiddleCollapsed");
    const assistantIndex = rows.findIndex(
      (row) => row.kind === "entry" && row.itemIds.includes("assistant-after"),
    );
    expect(chipIndex).toBe(assistantIndex - 1);
    expect(rows[chipIndex]).toMatchObject({
      kind: "liveMiddleCollapsed",
      phaseKey: "assistant-after",
      expanded: false,
    });
  });

  it("places the drawer header above remounted process rows when expanded", () => {
    const entries = groupToolItems([
      {
        id: "user-anchor",
        kind: "message",
        role: "user",
        text: "你好",
      },
      {
        id: "tool-a",
        kind: "tool",
        toolType: "fileRead",
        title: "Read a.ts",
        detail: "a.ts",
        status: "completed",
        output: "",
      },
      {
        id: "tool-b",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: Grep",
        detail: "pattern",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-after",
        kind: "message",
        role: "assistant",
        text: "回复",
      },
    ]);
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      processPhaseChips: [
        {
          phaseKey: "assistant-after",
          count: 2,
          expanded: true,
          durationMs: 63_000,
          breakdown: { reasoningCount: 0, toolCount: 2, exploreCount: 0 },
          insertBeforeItemId: "tool-a",
          assistantItemId: "assistant-after",
          hiddenItemIds: ["tool-a", "tool-b"],
        },
      ],
      effectiveItemsCount: 4,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: false,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    const chipIndex = rows.findIndex((row) => row.kind === "liveMiddleCollapsed");
    const firstToolIndex = rows.findIndex(
      (row) => row.kind === "entry" && row.itemIds.includes("tool-a"),
    );
    expect(chipIndex).toBe(firstToolIndex - 1);
    expect(rows[firstToolIndex]).toMatchObject({
      kind: "entry",
      processPhaseKey: "assistant-after",
    });
  });

  it("renders same-anchor chips in phases order (outer header above inner)", () => {
    // 极简模式外层 turn chip 展开 + 内层 trailing chip 同锚第一个可见 entry：
    // 两个 header 都要渲染，外层在上。
    const entries = groupToolItems([
      {
        id: "tool-a",
        kind: "tool",
        toolType: "fileRead",
        title: "Read a.ts",
        detail: "a.ts",
        status: "completed",
        output: "",
      },
      {
        id: "tool-b",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: Grep",
        detail: "pattern",
        status: "completed",
        output: "",
      },
    ]);
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      processPhaseChips: [
        {
          phaseKey: "liveturn:u1",
          count: 8,
          expanded: true,
          durationMs: 63_000,
          breakdown: { reasoningCount: 2, toolCount: 6, exploreCount: 0 },
          insertBeforeItemId: "tool-a",
          assistantItemId: "liveturn:u1",
          hiddenItemIds: ["tool-a", "tool-b"],
        },
        {
          phaseKey: "trailing:start",
          count: 5,
          expanded: false,
          durationMs: 40_000,
          breakdown: { reasoningCount: 0, toolCount: 5, exploreCount: 0 },
          insertBeforeItemId: "tool-x",
          assistantItemId: "trailing:start",
          collapsedAnchorItemId: "tool-a",
          hiddenItemIds: ["tool-x"],
        },
      ],
      effectiveItemsCount: 2,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: false,
      isHistoryLoading: false,
      isThinking: true,
      shouldRenderUserInputAtTail: false,
    });

    const chipRows = rows.filter((row) => row.kind === "liveMiddleCollapsed");
    expect(chipRows.map((row) => row.phaseKey)).toEqual([
      "liveturn:u1",
      "trailing:start",
    ]);
    const firstToolIndex = rows.findIndex(
      (row) => row.kind === "entry" && row.itemIds.includes("tool-a"),
    );
    // 两个 header 都落在第一个可见 entry 之前，外层 chip 在上。
    expect(rows[firstToolIndex - 2]?.kind).toBe("liveMiddleCollapsed");
    expect(rows[firstToolIndex - 1]?.kind).toBe("liveMiddleCollapsed");
  });

  it("parks a collapsed chip above each assistant segment", () => {
    const entries = groupToolItems([
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "分段",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "第一段",
      },
      {
        id: "assistant-2",
        kind: "message",
        role: "assistant",
        text: "第二段",
      },
    ]);
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      processPhaseChips: [
        {
          phaseKey: "assistant-1",
          count: 1,
          expanded: false,
          durationMs: null,
          breakdown: { reasoningCount: 0, toolCount: 1, exploreCount: 0 },
          insertBeforeItemId: "tool-1",
          assistantItemId: "assistant-1",
          hiddenItemIds: ["tool-1"],
        },
        {
          phaseKey: "assistant-2",
          count: 2,
          expanded: false,
          durationMs: null,
          breakdown: { reasoningCount: 0, toolCount: 2, exploreCount: 0 },
          insertBeforeItemId: "tool-2",
          assistantItemId: "assistant-2",
          hiddenItemIds: ["tool-2", "tool-3"],
        },
      ],
      effectiveItemsCount: 3,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: false,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    const kinds = rows
      .filter((row) => row.kind === "liveMiddleCollapsed" || row.kind === "entry")
      .map((row) =>
        row.kind === "liveMiddleCollapsed" ? `chip:${row.phaseKey}` : row.itemIds[0],
      );
    expect(kinds).toEqual([
      "user-1",
      "chip:assistant-1",
      "assistant-1",
      "chip:assistant-2",
      "assistant-2",
    ]);
  });

  it("resolves the projection row index for a message id", () => {
    const entries = groupToolItems(buildLongListFixture(12));
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: true,
      claudeDockedReasoningItemIds: ["reasoning-live"],
      processPhaseChips: [],
      effectiveItemsCount: 12,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: false,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    const index = findTimelineProjectionRowIndexByItemId(rows, "message-6");

    expect(index).toBeGreaterThanOrEqual(0);
    expect(rows[index]).toMatchObject({
      kind: "entry",
      itemIds: expect.arrayContaining(["message-6"]),
    });
    expect(findTimelineProjectionRowIndexByItemId(rows, "reasoning-live")).toBe(-1);
    expect(findTimelineProjectionRowIndexByItemId(rows, "missing")).toBe(-1);
  });

  it("adds one recovery failure row without hiding last-good history", () => {
    const entries = groupToolItems(buildLongListFixture(3));
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      processPhaseChips: [],
      effectiveItemsCount: 3,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: true,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    expect(rows.filter((row) => row.kind === "entry")).toHaveLength(entries.length);
    expect(rows.filter((row) => row.kind === "historyRecoveryFailure")).toHaveLength(1);
    expect(rows.some((row) => row.kind === "emptyState")).toBe(false);
  });

  it("shows recovery failure instead of an empty-thread row when history is empty", () => {
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      processPhaseChips: [],
      effectiveItemsCount: 0,
      groupedEntries: [],
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      historyRecoveryFailureVisible: true,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    expect(rows.filter((row) => row.kind === "historyRecoveryFailure")).toHaveLength(1);
    expect(rows.some((row) => row.kind === "emptyState")).toBe(false);
  });
});
