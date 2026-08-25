import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../../types";
import { resolveCollapsedTimelineItems } from "./messagesViewModel";

function user(id: string, text = "你好"): ConversationItem {
  return { id, kind: "message", role: "user", text };
}

function assistant(
  id: string,
  text: string,
  isFinal = false,
): ConversationItem {
  return { id, kind: "message", role: "assistant", text, isFinal };
}

function reasoning(id: string, content = "thinking"): ConversationItem {
  return { id, kind: "reasoning", summary: content, content };
}

function tool(
  id: string,
  status: "running" | "completed" = "completed",
  durationMs?: number,
): ConversationItem {
  return {
    id,
    kind: "tool",
    toolType: "fileRead",
    title: "Read foo.ts",
    detail: "foo.ts",
    status,
    output: "",
    durationMs,
  };
}

function ids(result: { timelineItems: ConversationItem[] }): string[] {
  return result.timelineItems.map((item) => item.id);
}

describe("resolveCollapsedTimelineItems minimal transcript mode", () => {
  it("keeps interstitial prose visible when the flag is off (default isolation)", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      tool("t1", "completed", 1_000),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      assistant("a2", "最终答案", true),
      user("u2"),
      assistant("a3", "第二轮答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      timelineSourceItems: items,
    });

    // 默认模式：per-phase 折叠，中间叙述 a1 保留在时间线；a3 上方无过程不产 chip。
    expect(ids(result)).toEqual(["u1", "a1", "a2", "u2", "a3"]);
    expect(result.phases.map((phase) => phase.phaseKey)).toEqual(["a1", "a2"]);
  });

  it("folds a completed turn's process and interstitial prose into a single turn chip", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      tool("t1", "completed", 1_000),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      tool("t2"),
      assistant("a2", "最终答案", true),
      user("u2"),
      assistant("a3", "第二轮答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 完成 turn：只剩最终答案；过程与中间叙述全部 hard-unmount。
    expect(ids(result)).toEqual(["u1", "a2", "u2", "a3"]);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "turn:a2",
      assistantItemId: "a2",
      insertBeforeItemId: "r1",
      expanded: false,
      durationMs: 1_000,
      hiddenItemIds: ["r1", "t1", "a1", "r2", "t2"],
      breakdown: {
        reasoningCount: 2,
        toolCount: 2,
        exploreCount: 0,
        proseCount: 1,
      },
    });
  });

  it("remounts the full original process when the turn chip is expanded", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      tool("t1"),
      assistant("a2", "最终答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      expandedPhaseKeys: new Set(["turn:a2"]),
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    expect(ids(result)).toEqual(["u1", "r1", "a1", "t1", "a2"]);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toMatchObject({
      phaseKey: "turn:a2",
      expanded: true,
    });
  });

  it("keeps the active streaming tail turn on live per-phase behavior", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "中间叙述"),
      reasoning("r2"),
      tool("t1", "running"),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      isThinking: true,
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 活跃 turn：a1 仍是 per-phase 锚点且可见，running tool 保持 live。
    expect(ids(result)).toEqual(["u1", "a1", "r2", "t1"]);
    expect(result.phases.map((phase) => phase.phaseKey)).toEqual(["a1"]);
  });

  it("produces no chip for a single-prose turn without process", () => {
    const items = [user("u1"), assistant("a1", "直接回答", true)];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    expect(result.phases).toEqual([]);
    expect(ids(result)).toEqual(["u1", "a1"]);
  });

  it("never folds a turn without any visible prose", () => {
    const items = [
      user("u1"),
      tool("t1"),
      tool("t2"),
      user("u2"),
      assistant("a1", "答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    // 纯工具 turn 不折叠；单 prose turn 无 chip。
    expect(result.phases).toEqual([]);
    expect(ids(result)).toEqual(["u1", "t1", "t2", "u2", "a1"]);
  });

  it("folds each completed turn independently in multi-turn history", () => {
    const items = [
      user("u1"),
      reasoning("r1"),
      assistant("a1", "第一轮答案", true),
      user("u2"),
      reasoning("r2"),
      assistant("a2", "第二轮中间叙述"),
      reasoning("r3"),
      assistant("a3", "第二轮答案", true),
    ];
    const result = resolveCollapsedTimelineItems({
      activeEngine: "claude",
      minimalTranscriptEnabled: true,
      timelineSourceItems: items,
    });

    expect(ids(result)).toEqual(["u1", "a1", "u2", "a3"]);
    expect(result.phases.map((phase) => phase.phaseKey)).toEqual([
      "turn:a1",
      "turn:a3",
    ]);
    expect(result.phases[1]).toMatchObject({
      hiddenItemIds: ["r2", "a2", "r3"],
      breakdown: { reasoningCount: 2, proseCount: 1 },
    });
  });
});
