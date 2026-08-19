import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { mergeThreadItemsPreservingOptimisticUsers } from "./threadReducerOptimisticItemMerge";

type UserMessage = Extract<ConversationItem, { kind: "message" }> & { role: "user" };

function userMessage(id: string, text: string): UserMessage {
  return {
    id,
    kind: "message",
    role: "user",
    text,
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

describe("mergeThreadItemsPreservingOptimisticUsers leftover order", () => {
  it("does not append a late older disk tail after the newest optimistic user", () => {
    const local: ConversationItem[] = [
      userMessage("hist-2", "第二问"),
      assistantMessage("a-2", "答二"),
      userMessage("optimistic-user-late", "新问题"),
    ];
    const incoming: ConversationItem[] = [
      userMessage("hist-1", "第一问"),
      assistantMessage("a-1", "答一"),
      userMessage("hist-2", "第二问"),
      assistantMessage("a-2", "答二"),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: true,
    });

    expect(merged.map((item) => item.id)).toEqual([
      "hist-1",
      "a-1",
      "hist-2",
      "a-2",
      "optimistic-user-late",
    ]);
  });

  it("keeps an unmatched optimistic user in place and does not copy a different incoming user to the end", () => {
    const local: ConversationItem[] = [
      userMessage("hist-keep", "已有提问"),
      userMessage("optimistic-user-keep", "hello"),
    ];
    const incoming: ConversationItem[] = [
      userMessage("hist-keep", "已有提问"),
      userMessage("1:user", "hello world"),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: true,
    });
    const users = merged.filter(
      (item): item is UserMessage =>
        item.kind === "message" && item.role === "user",
    );

    expect(users.map((item) => item.id)).toEqual([
      "hist-keep",
      "1:user",
      "optimistic-user-keep",
    ]);
    expect(users.filter((item) => item.text === "hello world")).toHaveLength(1);
    expect(users[users.length - 1]?.id).toBe("optimistic-user-keep");
  });

  it("drops a tail optimistic copy when the same visible question already sits earlier", () => {
    const question =
      "比如说 我有好几个进程崩溃了，为什么从好几个进程里面定位到peechclient.hmi这个进程";
    const wrapped = [
      "<browser_context_v2>",
      "url: https://example.com/tombstone",
      "</browser_context_v2>",
      "",
      question,
    ].join("\n");
    const local: ConversationItem[] = [
      userMessage("hist-1", "上一问"),
      assistantMessage("a-1", "上一答"),
      userMessage("optimistic-user-late", question),
    ];
    const incoming: ConversationItem[] = [
      userMessage("hist-1", "上一问"),
      assistantMessage("a-1", "上一答"),
      userMessage("hist-q", wrapped),
      assistantMessage("a-q", "tombstone 分析"),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: true,
    });
    const users = merged.filter(
      (item): item is UserMessage =>
        item.kind === "message" && item.role === "user",
    );

    expect(users.map((item) => item.id)).toEqual(["hist-1", "hist-q"]);
    expect(merged.some((item) => item.id === "optimistic-user-late")).toBe(
      false,
    );
    expect(merged.map((item) => item.id)).toEqual([
      "hist-1",
      "a-1",
      "hist-q",
      "a-q",
    ]);
  });

  it("keeps two genuine adjacent user bubbles when only the later one is optimistic", () => {
    const local: ConversationItem[] = [
      userMessage("hist-keep", "已有提问"),
      userMessage("optimistic-user-keep", "下一问"),
    ];
    const incoming: ConversationItem[] = [userMessage("hist-keep", "已有提问")];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: true,
    });

    expect(merged.map((item) => item.id)).toEqual([
      "hist-keep",
      "optimistic-user-keep",
    ]);
  });

  it("drops explore-only leftovers when hydrating an empty canvas", () => {
    const incoming: ConversationItem[] = [
      {
        id: "foreign-explore",
        kind: "explore",
        status: "exploring",
        entries: [{ kind: "list", label: "remnants" }],
      },
      {
        id: "foreign-explore-2",
        kind: "explore",
        status: "exploring",
        entries: [{ kind: "list", label: "remnants" }],
      },
      {
        id: "foreign-ls",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: ls remnants",
        detail: "",
        status: "inProgress",
      },
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers([], incoming, {
      isProcessing: false,
    });

    expect(merged).toEqual([]);
  });

  it("keeps a real history window that starts with explore when the canvas is empty", () => {
    const incoming: ConversationItem[] = [
      {
        id: "same-session-explore",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "list", label: "remnants" }],
      },
      userMessage("hist-1", "看看 remnants"),
      assistantMessage("a-1", "列完了"),
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers([], incoming, {
      isProcessing: false,
    });

    expect(merged.map((item) => item.id)).toEqual([
      "same-session-explore",
      "hist-1",
      "a-1",
    ]);
  });

  it("does not splice a foreign unmatched explore window above a new optimistic user", () => {
    const local: ConversationItem[] = [
      userMessage("optimistic-user-only", "在吗"),
    ];
    const incoming: ConversationItem[] = [
      {
        id: "foreign-explore",
        kind: "explore",
        status: "exploring",
        entries: [{ kind: "list", label: "Downloads" }],
      },
      {
        id: "foreign-ls",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: ls /Users/demo/Downloads",
        detail: "",
        status: "inProgress",
      },
    ];

    const merged = mergeThreadItemsPreservingOptimisticUsers(local, incoming, {
      isProcessing: true,
    });

    expect(merged.map((item) => item.id)).toEqual(["optimistic-user-only"]);
  });
});
