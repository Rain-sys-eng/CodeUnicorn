import { describe, expect, it } from "vitest";

import type { AgentBridgeRuntimeEvent } from "../../../services/events";
import { reduceDelegationLiveActivity } from "./liveActivity";

function event(
  kind: string,
  payload: unknown,
  timestampMs = 10,
): AgentBridgeRuntimeEvent {
  return {
    schemaVersion: "1.0",
    eventId: `event-${timestampMs}`,
    sequence: timestampMs,
    timestampMs,
    engine: "codex",
    workspaceId: "workspace-1",
    logicalSessionId: "shared:backing",
    runId: "delegate-1",
    kind,
    lane: "normal",
    payload,
  };
}

describe("Agent Bridge live activity reducer", () => {
  it("keeps only bounded token totals and latest tool state", () => {
    const usage = reduceDelegationLiveActivity(
      null,
      event("usage.updated", {
        type: "usage:update",
        inputTokens: 120,
        outputTokens: 30,
      }),
    );
    const started = reduceDelegationLiveActivity(
      usage,
      event("tool.started", { type: "tool:started", toolName: "Bash" }, 20),
    );
    const completed = reduceDelegationLiveActivity(
      started,
      event("tool.completed", { type: "tool:completed", toolName: null }, 30),
    );

    expect(completed).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      toolName: "Bash",
      toolStatus: "completed",
      observedAtMs: 30,
    });
  });

  it("preserves the last known side when a usage snapshot is partial", () => {
    const first = reduceDelegationLiveActivity(
      null,
      event("usage.updated", { inputTokens: 100, outputTokens: 10 }),
    );
    const second = reduceDelegationLiveActivity(
      first,
      event("usage.updated", { outputTokens: 25 }, 20),
    );
    expect(second).toEqual(
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
      }),
    );
  });

  it("ignores delta and unrelated normal events", () => {
    expect(
      reduceDelegationLiveActivity(
        null,
        event("tool.output.delta", { text: "large output" }),
      ),
    ).toBeNull();
    expect(
      reduceDelegationLiveActivity(
        null,
        event("run.heartbeat", { pulse: 1 }),
      ),
    ).toBeNull();
  });
});
