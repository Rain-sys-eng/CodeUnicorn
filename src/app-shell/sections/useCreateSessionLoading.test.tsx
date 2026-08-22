// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateSessionLoading } from "./useCreateSessionLoading";
import type { WorkspaceInfo } from "../../types";

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace One",
  path: "/tmp/workspace-one",
  connected: true,
  settings: {
    sidebarCollapsed: false,
  },
};

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === "workspace.engineCodex") return "Codex";
  if (key === "workspace.enginePi") return "PI CLI";
  if (key === "workspace.engineQoder") return "Qoder CLI";
  if (key === "workspace.loadingProgressCreateSessionMessage") {
    return `Creating ${String(options?.engine)} in ${String(options?.workspace)}`;
  }
  return key;
};

describe("useCreateSessionLoading", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the action result and closes loading before timeout", async () => {
    const controller = {
      showLoadingProgressDialog: vi.fn(() => "loading-1"),
      hideLoadingProgressDialog: vi.fn(),
    };
    const { result } = renderHook(() =>
      useCreateSessionLoading({
        ...controller,
        t,
        createSessionTimeoutMs: 100,
      }),
    );

    await expect(
      result.current({ workspace, engine: "codex" }, async () => "thread-1"),
    ).resolves.toBe("thread-1");

    expect(controller.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("labels PI session creation as PI CLI instead of Claude Code", async () => {
    const controller = {
      showLoadingProgressDialog: vi.fn(() => "loading-pi"),
      hideLoadingProgressDialog: vi.fn(),
    };
    const { result } = renderHook(() =>
      useCreateSessionLoading({
        ...controller,
        t,
        createSessionTimeoutMs: 100,
      }),
    );

    await expect(
      result.current({ workspace, engine: "pi" }, async () => "pi-pending-1"),
    ).resolves.toBe("pi-pending-1");

    expect(controller.showLoadingProgressDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Creating PI CLI in Workspace One",
      }),
    );
  });

  it("labels Qoder session creation as Qoder CLI instead of Claude Code", async () => {
    const controller = {
      showLoadingProgressDialog: vi.fn(() => "loading-qoder"),
      hideLoadingProgressDialog: vi.fn(),
    };
    const { result } = renderHook(() =>
      useCreateSessionLoading({
        ...controller,
        t,
        createSessionTimeoutMs: 100,
      }),
    );

    await expect(
      result.current({ workspace, engine: "qoder" }, async () => "qoder-pending-1"),
    ).resolves.toBe("qoder-pending-1");

    expect(controller.showLoadingProgressDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Creating Qoder CLI in Workspace One",
      }),
    );
  });

  it("preserves the original action failure before timeout", async () => {
    const actionError = new Error("provider config invalid");
    const controller = {
      showLoadingProgressDialog: vi.fn(() => "loading-2"),
      hideLoadingProgressDialog: vi.fn(),
    };
    const { result } = renderHook(() =>
      useCreateSessionLoading({
        ...controller,
        t,
        createSessionTimeoutMs: 100,
      }),
    );

    await expect(
      result.current({ workspace, engine: "codex" }, async () => {
        throw actionError;
      }),
    ).rejects.toBe(actionError);

    expect(controller.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-2");
  });

  it("rejects and closes loading when session creation exceeds the client timeout", async () => {
    vi.useFakeTimers();
    const controller = {
      showLoadingProgressDialog: vi.fn(() => "loading-3"),
      hideLoadingProgressDialog: vi.fn(),
    };
    const { result } = renderHook(() =>
      useCreateSessionLoading({
        ...controller,
        t,
        createSessionTimeoutMs: 25,
      }),
    );

    const pendingResult = result.current(
      { workspace, engine: "codex" },
      () => new Promise<string>(() => undefined),
    );
    const rejection = expect(pendingResult).rejects.toThrow(
      "Create session timed out after 25ms",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });

    await rejection;
    expect(controller.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-3");
  });
});
