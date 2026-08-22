import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getAppSettings, updateAppSettings } from "../../../services/tauri";
import { isWindowsPlatform } from "../../../utils/platform";
import { FirstRunFluidBackdrop } from "../../onboarding/components/FirstRunFluidBackdrop";
import {
  DEFAULT_WORKSPACE_FLUID_MOTION,
  DEFAULT_WORKSPACE_FLUID_PRESET,
} from "../../onboarding/utils/fluidTones";
import {
  DEFAULT_WORKSPACE_WALLPAPER_OBJECT_FIT,
  DEFAULT_WORKSPACE_WALLPAPER_PLAYBACK_RATE,
  WORKSPACE_FLUID_SPEED,
  resolveSelectedLibraryId,
  resolveWorkspaceWallpaperMedia,
  resolveWorkspaceWallpaperMode,
  sanitizeWorkspaceWallpaperBlur,
  sanitizeWorkspaceWallpaperDarken,
  sanitizeWorkspaceWallpaperVeilOpacity,
  visibleWallpaperLibraryItems,
} from "../utils/workspaceWallpaper";
import { useManagedWallpaperSrc } from "../utils/useManagedWallpaperSrc";
import {
  getWorkspaceWallpaperSnapshot,
  isWorkspaceWallpaperSeeded,
  publishWorkspaceWallpaper,
  seedWorkspaceWallpaper,
  subscribeWorkspaceWallpaper,
} from "../utils/workspaceWallpaperStore";

function cssObjectFit(value: string | undefined): string {
  if (value === "contain" || value === "fill") {
    return value;
  }
  if (value === "center") {
    return "none";
  }
  return DEFAULT_WORKSPACE_WALLPAPER_OBJECT_FIT;
}

