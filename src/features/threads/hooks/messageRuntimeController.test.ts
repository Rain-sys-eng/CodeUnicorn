import { describe, expect, it, vi } from "vitest";
import {
  buildLocalizedMemoryScoutPreviewText,
  extractClaudeCandidateSessionId,
  normalizeEngineScopedEffort,
  withMemoryScoutTimeout,
} from "./messageRuntimeController";

describe("messageRuntimeController", () => {
  it("normalizes effort by engine scope", () => {
    expect(normalizeEngineScopedEffort("claude", "high")).toBe("high");
    expect(normalizeEngineScopedEffort("claude", "ultra")).toBeNull();
    expect(normalizeEngineScopedEffort("grok", "high")).toBe("high");
    expect(normalizeEngineScopedEffort("grok", "xhigh")).toBeNull();
    expect(normalizeEngineScopedEffort("codex", "max")).toBe("max");
    expect(normalizeEngineScopedEffort("dsh", "off")).toBe("off");
    expect(normalizeEngineScopedEffort("dsh", "high")).toBe("high");
    expect(normalizeEngineScopedEffort("dsh", "medium")).toBeNull();
    expect(normalizeEngineScopedEffort("gemini", "high")).toBeNull();
    expect(normalizeEngineScopedEffort("pi", "low")).toBe("low");
    expect(normalizeEngineScopedEffort("pi", "high")).toBe("high");
    expect(normalizeEngineScopedEffort("pi", "minimal")).toBe("minimal");
    expect(normalizeEngineScopedEffort("pi", "ultra")).toBeNull();
  });

  it("ignores pending Claude session candidates", () => {
    expect(extractClaudeCandidateSessionId({ session_id: "pending" })).toBeNull();
    expect(extractClaudeCandidateSessionId({ session_id: "abc" })).toBe("abc");
  });

  it("builds localized memory scout copy from result state", () => {
    const t = vi.fn((key: string, params?: Record<string, unknown>) => {
      if (key === "threads.memoryReferenceTitlesSuffix") {
        return `: ${params?.titles}`;
      }
      if (key === "threads.memoryReferenceReferenced") {
        return `referenced ${params?.count}${params?.titlesSuffix}`;
      }
      return key;
    }) as any;

    expect(
      buildLocalizedMemoryScoutPreviewText(
        {
          status: "ok",
          query: "release",
          memories: [],
          items: [{ id: "m1", title: "Release", summary: "", detail: "" } as any],
          conflicts: [],
          truncated: false,
          elapsedMs: 1,
          retrievalMode: "lexical",
        },
        t,
      ),
    ).toBe("referenced 1: Release");
    expect(
      buildLocalizedMemoryScoutPreviewText(
        {
          status: "empty",
          query: "release",
          memories: [],
          items: [],
          conflicts: [],
          truncated: false,
          elapsedMs: 1,
          retrievalMode: "lexical",
        },
        t,
      ),
    ).toBe("threads.memoryReferenceNoRelated");
  });

  it("settles memory scout timeout as a bounded runtime result", async () => {
    await expect(withMemoryScoutTimeout(new Promise(() => undefined), 1)).resolves.toMatchObject({
      status: "timeout",
    });
  });
});
