// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setOrphanTurnFirstEventTimeoutMsForTests,
  clearFirstEngineEventForThread,
  decideOrphanTurnWatch,
  getFirstEngineEventAtForThread,
  noteEngineEventForThread,
} from "../utils/orphanTurnWatchdog";
import { useOrphanTurnWatchdog } from "./useOrphanTurnWatchdog";
import type { ThreadActivityStatus } from "./threadReducerTypes";

function makeStatus(isProcessing: boolean): ThreadActivityStatus {
  return {
    isProcessing,
    hasUnread: false,
    isReviewing: false,
    processingStartedAt: isProcessing ? Date.now() : null,
    lastDurationMs: null,
  };
}

function makeOptions(overrides?: {
  threadStatusById?: Record<string, ThreadActivityStatus>;
}) {
  const markProcessing = vi.fn();
  const setActiveTurnId = vi.fn();
  const pushThreadErrorMessage = vi.fn();
  const onDebug = vi.fn();
  const threadStatusById = overrides?.threadStatusById ?? {
    "thread-1": makeStatus(true),
  };
  const hook = renderHook(
    (props: { threadStatusById: Record<string, ThreadActivityStatus> }) =>
      useOrphanTurnWatchdog({
        threadStatusById: props.threadStatusById,
        markProcessing,
        setActiveTurnId,
        pushThreadErrorMessage,
        onDebug,
      }),
    { initialProps: { threadStatusById } },
  );
  return {
    hook,
    markProcessing,
    setActiveTurnId,
    pushThreadErrorMessage,
    onDebug,
    rerenderWithStatus(threadStatusById: Record<string, ThreadActivityStatus>) {
      hook.rerender({ threadStatusById });
    },
  };
}

describe("decideOrphanTurnWatch 纯判定", () => {
  it("零首事件 + 仍 processing + 到期 → settle-orphan", () => {
    expect(
      decideOrphanTurnWatch({
        isProcessing: true,
        firstEngineEventAt: null,
        deadlineAt: 1_000,
        now: 1_000,
      }),
    ).toBe("settle-orphan");
  });

  it("首事件已到 → keep-watching（不误杀慢启动后的正常 turn）", () => {
    expect(
      decideOrphanTurnWatch({
        isProcessing: true,
        firstEngineEventAt: 500,
        deadlineAt: 1_000,
        now: 2_000,
      }),
    ).toBe("keep-watching");
  });

  it("processing 已被清除（terminal/interrupt/rpcError）→ keep-watching", () => {
    expect(
      decideOrphanTurnWatch({
        isProcessing: false,
        firstEngineEventAt: null,
        deadlineAt: 1_000,
        now: 5_000,
      }),
    ).toBe("keep-watching");
  });

  it("未到期 → keep-watching", () => {
    expect(
      decideOrphanTurnWatch({
        isProcessing: true,
        firstEngineEventAt: null,
        deadlineAt: 1_000,
        now: 999,
      }),
    ).toBe("keep-watching");
  });
});

describe("首事件登记表", () => {
  afterEach(() => {
    clearFirstEngineEventForThread("thread-1");
  });

  it("note 幂等：仅首个时间戳生效", () => {
    noteEngineEventForThread("thread-1");
    const first = getFirstEngineEventAtForThread("thread-1");
    expect(first).not.toBeNull();
    noteEngineEventForThread("thread-1");
    expect(getFirstEngineEventAtForThread("thread-1")).toBe(first);
  });

  it("clear 后可重新登记", () => {
    noteEngineEventForThread("thread-1");
    clearFirstEngineEventForThread("thread-1");
    expect(getFirstEngineEventAtForThread("thread-1")).toBeNull();
  });
});

