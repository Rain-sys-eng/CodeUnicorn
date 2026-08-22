/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWorkspaceWallpaperStoreForTests,
} from "../utils/workspaceWallpaperStore";

vi.mock("../../onboarding/components/FirstRunFluidBackdrop", () => ({
  FirstRunFluidBackdrop: ({
    profile,
    motionId,
    speed,
    forceAnimate,
    onAttachChange,
  }: {
    profile?: string;
    motionId?: string;
    speed?: number;
    forceAnimate?: boolean;
    onAttachChange?: (attached: boolean) => void;
  }) => {
    useEffect(() => {
      onAttachChange?.(true);
      return () => onAttachChange?.(false);
    }, [onAttachChange]);
    return (
      <div
        data-testid="first-run-fluid"
        aria-hidden
        data-profile={profile ?? "full"}
        data-motion={motionId ?? "drift"}
        data-animate={forceAnimate ? "true" : "false"}
        data-speed={speed === undefined ? "" : String(speed)}
      />
    );
  },
}));

const platformMocks = vi.hoisted(() => ({
  isWindowsPlatform: vi.fn(() => false),
}));

vi.mock("../../../utils/platform", () => ({
  isWindowsPlatform: platformMocks.isWindowsPlatform,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

const getAppSettings = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      workspaceWallpaper: {
        mode: string;
        customImagePath: string | null;
        veilOpacity?: number;
        fluidPreset?: string;
        fluidMotion?: string;
        selectedLibraryId?: string | null;
        library?: Array<{
          id: string;
          kind: "image" | "video";
          path: string;
          sourcePath?: string | null;
          hidden?: boolean;
        }>;
        wallpaperBlur?: number;
        wallpaperDarken?: number;
        flip?: boolean;
        objectFit?: string;
        playbackRate?: number;
        paused?: boolean;
      };
      performanceCompatibilityModeEnabled?: boolean;
    }> => ({
      workspaceWallpaper: { mode: "none", customImagePath: null },
    }),
  ),
);

const updateAppSettings = vi.hoisted(() => vi.fn(async (settings) => settings));

const readWorkspaceWallpaperPreview = vi.hoisted(() =>
  vi.fn(async () => "data:image/png;base64,AAA"),
);

const readWorkspaceWallpaperBytes = vi.hoisted(() =>
  vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
);

vi.mock("../../../services/tauri", () => ({
  getAppSettings,
  updateAppSettings,
  readWorkspaceWallpaperPreview,
  readWorkspaceWallpaperBytes,
}));

import { WorkspaceWallpaperHost } from "./WorkspaceWallpaperHost";

