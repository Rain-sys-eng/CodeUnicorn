// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("../../messages", async () => {
  const React = await import("react");
  return {
    Messages: () => {
      React.useEffect(() => {
        lifecycle.mounts += 1;
        return () => {
          lifecycle.unmounts += 1;
        };
      }, []);
      return <div data-testid="messages" />;
    },
    MessageForkConfirmDialog: () => null,
  };
});

import { buildConversationCanvasNode } from "./conversationCanvasNode";

afterEach(() => {
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
});

describe("conversationCanvasNode", () => {
  it("does not remount Canvas when its parent recomputes after a target switch", () => {
    const input = {
      messagesProps: {} as never,
      forkConfirmDialogProps: {} as never,
    };
    const view = render(buildConversationCanvasNode(input));

    // selectedNextTarget 属于 Canvas 外层状态；切换时 layout 会重算 node，
    // 但 ActiveCanvasMessages 的 type/key 必须保持稳定。
    view.rerender(buildConversationCanvasNode({ ...input }));

    expect(lifecycle.mounts).toBe(1);
    expect(lifecycle.unmounts).toBe(0);
  });

  it("keeps activeTokenUsage off the Messages root selector", () => {
    const sourcePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "conversationCanvasNode.tsx",
    );
    const source = readFileSync(sourcePath, "utf8");
    const selectorStart = source.indexOf("const selectActiveCanvasMessagesProps");
    const selectorEnd = source.indexOf("function ActiveCanvasMessages");
    expect(selectorStart).toBeGreaterThan(-1);
    expect(selectorEnd).toBeGreaterThan(selectorStart);
    const selector = source.slice(selectorStart, selectorEnd);
    expect(selector).not.toContain("activeTokenUsage");
    expect(selector).not.toContain("heartbeatPulse");
  });
});
