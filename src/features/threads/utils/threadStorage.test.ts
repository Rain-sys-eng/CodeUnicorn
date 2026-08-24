import { beforeEach, describe, expect, it, vi } from "vitest";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: clientStorageMocks.getClientStoreSync,
  writeClientStoreValue: clientStorageMocks.writeClientStoreValue,
}));

import {
  MAX_CUSTOM_NAME_ENTRIES,
  MAX_THREAD_ALIAS_ENTRIES,
  buildClearedThreadAliases,
  buildUpdatedThreadAliases,
  collectCanonicalActiveThreadRebindings,
  loadThreadAliases,
  pruneCustomNames,
  resolveCanonicalThreadAlias,
  saveCustomName,
  saveCustomNamesBatch,
  saveThreadAliases,
} from "./threadStorage";

describe("threadStorage aliases", () => {
  beforeEach(() => {
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
  });

  it("loads only valid persisted thread aliases", () => {
    clientStorageMocks.getClientStoreSync.mockReturnValueOnce({
      "thread-stale": "thread-recovered",
      " ": "thread-blank",
      "thread-loop": "thread-loop",
      "thread-empty": "   ",
      "claude:session-old": "claude:session-new",
    });

    expect(loadThreadAliases()).toEqual({
      "thread-stale": "thread-recovered",
    });
  });

  it("ignores corrupted persisted alias payloads and removes cyclic chains", () => {
    clientStorageMocks.getClientStoreSync
      .mockReturnValueOnce(["thread-a", "thread-b"])
      .mockReturnValueOnce({
        "thread-a": "thread-b",
        "thread-b": "thread-a",
        "thread-c": 123,
      });

    expect(loadThreadAliases()).toEqual({});
    expect(loadThreadAliases()).toEqual({});
  });

  it("collapses alias chains onto the latest canonical thread id", () => {
    const aliases = buildUpdatedThreadAliases(
      {
        "thread-old": "thread-stale",
        "thread-stale": "thread-current",
      },
      "thread-current",
      "thread-next",
    );

    expect(aliases).toEqual({
      "thread-old": "thread-next",
      "thread-stale": "thread-next",
      "thread-current": "thread-next",
    });
    expect(resolveCanonicalThreadAlias(aliases, "thread-old")).toBe("thread-next");
  });

  it("does not alias finalized native session ids", () => {
    expect(
      buildUpdatedThreadAliases(
        {
          "claude:session-a": "claude:session-b",
          "opencode:session-a": "opencode:session-b",
          "gemini:session-a": "gemini:session-b",
          "kimi:session-a": "kimi:session-b",
          "pi:session-a": "pi:session-b",
        },
        "claude:session-current",
        "claude:session-next",
      ),
    ).toEqual({});
    expect(
      buildUpdatedThreadAliases(
        {},
        "pi:session-current",
        "pi:session-next",
      ),
    ).toEqual({});
    expect(
      buildUpdatedThreadAliases(
        {},
        "claude-pending-123",
        "claude:session-next",
      ),
    ).toEqual({
      "claude-pending-123": "claude:session-next",
    });
  });

  it("keeps durable forwarding tombstones bounded", () => {
    const aliases = Object.fromEntries(
      Array.from({ length: MAX_THREAD_ALIAS_ENTRIES + 2 }, (_, index) => [
        `pending-${index}`,
        `native-${index}`,
      ]),
    );

    const normalized = buildUpdatedThreadAliases(
      aliases,
      "pending-latest",
      "native-latest",
    );

    expect(Object.keys(normalized)).toHaveLength(MAX_THREAD_ALIAS_ENTRIES);
    expect(normalized["pending-0"]).toBeUndefined();
    expect(normalized["pending-latest"]).toBe("native-latest");
  });

  it("persists normalized alias maps", () => {
    saveThreadAliases({
      "thread-a": "thread-b",
      "thread-b": "thread-b",
      "thread-c": "thread-d",
      "thread-d": "thread-e",
      "claude:session-old": "claude:session-new",
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "threads",
      "threadAliases",
      {
        "thread-a": "thread-b",
        "thread-c": "thread-e",
        "thread-d": "thread-e",
      },
    );
  });

  it("clears one persisted alias without deleting related canonical targets", () => {
    const aliases = buildClearedThreadAliases(
      {
        "thread-stale": "thread-recovered",
        "thread-old": "thread-recovered",
      },
      "thread-stale",
    );

    expect(aliases).toEqual({
      "thread-old": "thread-recovered",
    });
  });

  it("collects active thread map rebindings before lifecycle consumers use stale ids", () => {
    const aliases = buildUpdatedThreadAliases(
      {
        "codex:old": "codex:middle",
        "codex:middle": "codex:current",
      },
      "codex:current",
      "codex:latest",
    );

    expect(
      collectCanonicalActiveThreadRebindings(
        {
          "ws-codex": " codex:old ",
          "ws-current": "codex:latest",
          "ws-empty": null,
        },
        (threadId) => resolveCanonicalThreadAlias(aliases, threadId),
      ),
    ).toEqual([
      {
        workspaceId: "ws-codex",
        threadId: "codex:old",
        canonicalThreadId: "codex:latest",
      },
    ]);
  });
});

describe("threadStorage customNames pruning", () => {
  beforeEach(() => {
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
  });

  it("keeps maps under the capacity untouched (same reference)", () => {
    const names = { "ws:a": "Alpha", "ws:b": "Beta" };
    expect(pruneCustomNames(names)).toBe(names);
  });

  it("drops the oldest entries by insertion order when over capacity", () => {
    const names: Record<string, string> = {};
    for (let index = 0; index < MAX_CUSTOM_NAME_ENTRIES + 5; index += 1) {
      names[`ws:thread-${index}`] = `Name ${index}`;
    }

    const pruned = pruneCustomNames(names);
    const keys = Object.keys(pruned);
    expect(keys).toHaveLength(MAX_CUSTOM_NAME_ENTRIES);
    expect(pruned["ws:thread-0"]).toBeUndefined();
    expect(pruned["ws:thread-4"]).toBeUndefined();
    expect(pruned["ws:thread-5"]).toBe("Name 5");
    expect(keys[keys.length - 1]).toBe(
      `ws:thread-${MAX_CUSTOM_NAME_ENTRIES + 4}`,
    );
  });

  it("moves renamed threads to the newest position instead of keeping stale insertion order", () => {
    clientStorageMocks.getClientStoreSync.mockReturnValueOnce({
      "ws:thread-1": "Old title",
      "ws:thread-2": "Other",
    });

    saveCustomName("ws", "thread-1", "New title");

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "threads",
      "customNames",
      { "ws:thread-2": "Other", "ws:thread-1": "New title" },
    );
    const written = clientStorageMocks.writeClientStoreValue.mock.calls[0]![2] as Record<
      string,
      string
    >;
    expect(Object.keys(written)).toEqual(["ws:thread-2", "ws:thread-1"]);
  });

  it("batches title mapping writes into a single pruned store update", () => {
    clientStorageMocks.getClientStoreSync.mockReturnValue({
      "ws:old": "Old",
    });

    saveCustomNamesBatch("ws", {
      "thread-1": "First",
      "thread-2": "Second",
      " ": "ignored",
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(1);
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "threads",
      "customNames",
      {
        "ws:old": "Old",
        "ws:thread-1": "First",
        "ws:thread-2": "Second",
      },
    );
  });

  it("skips the disk write when batch titles are already current", () => {
    clientStorageMocks.getClientStoreSync.mockReturnValue({
      "ws:thread-1": "First",
    });

    saveCustomNamesBatch("ws", { "thread-1": "First" });
    expect(clientStorageMocks.writeClientStoreValue).not.toHaveBeenCalled();
  });
});