describe("WorkspaceWallpaperHost", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:wallpaper-video"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    resetWorkspaceWallpaperStoreForTests();
    getAppSettings.mockReset();
    getAppSettings.mockResolvedValue({
      workspaceWallpaper: { mode: "none", customImagePath: null },
    });
    readWorkspaceWallpaperPreview.mockClear();
    readWorkspaceWallpaperBytes.mockClear();
    delete document.documentElement.dataset.workspaceWallpaper;
    platformMocks.isWindowsPlatform.mockReset();
    platformMocks.isWindowsPlatform.mockReturnValue(false);
  });

  it("does not mount a wallpaper layer by default", async () => {
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(getAppSettings).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("workspace-wallpaper")).toBeNull();
    expect(document.documentElement.dataset.workspaceWallpaper).toBeUndefined();
  });

  it("renders the first-run fluid backdrop when the user opts in", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: { mode: "fluid", customImagePath: null },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("workspace-wallpaper").dataset.mode).toBe(
        "fluid",
      );
    });
    expect(screen.getByTestId("first-run-fluid")).not.toBeNull();
    expect(screen.getByTestId("first-run-fluid").dataset.animate).toBe("false");
    expect(screen.getByTestId("first-run-fluid").dataset.motion).toBe("drift");
    await waitFor(() => {
      expect(document.documentElement.dataset.workspaceWallpaper).toBe("fluid");
    });
  });

  it("forwards a persisted structured motion to the fluid backdrop", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "fluid",
        customImagePath: null,
        fluidMotion: "tornado",
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("first-run-fluid").dataset.motion).toBe(
        "tornado",
      );
    });
  });

  it("does not mount a wallpaper layer when mode is none", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: { mode: "none", customImagePath: null },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(getAppSettings).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("workspace-wallpaper")).toBeNull();
    expect(document.documentElement.dataset.workspaceWallpaper).toBeUndefined();
  });

  it("renders a custom cover image from the persisted path", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "custom",
        customImagePath: "/Users/me/Wall.png",
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("workspace-wallpaper").dataset.mode).toBe(
        "custom",
      );
    });
    const host = screen.getByTestId("workspace-wallpaper");
    const image = host.querySelector("img");
    expect(image?.getAttribute("src")).toBe("asset://localhost/Users/me/Wall.png");
    expect(screen.queryByTestId("first-run-fluid")).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue(
        "--workspace-wallpaper-frost",
      ),
    ).toBe("0px");
  });

  it("falls back to a managed data URL when the asset protocol image fails", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "custom",
        customImagePath: null,
        selectedLibraryId: "pic-1",
        library: [
          {
            id: "pic-1",
            kind: "image",
            path: "/Users/me/.ccgui/wallpapers/shot.png",
          },
        ],
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("workspace-wallpaper").dataset.mode).toBe(
        "custom",
      );
    });
    const image = screen
      .getByTestId("workspace-wallpaper")
      .querySelector("img");
    expect(image).not.toBeNull();
    image?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(image?.getAttribute("src")).toBe("data:image/png;base64,AAA");
    });
    expect(screen.queryByTestId("first-run-fluid")).toBeNull();
  });

  it("renders a muted looping video from the selected library item", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "custom",
        customImagePath: null,
        selectedLibraryId: "vid-1",
        library: [
          {
            id: "vid-1",
            kind: "video",
            path: "/Users/me/.ccgui/wallpapers/loop.mp4",
          },
        ],
        wallpaperBlur: 8,
        wallpaperDarken: 20,
        flip: true,
        objectFit: "contain",
        playbackRate: 1.25,
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("workspace-wallpaper").dataset.mediaKind).toBe(
        "video",
      );
    });
    const video = screen
      .getByTestId("workspace-wallpaper")
      .querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      "asset://localhost/Users/me/.ccgui/wallpapers/loop.mp4",
    );
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(screen.getByTestId("workspace-wallpaper").getAttribute("data-media-blur")).toBe(
      "true",
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--workspace-wallpaper-media-blur",
      ),
    ).toBe("8px");
    expect(
      document.documentElement.style.getPropertyValue(
        "--workspace-wallpaper-darken",
      ),
    ).toBe("20%");
    expect(
      document.documentElement.style.getPropertyValue(
        "--workspace-wallpaper-flip",
      ),
    ).toBe("scaleX(-1)");
    expect(
      document.documentElement.style.getPropertyValue(
        "--workspace-wallpaper-object-fit",
      ),
    ).toBe("contain");
  });

  it("falls back to a managed blob URL when the asset protocol video fails", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "custom",
        customImagePath: null,
        selectedLibraryId: "vid-1",
        library: [
          {
            id: "vid-1",
            kind: "video",
            path: "/Users/me/.ccgui/wallpapers/loop.mp4",
          },
        ],
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("workspace-wallpaper").dataset.mediaKind).toBe(
        "video",
      );
    });
    const host = screen.getByTestId("workspace-wallpaper");
    const video = host.querySelector("video");
    expect(video).not.toBeNull();
    video?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(
        screen.getByTestId("workspace-wallpaper").querySelector("video")?.getAttribute("src"),
      ).toBe("blob:wallpaper-video");
    });
    expect(readWorkspaceWallpaperBytes).toHaveBeenCalledWith(
      "/Users/me/.ccgui/wallpapers/loop.mp4",
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.getByTestId("workspace-wallpaper").dataset.mode).toBe(
      "custom",
    );
    expect(screen.queryByTestId("first-run-fluid")).toBeNull();
  });

  it("remaps the legacy 12px frost default to a sharp wallpaper", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "custom",
        customImagePath: "/Users/me/Wall.png",
        veilOpacity: 12,
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue(
          "--workspace-wallpaper-frost",
        ),
      ).toBe("0px");
    });
  });

  it("does not apply persisted frost onto the wallpaper overlay", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "fluid",
        customImagePath: null,
        veilOpacity: 18,
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue(
          "--workspace-wallpaper-frost",
        ),
      ).toBe("0px");
    });
  });

  it("uses the full fluid profile on Mac and lite on Windows", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: { mode: "fluid", customImagePath: null },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("first-run-fluid").dataset.profile).toBe("full");
    });
    cleanup();
    platformMocks.isWindowsPlatform.mockReturnValue(true);
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: { mode: "fluid", customImagePath: null },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("first-run-fluid").dataset.profile).toBe("lite");
    });
  });

  it("forwards sanitized motion and workspace speed to the fluid backdrop", async () => {
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: {
        mode: "fluid",
        customImagePath: null,
        fluidMotion: "taiji",
      },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("first-run-fluid").dataset.motion).toBe("taiji");
    });
    expect(screen.getByTestId("first-run-fluid").dataset.speed).toBe("9");
  });

  it("applies WebView2 fluid compat only on Windows", async () => {
    platformMocks.isWindowsPlatform.mockReturnValue(true);
    getAppSettings.mockResolvedValueOnce({
      workspaceWallpaper: { mode: "fluid", customImagePath: null },
    });
    render(<WorkspaceWallpaperHost />);
    await waitFor(() => {
      expect(screen.getByTestId("first-run-fluid").dataset.animate).toBe(
        "true",
      );
    });
    await waitFor(() => {
      expect(document.documentElement.dataset.workspaceWallpaper).toBe("fluid");
    });
  });
});
