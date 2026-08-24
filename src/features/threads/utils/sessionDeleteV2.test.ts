// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  deleteSessionViaV2IfEnabled,
  isSessionDeleteSuccessCode,
  isSessionDeleteV2Enabled,
  requestSessionDelete,
  resetSessionDeleteV2ForTests,
  SESSION_DELETE_SETTLED_EVENT,
  SESSION_DELETE_V2_FLAG_KEY,
} from "./sessionDeleteV2";

describe("sessionDeleteV2", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    window.localStorage.removeItem(SESSION_DELETE_V2_FLAG_KEY);
  });

  afterEach(() => {
    resetSessionDeleteV2ForTests();
    window.localStorage.removeItem(SESSION_DELETE_V2_FLAG_KEY);
  });

  it("flag 生产默认开启；测试环境默认关闭，显式 on 开启", () => {
    // 测试环境（import.meta.env.MODE === 'test'）默认 off
    expect(isSessionDeleteV2Enabled()).toBe(false);
    window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, "on");
    expect(isSessionDeleteV2Enabled()).toBe(true);
    window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, "off");
    expect(isSessionDeleteV2Enabled()).toBe(false);
    window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, "false");
    expect(isSessionDeleteV2Enabled()).toBe(false);
    window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, "0");
    expect(isSessionDeleteV2Enabled()).toBe(false);
  });

  it("幂等成功码收敛为 OK / ALREADY_MISSING / GHOST_CLEANED / MARKED_DELETED", () => {
    for (const code of ["OK", "ALREADY_MISSING", "GHOST_CLEANED", "MARKED_DELETED"]) {
      expect(isSessionDeleteSuccessCode(code)).toBe(true);
    }
    for (const code of ["IO_FAILED", "ENGINE_BUSY", "REQUEST_TIMEOUT", ""]) {
      expect(isSessionDeleteSuccessCode(code)).toBe(false);
    }
  });

  it("settled 事件按 requestId 路由并 resolve", async () => {
    invokeMock.mockResolvedValue({ requestId: "req-1" });
    let settledHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(
      (_event: string, handler: (event: { payload: unknown }) => void) => {
        settledHandler = handler;
        return Promise.resolve(() => {});
      },
    );

    const promise = requestSessionDelete("ws-1", ["thread-1", "thread-2"]);
    // 等 listener 建立 → invoke 发出 → pending 注册
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_workspace_sessions_v2", {
        request: {
          workspaceId: "ws-1",
          targets: [{ threadId: "thread-1" }, { threadId: "thread-2" }],
        },
      });
    });
    expect(listenMock).toHaveBeenCalledWith(
      SESSION_DELETE_SETTLED_EVENT,
      expect.any(Function),
    );

    // 无关 requestId 的 settled 不影响挂起请求
    settledHandler?.({ payload: { requestId: "req-other", results: [] } });

    settledHandler?.({
      payload: {
        requestId: "req-1",
        results: [
          { sessionId: "thread-1", ok: true, code: "OK" },
          { sessionId: "thread-2", ok: true, code: "MARKED_DELETED" },
        ],
      },
    });

    const results = await promise;
    expect(results).toHaveLength(2);
    expect(results[1].code).toBe("MARKED_DELETED");
  });

  it("settled 先于 pending 注册到达：从 early buffer 领取（竞态回归）", async () => {
    let settledHandler: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(
      (_event: string, handler: (event: { payload: unknown }) => void) => {
        settledHandler = handler;
        return Promise.resolve(() => {});
      },
    );
    invokeMock.mockImplementation(async () => {
      // 模拟后端在 invoke 返回前就 emit settled（快删除竞态）
      settledHandler?.({
        payload: {
          requestId: "req-early",
          results: [{ sessionId: "t1", ok: true, code: "OK" }],
        },
      });
      return { requestId: "req-early" };
    });

    const results = await requestSessionDelete("ws-1", ["t1"]);
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("OK");
  });

  it("超时 reject（前端回滚 + 可重试）", async () => {
    invokeMock.mockResolvedValue({ requestId: "req-timeout" });
    listenMock.mockResolvedValue(() => {});

    await expect(
      requestSessionDelete("ws-1", ["thread-1"], { timeoutMs: 20 }),
    ).rejects.toThrow("session delete request timeout");
  });

  it("engine 选项透传到删除目标（codex 裸 id 定向）", async () => {
    invokeMock.mockResolvedValue({ requestId: "req-engine" });
    listenMock.mockResolvedValue(() => {});

    const promise = requestSessionDelete("ws-1", ["bare-uuid"], {
      engine: "codex",
      timeoutMs: 20,
    });
    // 立即挂上 reject 断言，避免 20ms 超时先于 handler 触发 unhandled rejection
    const assertion = expect(promise).rejects.toThrow(
      "session delete request timeout",
    );
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_workspace_sessions_v2", {
        request: {
          workspaceId: "ws-1",
          targets: [{ threadId: "bare-uuid", engine: "codex" }],
        },
      });
    });
    await assertion;
  });

  describe("deleteSessionViaV2IfEnabled（内部生命周期删除）", () => {
    it("flag off 返回 null（调用方回退 legacy 直删）", async () => {
      window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, "off");
      const result = await deleteSessionViaV2IfEnabled("ws-1", "thread-1");
      expect(result).toBeNull();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it("MARKED_DELETED 等幂等成功码归一为 ok", async () => {
      window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, "on");
      let settledHandler: ((event: { payload: unknown }) => void) | undefined;
      listenMock.mockImplementation(
        (_event: string, handler: (event: { payload: unknown }) => void) => {
          settledHandler = handler;
          return Promise.resolve(() => {});
        },
      );
      invokeMock.mockImplementation(async () => {
        settledHandler?.({
          payload: {
            requestId: "req-lifecycle",
            results: [{ sessionId: "thread-1", ok: true, code: "MARKED_DELETED" }],
          },
        });
        return { requestId: "req-lifecycle" };
      });

      const result = await deleteSessionViaV2IfEnabled("ws-1", "thread-1", {
        engine: "claude",
      });
      expect(result).toEqual({ ok: true, message: null });
    });

    it("失败结果与异常都归一为 { ok: false, message }", async () => {
      window.localStorage.setItem(SESSION_DELETE_V2_FLAG_KEY, "on");
      listenMock.mockResolvedValue(() => {});
      // 后端返回失败码
      invokeMock.mockResolvedValueOnce({ requestId: "req-fail" });
      const failPromise = deleteSessionViaV2IfEnabled("ws-1", "thread-1", {
        timeoutMs: 20,
      });
      // 无 settled → 超时 → { ok: false }
      await expect(failPromise).resolves.toEqual({
        ok: false,
        message: "session delete request timeout",
      });
      // invoke 异常
      invokeMock.mockRejectedValueOnce(new Error("ipc down"));
      const ipcResult = await deleteSessionViaV2IfEnabled("ws-1", "thread-1");
      expect(ipcResult).toEqual({ ok: false, message: "ipc down" });
    });
  });
});