export function WorkspaceWallpaperHost() {
  const wallpaper = useSyncExternalStore(
    subscribeWorkspaceWallpaper,
    getWorkspaceWallpaperSnapshot,
  );
  const [hydrated, setHydrated] = useState(false);
  const [fluidAttached, setFluidAttached] = useState(false);
  const [compatPaused, setCompatPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const windowsFluidCompat = isWindowsPlatform();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    // useAppSettings publishes the wallpaper snapshot when it finishes loading
    // settings; if that already happened, skip the duplicate IPC entirely.
    const alreadySeeded = isWorkspaceWallpaperSeeded();
    if (alreadySeeded) {
      setHydrated(true);
    }
    let active = true;
    void getAppSettings()
      .then((settings) => {
        if (!active) {
          return;
        }
        if (!alreadySeeded) {
          seedWorkspaceWallpaper(settings.workspaceWallpaper);
        }
        setCompatPaused(settings.performanceCompatibilityModeEnabled === true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setHydrated(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  const requestedMode = resolveWorkspaceWallpaperMode(wallpaper);
  const media = resolveWorkspaceWallpaperMedia(wallpaper);
  const preview = useManagedWallpaperSrc(
    media?.path ?? "",
    media?.kind ?? "image",
  );
  const mode =
    requestedMode === "custom" && (preview.failed || !media) ? "fluid" : requestedMode;
  const customSrc = mode === "custom" && media ? preview.src : "";
  const isVideo = mode === "custom" && media?.kind === "video";
  const holdVideoStill = wallpaper.paused === true || compatPaused || reducedMotion;

  const wallpaperActive =
    mode === "custom" ||
    (mode === "fluid" && (!windowsFluidCompat || fluidAttached));
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    const root = document.documentElement;
    if (!wallpaperActive) {
      delete root.dataset.workspaceWallpaper;
      return undefined;
    }
    root.dataset.workspaceWallpaper = mode;
    return () => {
      delete root.dataset.workspaceWallpaper;
    };
  }, [mode, wallpaperActive]);

  useEffect(() => {
    if (typeof document === "undefined" || mode === "none") {
      return undefined;
    }
    const root = document.documentElement;
    root.style.setProperty(
      "--workspace-wallpaper-frost",
      `${sanitizeWorkspaceWallpaperVeilOpacity(wallpaper.veilOpacity)}px`,
    );
    root.style.setProperty(
      "--workspace-wallpaper-media-blur",
      `${sanitizeWorkspaceWallpaperBlur(wallpaper.wallpaperBlur)}px`,
    );
    root.style.setProperty(
      "--workspace-wallpaper-darken",
      `${sanitizeWorkspaceWallpaperDarken(wallpaper.wallpaperDarken)}%`,
    );
    root.style.setProperty(
      "--workspace-wallpaper-object-fit",
      cssObjectFit(wallpaper.objectFit),
    );
    root.style.setProperty(
      "--workspace-wallpaper-object-position",
      wallpaper.objectFit === "center" ? "center" : "center",
    );
    root.style.setProperty(
      "--workspace-wallpaper-flip",
      wallpaper.flip ? "scaleX(-1)" : "none",
    );
    return () => {
      root.style.removeProperty("--workspace-wallpaper-frost");
      root.style.removeProperty("--workspace-wallpaper-media-blur");
      root.style.removeProperty("--workspace-wallpaper-darken");
      root.style.removeProperty("--workspace-wallpaper-object-fit");
      root.style.removeProperty("--workspace-wallpaper-object-position");
      root.style.removeProperty("--workspace-wallpaper-flip");
    };
  }, [
    mode,
    wallpaper.veilOpacity,
    wallpaper.wallpaperBlur,
    wallpaper.wallpaperDarken,
    wallpaper.objectFit,
    wallpaper.flip,
  ]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) {
      return;
    }
    node.muted = true;
    node.playbackRate =
      wallpaper.playbackRate ?? DEFAULT_WORKSPACE_WALLPAPER_PLAYBACK_RATE;
    if (holdVideoStill) {
      node.pause();
      return;
    }
    const playResult = node.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => undefined);
    }
  }, [
    customSrc,
    holdVideoStill,
    isVideo,
    wallpaper.playbackRate,
    wallpaper.paused,
  ]);

  const visibleLibrary = useMemo(
    () => visibleWallpaperLibraryItems(wallpaper.library ?? []),
    [wallpaper.library],
  );
  const visibleLibraryIds = visibleLibrary.map((item) => item.id).join("|");
  const rotationEnabled =
    mode === "custom" &&
    wallpaper.rotationEnabled === true &&
    visibleLibrary.length >= 2;

  useEffect(() => {
    if (!rotationEnabled) {
      return undefined;
    }
    const intervalMs =
      Math.max(1, wallpaper.rotationIntervalMinutes ?? 30) * 60 * 1000;
    const timer = window.setTimeout(() => {
      const current = getWorkspaceWallpaperSnapshot();
      const items = visibleWallpaperLibraryItems(current.library ?? []);
      const currentId = resolveSelectedLibraryId(
        items,
        current.selectedLibraryId,
      );
      const index = items.findIndex((item) => item.id === currentId);
      const next = items[(index + 1) % items.length];
      if (!next || next.id === currentId) {
        return;
      }
      const nextWallpaper = {
        ...current,
        selectedLibraryId: next.id,
      };
      publishWorkspaceWallpaper(nextWallpaper);
      void getAppSettings()
        .then((settings) =>
          updateAppSettings({
            ...settings,
            workspaceWallpaper: nextWallpaper,
          }),
        )
        .catch(() => undefined);
    }, intervalMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    rotationEnabled,
    visibleLibraryIds,
    wallpaper.selectedLibraryId,
    wallpaper.rotationIntervalMinutes,
  ]);

  if (!hydrated || mode === "none") {
    return null;
  }

  return (
    <div
      className="workspace-wallpaper"
      aria-hidden
      data-testid="workspace-wallpaper"
      data-mode={mode}
      data-media-kind={isVideo ? "video" : mode === "custom" ? "image" : "fluid"}
      data-media-blur={
        sanitizeWorkspaceWallpaperBlur(wallpaper.wallpaperBlur) > 0
          ? "true"
          : undefined
      }
    >
      {mode === "fluid" ? (
        <FirstRunFluidBackdrop
          profile={windowsFluidCompat ? "lite" : "full"}
          presetId={wallpaper.fluidPreset ?? DEFAULT_WORKSPACE_FLUID_PRESET}
          motionId={wallpaper.fluidMotion ?? DEFAULT_WORKSPACE_FLUID_MOTION}
          speed={WORKSPACE_FLUID_SPEED}
          forceAnimate={windowsFluidCompat}
          deferChase={windowsFluidCompat}
          onAttachChange={
            windowsFluidCompat ? setFluidAttached : undefined
          }
        />
      ) : null}
      {mode === "custom" && customSrc && isVideo ? (
        <video
          key={customSrc}
          ref={videoRef}
          className="workspace-wallpaper-media workspace-wallpaper-video"
          src={customSrc}
          muted
          loop
          playsInline
          preload="auto"
          autoPlay={!holdVideoStill}
          onError={preview.handleError}
        />
      ) : null}
      {mode === "custom" && customSrc && !isVideo ? (
        <img
          className="workspace-wallpaper-media workspace-wallpaper-image"
          src={customSrc}
          alt=""
          decoding="async"
          onError={preview.handleError}
        />
      ) : null}
    </div>
  );
}
