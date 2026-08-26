import { useMemo, useSyncExternalStore } from "react";
import {
  getBackgroundTaskStoreVersion,
  listBackgroundTasks,
  subscribeBackgroundTaskStore,
  type BackgroundTaskLiveRecord,
} from "../../../messages/utils/backgroundTaskStore";

export type BackgroundTaskPillScope = {
  workspaceId: string | null;
  threadId: string | null;
};

export type BackgroundTaskPillModel = {
  tasks: BackgroundTaskLiveRecord[];
  runningCount: number;
  completedCount: number;
  totalCount: number;
  hasAny: boolean;
  anyRunning: boolean;
  allDone: boolean;
};

const EMPTY_MODEL: BackgroundTaskPillModel = {
  tasks: [],
  runningCount: 0,
  completedCount: 0,
  totalCount: 0,
  hasAny: false,
  anyRunning: false,
  allDone: false,
};

function isTerminalStatus(status: unknown): boolean {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  return value === "completed" || value === "failed" || value === "killed";
}

/**
 * 3.1 「后台任务」pill 数据源（design §A3）：会话级 backgroundTask 状态表，
 * useSyncExternalStore 事件驱动读副本（store 版本号 snapshot，列表派生走
 * useMemo），无轮询、不挂根 hook 链（Render Perf 红线）。非 pi 会话 /
 * 无任务时 hasAny=false，pill 不占位。
 */
export function useBackgroundTaskPill(
  scope: BackgroundTaskPillScope,
): BackgroundTaskPillModel {
  const version = useSyncExternalStore(
    subscribeBackgroundTaskStore,
    getBackgroundTaskStoreVersion,
  );
  const workspaceId = scope.workspaceId;
  const threadId = scope.threadId;
  return useMemo(() => {
    if (!workspaceId || !threadId) return EMPTY_MODEL;
    const tasks = listBackgroundTasks(workspaceId, threadId);
    if (tasks.length === 0) return EMPTY_MODEL;
    const runningCount = tasks.filter(
      (record) => !isTerminalStatus(record.task.status),
    ).length;
    return {
      tasks,
      runningCount,
      completedCount: tasks.length - runningCount,
      totalCount: tasks.length,
      hasAny: true,
      anyRunning: runningCount > 0,
      allDone: runningCount === 0,
    };
    // SAFETY: version 是 store 写入序号（intentional cache-buster，不是读值）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, workspaceId, threadId]);
}
