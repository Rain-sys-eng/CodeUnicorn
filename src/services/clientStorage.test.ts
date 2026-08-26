import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

// client_store_write/patch 的载荷必须以单一 pre-stringified JSON string 过桥：
// WKWebView 桥按对象数同步转换嵌套对象图（实测 274KB patch 同步段 3338ms），字符串成本 O(len)。
function expectRawStringPayloadCall(
  invokeMock: ReturnType<typeof vi.mocked<typeof invoke>>,
  command: "client_store_write" | "client_store_patch",
  expectedParsed: Record<string, unknown>,
) {
  const call = invokeMock.mock.calls.find(([name]) => name === command);
  expect(call, `expected a ${command} invoke`).toBeDefined();
  const [, payload] = call as [string, Record<string, unknown>];
  expect(Object.keys(payload).sort()).toEqual(["payloadJson", "store"]);
  expect(typeof payload.payloadJson).toBe("string");
  expect(JSON.parse(payload.payloadJson as string)).toEqual(expectedParsed);
}

describe("clientStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unmock("./clientStorage");
  });

  it("hydrates legacy object stores and rewrites schema metadata immediately", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockImplementation(async (command, payload) => {
      const args =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (command === "client_store_read" && args?.store === "layout") {
        return { sidebarWidth: 280 };
      }
      if (command === "client_store_read") {
        return null;
      }
      return null;
    });

    await storage.preloadClientStores();
    await Promise.resolve();

    expect(storage.getClientStoreSync("layout", "sidebarWidth")).toBe(280);
    expectRawStringPayloadCall(invokeMock, "client_store_write", {
      __schemaVersion: 1,
      sidebarWidth: 280,
    });
  });

  it("drops invalid root payloads and rewrites defaults", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockImplementation(async (command, payload) => {
      const args =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (command === "client_store_read" && args?.store === "app") {
        return ["broken"];
      }
      if (command === "client_store_read") {
        return null;
      }
      return null;
    });

    await storage.preloadClientStores();
    await Promise.resolve();

    expect(storage.getClientStoreFullSync("app")).toEqual({});
    expectRawStringPayloadCall(invokeMock, "client_store_write", {
      __schemaVersion: 1,
    });
  });

  it("does not create empty schema files for missing stores during preload", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    await storage.preloadClientStores();
    await Promise.resolve();

    expect(storage.getClientStoreFullSync("layout")).toEqual({});
    expect(invokeMock).not.toHaveBeenCalledWith(
      "client_store_write",
      expect.objectContaining({ payloadJson: expect.stringContaining("__schemaVersion") }),
    );
  });

  it("writes patch updates with schema metadata while keeping sync cache payload clean", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    storage.writeClientStoreValue(
      "threads",
      "customNames",
      { "ws:thread": "Name" },
      { immediate: true },
    );
    await Promise.resolve();

    expect(storage.getClientStoreSync("threads", "customNames")).toEqual({
      "ws:thread": "Name",
    });
    expectRawStringPayloadCall(invokeMock, "client_store_patch", {
      __schemaVersion: 1,
      customNames: { "ws:thread": "Name" },
    });
  });

  it("writes full replace updates with schema metadata", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    storage.writeClientStoreData(
      "composer",
      {
        promptHistory: { demo: ["hi"] },
      },
      { immediate: true },
    );
    await Promise.resolve();

    expect(storage.getClientStoreFullSync("composer")).toEqual({
      promptHistory: { demo: ["hi"] },
    });
    expectRawStringPayloadCall(invokeMock, "client_store_write", {
      __schemaVersion: 1,
      promptHistory: { demo: ["hi"] },
    });
  });

  it("never passes nested object graphs across the store write bridge", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    storage.writeClientStoreValue(
      "diagnostics",
      "diagnostics.rendererLifecycleLog",
      [{ timestamp: 1, label: "perf.frame-drop", payload: { deltaMs: 120 } }],
      { immediate: true },
    );
    storage.writeClientStoreData(
      "threads",
      { customNames: { "ws:t": "T" } },
      { immediate: true },
    );
    await Promise.resolve();

    for (const [command, payload] of invokeMock.mock.calls) {
      if (command !== "client_store_write" && command !== "client_store_patch") {
        continue;
      }
      const args = payload as Record<string, unknown>;
      expect(args.data).toBeUndefined();
      expect(args.patch).toBeUndefined();
      expect(typeof args.payloadJson).toBe("string");
    }
  });

  it("round-trips unicode payloads through the raw string bridge unchanged", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockResolvedValue(null);

    // 中文 / emoji / 换行 / 引号：stringify→from_str 必须逐字节还原，
    // 防止任何转义层把多字节内容弄脏。
    const unicodeValue = {
      "会话名": "中文会话 🎯",
      note: 'line1\nline2 "quoted"',
      nested: [{ deep: true, emoji: "🚀" }],
    };
    storage.writeClientStoreValue("threads", "customNames", unicodeValue, {
      immediate: true,
    });
    await Promise.resolve();

    const patchCall = invokeMock.mock.calls.find(
      ([command]) => command === "client_store_patch",
    );
    expect(patchCall).toBeDefined();
    const [, payload] = patchCall as [string, Record<string, unknown>];
    expect(JSON.parse(payload.payloadJson as string)).toEqual({
      __schemaVersion: 1,
      customNames: unicodeValue,
    });
  });

  it("hydrates only layout and app on the critical path", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockImplementation(async (command, payload) => {
      const args =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (command === "client_store_read") {
        return { __schemaVersion: 1, from: args?.store };
      }
      return null;
    });

    await storage.preloadCriticalClientStores();

    expect(storage.isClientStoreReady("layout")).toBe(true);
    expect(storage.isClientStoreReady("app")).toBe(true);
    expect(storage.isClientStoreReady("threads")).toBe(false);
    expect(storage.isPreloaded()).toBe(false);
    expect(invokeMock.mock.calls.filter(([command]) => command === "client_store_read")).toHaveLength(2);
    expect(storage.getClientStoreSync("layout", "from")).toBe("layout");
    expect(storage.getClientStoreSync("threads", "from")).toBeUndefined();
  });

  it("keeps in-memory dirty keys when a deferred store hydrates later", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockImplementation(async (command, payload) => {
      const args =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (command === "client_store_read" && args?.store === "threads") {
        return {
          __schemaVersion: 1,
          customNames: { "ws:disk": "Disk" },
          pinnedThreads: { "ws:old": 1 },
        };
      }
      if (command === "client_store_read") {
        return null;
      }
      return null;
    });

    storage.writeClientStoreValue("threads", "customNames", { "ws:memory": "Memory" });
    await storage.preloadDeferredClientStores();

    expect(storage.getClientStoreSync("threads", "customNames")).toEqual({
      "ws:memory": "Memory",
    });
    expect(storage.getClientStoreSync("threads", "pinnedThreads")).toEqual({
      "ws:old": 1,
    });
    expect(storage.isClientStoreReady("threads")).toBe(true);
    expect(storage.isPreloaded()).toBe(false);
  });

  it("rehydrates persisted schema stores after an in-memory reset without exposing schema metadata", async () => {
    const invokeMock = vi.mocked(invoke);
    const storage = await import("./clientStorage");
    storage.resetClientStorageForTests();
    invokeMock.mockImplementation(async (command, payload) => {
      const args =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (command === "client_store_read" && args?.store === "layout") {
        return {
          __schemaVersion: 1,
          sidebarWidth: 360,
        };
      }
      if (command === "client_store_read") {
        return null;
      }
      return null;
    });

    await storage.preloadClientStores();
    expect(storage.getClientStoreFullSync("layout")).toEqual({
      sidebarWidth: 360,
    });

    storage.resetClientStorageForTests();
    await storage.preloadClientStores();

    expect(storage.getClientStoreSync("layout", "sidebarWidth")).toBe(360);
    expect(storage.getClientStoreFullSync("layout")).toEqual({
      sidebarWidth: 360,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "client_store_write",
      expect.objectContaining({ store: "layout" }),
    );
  });
});
