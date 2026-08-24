import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { mergeThreadItemsPreservingOptimisticUsers } from "./threadReducerOptimisticItemMerge";

type UserMessage = Extract<ConversationItem, { kind: "message" }> & { role: "user" };

function userMessage(
  id: string,
  text: string,
  images?: string[],
): UserMessage {
  return {
    id,
    kind: "message",
    role: "user",
    text,
    ...(images && images.length > 0 ? { images } : {}),
  };
}

function assistantMessage(id: string, text: string): ConversationItem {
  return {
    id,
    kind: "message",
    role: "assistant",
    text,
  };
}

describe("mergeThreadItemsPreservingOptimisticUsers user images", () => {
  it("converges text-matched optimistic+real and keeps images when projection drops them", () => {
    const local: ConversationItem[] = [
      userMessage("optimistic-user-1", "看图说明一下", ["/tmp/a.png"]),
    ];
    const incoming: ConversationItem[] = [
      userMessage("1:user", "看图说明一下"),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: true,
    });
    const users = merged.filter(
      (item): item is UserMessage =>
        item.kind === "message" && item.role === "user",
    );

    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe("1:user");
    expect(users[0]?.images).toEqual(["/tmp/a.png"]);
  });

  it("drops optimistic when projected real already carries the same images", () => {
    const local: ConversationItem[] = [
      userMessage("optimistic-user-2", "hello", ["/tmp/a.png"]),
    ];
    const incoming: ConversationItem[] = [
      userMessage("2:user", "hello", ["/tmp/a.png"]),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: false,
    });
    const users = merged.filter(
      (item): item is UserMessage =>
        item.kind === "message" && item.role === "user",
    );

    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe("2:user");
    expect(users[0]?.images).toEqual(["/tmp/a.png"]);
  });

  it("does not leave a captioned image optimistic after the assistant when history uses another image url", () => {
    const question = "分析一下这个是什么原因";
    const local: ConversationItem[] = [
      userMessage("optimistic-user-shot", question, ["blob:optimistic-shot"]),
      assistantMessage("live-asst", "正在看图"),
    ];
    const incoming: ConversationItem[] = [
      userMessage("hist-shot", question, ["/tmp/shot.png"]),
      assistantMessage("hist-asst", "这是 Cryptex 路径"),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: false,
    });

    expect(merged.map((item) => item.id)).toEqual(["hist-shot", "hist-asst"]);
    expect(merged.some((item) => item.id === "optimistic-user-shot")).toBe(
      false,
    );
  });

  it("keeps the captioned image user above the assistant when history hydrates an empty-text image row", () => {
    const question = "分析一下这个是什么原因";
    const local: ConversationItem[] = [
      userMessage("hist-1", "上一问"),
      assistantMessage("a-1", "上一答"),
      userMessage("optimistic-user-shot", question, ["blob:optimistic-shot"]),
      assistantMessage("live-asst", "流式中"),
    ];
    const incoming: ConversationItem[] = [
      userMessage("hist-1", "上一问"),
      assistantMessage("a-1", "上一答"),
      userMessage("hist-shot", "", ["/tmp/shot.png"]),
      assistantMessage("hist-asst", "这是 Cryptex 路径"),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: true,
    });
    const users = merged.filter(
      (item): item is UserMessage =>
        item.kind === "message" && item.role === "user",
    );

    expect(merged.map((item) => item.id)).toEqual([
      "hist-1",
      "a-1",
      "hist-shot",
      "hist-asst",
    ]);
    expect(users.map((item) => item.id)).toEqual(["hist-1", "hist-shot"]);
    expect(users[1]?.text).toBe(question);
    expect(merged.some((item) => item.id === "optimistic-user-shot")).toBe(
      false,
    );
  });
});
