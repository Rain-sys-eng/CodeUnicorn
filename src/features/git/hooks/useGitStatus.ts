import { useCallback, useEffect, useRef, useState } from "react";
import type { GitFileStatus, WorkspaceInfo } from "../../../types";
import { getGitStatus } from "../../../services/tauri";

type GitStatusState = {
  isGitRepository: boolean;
  branchName: string;
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalAdditions: number;
  totalDeletions: number;
  error: string | null;
};

const emptyStatus: GitStatusState = {
  isGitRepository: true,
  branchName: "",
  files: [],
  stagedFiles: [],
  unstagedFiles: [],
  totalAdditions: 0,
  totalDeletions: 0,
  error: null,
};

// 渲染红线（AGENTS.md Render Perf Baseline）：常驻兜底轮询 ≥30s。
// 长间隔的陈旧感由「窗口回到可见时立即补一拍」补偿（见下方 visibilitychange）。
const REFRESH_INTERVAL_MS = 30_000;
const HEAVY_CHANGESET_FILE_THRESHOLD = 120;
const HEAVY_CHANGESET_REFRESH_INTERVAL_MS = 45_000;
const BACKGROUND_REFRESH_INTERVAL_MS = 60_000;
const HEAVY_CHANGESET_BACKGROUND_REFRESH_INTERVAL_MS = 90_000;

export type GitStatusPollingMode = "active" | "background" | "paused";

type UseGitStatusOptions = {
  pollingEnabled?: boolean;
  pollingMode?: GitStatusPollingMode;
};

