import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  readWorkspaceWallpaperBytes,
  readWorkspaceWallpaperPreview,
} from "../../../services/tauri";
import {
  createOwnedObjectUrl,
  revokeOwnedObjectUrl,
} from "../../../services/mediaResourceOwners";
import type { WorkspaceWallpaperLibraryKind } from "../../../types";
import { fileExtension } from "./workspaceWallpaper";

export function toWallpaperAssetUrl(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

function wallpaperMediaMime(
  path: string,
  kind: WorkspaceWallpaperLibraryKind,
): string {
  if (kind === "video") {
    return "video/mp4";
  }
  switch (fileExtension(path)) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

function isOwnedBlobUrl(value: string): boolean {
  return value.startsWith("blob:");
}

export function useManagedWallpaperSrc(
  path: string,
  kind: WorkspaceWallpaperLibraryKind = "image",
): {
  src: string;
  failed: boolean;
  handleError: () => void;
} {
  const [src, setSrc] = useState(() => toWallpaperAssetUrl(path));
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const recoveringRef = useRef(false);

  const replaceSrc = useCallback((next: string) => {
    setSrc((current) => {
      if (current === next) {
        return current;
      }
      if (isOwnedBlobUrl(current)) {
        revokeOwnedObjectUrl(current);
        if (blobUrlRef.current === current) {
          blobUrlRef.current = null;
        }
      }
      if (isOwnedBlobUrl(next)) {
        blobUrlRef.current = next;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    recoveringRef.current = false;
    replaceSrc(toWallpaperAssetUrl(path));
    setFailed(false);
  }, [path, replaceSrc]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        revokeOwnedObjectUrl(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const handleError = useCallback(() => {
    if (!path || failed) {
      setFailed(true);
      return;
    }
    // WKWebView / asset:// often cannot stream MP4 (no Range). Read the
    // managed copy over IPC and play a blob: URL instead of falling back
    // to the fluid wallpaper.
    if (kind === "video") {
      if (isOwnedBlobUrl(src) || recoveringRef.current) {
        if (isOwnedBlobUrl(src)) {
          setFailed(true);
        }
        return;
      }
      recoveringRef.current = true;
      void readWorkspaceWallpaperBytes(path)
        .then((bytes) => {
          const copy = Uint8Array.from(bytes);
          const blob = new Blob([copy], {
            type: wallpaperMediaMime(path, kind),
          });
          replaceSrc(
            createOwnedObjectUrl(blob, {
              ownerId: "workspace-wallpaper-video",
              byteSize: bytes.byteLength,
            }),
          );
        })
        .catch(() => {
          setFailed(true);
        })
        .finally(() => {
          recoveringRef.current = false;
        });
      return;
    }
    void readWorkspaceWallpaperPreview(path)
      .then((dataUrl) => {
        if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
          replaceSrc(dataUrl);
          return;
        }
        setFailed(true);
      })
      .catch(() => {
        setFailed(true);
      });
  }, [failed, kind, path, replaceSrc, src]);

  return { src, failed, handleError };
}
