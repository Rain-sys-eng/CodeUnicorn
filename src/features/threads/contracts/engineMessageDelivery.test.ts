import { describe, expect, it } from "vitest";
import {
  createEngineMessageDeliveryDiagnostic,
  decideEngineMessageDelivery,
} from "./engineMessageDelivery";

describe("engine message delivery contract", () => {
  it("dispatches a prompt only without an active run", () => {
    expect(
      decideEngineMessageDelivery({
        intent: "prompt",
        engine: "codex",
        sessionId: "session-1",
        activeRunId: null,
      }),
    ).toMatchObject({ status: "accepted", route: "dispatch" });
  });

  it("routes Pi steering to same-run steer (RPC resident, input.mid-turn=supported)", () => {
    expect(
      decideEngineMessageDelivery({
        intent: "steer",
        engine: "pi",
        sessionId: "session-1",
        activeRunId: "run-1",
      }),
    ).toMatchObject({ status: "accepted", route: "steer" });
  });

  it("rejects Kimi steering instead of reporting a fake send", () => {
    expect(
      decideEngineMessageDelivery({
        intent: "steer",
        engine: "kimi",
        sessionId: "session-1",
        activeRunId: "run-1",
      }),
    ).toMatchObject({
      status: "rejected",
      reason: "input.mid-turn:unsupported",
    });
  });

  it("degrades compatibility input to a queued follow-up", () => {
    expect(
      decideEngineMessageDelivery({
        intent: "steer",
        engine: "claude",
        sessionId: "session-1",
        activeRunId: "run-1",
        allowFollowUpFallback: true,
      }),
    ).toMatchObject({
      status: "degraded",
      route: "queue",
      fallbackIntent: "followUp",
      reason: "input.mid-turn:compat-input",
    });
  });

  it("rejects compatibility input when no follow-up fallback is allowed", () => {
    expect(
      decideEngineMessageDelivery({
        intent: "steer",
        engine: "codex",
        sessionId: "session-1",
        activeRunId: "run-1",
      }),
    ).toMatchObject({
      status: "rejected",
      reason: "input.mid-turn:compat-input",
    });
  });

  it("queues an explicit follow-up fallback for unsupported steering", () => {
    expect(
      decideEngineMessageDelivery({
        intent: "steer",
        engine: "kimi",
        sessionId: "session-1",
        activeRunId: "run-1",
        allowFollowUpFallback: true,
      }),
    ).toMatchObject({
      status: "degraded",
      route: "queue",
      fallbackIntent: "followUp",
    });
  });

  it("diagnostics contain decision evidence but no message content", () => {
    const request = {
      intent: "steer" as const,
      engine: "kimi" as const,
      sessionId: "session-1",
      activeRunId: "run-1",
    };
    const diagnostic = createEngineMessageDeliveryDiagnostic(
      request,
      decideEngineMessageDelivery(request),
    );
    expect(diagnostic).toMatchObject({
      intent: "steer",
      engine: "kimi",
      result: "rejected",
      evidence: { activeRun: true, midTurnCapability: "unsupported" },
    });
    expect(diagnostic).not.toHaveProperty("text");
    expect(diagnostic).not.toHaveProperty("images");
  });
});
