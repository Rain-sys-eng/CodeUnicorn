import { describe, expect, it } from "vitest";
import type { EngineFeatures, EngineType } from "../../types";
import {
  ENGINE_CAPABILITY_KEYS,
  getEngineCapabilityState,
  projectEngineFeaturesToCapabilityStates,
  resolveEngineCapabilityRuntimeStatus,
} from "./engineCapabilityMatrix";

const allFeatures: EngineFeatures = {
  streaming: true,
  reasoning: true,
  toolUse: true,
  imageInput: true,
  sessionContinuation: true,
};

describe("engineCapabilityMatrix", () => {
  it("defines a stable first capability set", () => {
    expect(ENGINE_CAPABILITY_KEYS).toEqual([
      "streaming.text",
      "streaming.reasoning",
      "streaming.tool-output",
      "tool.use",
      "tool.mcp",
      "reasoning.effort",
      "collaboration.mode",
      "session.continuation",
      "image.input",
      "input.mid-turn",
      "session.resume",
      "session.fork",
      "session.switch",
      "session.tree",
      "rpc.server",
    ]);
  });

  it("resolves spec-owned capability states by engine", () => {
    expect(getEngineCapabilityState("codex", "reasoning.effort")).toBe("supported");
    expect(getEngineCapabilityState("claude", "reasoning.effort")).toBe("supported");
    expect(getEngineCapabilityState("grok", "reasoning.effort")).toBe("supported");
    expect(getEngineCapabilityState("pi", "reasoning.effort")).toBe("supported");
    expect(getEngineCapabilityState("pi", "image.input")).toBe("supported");
    expect(getEngineCapabilityState("pi", "streaming.tool-output")).toBe(
      "unsupported",
    );
    expect(getEngineCapabilityState("opencode", "tool.mcp")).toBe("unsupported");
  });

  it("projects legacy EngineFeatures through the compatibility aliases", () => {
    expect(projectEngineFeaturesToCapabilityStates(allFeatures)).toMatchObject({
      "streaming.text": "supported",
      "streaming.reasoning": "supported",
      "streaming.tool-output": "supported",
      "tool.use": "supported",
      "tool.mcp": "unknown",
      "reasoning.effort": "supported",
      "collaboration.mode": "unknown",
      "session.continuation": "supported",
      "image.input": "supported",
      "input.mid-turn": "unknown",
      "session.resume": "supported",
      "session.fork": "unknown",
      "session.switch": "unknown",
      "session.tree": "unknown",
      "rpc.server": "unknown",
    });
  });

  it("uses legacy runtime evidence while old cached DTOs remain supported", () => {
    const status = resolveEngineCapabilityRuntimeStatus(
      {
        engineType: "codex" satisfies EngineType,
        features: allFeatures,
      },
      "reasoning.effort",
    );

    expect(status).toEqual({
      engine: "codex",
      capability: "reasoning.effort",
      specState: "supported",
      runtimeState: "supported",
      available: true,
      reason: null,
    });
  });

  it("projects the exact Rust DTO field names when they are present", () => {
    expect(
      projectEngineFeaturesToCapabilityStates({
        streaming: true,
        imageInput: false,
        reasoningEffort: false,
        collaborationMode: true,
        sessionResume: true,
        toolsControl: true,
        mcp: false,
      }),
    ).toMatchObject({
      "reasoning.effort": "unsupported",
      "collaboration.mode": "supported",
      "session.resume": "supported",
      "tool.use": "supported",
      "tool.mcp": "unsupported",
    });
  });

  it("keeps unprobed runtime capabilities unknown with an explicit reason", () => {
    expect(
      resolveEngineCapabilityRuntimeStatus(
        {
          engineType: "codex",
          features: { streaming: true, imageInput: true },
        },
        "rpc.server",
      ),
    ).toMatchObject({
      specState: "supported",
      runtimeState: "unknown",
      available: true,
      reason: "runtime:evidence-missing",
    });
  });
});
