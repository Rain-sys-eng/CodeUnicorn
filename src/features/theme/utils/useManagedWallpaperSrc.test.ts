/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMediaOwnerRegistryForTests } from "../../../services/mediaResourceOwners";

const readWorkspaceWallpaperPreview = vi.hoisted(() =>
  vi.fn(async () => "data:image/png;base64,AAA"),
);
const readWorkspaceWallpaperBytes = vi.hoisted(() =>
  vi.fn(async () => new Uint8Array([9, 8, 7, 6])),
);

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

vi.mock("../../../services/tauri", () => ({
  readWorkspaceWallpaperPreview,
  readWorkspaceWallpaperBytes,
}));

import { useManagedWallpaperSrc } from "./useManagedWallpaperSrc";

describe("useManagedWallpaperSrc", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:managed-video"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    resetMediaOwnerRegistryForTests();
    vi.restoreAllMocks();
    readWorkspaceWallpaperPreview.mockClear();
    readWorkspaceWallpaperBytes.mockClear();
  });

  it("keeps the asset URL until a video error, then uses a blob URL", async () => {
    const { result } = renderHook(() =>
      useManagedWallpaperSrc("/tmp/loop.mp4", "video"),
    );

    expect(result.current.src).toBe("asset://localhost/tmp/loop.mp4");
    expect(result.current.failed).toBe(false);

    act(() => {
      result.current.handleError();
    });
    await waitFor(() => {
      expect(result.current.src).toBe("blob:managed-video");
    });
    expect(result.current.failed).toBe(false);
    expect(readWorkspaceWallpaperBytes).toHaveBeenCalledWith("/tmp/loop.mp4");
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("marks a video as failed only after the blob fallback also errors", async () => {
    const { result } = renderHook(() =>
      useManagedWallpaperSrc("/tmp/loop.mp4", "video"),
    );

    act(() => {
      result.current.handleError();
    });
    await waitFor(() => {
      expect(result.current.src).toBe("blob:managed-video");
    });

    act(() => {
      result.current.handleError();
    });
    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(readWorkspaceWallpaperBytes).toHaveBeenCalledTimes(1);
  });
});
