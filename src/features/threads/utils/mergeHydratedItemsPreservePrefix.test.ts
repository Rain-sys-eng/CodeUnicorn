import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { mergeHydratedItemsPreservePrefix } from "./mergeHydratedItemsPreservePrefix";

function message(id: string, text: string): ConversationItem {
  return { id, kind: "message", role: "assistant", text };
}

describe("mergeHydratedItemsPreservePrefix", () => {
  it("keeps items older than the hydrated window and lets hydrated own the tail", () => {
    const current = [
      message("old-1", "older page row 1"),
      message("old-2", "older page row 2"),
      message("w-1", "window row 1 (stale)"),
      message("live-tail", "live committed tail"),
    ];
    const hydrated = [
      message("w-1", "window row 1 (fresh)"),
      message("w-2", "window row 2"),
      message("w-3", "latest turn from disk"),
    ];
    const merged = mergeHydratedItemsPreservePrefix(current, hydrated);
    expect(merged.map((item) => item.id)).toEqual([
      "old-1",
      "old-2",
      "w-1",
      "w-2",
      "w-3",
    ]);
    expect(merged[2]).toMatchObject({ text: "window row 1 (fresh)" });
  });

  it("replaces the whole list when no anchor can be aligned (trust disk)", () => {
    const current = [message("a", "unrelated a"), message("b", "unrelated b")];
    const hydrated = [message("x", "disk x"), message("y", "disk y")];
    expect(mergeHydratedItemsPreservePrefix(current, hydrated)).toEqual(
      hydrated,
    );
  });

  it("returns hydrated when current is empty", () => {
    const hydrated = [message("x", "disk x")];
    expect(mergeHydratedItemsPreservePrefix([], hydrated)).toEqual(hydrated);
  });

  it("keeps current when hydrated is empty (do not blank the surface)", () => {
    const current = [message("a", "still visible")];
    expect(mergeHydratedItemsPreservePrefix(current, [])).toEqual(current);
  });
});
