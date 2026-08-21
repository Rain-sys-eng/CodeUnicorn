import { describe, expect, it } from "vitest";
import type { ThreadTokenUsage } from "../../../types";
import {
  resolveWorkingIndicatorLiveTokenCount,
  selectWorkingIndicatorLiveTokenSnapshot,
  sumWorkingIndicatorLiveTokens,
} from "./workingIndicatorLiveTokens";

function usage(partial: {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}): ThreadTokenUsage {
  return {
    total: {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    last: {
      totalTokens: 0,
      inputTokens: partial.inputTokens ?? 0,
      cachedInputTokens: partial.cachedInputTokens ?? 0,
      outputTokens: partial.outputTokens ?? 0,
      reasoningOutputTokens: 0,
    },
    modelContextWindow: null,
  };
}

describe("sumWorkingIndicatorLiveTokens", () => {
  it("sums last-turn input, cached input, and output", () => {
    expect(
      sumWorkingIndicatorLiveTokens(
        usage({ inputTokens: 4100, cachedInputTokens: 1000, outputTokens: 500 }),
      ),
    ).toBe(5600);
  });

  it("returns 0 when usage is missing or empty", () => {
    expect(sumWorkingIndicatorLiveTokens(null)).toBe(0);
    expect(sumWorkingIndicatorLiveTokens(usage({}))).toBe(0);
  });
});

describe("resolveWorkingIndicatorLiveTokenCount", () => {
  it("hides tokens when not thinking or count is empty", () => {
    expect(
      resolveWorkingIndicatorLiveTokenCount({
        isThinking: false,
        tokenCount: 5600,
      }),
    ).toBeNull();
    expect(
      resolveWorkingIndicatorLiveTokenCount({
        isThinking: true,
        tokenCount: 0,
      }),
    ).toBeNull();
  });

  it("hides a previous-turn snapshot older than processingStartedAt", () => {
    expect(
      resolveWorkingIndicatorLiveTokenCount({
        isThinking: true,
        tokenCount: 5600,
        usageUpdatedAt: 1_000,
        processingStartedAt: 2_000,
      }),
    ).toBeNull();
  });

  it("keeps a snapshot updated during the current turn", () => {
    expect(
      resolveWorkingIndicatorLiveTokenCount({
        isThinking: true,
        tokenCount: 5600,
        usageUpdatedAt: 2_500,
        processingStartedAt: 2_000,
      }),
    ).toBe(5600);
  });

  it("keeps a count when timestamps are missing", () => {
    expect(
      resolveWorkingIndicatorLiveTokenCount({
        isThinking: true,
        tokenCount: 120,
      }),
    ).toBe(120);
  });
});

describe("selectWorkingIndicatorLiveTokenSnapshot", () => {
  it("projects a stable primitive slice", () => {
    expect(
      selectWorkingIndicatorLiveTokenSnapshot(usage({ outputTokens: 12 }), 9),
    ).toEqual({ tokenCount: 12, usageUpdatedAt: 9 });
    expect(selectWorkingIndicatorLiveTokenSnapshot(null, null)).toEqual({
      tokenCount: null,
      usageUpdatedAt: null,
    });
  });
});
