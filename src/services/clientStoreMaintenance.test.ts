// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  getClientStoreSync,
  writeClientStoreData,
  writeClientStoreValue,
} from "./clientStorage";
import { runClientStoreMaintenance } from "./clientStoreMaintenance";
import { MAX_CUSTOM_NAME_ENTRIES } from "../features/threads/utils/threadStorage";
import {
  isBlockedThreadSessionLogLabel,
  MAX_THREAD_SESSION_LOG_ENTRIES,
  MAX_THREAD_SESSION_LOG_PAYLOAD_CHARS,
} from "../features/debug/hooks/useDebugLog";

const THREAD_SESSION_LOG_KEY = "diagnostics.threadSessionLog";
const RENDERER_LOG_KEY = "diagnostics.rendererLifecycleLog";

function makeEntry(label: string, payload: unknown = {}, timestamp = Date.now()) {
  return { timestamp, source: "event", label, payload };
}

describe("runClientStoreMaintenance", () => {
  beforeEach(() => {
    writeClientStoreData("app", {});
    writeClientStoreData("diagnostics", {});
    writeClientStoreData("threads", {});
  });

  it("removes blocked-label backlog entries from the persisted thread session log", () => {
    writeClientStoreValue("diagnostics", THREAD_SESSION_LOG_KEY, [
      makeEntry("thread/list"),
      makeEntry("thread/list response", { huge: true }),
      makeEntry("thread/session:turn-diagnostic:codex-no-progress-watchdog-scheduled"),
      makeEntry("thread/list older"),
      makeEntry("thread/list older response"),
      makeEntry("thread/session:reasoning-text-delta", { deltaLength: 7 }),
      makeEntry("thread/session:reasoning-summary-delta", { deltaLength: 3 }),
      makeEntry("thread/session:turn-start", { ok: true }),
    ]);

    runClientStoreMaintenance();

    const cleaned = getClientStoreSync<Array<{ label: string }>>(
      "diagnostics",
      THREAD_SESSION_LOG_KEY,
    );
    expect(cleaned?.map((entry) => entry.label)).toEqual(["thread/session:turn-start"]);
  });

  it("blocks reasoning per-delta labels from threadSessionLog persistence", () => {
    // 流式期间逐 delta 落盘会以 ≥300ms 周期全量重写 threadSessionLog key
    // （实测单会话 323 条），turn 级聚合由 realtime.turnTrace.summary 承担。
    expect(isBlockedThreadSessionLogLabel("thread/session:reasoning-text-delta")).toBe(true);
    expect(isBlockedThreadSessionLogLabel("thread/session:reasoning-summary-delta")).toBe(true);
    // 归一化（trim + lowercase）后同 label 仍必须命中，防止旁路大小写变体。
    expect(isBlockedThreadSessionLogLabel("  THREAD/SESSION:reasoning-text-delta ")).toBe(true);
    // 非 per-delta 的 reasoning 路由日志不受影响。
    expect(isBlockedThreadSessionLogLabel("thread/session:reasoning-snapshot-accepted")).toBe(false);
    expect(isBlockedThreadSessionLogLabel("thread/session:turn-start")).toBe(false);
    expect(isBlockedThreadSessionLogLabel("thread/session:claude-stream:reasoning-text-delta")).toBe(false);
  });

  it("truncates oversized backlog payloads and enforces the entry cap", () => {
    const oversizedPayload = { blob: "x".repeat(MAX_THREAD_SESSION_LOG_PAYLOAD_CHARS + 100) };
    const entries = Array.from({ length: MAX_THREAD_SESSION_LOG_ENTRIES + 20 }, (_, index) =>
      makeEntry(`thread/session:event-${index}`, index === 0 ? { small: true } : oversizedPayload),
    );
    writeClientStoreValue("diagnostics", THREAD_SESSION_LOG_KEY, entries);

    runClientStoreMaintenance();

    const cleaned = getClientStoreSync<Array<{ payload: unknown }>>(
      "diagnostics",
      THREAD_SESSION_LOG_KEY,
    );
    expect(cleaned).toHaveLength(MAX_THREAD_SESSION_LOG_ENTRIES);
    for (const entry of cleaned ?? []) {
      expect(typeof entry.payload).toBe("string");
      expect((entry.payload as string).length).toBeLessThan(
        MAX_THREAD_SESSION_LOG_PAYLOAD_CHARS,
      );
      expect(entry.payload).toContain("...(truncated");
    }
  });

  it("clears legacy app store diagnostics dead data", () => {
    writeClientStoreValue("app", THREAD_SESSION_LOG_KEY, [
      makeEntry("thread/session:legacy"),
    ]);
    writeClientStoreValue("app", RENDERER_LOG_KEY, [
      { timestamp: Date.now(), label: "renderer/install", payload: {} },
    ]);

    runClientStoreMaintenance();

    expect(getClientStoreSync("app", THREAD_SESSION_LOG_KEY)).toEqual([]);
    expect(getClientStoreSync("app", RENDERER_LOG_KEY)).toEqual([]);
    // legacy renderer 日志迁移进 diagnostics store，不能丢。
    const migrated = getClientStoreSync<Array<{ label: string }>>(
      "diagnostics",
      RENDERER_LOG_KEY,
    );
    expect(migrated?.some((entry) => entry.label === "renderer/install")).toBe(true);
  });

  it("prunes customNames down to the capacity limit", () => {
    const names: Record<string, string> = {};
    for (let index = 0; index < MAX_CUSTOM_NAME_ENTRIES + 50; index += 1) {
      names[`ws:thread-${index}`] = `Name ${index}`;
    }
    writeClientStoreValue("threads", "customNames", names);

    runClientStoreMaintenance();

    const pruned = getClientStoreSync<Record<string, string>>("threads", "customNames");
    expect(Object.keys(pruned ?? {})).toHaveLength(MAX_CUSTOM_NAME_ENTRIES);
    expect(pruned?.["ws:thread-0"]).toBeUndefined();
    expect(pruned?.[`ws:thread-${MAX_CUSTOM_NAME_ENTRIES + 49}`]).toBe(
      `Name ${MAX_CUSTOM_NAME_ENTRIES + 49}`,
    );
  });

  it("is a no-op when stores are already within limits", () => {
    writeClientStoreValue("diagnostics", THREAD_SESSION_LOG_KEY, [
      makeEntry("thread/session:turn-start"),
    ]);
    writeClientStoreValue("threads", "customNames", { "ws:a": "Alpha" });

    runClientStoreMaintenance();

    expect(
      getClientStoreSync<Array<{ label: string }>>("diagnostics", THREAD_SESSION_LOG_KEY),
    ).toHaveLength(1);
    expect(getClientStoreSync("threads", "customNames")).toEqual({ "ws:a": "Alpha" });
  });
});
