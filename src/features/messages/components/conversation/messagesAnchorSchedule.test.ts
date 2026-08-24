import { describe, expect, it } from "vitest";
import { resolveAnchorSchedulePlan } from "./messagesAnchorSchedule";

describe("resolveAnchorSchedulePlan", () => {
  it("skips when pinned at bottom and the active anchor is already the latest", () => {
    expect(
      resolveAnchorSchedulePlan({
        isNearBottom: true,
        latestAnchorId: "u2",
        activeAnchorId: "u2",
      }),
    ).toEqual({ action: "skip" });
  });

  it("commits the latest anchor directly when pinned but active anchor is stale", () => {
    expect(
      resolveAnchorSchedulePlan({
        isNearBottom: true,
        latestAnchorId: "u3",
        activeAnchorId: "u2",
      }),
    ).toEqual({ action: "commit", nextActiveAnchor: "u3" });
  });

  it("skips when pinned and there are no anchors at all", () => {
    expect(
      resolveAnchorSchedulePlan({
        isNearBottom: true,
        latestAnchorId: null,
        activeAnchorId: null,
      }),
    ).toEqual({ action: "skip" });
  });

  it("commits null when anchors disappeared while pinned", () => {
    expect(
      resolveAnchorSchedulePlan({
        isNearBottom: true,
        latestAnchorId: null,
        activeAnchorId: "u2",
      }),
    ).toEqual({ action: "commit", nextActiveAnchor: null });
  });

  it("requires DOM computation when the user scrolled away from the bottom", () => {
    expect(
      resolveAnchorSchedulePlan({
        isNearBottom: false,
        latestAnchorId: "u2",
        activeAnchorId: "u2",
      }),
    ).toEqual({ action: "compute" });
  });
});
