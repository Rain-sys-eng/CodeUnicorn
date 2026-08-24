import { describe, expect, it } from "vitest";
import { parsePiHistoryMessages } from "./piHistoryParser";

describe("parsePiHistoryMessages", () => {
  it("returns empty items for non-array payloads", () => {
    expect(parsePiHistoryMessages(null)).toEqual([]);
    expect(parsePiHistoryMessages({ messages: [] })).toEqual([]);
    expect(parsePiHistoryMessages(undefined)).toEqual([]);
  });

  it("keeps user image paths on history rows", () => {
    const items = parsePiHistoryMessages([
      {
        id: "pi-user-shot",
        kind: "message",
        role: "user",
        text: "这是啥",
        images: ["data:image/png;base64,AAAA"],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "pi-user-shot",
        kind: "message",
        role: "user",
        text: "这是啥",
        images: ["data:image/png;base64,AAAA"],
      }),
    );
  });

  it("maps user and assistant messages to conversation items", () => {
    const items = parsePiHistoryMessages([
      { id: "pi-user-1", kind: "message", role: "user", text: "hello" },
      { id: "pi-agent-1", kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({ id: "pi-user-1", kind: "message", role: "user", text: "hello" }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({ id: "pi-agent-1", kind: "message", role: "assistant", text: "hi" }),
    );
  });

  it("maps tool entries to command execution items", () => {
    const items = parsePiHistoryMessages([
      {
        id: "pi-tool-1",
        kind: "tool",
        toolType: "bash",
        toolInput: { command: "ls" },
        toolOutput: "ok",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({ id: "pi-tool-1", kind: "tool", output: "ok" }),
    );
  });

  it("never pushes null items for entries that fail conversion", () => {
    const items = parsePiHistoryMessages([
      { id: "pi-thinking-1", kind: "thinking", text: "" },
      { id: "pi-agent-1", kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items.every((item) => item !== null && typeof item.id === "string")).toBe(
      true,
    );
  });

  it("generates fallback ids for entries without id", () => {
    const items = parsePiHistoryMessages([
      { kind: "message", role: "assistant", text: "hi" },
    ]);

    expect(items).toHaveLength(1);
    expect(typeof items[0]?.id).toBe("string");
  });
});
