import { describe, expect, it } from "vitest";
import { parseQoderHistoryMessages } from "./qoderHistoryParser";

describe("parseQoderHistoryMessages", () => {
  it("returns empty items for non-array payloads", () => {
    expect(parseQoderHistoryMessages(null)).toEqual([]);
    expect(parseQoderHistoryMessages({ messages: [] })).toEqual([]);
    expect(parseQoderHistoryMessages(undefined)).toEqual([]);
  });

  it("maps user and assistant messages to conversation items", () => {
    const items = parseQoderHistoryMessages([
      { id: "qoder-user-1", kind: "message", role: "user", text: "hello" },
      { id: "qoder-agent-1", kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({ id: "qoder-user-1", kind: "message", role: "user", text: "hello" }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({ id: "qoder-agent-1", kind: "message", role: "assistant", text: "hi" }),
    );
  });

  it("maps tool entries to command execution items", () => {
    const items = parseQoderHistoryMessages([
      {
        id: "qoder-tool-1",
        kind: "tool",
        toolType: "bash",
        toolInput: { command: "ls" },
        toolOutput: "ok",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({ id: "qoder-tool-1", kind: "tool", output: "ok" }),
    );
  });

  it("never pushes null items for entries that fail conversion", () => {
    const items = parseQoderHistoryMessages([
      { id: "qoder-thinking-1", kind: "thinking", text: "" },
      { id: "qoder-agent-1", kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items.every((item) => item !== null && typeof item.id === "string")).toBe(
      true,
    );
  });

  it("generates fallback ids for entries without id", () => {
    const items = parseQoderHistoryMessages([
      { kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items).toHaveLength(1);
    expect(typeof items[0]?.id).toBe("string");
  });
});
