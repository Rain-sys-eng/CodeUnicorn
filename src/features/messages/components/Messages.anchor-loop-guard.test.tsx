// @vitest-environment jsdom
/**
 * W1（2026-08-25）：钉底跟随期间 scroll/sync 风暴不得触发 messages/overlay-loop-guard。
 *
 * 线上证据：~/.ccgui/client/diagnostics.json 中 overlay-loop-guard 31 条，
 * idempotent-state-write counter 最高 132 —— guard 拦住了 setState，
 * 但每帧 rAF 调度 + 锚点解析的触发源本身仍在空转。
 * 修复后：钉底且 active anchor 已是 latest 时，scroll/sync 触发直接跳过，
 * 不再进入 rAF / guard 计数。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

vi.mock("../../../services/rendererDiagnostics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/rendererDiagnostics")>();
  return {
    ...actual,
    appendRendererDiagnostic: vi.fn(),
  };
});

import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { Messages } from "./Messages";

const appendRendererDiagnosticMock = vi.mocked(appendRendererDiagnostic);

const flushFrame = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
};

const getMessagesScroller = (container: HTMLElement) => {
  const scroller = container.querySelector(".messages");
  expect(scroller).toBeTruthy();
  return scroller as HTMLDivElement;
};

const overlayLoopGuardCalls = () =>
  appendRendererDiagnosticMock.mock.calls.filter(
    ([label]) => label === "messages/overlay-loop-guard",
  );

const baseItems: ConversationItem[] = [
  { id: "anchor-u1", kind: "message", role: "user", text: "first question" },
  { id: "anchor-a1", kind: "message", role: "assistant", text: "first answer" },
  { id: "anchor-u2", kind: "message", role: "user", text: "second question" },
];

const renderPinnedMessages = (items: ConversationItem[] = baseItems) =>
  render(
    <Messages
      items={items}
      threadId="thread-anchor-loop"
      workspaceId="ws-1"
      isThinking={false}
      openTargets={[]}
      selectedOpenAppId=""
    />,
  );

describe("Messages anchor loop guard (W1)", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    appendRendererDiagnosticMock.mockClear();
  });

  it("does not trip the loop guard under a pinned scroll storm", async () => {
    const { container } = renderPinnedMessages();
    // jsdom 布局全为 0 → isCanvasNearBottom 恒 true，即钉底场景。
    // 先推进初始 sync 提交：active anchor 落为 latest。
    await flushFrame();
    appendRendererDiagnosticMock.mockClear();

    const scroller = getMessagesScroller(container);
    // 钉底跟随期间，流式追底每帧都会派发 scroll 事件（生产现场 counter 冲到 132）。
    for (let index = 0; index < 12; index += 1) {
      fireEvent.scroll(scroller);
      await flushFrame();
    }

    expect(overlayLoopGuardCalls()).toHaveLength(0);
    // 高亮不能被「跳过」弄丢：latest 锚点仍然是 active。
    const latestDash = document.querySelector('[data-anchor-id="anchor-u2"]');
    expect(latestDash?.classList.contains("is-active")).toBe(true);
  });

  it("still promotes the active anchor when a new message lands while pinned", async () => {
    const { rerender } = renderPinnedMessages();
    await flushFrame();

    const nextItems: ConversationItem[] = [
      ...baseItems,
      { id: "anchor-a2", kind: "message", role: "assistant", text: "second answer" },
      { id: "anchor-u3", kind: "message", role: "user", text: "third question" },
    ];
    rerender(
      <Messages
        items={nextItems}
        threadId="thread-anchor-loop"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    await flushFrame();

    const rail = screen.getByRole("navigation", { name: "messages.anchorNavigation" });
    expect(rail.querySelectorAll(".messages-anchor-dash").length).toBe(3);
    const latestDash = document.querySelector('[data-anchor-id="anchor-u3"]');
    expect(latestDash?.classList.contains("is-active")).toBe(true);
  });

  it("keeps the rAF compute path when the user scrolled away from the bottom", async () => {
    const { container } = renderPinnedMessages();
    await flushFrame();

    const scroller = getMessagesScroller(container);
    // 模拟上翻：scrollHeight 2400 / clientHeight 720 / scrollTop 0 → 远离底部。
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2400 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 720 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0 });

    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    rafSpy.mockClear();
    try {
      fireEvent.scroll(scroller);
      // 上翻后 active anchor 需要按视口 DOM 重算，必须仍走 rAF 调度。
      expect(rafSpy).toHaveBeenCalled();
      await flushFrame();
    } finally {
      rafSpy.mockRestore();
    }
  });
});
