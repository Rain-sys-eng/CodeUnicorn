import { describe, expect, it } from "vitest";
import {
  assertSharedSessionWriteEngine,
  isSharedSessionSupportedEngine,
  normalizeSharedSessionEngine,
} from "./sharedSessionEngines";

describe("sharedSessionEngines", () => {
  it.each(["claude", "codex", "kimi", "grok", "opencode", "pi", "qoder"] as const)(
    "accepts %s as a Shared Session target",
    (engine) => {
      expect(isSharedSessionSupportedEngine(engine)).toBe(true);
      expect(normalizeSharedSessionEngine(engine)).toBe(engine);
    },
  );

  it("keeps unsupported engines on claude fallback", () => {
    expect(isSharedSessionSupportedEngine("gemini")).toBe(false);
    expect(isSharedSessionSupportedEngine("dsh")).toBe(false);
    expect(normalizeSharedSessionEngine("gemini")).toBe("claude");
    expect(normalizeSharedSessionEngine("dsh")).toBe("claude");
  });

  it("rejects Native-only engines on Shared write", () => {
    expect(() => assertSharedSessionWriteEngine("dsh")).toThrow(
      /Unsupported shared session engine: dsh/,
    );
    expect(() => assertSharedSessionWriteEngine("gemini")).toThrow(
      /Unsupported shared session engine: gemini/,
    );
    expect(assertSharedSessionWriteEngine("codex")).toBe("codex");
  });
});
