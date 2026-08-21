import type { ThreadSummary } from "../../../types";
import { normalizeRootPath } from "../utils/threadNormalize";

export function normalizeComparableWorkspacePath(path: string): string {
  return normalizeWindowsPathForComparison(normalizeRootPath(stripFileUri(path)).trim());
}

function normalizeWindowsPathForComparison(path: string): string {
  if (!path) {
    return path;
  }
  if (path.startsWith("//?/UNC/")) {
    return `//${path.slice("//?/UNC/".length)}`;
  }
  if (path.startsWith("//?/")) {
    return path.slice("//?/".length);
  }
  return path;
}

function stripFileUri(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.toLowerCase().startsWith("file://")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const pathname = decodeURIComponent(url.pathname || "");
    if (!pathname) {
      return trimmed;
    }
    const host = decodeURIComponent(url.hostname || "");
    const lowerHost = host.toLowerCase();
    if (/^[A-Za-z]$/.test(host) && pathname.startsWith("/")) {
      return `${host.toUpperCase()}:${pathname}`;
    }
    if (lowerHost === "localhost") {
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        return pathname.slice(1);
      }
      return pathname;
    }
    if (host) {
      return `//${host}${pathname}`;
    }
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return trimmed;
  }
}

function addMacVolumeDataVariants(path: string, variants: Set<string>) {
  if (path.startsWith("/System/Volumes/Data/")) {
    variants.add(path.slice("/System/Volumes/Data".length));
    return;
  }
  if (path.startsWith("/")) {
    variants.add(`/System/Volumes/Data${path}`);
  }
}

function addWindowsDriveShellVariants(path: string, variants: Set<string>) {
  const winDriveMatch = path.match(/^([A-Za-z]):\/(.+)$/);
  if (winDriveMatch) {
    const drive = winDriveMatch[1]?.toLowerCase() ?? "";
    const rest = winDriveMatch[2] ?? "";
    variants.add(`/${drive}/${rest}`);
    variants.add(`/mnt/${drive}/${rest}`);
  }
  const shellDriveMatch = path.match(/^\/(?:(?:mnt)\/)?([A-Za-z])\/(.+)$/);
  if (shellDriveMatch) {
    const drive = shellDriveMatch[1]?.toLowerCase() ?? "";
    const rest = shellDriveMatch[2] ?? "";
    variants.add(`${drive.toUpperCase()}:/${rest}`);
    variants.add(`${drive}:/${rest}`);
  }
}

function buildWorkspacePathVariants(path: string): Set<string> {
  const normalized = normalizeComparableWorkspacePath(path);
  const variants = new Set<string>();
  if (!normalized) {
    return variants;
  }
  variants.add(normalized);
  if (normalized.startsWith("/private/")) {
    variants.add(normalized.slice("/private".length));
  } else if (normalized.startsWith("/")) {
    variants.add(`/private${normalized}`);
  }
  addMacVolumeDataVariants(normalized, variants);
  addWindowsDriveShellVariants(normalized, variants);
  if (/^[A-Za-z]:/.test(normalized)) {
    variants.add(`${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`);
    variants.add(normalized.toLowerCase());
  }
  if (normalized.startsWith("//")) {
    variants.add(normalized.toLowerCase());
  }
  return variants;
}

export function matchesWorkspacePath(threadCwd: string, workspacePath: string): boolean {
  const workspaceVariants = buildWorkspacePathVariants(workspacePath);
  if (workspaceVariants.size === 0) {
    return false;
  }
  const threadVariants = buildWorkspacePathVariants(threadCwd);
  for (const candidate of threadVariants) {
    for (const workspaceCandidate of workspaceVariants) {
      if (candidate === workspaceCandidate) {
        return true;
      }
      if (
        candidate.startsWith(workspaceCandidate) &&
        candidate.charAt(workspaceCandidate.length) === "/"
      ) {
        return true;
      }
    }
  }
  return false;
}

function isLikelyCodexThreadId(threadId: string): boolean {
  const normalized = threadId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !(
    normalized.startsWith("codex-pending-") ||
    normalized.startsWith("claude:") ||
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("grok:") ||
    normalized.startsWith("grok-pending-") ||
    normalized.startsWith("kimi:") ||
    normalized.startsWith("kimi-pending-") ||
    normalized.startsWith("pi:") ||
    normalized.startsWith("pi-pending-") ||
    normalized.startsWith("qoder:") ||
    normalized.startsWith("qoder-pending-") ||
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-") ||
    normalized.startsWith("dsh:") ||
    normalized.startsWith("dsh-pending-")
  );
}

export function collectKnownCodexThreadIds(
  existingThreads: ThreadSummary[],
  activeThreadId: string,
): Set<string> {
  const known = new Set<string>();
  existingThreads.forEach((thread) => {
    if (thread.threadKind !== "shared" && thread.engineSource === "codex" && thread.id) {
      known.add(thread.id);
    }
  });
  if (isLikelyCodexThreadId(activeThreadId)) {
    known.add(activeThreadId);
  }
  return known;
}
