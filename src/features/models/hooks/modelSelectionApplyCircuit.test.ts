import { describe, expect, it } from "vitest";
import { buildSelectionApplyEpochKey } from "./modelSelectionApplyCircuit";

describe("buildSelectionApplyEpochKey", () => {
  it("stays stable when only the catalog fingerprint would have changed", () => {
    const input = {
      preferredModelId: "gpt-5.6-terra",
      preferredEffort: "medium",
      preferredSelectionReady: true,
      nextModelId: "gpt-5.6-terra",
      nextEffort: "medium",
    };
    expect(buildSelectionApplyEpochKey(input)).toBe(
      buildSelectionApplyEpochKey(input),
    );
    expect(buildSelectionApplyEpochKey(input)).not.toContain("MiniMax-M3");
    expect(buildSelectionApplyEpochKey(input)).not.toContain("mimo-v2.5-pro");
  });

  it("changes when the preferred or next selection actually changes", () => {
    const base = {
      preferredModelId: "gpt-5.6-terra",
      preferredEffort: "medium",
      preferredSelectionReady: true,
      nextModelId: "gpt-5.6-terra",
      nextEffort: "medium",
    };
    expect(
      buildSelectionApplyEpochKey({ ...base, nextEffort: "high" }),
    ).not.toBe(buildSelectionApplyEpochKey(base));
    expect(
      buildSelectionApplyEpochKey({ ...base, preferredModelId: "k3" }),
    ).not.toBe(buildSelectionApplyEpochKey(base));
  });
});
