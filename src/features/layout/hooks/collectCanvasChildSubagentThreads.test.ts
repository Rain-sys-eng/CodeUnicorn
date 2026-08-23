import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "../../../types";
import { collectCanvasChildSubagentThreads } from "./useLayoutNodes";

const thread = (id: string, parentThreadId?: string): ThreadSummary =>
  ({
    id,
    name: id,
    updatedAt: 0,
    engineSource: "claude",
    ...(parentThreadId ? { parentThreadId } : {}),
  }) as ThreadSummary;

describe("collectCanvasChildSubagentThreads", () => {
  it("excludes pi fork-derived threads from subagent counting", () => {
    const rows = [
      {
        ...thread("pi:parent-session"),
        id: "pi:parent-session",
      },
      {
        ...thread("pi:forked-branch", "pi:parent-session"),
        engineSource: "pi" as const,
      },
      thread("grok:real-subagent", "pi:parent-session"),
    ];
    const result = collectCanvasChildSubagentThreads(
      "pi:parent-session",
      "ws-1",
      rows,
      {},
      [],
    );
    // pi fork 分支不计入子代理（pi 分支归会话树单独控制）
    expect(result.map((t) => t.id)).toEqual(["grok:real-subagent"]);
  });

  it("includes threads whose parent is the active id", () => {
    const rows = [
      thread("grok:child-1", "shared:parent"),
      thread("grok:child-2", "shared:parent"),
      thread("grok:unrelated"),
    ];
    const result = collectCanvasChildSubagentThreads(
      "shared:parent",
      "ws-1",
      rows,
      {},
      [],
    );
    expect(result.map((t) => t.id)).toEqual(["grok:child-1", "grok:child-2"]);
  });

  it("includes claude:subagent rows under the shared session native owners (history no-parent case)", () => {
    const rows = [
      thread("claude:subagent:10665500-08df-4321-8906-8485e6850a1b:a0a98a34399ddf965"),
      thread("claude:subagent:10665500-08df-4321-8906-8485e6850a1b:a5c8721e849a2691d"),
      thread("claude:subagent:10665500-08df-4321-8906-8485e6850a1b:a87ec4e58d579c5c0"),
      thread("claude:other-owner:agent-x"),
      thread("claude:10665500-08df-4321-8906-8485e6850a1b"),
    ];
    const result = collectCanvasChildSubagentThreads(
      "shared:7d38d159-ccf0-4a64-a689-c346eee8b983",
      "ws-1",
      rows,
      {},
      ["claude:10665500-08df-4321-8906-8485e6850a1b"],
    );
    expect(result.map((t) => t.id)).toEqual([
      "claude:subagent:10665500-08df-4321-8906-8485e6850a1b:a0a98a34399ddf965",
      "claude:subagent:10665500-08df-4321-8906-8485e6850a1b:a5c8721e849a2691d",
      "claude:subagent:10665500-08df-4321-8906-8485e6850a1b:a87ec4e58d579c5c0",
    ]);
  });

  it("does not inject claude:subagent rows for native (non-shared) parents", () => {
    const rows = [
      thread("claude:subagent:owner:agent-x"),
      thread("claude:owner"),
    ];
    const result = collectCanvasChildSubagentThreads(
      "claude:owner",
      "ws-1",
      rows,
      {},
      [],
    );
    expect(result).toEqual([]);
  });

  it("falls back to bare owner id without engine prefix", () => {
    const rows = [thread("claude:subagent:10665500-08df:agent-x")];
    const result = collectCanvasChildSubagentThreads(
      "shared:p",
      "ws-1",
      rows,
      {},
      ["claude:10665500-08df"],
    );
    expect(result.map((t) => t.id)).toEqual([
      "claude:subagent:10665500-08df:agent-x",
    ]);
  });

  it("returns empty for missing active/workspace/threads", () => {
    expect(collectCanvasChildSubagentThreads(null, "ws", [], {}, [])).toEqual(
      [],
    );
    expect(collectCanvasChildSubagentThreads("shared:p", null, [], {}, [])).toEqual(
      [],
    );
    expect(collectCanvasChildSubagentThreads("shared:p", "ws", undefined, {}, [])).toEqual(
      [],
    );
  });
});
