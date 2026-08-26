/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBackgroundTaskUpdate,
  getBackgroundTaskUpdateSink,
  listBackgroundTasks,
  resetBackgroundTaskStoreForTests,
  setBackgroundTaskUpdateSink,
} from "./backgroundTaskStore";
import {
  registryMetadataPathForOutput,
  useBackgroundTaskRegistryWatcher,
} from "./useBackgroundTaskRegistryWatcher";

const WS = "ws-1";
const THREAD = "pi:s1";

describe("registryMetadataPathForOutput", () => {
  it("derives the sibling .json metadata path from the .output log path", () => {
    expect(
      registryMetadataPathForOutput(
        ".pi/tasks/session-123-123/b2e2f48ad.output",
      ),
    ).toBe(".pi/tasks/session-123-123/b2e2f48ad.json");
    expect(
      registryMetadataPathForOutput(".pi/tasks/session-9-9/task-1.OUTPUT"),
    ).toBe(".pi/tasks/session-9-9/task-1.json");
    expect(registryMetadataPathForOutput("logs/raw.bin")).toBe(
      "logs/raw.bin.json",
    );
  });
});

describe("useBackgroundTaskRegistryWatcher", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("promotes terminal registry metadata into the store (post-settle 兜底)", async () => {
    const readFile = vi.fn(async () => ({
      content: JSON.stringify({
        id: "t-1",
        name: "spike",
        status: "completed",
        exitCode: 0,
        endTime: 100,
      }),
      truncated: false,
    }));
    const onApply = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        name: "spike",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: WS, threadId: THREAD },
        { pollMs: 1000, staleAfterMs: 30000, readFile, onApply },
      ),
    );

    // 挂载时的首次 probe 是纯异步（readFile mock 立即 resolve）；flush microtask。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onApply).toHaveBeenCalledWith({
      toolId: null,
      task: expect.objectContaining({
        id: "t-1",
        status: "completed",
        exitCode: 0,
      }),
      source: "registry",
    });
    const records = listBackgroundTasks(WS, THREAD);
    expect(records[0]?.task.status).toBe("completed");
  });

  it("marks a task failed after the process is sustainedly dead and no terminal metadata", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("no file");
    });
    const isProcessAlive = vi.fn(async () => false);
    const onApply = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        name: "spike",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: WS, threadId: THREAD },
        { pollMs: 1000, staleAfterMs: 3000, readFile, isProcessAlive, onApply },
      ),
    );

    // 首次探测记录死亡起点，未到阈值不标记。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onApply).not.toHaveBeenCalled();

    // 持续死亡 > staleAfterMs → 标异常终止。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "registry",
        task: expect.objectContaining({ id: "t-1", status: "failed" }),
      }),
    );
    const records = listBackgroundTasks(WS, THREAD);
    expect(records[0]?.task.status).toBe("failed");
  });

  it("does not flag a running task when the process is still alive", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("no file");
    });
    const isProcessAlive = vi.fn(async () => true);
    const onApply = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: WS, threadId: THREAD },
        { pollMs: 1000, staleAfterMs: 3000, readFile, isProcessAlive, onApply },
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(listBackgroundTasks(WS, THREAD)[0]?.task.status).toBe("running");
  });

  it("does nothing for a null scope", () => {
    const onApply = vi.fn();
    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: null, threadId: null },
        { readFile: vi.fn(), isProcessAlive: vi.fn(), onApply },
      ),
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it("routes through the registered sink when mounted (timeline 与 pill 同步)", async () => {
    const readFile = vi.fn(async () => ({
      content: JSON.stringify({
        id: "t-1",
        name: "spike",
        status: "completed",
        exitCode: 0,
      }),
      truncated: false,
    }));
    const sink = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    act(() => {
      setBackgroundTaskUpdateSink(sink);
    });
    try {
      renderHook(() =>
        useBackgroundTaskRegistryWatcher(
          { workspaceId: WS, threadId: THREAD },
          { pollMs: 1000, staleAfterMs: 30000, readFile },
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(sink).toHaveBeenCalledWith(
        WS,
        THREAD,
        expect.objectContaining({
          source: "registry",
          task: expect.objectContaining({ status: "completed" }),
        }),
      );
    } finally {
      act(() => {
        setBackgroundTaskUpdateSink(null);
      });
    }
  });
});