function areGitFileStatusesEqual(
  left: GitFileStatus[],
  right: GitFileStatus[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((leftFile, index) => {
    const rightFile = right[index];
    return (
      rightFile !== undefined &&
      leftFile.path === rightFile.path &&
      leftFile.oldPath === rightFile.oldPath &&
      leftFile.status === rightFile.status &&
      leftFile.additions === rightFile.additions &&
      leftFile.deletions === rightFile.deletions &&
      leftFile.isDiffOnlyFallback === rightFile.isDiffOnlyFallback &&
      leftFile.mutationDisabled === rightFile.mutationDisabled
    );
  });
}

function areGitStatusesEqual(left: GitStatusState, right: GitStatusState): boolean {
  return (
    left.isGitRepository === right.isGitRepository &&
    left.branchName === right.branchName &&
    left.totalAdditions === right.totalAdditions &&
    left.totalDeletions === right.totalDeletions &&
    left.error === right.error &&
    areGitFileStatusesEqual(left.files, right.files) &&
    areGitFileStatusesEqual(left.stagedFiles, right.stagedFiles) &&
    areGitFileStatusesEqual(left.unstagedFiles, right.unstagedFiles)
  );
}

export function useGitStatus(
  activeWorkspace: WorkspaceInfo | null,
  options?: UseGitStatusOptions,
) {
  const pollingMode: GitStatusPollingMode =
    options?.pollingMode ??
    (options?.pollingEnabled === false ? "paused" : "active");
  const [status, setStatus] = useState<GitStatusState>(emptyStatus);
  const requestIdRef = useRef(0);
  const workspaceIdRef = useRef<string | null>(activeWorkspace?.id ?? null);
  const cachedStatusRef = useRef<Map<string, GitStatusState>>(new Map());
  const statusRef = useRef<GitStatusState>(emptyStatus);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const inFlightRequestIdRef = useRef<number | null>(null);
  const workspaceId = activeWorkspace?.id ?? null;
  const autoPollingAllowed = status.isGitRepository;

  const resolveBranchName = useCallback(
    (incoming: string | undefined, cached: GitStatusState | undefined) => {
      const trimmed = incoming?.trim();
      if (trimmed && trimmed !== "unknown") {
        return trimmed;
      }
      const cachedBranch = cached?.branchName?.trim();
      return cachedBranch && cachedBranch !== "unknown"
        ? cachedBranch
        : trimmed ?? "";
    },
    [],
  );

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const resolveNextRefreshInterval = useCallback(() => {
    const changedFileCount = statusRef.current.files.length;
    if (pollingMode === "background") {
      if (changedFileCount >= HEAVY_CHANGESET_FILE_THRESHOLD) {
        return HEAVY_CHANGESET_BACKGROUND_REFRESH_INTERVAL_MS;
      }
      return BACKGROUND_REFRESH_INTERVAL_MS;
    }
    if (changedFileCount >= HEAVY_CHANGESET_FILE_THRESHOLD) {
      return HEAVY_CHANGESET_REFRESH_INTERVAL_MS;
    }
    return REFRESH_INTERVAL_MS;
  }, [pollingMode]);

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setStatus(emptyStatus);
      return Promise.resolve();
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const currentRequestId = requestId;
    const inFlight = (async () => {
      try {
        const data = await getGitStatus(workspaceId);
        if (
          requestIdRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId
        ) {
          return;
        }
        const cached = cachedStatusRef.current.get(workspaceId);
        const isGitRepository = data.isGitRepository ?? true;
        const resolvedBranchName = isGitRepository
          ? resolveBranchName(data.branchName, cached)
          : "";
        const freshStatus = {
          ...data,
          isGitRepository,
          branchName: resolvedBranchName,
          error: isGitRepository ? null : "not a git repository",
        };
        // Reuse the cached object (stable identity) when the poll changed nothing,
        // so identity-keyed downstream memos don't re-run every 15s.
        setStatus((currentStatus) => {
          if (areGitStatusesEqual(currentStatus, freshStatus)) {
            cachedStatusRef.current.set(workspaceId, currentStatus);
            return currentStatus;
          }
          cachedStatusRef.current.set(workspaceId, freshStatus);
          return freshStatus;
        });
      } catch (err) {
        console.error("Failed to load git status", err);
        if (
          requestIdRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const cached = cachedStatusRef.current.get(workspaceId);
        const nextStatus = cached
          ? { ...cached, error: message }
          : { ...emptyStatus, error: message };
        setStatus((currentStatus) =>
          areGitStatusesEqual(currentStatus, nextStatus)
            ? currentStatus
            : nextStatus,
        );
      } finally {
        if (inFlightRequestIdRef.current === currentRequestId) {
          inFlightRef.current = null;
          inFlightRequestIdRef.current = null;
        }
      }
    })();
    inFlightRequestIdRef.current = currentRequestId;
    inFlightRef.current = inFlight;
    return inFlight;
  }, [resolveBranchName, workspaceId]);

  useEffect(() => {
    if (workspaceIdRef.current !== workspaceId) {
      workspaceIdRef.current = workspaceId;
      requestIdRef.current += 1;
      inFlightRef.current = null;
      inFlightRequestIdRef.current = null;
      if (!workspaceId) {
        setStatus(emptyStatus);
        return;
      }
      const cached = cachedStatusRef.current.get(workspaceId);
      setStatus(cached ?? emptyStatus);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setStatus(emptyStatus);
      return;
    }
    if (pollingMode === "paused") {
      return;
    }
    if (!autoPollingAllowed) {
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    const runAndSchedule = () => {
      if (cancelled) {
        return;
      }
      // 窗口隐藏时跳过本轮 refresh 只重排程（与 useGitRepositories 同一 idiom）：
      // 隐藏期间轮询结果不可见，且 Windows WebView2 后台节流叠加慢 IPC
      // 纯属浪费（Task 5.3）。必须 === "hidden"：jsdom 默认 "prerender"。
      if (document.visibilityState === "hidden") {
        timeoutId = window.setTimeout(() => {
          runAndSchedule();
        }, resolveNextRefreshInterval());
        return;
      }
      refresh()
        .catch(() => {})
        .finally(() => {
          if (cancelled) {
            return;
          }
          const delayMs = resolveNextRefreshInterval();
          timeoutId = window.setTimeout(() => {
            runAndSchedule();
          }, delayMs);
        });
    };
    if (pollingMode === "background") {
      const delayMs = resolveNextRefreshInterval();
      timeoutId = window.setTimeout(() => {
        runAndSchedule();
      }, delayMs);
    } else {
      runAndSchedule();
    }

    // 回到前台立即补一拍（仅 active 面板）：兜底间隔拉长到 30-45s 后，
    // 用户切回窗口不该看到陈旧的 git 状态。refresh 自带 in-flight 去重
    // 与 identity 缓存，未变化时不会触发下游重渲。
    const handleVisibilityChange = () => {
      if (
        cancelled ||
        pollingMode !== "active" ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      window.clearTimeout(timeoutId);
      runAndSchedule();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearTimeout(timeoutId);
    };
  }, [autoPollingAllowed, pollingMode, refresh, resolveNextRefreshInterval, workspaceId]);

  return { status, refresh };
}
