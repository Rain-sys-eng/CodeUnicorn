// @vitest-environment jsdom
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PiConversationTreeSplit } from "./PiConversationTreeSplit";
import { setActiveCanvasSnapshot } from "../../layout/hooks/activeCanvasStore";
import {
  closePiTreeOverlay,
  openPiTreeOverlay,
} from "../store/piSessionStore";

// jsdom 未实现 pointer capture：拖放路径依赖它，这里 stub。
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.setPointerCapture !== "function") {
    proto.setPointerCapture = () => {};
    proto.releasePointerCapture = () => {};
    proto.hasPointerCapture = () => true;
  }
});

beforeEach(() => {
  setActiveCanvasSnapshot({
    workspaceId: "ws-1",
    threadId: "pi:s-1",
  } as never);
  closePiTreeOverlay();
});

describe("PiConversationTreeSplit dock 拖拽", () => {
  it("pointer capture 拖拽改变 dock 宽度（向左变宽、向右变窄）", () => {
    openPiTreeOverlay("ws-1", "pi:s-1");
    const { container } = render(
      <PiConversationTreeSplit>
        <div>main</div>
      </PiConversationTreeSplit>,
    );
    const divider = container.querySelector<HTMLDivElement>(
      ".pi-tree-dock-divider",
    );
    const dock = container.querySelector<HTMLDivElement>(".pi-tree-dock");
    expect(divider).not.toBeNull();
    expect(dock).not.toBeNull();

    const initialWidth = parseInt(dock!.style.width, 10);
    expect(initialWidth).toBeGreaterThan(0);

    fireEvent.pointerDown(divider!, {
      button: 0,
      clientX: 500,
      pointerId: 1,
    });
    fireEvent.pointerMove(divider!, { clientX: 400, pointerId: 1 });
    const widerWidth = parseInt(dock!.style.width, 10);
    expect(widerWidth).toBe(initialWidth + 100);

    fireEvent.pointerMove(divider!, { clientX: 560, pointerId: 1 });
    const narrowerWidth = parseInt(dock!.style.width, 10);
    expect(narrowerWidth).toBe(initialWidth - 60);

    fireEvent.pointerUp(divider!, { pointerId: 1 });
  });

  it("双击复位默认宽度", () => {
    openPiTreeOverlay("ws-1", "pi:s-1");
    const { container } = render(
      <PiConversationTreeSplit>
        <div>main</div>
      </PiConversationTreeSplit>,
    );
    const divider = container.querySelector<HTMLDivElement>(
      ".pi-tree-dock-divider",
    );
    const dock = container.querySelector<HTMLDivElement>(".pi-tree-dock");
    fireEvent.pointerDown(divider!, { button: 0, clientX: 500, pointerId: 2 });
    fireEvent.pointerMove(divider!, { clientX: 300, pointerId: 2 });
    fireEvent.pointerUp(divider!, { pointerId: 2 });
    fireEvent.doubleClick(divider!);
    expect(parseInt(dock!.style.width, 10)).toBe(380);
  });
});
