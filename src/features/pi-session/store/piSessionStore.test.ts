// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../api/piSessionRpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/piSessionRpc")>();
  return {
    ...actual,
    piGetSessionTree: vi.fn(),
  };
});

import { piGetSessionTree } from "../api/piSessionRpc";
import {
  refreshPiSessionTree,
  usePiSessionTreeError,
} from "./piSessionStore";

const mockedGetTree = vi.mocked(piGetSessionTree);

describe("piSessionStore 会话树加载错误态", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("加载失败写入后端错误消息", async () => {
    mockedGetTree.mockRejectedValue(
      new Error("pi rpc disabled after previous failure"),
    );
    await act(async () => {
      await refreshPiSessionTree("ws-err-1", "pi:sess-err-1");
    });
    const { result } = renderHook(() =>
      usePiSessionTreeError("ws-err-1", "pi:sess-err-1"),
    );
    expect(result.current).toBe("pi rpc disabled after previous failure");
  });

  it("再次尝试开始时立即清除旧错误（不等结果）", async () => {
    mockedGetTree.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await refreshPiSessionTree("ws-err-2", "pi:sess-err-2");
    });
    const { result } = renderHook(() =>
      usePiSessionTreeError("ws-err-2", "pi:sess-err-2"),
    );
    expect(result.current).toBe("boom");

    // 第二次尝试挂起不结算：错误必须在尝试开始（resolve 之前）就被清除，
    // 面板才能从「加载失败」立刻切回「加载中」。
    let settle: (value: unknown) => void = () => undefined;
    mockedGetTree.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          settle = resolve;
        }) as Promise<never>,
    );
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = refreshPiSessionTree("ws-err-2", "pi:sess-err-2");
    });
    expect(result.current).toBeNull();

    // 收尾：用空对象结算（投影失败会走 catch，与断言无关），避免悬挂 promise。
    settle({});
    await act(async () => {
      await pending;
    });
  });
});
