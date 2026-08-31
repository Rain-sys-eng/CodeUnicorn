/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  consumeAgentBridgeThreadOpen,
  requestAgentBridgeThreadOpen,
  useAgentBridgeThreadOpenRequest,
} from "./navigationStore";

describe("Agent Bridge navigation store", () => {
  it("publishes an exact workspace/backing-thread request and consumes it once", () => {
    const rendered = renderHook(() => useAgentBridgeThreadOpenRequest());

    act(() => {
      requestAgentBridgeThreadOpen("workspace-runtime", "shared:backing");
    });
    expect(rendered.result.current).toEqual({
      workspaceId: "workspace-runtime",
      threadId: "shared:backing",
    });

    act(() => consumeAgentBridgeThreadOpen());
    expect(rendered.result.current).toBeNull();
  });
});
