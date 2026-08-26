// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeleteThreadPrompt } from "./useDeleteThreadPrompt";
import { SESSION_DELETE_V2_FLAG_KEY } from "../utils/sessionDeleteV2";

const threadsByWorkspace = {
  "ws-1": [{ id: "thread-1", name: "待删除会话", updatedAt: 1 }],
};

function setV2Flag(value: string | null) {
  if (value == null) {
    window.localStorage.removeItem(SESSION_DELETE_V2_FLAG_KEY);
  } else {
    window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, value);
  }
}

describe("useDeleteThreadPrompt", () => {
  beforeEach(() => {
    setV2Flag("off");
  });
  afterEach(() => {
    setV2Flag(null);
  });

  it("opens prompt with matched thread name", () => {
    const removeThread = vi.fn().mockResolvedValue({ success: true, message: null });
    const { result } = renderHook(() =>
      useDeleteThreadPrompt({
        threadsByWorkspace,
        removeThread,
      }),
    );

    act(() => {
      result.current.openDeletePrompt("ws-1", "thread-1");
    });

    expect(result.current.deletePrompt).toEqual({
      workspaceId: "ws-1",
      threadId: "thread-1",
      threadName: "待删除会话",
    });
  });

  it("confirms deletion and calls success callback (legacy path)", async () => {
    const removeThread = vi.fn().mockResolvedValue({ success: true, message: null });
    const onDeleteSuccess = vi.fn();
    const onDeleteError = vi.fn();
    const { result } = renderHook(() =>
      useDeleteThreadPrompt({
        threadsByWorkspace,
        removeThread,
        onDeleteSuccess,
        onDeleteError,
      }),
    );

    act(() => {
      result.current.openDeletePrompt("ws-1", "thread-1");
    });

    await act(async () => {
      await result.current.handleDeletePromptConfirm();
    });

    expect(removeThread).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(onDeleteSuccess).toHaveBeenCalledWith("thread-1");
    expect(onDeleteError).not.toHaveBeenCalled();
    expect(result.current.deletePrompt).toBeNull();
  });

  it("keeps prompt open when deletion fails (legacy path)", async () => {
    const removeThread = vi.fn().mockResolvedValue({ success: false, message: "boom" });
    const onDeleteSuccess = vi.fn();
    const onDeleteError = vi.fn();
    const { result } = renderHook(() =>
      useDeleteThreadPrompt({
        threadsByWorkspace,
        removeThread,
        onDeleteSuccess,
        onDeleteError,
      }),
    );

    act(() => {
      result.current.openDeletePrompt("ws-1", "thread-1");
    });

    await act(async () => {
      await result.current.handleDeletePromptConfirm();
    });

    expect(onDeleteSuccess).not.toHaveBeenCalled();
    expect(onDeleteError).toHaveBeenCalledWith("boom");
    expect(result.current.deletePrompt?.threadId).toBe("thread-1");
  });
});

describe("useDeleteThreadPrompt (v2 乐观删除)", () => {
  beforeEach(() => {
    setV2Flag("on"); // 测试环境默认 off，显式开启
  });

  afterEach(() => {
    setV2Flag(null);
  });

  it("确认即关框，成功后回调 onDeleteSuccess", async () => {
    let resolveRemove: ((value: { success: boolean; message: string | null }) => void) | null =
      null;
    const removeThread = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const onDeleteSuccess = vi.fn();
    const onDeleteError = vi.fn();
    const { result } = renderHook(() =>
      useDeleteThreadPrompt({
        threadsByWorkspace,
        removeThread,
        onDeleteSuccess,
        onDeleteError,
      }),
    );

    act(() => {
      result.current.openDeletePrompt("ws-1", "thread-1");
    });

    await act(async () => {
      await result.current.handleDeletePromptConfirm();
    });

    // 乐观：后端尚未回包，弹窗已关闭
    expect(result.current.deletePrompt).toBeNull();
    expect(removeThread).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(onDeleteSuccess).not.toHaveBeenCalled();

    await act(async () => {
      resolveRemove?.({ success: true, message: null });
    });
    expect(onDeleteSuccess).toHaveBeenCalledWith("thread-1");
    expect(onDeleteError).not.toHaveBeenCalled();
  });

  it("后台删除失败：onDeleteError 提示（弹窗已关闭，行回滚由 useThreads 负责）", async () => {
    const removeThread = vi.fn().mockResolvedValue({ success: false, message: "boom" });
    const onDeleteSuccess = vi.fn();
    const onDeleteError = vi.fn();
    const { result } = renderHook(() =>
      useDeleteThreadPrompt({
        threadsByWorkspace,
        removeThread,
        onDeleteSuccess,
        onDeleteError,
      }),
    );

    act(() => {
      result.current.openDeletePrompt("ws-1", "thread-1");
    });

    await act(async () => {
      await result.current.handleDeletePromptConfirm();
    });

    expect(result.current.deletePrompt).toBeNull();
    expect(onDeleteSuccess).not.toHaveBeenCalled();
    expect(onDeleteError).toHaveBeenCalledWith("boom");
  });

  it("flag=off 时回退 legacy 阻塞式确认", async () => {
    setV2Flag("off");
    const removeThread = vi.fn().mockResolvedValue({ success: true, message: null });
    const onDeleteSuccess = vi.fn();
    const { result } = renderHook(() =>
      useDeleteThreadPrompt({
        threadsByWorkspace,
        removeThread,
        onDeleteSuccess,
      }),
    );

    act(() => {
      result.current.openDeletePrompt("ws-1", "thread-1");
    });

    await act(async () => {
      await result.current.handleDeletePromptConfirm();
    });

    expect(removeThread).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(onDeleteSuccess).toHaveBeenCalledWith("thread-1");
  });
});
