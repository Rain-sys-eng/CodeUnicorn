import { describe, expect, it } from "vitest";
import {
  EMPTY_COMPOSER_ENGINE_PREF,
  getComposerEnginePref,
  normalizeComposerEnginePrefsRecord,
  resolveRestoredAccessMode,
  upsertComposerEnginePref,
} from "./composerEnginePrefs";

describe("composerEnginePrefs", () => {
  it("returns a fully populated empty pref for unknown engines", () => {
    expect(getComposerEnginePref(undefined, "claude")).toEqual(
      EMPTY_COMPOSER_ENGINE_PREF,
    );
    expect(getComposerEnginePref({}, "gemini")).toEqual(
      EMPTY_COMPOSER_ENGINE_PREF,
    );
  });

  it("merges a partial patch without touching other fields", () => {
    const start = { claude: { modelId: "fable-5", effort: "high", accessMode: null, collaborationModeId: null,
      dshAgentPreset: null } };
    const next = upsertComposerEnginePref(start, "claude", {
      accessMode: "read-only",
    });
    expect(next.claude).toEqual({
      modelId: "fable-5",
      effort: "high",
      accessMode: "read-only",
      collaborationModeId: null,
      dshAgentPreset: null,
    });
  });

  it("keeps other engines intact when patching one engine", () => {
    const start = {
      claude: { modelId: "fable-5", effort: null, accessMode: null, collaborationModeId: null,
      dshAgentPreset: null },
    };
    const next = upsertComposerEnginePref(start, "gemini", {
      modelId: "gemini-pro",
    });
    expect(next.claude?.modelId).toBe("fable-5");
    expect(next.gemini?.modelId).toBe("gemini-pro");
  });

  it("returns the same reference when the patch changes nothing", () => {
    const start = {
      claude: { modelId: "fable-5", effort: null, accessMode: null, collaborationModeId: null,
      dshAgentPreset: null },
    };
    expect(upsertComposerEnginePref(start, "claude", { modelId: "fable-5" })).toBe(
      start,
    );
  });

  it("stores a DSH agent preset without wiping other fields", () => {
    const start = {
      dsh: {
        modelId: "ggggg/grok-4.6",
        effort: "high",
        accessMode: null,
        collaborationModeId: null,
        dshAgentPreset: null,
      },
    };
    const next = upsertComposerEnginePref(start, "dsh", {
      dshAgentPreset: "minimal",
    });
    expect(next.dsh).toEqual({
      modelId: "ggggg/grok-4.6",
      effort: "high",
      accessMode: null,
      collaborationModeId: null,
      dshAgentPreset: "minimal",
    });
  });

  it("does not wipe a stored model when only effort is patched", () => {
    const start = {
      claude: { modelId: "fable-5", effort: "high", accessMode: null, collaborationModeId: null,
      dshAgentPreset: null },
    };
    const next = upsertComposerEnginePref(start, "claude", { effort: "low" });
    expect(next.claude).toEqual({
      modelId: "fable-5",
      effort: "low",
      accessMode: null,
      collaborationModeId: null,
      dshAgentPreset: null,
    });
  });

  it("drops unknown engines and malformed fields when normalizing", () => {
    const normalized = normalizeComposerEnginePrefsRecord({
      claude: { modelId: "fable-5", effort: 42, accessMode: "bogus", collaborationModeId: "plan" },
      martian: { modelId: "x" },
    });
    expect(normalized.claude).toEqual({
      modelId: "fable-5",
      effort: null,
      accessMode: null,
      collaborationModeId: "plan",
      dshAgentPreset: null,
    });
    expect("martian" in normalized).toBe(false);
  });

  it("seeds the codex entry from legacy composer fields when absent", () => {
    const normalized = normalizeComposerEnginePrefsRecord(
      { claude: { modelId: "fable-5" } },
      { modelId: "gpt-5.5", effort: "high" },
    );
    expect(normalized.codex).toEqual({
      modelId: "gpt-5.5",
      effort: "high",
      accessMode: null,
      collaborationModeId: null,
      dshAgentPreset: null,
    });
    expect(normalized.claude?.modelId).toBe("fable-5");
  });

  it("does not override an existing codex entry with legacy fields", () => {
    const normalized = normalizeComposerEnginePrefsRecord(
      { codex: { modelId: "gpt-5.4" } },
      { modelId: "gpt-5.5", effort: "high" },
    );
    expect(normalized.codex?.modelId).toBe("gpt-5.4");
  });
});

describe("resolveRestoredAccessMode", () => {
  it("prefers the stored mode over the configured default", () => {
    expect(resolveRestoredAccessMode("claude", "full-access", "current")).toBe(
      "full-access",
    );
  });

  it("falls back to the configured default, then full-access", () => {
    expect(resolveRestoredAccessMode("gemini", null, "read-only")).toBe(
      "read-only",
    );
    expect(resolveRestoredAccessMode("gemini", null, undefined)).toBe(
      "full-access",
    );
  });

  it("degrades claude's disabled acceptEdits mode to default", () => {
    expect(resolveRestoredAccessMode("claude", "current", undefined)).toBe(
      "default",
    );
    expect(resolveRestoredAccessMode("claude", null, "current")).toBe(
      "default",
    );
  });

  it("keeps acceptEdits for engines that allow it", () => {
    expect(resolveRestoredAccessMode("gemini", "current", undefined)).toBe(
      "current",
    );
  });

  it("starts blank DSH sessions on default instead of global full-access", () => {
    expect(resolveRestoredAccessMode("dsh", null, "full-access")).toBe(
      "default",
    );
    expect(resolveRestoredAccessMode("dsh", null, undefined)).toBe("default");
    expect(resolveRestoredAccessMode("dsh", "current", "full-access")).toBe(
      "default",
    );
  });

  it("keeps an explicit DSH auto-mode pin", () => {
    expect(resolveRestoredAccessMode("dsh", "full-access", "default")).toBe(
      "full-access",
    );
    expect(resolveRestoredAccessMode("dsh", "default", "full-access")).toBe(
      "default",
    );
  });
});
