// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api/piSessionRpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/piSessionRpc")>();
  return {
    ...actual,
    piGetSessionTree: vi.fn(),
  };
});

import { piGetSessionTree } from "../api/piSessionRpc";
import { PiConversationTreeSplit } from "./PiConversationTreeSplit";
import { setActiveCanvasSnapshot } from "../../layout/hooks/activeCanvasStore";
import {
  closePiTreeOverlay,
  openPiTreeOverlay,
} from "../store/piSessionStore";

const mockedGetTree = vi.mocked(piGetSessionTree);

beforeEach(() => {
  vi.clearAllMocks();
  setActiveCanvasSnapshot({
    workspaceId: "ws-1",
    threadId: "pi:s-panel-err",
  } as never);
  closePiTreeOverlay();
});

describe("PiSessionTreePanel 加载失败错误态", () => {
  it("加载失败显示错误详情与重试入口，点击重试重新发起加载", async () => {
    mockedGetTree.mockRejectedValue(
      new Error("pi rpc disabled after previous failure"),
    );
    openPiTreeOverlay("ws-1", "pi:s-panel-err");
    const { container } = render(
      <PiConversationTreeSplit>
        <div>main</div>
      </PiConversationTreeSplit>,
    );

    // 失败后面板必须呈现错误态（role=alert + 后端错误详情），
    // 而不是永远停在「加载中…」。
    const alert = await screen.findByRole("alert", undefined, {
      timeout: 3000,
    });
    expect(alert.textContent).toContain(
      "pi rpc disabled after previous failure",
    );

    const retryButton = container.querySelector<HTMLButtonElement>(
      ".pi-fs-load-error-retry",
    );
    expect(retryButton).not.toBeNull();

    const callsBeforeRetry = mockedGetTree.mock.calls.length;
    fireEvent.click(retryButton!);
    expect(mockedGetTree.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });
});
