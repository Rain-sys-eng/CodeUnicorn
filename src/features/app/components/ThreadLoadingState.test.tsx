// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ThreadLoadingState } from "./ThreadLoadingState";

describe("ThreadLoadingState", () => {
  beforeEach(() => {
    // 只接管 setTimeout：jsdom 的 requestAnimationFrame 是只读 getter，全量 fake 会炸。
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the session-index label and swaps to the deep-scan label after the index budget", () => {
    render(<ThreadLoadingState />);
    // 初始：第一拍「读取会话索引」。
    expect(screen.queryByText(/loadingWorkspaceSessionsIndex/i)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    // 超过索引读取预算后：切「完整扫描」长查询文案。
    expect(screen.queryByText(/loadingWorkspaceSessionsDeep/i)).toBeTruthy();
  });
});
