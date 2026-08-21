import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_WALLPAPER,
  findDuplicateWallpaperLibraryItem,
  resolveWorkspaceWallpaperMedia,
  resolveWorkspaceWallpaperMode,
  sanitizeCustomWallpaperPath,
  sanitizeWorkspaceWallpaper,
} from "./workspaceWallpaper";

describe("workspaceWallpaper", () => {
  it("defaults missing wallpaper to off until the user opts in", () => {
    expect(sanitizeWorkspaceWallpaper(undefined)).toEqual(
      DEFAULT_WORKSPACE_WALLPAPER,
    );
    expect(sanitizeWorkspaceWallpaper(null)).toEqual(
      DEFAULT_WORKSPACE_WALLPAPER,
    );
  });

  it("keeps none and fluid modes and retains a valid custom path", () => {
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "none",
        customImagePath: "/Users/me/Wall.png",
      }),
    ).toEqual({
      ...DEFAULT_WORKSPACE_WALLPAPER,
      mode: "none",
      customImagePath: "/Users/me/Wall.png",
    });
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: "C:\\Pictures\\bg.webp",
        fluidPreset: "orchid",
      }),
    ).toEqual({
      ...DEFAULT_WORKSPACE_WALLPAPER,
      mode: "fluid",
      customImagePath: "C:\\Pictures\\bg.webp",
      fluidPreset: "orchid",
    });
  });

  it("keeps a valid motion and falls unknown motion back to drift", () => {
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: null,
        fluidPreset: "ash",
        fluidMotion: "tornado",
      }),
    ).toEqual({
      mode: "fluid",
      customImagePath: null,
      fluidPreset: "ash",
      fluidMotion: "tornado",
      veilOpacity: 12,
      library: [],
      selectedLibraryId: null,
      wallpaperBlur: 0,
      wallpaperDarken: 0,
      playbackRate: 1,
      flip: false,
      objectFit: "cover",
      paused: false,
      rotationEnabled: false,
      rotationIntervalMinutes: 30,
    });
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: null,
        fluidPreset: "ash",
        fluidMotion: "chase",
      }).fluidMotion,
    ).toBe("chase");
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: null,
        fluidPreset: "mist",
        fluidMotion: "typhoon" as never,
      }).fluidMotion,
    ).toBe("drift");
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: null,
        fluidPreset: "nope" as never,
        fluidMotion: "storm",
      }),
    ).toEqual({
      mode: "fluid",
      customImagePath: null,
      fluidPreset: "mist",
      fluidMotion: "storm",
      veilOpacity: 12,
      library: [],
      selectedLibraryId: null,
      wallpaperBlur: 0,
      wallpaperDarken: 0,
      playbackRate: 1,
      flip: false,
      objectFit: "cover",
      paused: false,
      rotationEnabled: false,
      rotationIntervalMinutes: 30,
    });
  });

  it("keeps custom mode when the path is empty and drops illegal paths", () => {
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "custom",
        customImagePath: null,
      }),
    ).toEqual({
      mode: "custom",
      customImagePath: null,
      fluidPreset: "mist",
      fluidMotion: "drift",
      veilOpacity: 12,
      library: [],
      selectedLibraryId: null,
      wallpaperBlur: 0,
      wallpaperDarken: 0,
      playbackRate: 1,
      flip: false,
      objectFit: "cover",
      paused: false,
      rotationEnabled: false,
      rotationIntervalMinutes: 30,
    });
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "custom",
        customImagePath: "  ",
      }),
    ).toEqual({
      ...DEFAULT_WORKSPACE_WALLPAPER,
      mode: "custom",
    });
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "custom",
        customImagePath: "/tmp/notes.txt",
      }),
    ).toEqual({
      ...DEFAULT_WORKSPACE_WALLPAPER,
      mode: "custom",
    });
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "custom",
        customImagePath: "https://example.com/bg.png",
      }),
    ).toEqual({
      ...DEFAULT_WORKSPACE_WALLPAPER,
      mode: "custom",
    });
  });

  it("rejects remote urls and unknown extensions for custom paths", () => {
    expect(sanitizeCustomWallpaperPath("asset://localhost/x.png")).toBeNull();
    expect(sanitizeCustomWallpaperPath("/tmp/photo.heic")).toBeNull();
    expect(sanitizeCustomWallpaperPath("/tmp/photo.jpeg")).toBe(
      "/tmp/photo.jpeg",
    );
  });

  it("resolves persisted fluid and custom modes without a platform gate", () => {
    expect(
      resolveWorkspaceWallpaperMode({
        mode: "fluid",
        customImagePath: null,
        fluidPreset: "mist",
        veilOpacity: 12,
      }),
    ).toBe("fluid");
    expect(
      resolveWorkspaceWallpaperMode({
        mode: "custom",
        customImagePath: "/tmp/wall.png",
        fluidPreset: "mist",
        veilOpacity: 12,
      }),
    ).toBe("custom");
    expect(
      resolveWorkspaceWallpaperMode({
        mode: "custom",
        customImagePath: null,
        fluidPreset: "mist",
        veilOpacity: 12,
      }),
    ).toBe("fluid");
    expect(
      resolveWorkspaceWallpaperMode({
        mode: "none",
        customImagePath: null,
        fluidPreset: "mist",
        veilOpacity: 12,
      }),
    ).toBe("none");
  });

  it("keeps a video library item and falls hidden selection back to the first visible", () => {
    const sanitized = sanitizeWorkspaceWallpaper({
      mode: "custom",
      customImagePath: null,
      library: [
        {
          id: "hidden-one",
          kind: "image",
          path: "/tmp/one.png",
          hidden: true,
        },
        {
          id: "video-two",
          kind: "video",
          path: "/tmp/loop.mp4",
          sourcePath: "/Users/me/loop.mp4",
        },
        {
          id: "bad",
          kind: "image",
          path: "/tmp/notes.txt",
        },
      ],
      selectedLibraryId: "hidden-one",
      wallpaperBlur: 80,
      wallpaperDarken: -2,
      playbackRate: 1.5,
      flip: true,
      objectFit: "contain",
      rotationIntervalMinutes: 15,
    });
    expect(sanitized.library).toEqual([
      {
        id: "hidden-one",
        kind: "image",
        path: "/tmp/one.png",
        sourcePath: null,
        hidden: true,
      },
      {
        id: "video-two",
        kind: "video",
        path: "/tmp/loop.mp4",
        sourcePath: "/Users/me/loop.mp4",
        hidden: false,
      },
    ]);
    expect(sanitized.selectedLibraryId).toBe("video-two");
    expect(sanitized.wallpaperBlur).toBe(40);
    expect(sanitized.wallpaperDarken).toBe(0);
    expect(sanitized.playbackRate).toBe(1.5);
    expect(sanitized.flip).toBe(true);
    expect(sanitized.objectFit).toBe("contain");
    expect(resolveWorkspaceWallpaperMedia(sanitized)).toEqual({
      kind: "video",
      path: "/tmp/loop.mp4",
      libraryId: "video-two",
    });
  });

  it("reuses an existing library item when the same source path is imported again", () => {
    const duplicate = findDuplicateWallpaperLibraryItem(
      [
        {
          id: "keep",
          kind: "image",
          path: "/Users/me/.ccgui/wallpapers/keep.png",
          sourcePath: "C:\\Pictures\\Wall.PNG",
        },
      ],
      "c:/pictures/wall.png",
    );
    expect(duplicate?.id).toBe("keep");
  });

  it("reuses a downloaded market wallpaper by Wallhaven page URL", () => {
    const duplicate = findDuplicateWallpaperLibraryItem(
      [
        {
          id: "from-market",
          kind: "image",
          path: "/Users/me/.ccgui/wallpapers/from-market.jpg",
          sourcePath: "https://wallhaven.cc/w/abc123",
        },
      ],
      "HTTPS://Wallhaven.cc/w/abc123",
    );
    expect(duplicate?.id).toBe("from-market");
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "custom",
        customImagePath: null,
        library: [
          {
            id: "from-market",
            kind: "image",
            path: "/Users/me/.ccgui/wallpapers/from-market.jpg",
            sourcePath: "https://wallhaven.cc/w/abc123",
          },
        ],
        selectedLibraryId: "from-market",
      }).library?.[0]?.sourcePath,
    ).toBe("https://wallhaven.cc/w/abc123");
  });

  it("clamps frost blur to the readable chrome range", () => {
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: null,
        veilOpacity: 16,
      }).veilOpacity,
    ).toBe(16);
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: null,
        veilOpacity: -4,
      }).veilOpacity,
    ).toBe(0);
    expect(
      sanitizeWorkspaceWallpaper({
        mode: "fluid",
        customImagePath: null,
        veilOpacity: 48,
      }).veilOpacity,
    ).toBe(20);
  });
});
