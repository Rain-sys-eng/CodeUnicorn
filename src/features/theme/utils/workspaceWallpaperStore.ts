import type { WorkspaceWallpaperSettings } from "../../../types";
import {
  DEFAULT_WORKSPACE_WALLPAPER,
  sanitizeWorkspaceWallpaper,
  workspaceWallpaperSnapshotKey,
} from "./workspaceWallpaper";

type Listener = () => void;

let snapshot: WorkspaceWallpaperSettings = { ...DEFAULT_WORKSPACE_WALLPAPER };
let seeded = false;
const listeners = new Set<Listener>();

export function getWorkspaceWallpaperSnapshot(): WorkspaceWallpaperSettings {
  return snapshot;
}

export function isWorkspaceWallpaperSeeded(): boolean {
  return seeded;
}

export function seedWorkspaceWallpaper(
  value: WorkspaceWallpaperSettings | null | undefined,
): WorkspaceWallpaperSettings {
  if (seeded) {
    return snapshot;
  }
  return publishWorkspaceWallpaper(value);
}

export function publishWorkspaceWallpaper(
  value: WorkspaceWallpaperSettings | null | undefined,
): WorkspaceWallpaperSettings {
  // Any publish counts as hydration, even a no-op one: callers only publish
  // from a real settings load/save, so later seeds must not overwrite it.
  seeded = true;
  const next = sanitizeWorkspaceWallpaper(value);
  if (workspaceWallpaperSnapshotKey(snapshot) === workspaceWallpaperSnapshotKey(next)) {
    return snapshot;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function subscribeWorkspaceWallpaper(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetWorkspaceWallpaperStoreForTests(): void {
  snapshot = { ...DEFAULT_WORKSPACE_WALLPAPER };
  seeded = false;
  listeners.clear();
}
