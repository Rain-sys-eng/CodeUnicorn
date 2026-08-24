// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ThreadSummary } from "../../../types";
import { useLayoutTopbarSessionTabs } from "./useLayoutTopbarSessionTabs";

function makeThreads(ids: string[]): ThreadSummary[] {
  return ids.map((id, index) => ({
    id,
    name: `Thread ${index + 1}`,
    updatedAt: index + 1,
  }));
}

type HookInput = Parameters<typeof useLayoutTopbarSessionTabs>[0];

function makeInput(overrides: Partial<HookInput> = {}) {
  const onSelectThread = vi.fn();
  const onClearActiveThread = vi.fn();
  const input: HookInput = {
    activeThreadId: "t1",
    activeWorkspaceId: "w1",
    closeCurrentSessionShortcut: null,
    cycleOpenSessionNextShortcut: null,
    cycleOpenSessionPrevShortcut: null,
    isPhone: false,
    isTablet: false,
    showTopSessionTabs: true,
    threadStatusById: {},
    threadsByWorkspace: { w1: makeThreads(["t1", "t2"]) },
    t: (key: string) => key,
    onSelectThread,
    onClearActiveThread,
    ...overrides,
  };
  return { input, onSelectThread, onClearActiveThread };
}

function sessionTabsElement(node: ReturnType<typeof useLayoutTopbarSessionTabs>["sessionTabsNode"]) {
  if (!node) {
    throw new Error("sessionTabsNode should be rendered on desktop");
  }
  return node as ReactElement<{
    tabs: Array<{ workspaceId: string; threadId: string }>;
    onCloseThread: (workspaceId: string, threadId: string) => void;
  }>;
}

describe("useLayoutTopbarSessionTabs close fallback", () => {
  it("closes the last active tab: clears active thread selection instead of resurrecting it", () => {
    const { input, onSelectThread, onClearActiveThread } = makeInput({
      threadsByWorkspace: { w1: makeThreads(["t1"]) },
    });
    const { result, rerender } = renderHook(
      (props: HookInput) => useLayoutTopbarSessionTabs(props),
      { initialProps: input },
    );

    expect(sessionTabsElement(result.current.sessionTabsNode).props.tabs).toHaveLength(1);

    act(() => {
      sessionTabsElement(result.current.sessionTabsNode).props.onCloseThread("w1", "t1");
    });

    // 方案 A：无剩余 tab 时清空选择落空画布，禁止经 selectWorkspace 恢复 last thread
    expect(onClearActiveThread).toHaveBeenCalledTimes(1);
    expect(onClearActiveThread).toHaveBeenCalledWith("w1");
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(sessionTabsElement(result.current.sessionTabsNode).props.tabs).toHaveLength(0);

    // 父级应用清空选择（activeThreadId -> null）后，已关闭 tab 不得复活
    rerender({ ...input, activeThreadId: null });
    expect(sessionTabsElement(result.current.sessionTabsNode).props.tabs).toHaveLength(0);
  });

  it("closes the active tab with remaining tabs: still activates the adjacent tab", () => {
    const base = makeInput();
    const { result, rerender } = renderHook(
      (props: HookInput) => useLayoutTopbarSessionTabs(props),
      { initialProps: base.input },
    );
    // 激活 t2，窗口变为 [t1, t2]，active = t2
    rerender({ ...base.input, activeThreadId: "t2" });
    expect(sessionTabsElement(result.current.sessionTabsNode).props.tabs).toHaveLength(2);

    act(() => {
      sessionTabsElement(result.current.sessionTabsNode).props.onCloseThread("w1", "t2");
    });

    // 相邻 fallback：t2 右侧无 tab，落到左侧 t1；不清空选择
    expect(base.onSelectThread).toHaveBeenCalledTimes(1);
    expect(base.onSelectThread).toHaveBeenCalledWith("w1", "t1");
    expect(base.onClearActiveThread).not.toHaveBeenCalled();
  });

  it("closes an inactive tab: keeps the current selection untouched", () => {
    const base = makeInput();
    const { result, rerender } = renderHook(
      (props: HookInput) => useLayoutTopbarSessionTabs(props),
      { initialProps: base.input },
    );
    rerender({ ...base.input, activeThreadId: "t2" });

    act(() => {
      sessionTabsElement(result.current.sessionTabsNode).props.onCloseThread("w1", "t1");
    });

    expect(base.onSelectThread).not.toHaveBeenCalled();
    expect(base.onClearActiveThread).not.toHaveBeenCalled();
    expect(sessionTabsElement(result.current.sessionTabsNode).props.tabs).toHaveLength(1);
  });
});
