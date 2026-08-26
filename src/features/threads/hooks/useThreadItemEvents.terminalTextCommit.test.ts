// @vitest-environment jsdom
//
// fix-turn-terminal-live-text-commit-loss 回归守卫。
//
// normalized 路由（codex / shared: / agent-canvas:）的 assistant delta 走
// contract batcher：first-token 同步建壳、后续 coalesce 由 32ms cadence 以
// startTransition 延迟提交。turn/completed 结算时若只 flush legacy 队列而不
// drain batcher，barrier 之后的 cadence flush 会把末段正文当迟到事件静默丢弃，
// durable 冻结在 first-token 壳（如「完全」），重开历史才恢复。
//
// 本文件锁死两条防线：
//   Fix 1 — flushPendingRealtimeEvents 必须同步 drain contract batcher；
//   Fix 2 — barrier 之后到达的非空 completeAgentMessage 走 salvage 落盘，
//           增量 delta 仍按迟到事件丢弃。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import { useThreadItemEvents } from "./useThreadItemEvents";

const WORKSPACE_ID = "ws-1";
const THREAD_ID = "shared:thread-1";
const TURN_ID = "turn-1";
const ITEM_ID = "msg-1";

const makeHook = () => {
  const dispatch = vi.fn();
  const markProcessing = vi.fn();
  const { result } = renderHook(() =>
    useThreadItemEvents({
      activeThreadId: THREAD_ID,
      dispatch,
      getCustomName: vi.fn(() => undefined),
      markProcessing,
      markReviewing: vi.fn(),
      safeMessageActivity: vi.fn(),
      recordThreadActivity: vi.fn(),
      applyCollabThreadLinks: vi.fn(),
      interruptedThreadsRef: { current: new Map<string, Map<string, true>>() },
    }),
  );
  return { result, dispatch, markProcessing };
};

const agentDeltaEvent = (delta: string): NormalizedThreadEvent => ({
  engine: "codex",
  workspaceId: WORKSPACE_ID,
  threadId: THREAD_ID,
  eventId: `${ITEM_ID}:delta`,
  itemKind: "message",
  timestampMs: Date.now(),
  item: {
    id: ITEM_ID,
    kind: "message",
    role: "assistant",
    text: delta,
  },
  operation: "appendAgentMessageDelta",
  sourceMethod: "item/agentMessage/delta",
  delta,
  turnId: TURN_ID,
});

const completeEvent = (text: string): NormalizedThreadEvent => ({
  engine: "codex",
  workspaceId: WORKSPACE_ID,
  threadId: THREAD_ID,
  eventId: `${ITEM_ID}:completed`,
  itemKind: "message",
  timestampMs: Date.now(),
  item: {
    id: ITEM_ID,
    kind: "message",
    role: "assistant",
    text,
  },
  operation: "completeAgentMessage",
  sourceMethod: "item/completed",
  turnId: TURN_ID,
});

const appliedEvents = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls
    .map(([action]) => action as Record<string, unknown>)
    .filter((action) => action.type === "applyNormalizedRealtimeEvent")
    .map((action) => action.event as NormalizedThreadEvent);

describe("useThreadItemEvents turn-terminal text commit integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("ccgui.perf.realtimeBatching", "1");
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.localStorage.removeItem("ccgui.perf.realtimeBatching");
    vi.useRealTimers();
  });

  it("drains contract-batcher deltas synchronously at terminal flush (before the barrier)", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      // first-token：同步建壳（如「完全」）。
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      // 后续 delta coalesce 进 batcher pending，不立即提交。
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("顶得住，而且非常轻松。"));
    });

    const beforeFlush = appliedEvents(dispatch);
    expect(beforeFlush).toHaveLength(1);
    expect(beforeFlush[0]?.delta).toBe("完全");

    // 结算路径在建立 terminal barrier 前调用 flushPendingRealtimeEvents。
    act(() => {
      result.current.flushPendingRealtimeEvents();
    });

    const afterFlush = appliedEvents(dispatch);
    // 积压 delta 被同步 drain 落盘（first-token 已同步提交，pending 只剩增量）。
    expect(afterFlush).toHaveLength(2);
    expect(afterFlush[1]?.operation).toBe("appendAgentMessageDelta");
    expect(afterFlush[1]?.delta).toBe("顶得住，而且非常轻松。");
  });

  it("cadence flush after terminal drain is a no-op (no double apply, no late-drop)", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("顶得住。"));
      // 结算：先 drain，再装 barrier（与 settleCompletedTurn 顺序一致）。
      result.current.flushPendingRealtimeEvents();
      result.current.markRealtimeTurnTerminal(THREAD_ID, TURN_ID);
    });

    const appliedAfterSettle = appliedEvents(dispatch).length;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // batcher pending 已在 drain 时清空，cadence 不再提交也不产生迟到丢弃副作用。
    expect(appliedEvents(dispatch)).toHaveLength(appliedAfterSettle);
  });

  it("salvages a completeAgentMessage that arrives after the terminal barrier", () => {
    const { result, dispatch, markProcessing } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.markRealtimeTurnTerminal(THREAD_ID, TURN_ID);
    });
    dispatch.mockClear();
    markProcessing.mockClear();

    act(() => {
      // cross-channel 乱序：item/completed 晚于 turn/completed 到达。
      result.current.onNormalizedRealtimeEvent(
        completeEvent("完全顶得住，而且非常轻松。"),
      );
    });

    const applied = appliedEvents(dispatch);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.operation).toBe("completeAgentMessage");
    expect(
      applied[0]?.item.kind === "message" ? applied[0].item.text : "",
    ).toBe("完全顶得住，而且非常轻松。");
    // salvage 不得复燃 processing。
    expect(markProcessing).not.toHaveBeenCalledWith(THREAD_ID, true);
  });

  it("still drops late incremental deltas after the terminal barrier", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.markRealtimeTurnTerminal(THREAD_ID, TURN_ID);
    });
    dispatch.mockClear();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("迟到的尾巴"));
      vi.advanceTimersByTime(1000);
    });

    expect(appliedEvents(dispatch)).toHaveLength(0);
  });

  it("does not salvage an empty completion body", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.markRealtimeTurnTerminal(THREAD_ID, TURN_ID);
    });
    dispatch.mockClear();

    act(() => {
      result.current.onNormalizedRealtimeEvent(completeEvent(""));
    });

    expect(appliedEvents(dispatch)).toHaveLength(0);
  });
});
