import { describe, expect, it } from "vitest";

import { isMultiAgentTargetSupported } from "./ComposerToggle";

describe("isMultiAgentTargetSupported", () => {
  it.each(["claude", "codex", "kimi", "grok", "opencode", "pi", "qoder"] as const)(
    "accepts Shared-supported engine %s as collab host/stage",
    (engine) => {
      expect(isMultiAgentTargetSupported(engine)).toBe(true);
    },
  );

  it("rejects gemini and empty host engines", () => {
    expect(isMultiAgentTargetSupported("gemini")).toBe(false);
    expect(isMultiAgentTargetSupported(null)).toBe(false);
    expect(isMultiAgentTargetSupported(undefined)).toBe(false);
  });
});
