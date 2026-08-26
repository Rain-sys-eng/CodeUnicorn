/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyBackgroundTaskUpdate,
  clearBackgroundTasks,
  resetBackgroundTaskStoreForTests,
} from "../../../messages/utils/backgroundTaskStore";
import { useBackgroundTaskPill } from "./useBackgroundTaskPill";

const WS = "ws-1";
const THREAD = "pi:s1";

describe("useBackgroundTaskPill", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("returns empty model when no tasks (pill 不占位)", () => {
    const { result } = renderHook(() =>
      useBackgroundTaskPill({ workspaceId: WS, threadId: THREAD }),
    );
    expect(result.current).toEqual({
      tasks: [],
      runningCount: 0,
      completedCount: 0,
      totalCount: 0,
      hasAny: false,
      anyRunning: false,
      allDone: false,
    });
  });

  it("derives counts from the store and refreshes on updates", () => {
    const { result } = renderHook(() =>
      useBackgroundTaskPill({ workspaceId: WS, threadId: THREAD }),
    );

    act(() => {
      applyBackgroundTaskUpdate(WS, THREAD, {
        toolId: "tool-1",
        task: { id: "t-1", name: "spike", status: "running" },
        source: "receipt",
      });
      applyBackgroundTaskUpdate(WS, THREAD, {
        toolId: "tool-2",
        task: { id: "t-2", name: "build", status: "completed", exitCode: 0 },
        source: "notification",
      });
    });

    expect(result.current.hasAny).toBe(true);
    expect(result.current.totalCount).toBe(2);
    expect(result.current.runningCount).toBe(1);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.anyRunning).toBe(true);
    expect(result.current.allDone).toBe(false);

    act(() => {
      applyBackgroundTaskUpdate(WS, THREAD, {
        toolId: null,
        task: { id: "t-1", status: "completed", exitCode: 0 },
        source: "notification",
      });
    });

    expect(result.current.runningCount).toBe(0);
    expect(result.current.allDone).toBe(true);
  });

  it("scopes reads per thread (别的会话任务不可见)", () => {
    act(() => {
      applyBackgroundTaskUpdate(WS, THREAD, {
        toolId: "tool-1",
        task: { id: "t-1", status: "running" },
        source: "receipt",
      });
    });
    const { result } = renderHook(() =>
      useBackgroundTaskPill({ workspaceId: WS, threadId: "pi:other" }),
    );
    expect(result.current.hasAny).toBe(false);

    act(() => {
      clearBackgroundTasks(WS, THREAD);
    });
    const main = renderHook(() =>
      useBackgroundTaskPill({ workspaceId: WS, threadId: THREAD }),
    );
    expect(main.result.current.hasAny).toBe(false);
  });

  it("returns empty model for null scope (非会话态)", () => {
    const { result } = renderHook(() =>
      useBackgroundTaskPill({ workspaceId: null, threadId: null }),
    );
    expect(result.current.hasAny).toBe(false);
  });
});