describe("useOrphanTurnWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    __setOrphanTurnFirstEventTimeoutMsForTests(90_000);
  });

  afterEach(() => {
    __setOrphanTurnFirstEventTimeoutMsForTests(null);
    vi.useRealTimers();
  });

  it("零首事件到期：settle 孤儿 turn（清 processing/activeTurnId + 可重试错误 + 诊断）", () => {
    const ctx = makeOptions();
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
    });
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(ctx.markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(ctx.setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(ctx.pushThreadErrorMessage).toHaveBeenCalledTimes(1);
    expect(ctx.pushThreadErrorMessage.mock.calls[0][0]).toBe("ws-1");
    expect(ctx.pushThreadErrorMessage.mock.calls[0][1]).toBe("thread-1");
    expect(typeof ctx.pushThreadErrorMessage.mock.calls[0][2]).toBe("string");
    expect(ctx.onDebug).toHaveBeenCalledTimes(1);
    expect(ctx.onDebug.mock.calls[0][0].label).toBe(
      "orphan-turn-first-event-timeout",
    );
  });

  it("首事件在阈值内到达：不 settle，行为零干预", () => {
    const ctx = makeOptions();
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
    });
    act(() => {
      noteEngineEventForThread("thread-1");
      vi.advanceTimersByTime(90_000);
    });
    expect(ctx.markProcessing).not.toHaveBeenCalled();
    expect(ctx.pushThreadErrorMessage).not.toHaveBeenCalled();
  });

  it("terminal/interrupt 先清除 processing：不触发（互斥）", () => {
    const ctx = makeOptions();
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
    });
    // 拆两个 act：rerender 的 passive effect（ref 更新）需 act 退出时 flush，
    // 若同块内推进 timer，fire 时读到的是旧 ref（测试时序 artifact，非 hook 缺陷）。
    act(() => {
      ctx.rerenderWithStatus({ "thread-1": makeStatus(false) });
    });
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(ctx.markProcessing).not.toHaveBeenCalledWith("thread-1", false);
    expect(ctx.pushThreadErrorMessage).not.toHaveBeenCalled();
  });

  it("disarm 后不触发", () => {
    const ctx = makeOptions();
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
      ctx.hook.result.current.disarmOrphanTurnWatchdog("thread-1");
    });
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(ctx.pushThreadErrorMessage).not.toHaveBeenCalled();
  });

  it("同 thread 重复 arm：复用最早 deadline，不重置窗口", () => {
    const ctx = makeOptions();
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
      vi.advanceTimersByTime(60_000);
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
      vi.advanceTimersByTime(30_000);
    });
    // 第一段 90s 已满 → settle 已发生（第二次 arm 不重置窗口）
    expect(ctx.pushThreadErrorMessage).toHaveBeenCalledTimes(1);
  });

  it("卸载时清 timer：不泄漏、不 settle", () => {
    const ctx = makeOptions();
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
    });
    ctx.hook.unmount();
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(ctx.pushThreadErrorMessage).not.toHaveBeenCalled();
  });
  it("arm 前的陈旧首事件登记（非 turn 事件）不遮蔽本 turn 的孤儿判定", () => {
    const ctx = makeOptions();
    // 历史加载 / 标题生成等非 turn 事件在 arm 前登记过首事件；arm 必须清掉，
    // 否则本 turn 零事件也会被误判 keep-watching 而永久挂起。
    noteEngineEventForThread("thread-1");
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
    });
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(ctx.markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(ctx.pushThreadErrorMessage).toHaveBeenCalledTimes(1);
  });
  it("上一窗口已见首事件后再次 arm（新 turn）：重挂全新窗口，新 turn 孤儿可判出", () => {
    const ctx = makeOptions();
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
    });
    // turn 1 正常：首事件到达，随后完结（processing 清除），旧 timer 仍在。
    act(() => {
      noteEngineEventForThread("thread-1");
      vi.advanceTimersByTime(10_000);
    });
    act(() => {
      ctx.rerenderWithStatus({ "thread-1": makeStatus(false) });
    });
    // turn 2 在旧 timer 窗口内发出：已见首事件 → 视为新 turn 重挂全新窗口。
    act(() => {
      ctx.rerenderWithStatus({ "thread-1": makeStatus(true) });
    });
    act(() => {
      ctx.hook.result.current.armOrphanTurnWatchdog("ws-1", "thread-1");
    });
    // 旧 deadline（t=90s）不应触发 settle（窗口已重置为 t=100s）。
    act(() => {
      vi.advanceTimersByTime(80_000);
    });
    expect(ctx.markProcessing).not.toHaveBeenCalled();
    // 新窗口到期：turn 2 零首事件 → settle。
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(ctx.markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(ctx.pushThreadErrorMessage).toHaveBeenCalledTimes(1);
  });
});
