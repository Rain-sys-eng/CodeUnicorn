import { describe, expect, it } from "vitest";

import {
  formatSharedProviderRetryDate,
  formatSharedProviderRetryElapsed,
  resolveSharedProviderRetryElapsed,
} from "./formatSharedProviderRetryElapsed";

describe("formatSharedProviderRetryElapsed", () => {
  it("formats a local calendar date with time", () => {
    expect(formatSharedProviderRetryDate(Date.UTC(2026, 2, 24, 16, 0, 0))).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("formats seconds, minutes, and hours", () => {
    expect(formatSharedProviderRetryElapsed(4_000)).toBe("4s");
    expect(formatSharedProviderRetryElapsed(75_000)).toBe("1m15s");
    expect(formatSharedProviderRetryElapsed(3_661_000)).toBe("1h01m");
  });

  it("splits series total from the current batch", () => {
    expect(
      resolveSharedProviderRetryElapsed({
        seriesStartedAtMs: 1_000,
        batchStartedAtMs: 8_000,
        now: 13_000,
      }),
    ).toEqual({ total: "12s", batch: "5s" });
  });
});
