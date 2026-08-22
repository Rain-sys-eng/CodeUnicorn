import { describe, expect, it } from "vitest";
import {
  buildAvailableEngines,
  ENABLED_ENGINE_TYPES,
} from "./engineControllerAvailability";

describe("engineControllerAvailability", () => {
  it("projects labels from the canonical registry and excludes retired engines", () => {
    expect(ENABLED_ENGINE_TYPES).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
      "pi",
      "dsh",
      "qoder",
    ]);
    expect(buildAvailableEngines([], false)).toEqual([
      expect.objectContaining({
        type: "claude",
        displayName: "Claude Code",
        shortName: "Claude Code",
        availabilityState: "loading",
      }),
      expect.objectContaining({
        type: "codex",
        displayName: "Codex CLI",
        shortName: "Codex",
      }),
      expect.objectContaining({
        type: "grok",
        displayName: "Grok CLI",
        shortName: "Grok",
      }),
      expect.objectContaining({
        type: "kimi",
        displayName: "Kimi CLI",
        shortName: "Kimi",
      }),
      expect.objectContaining({
        type: "opencode",
        displayName: "OpenCode",
        shortName: "OpenCode",
      }),
      expect.objectContaining({
        type: "pi",
        displayName: "PI CLI",
        shortName: "PI",
      }),
      expect.objectContaining({
        type: "dsh",
        displayName: "DeepSeek Harness",
        shortName: "DSH",
      }),
      expect.objectContaining({
        type: "qoder",
        displayName: "Qoder CLI",
        shortName: "Qoder",
      }),
    ]);
  });
});
