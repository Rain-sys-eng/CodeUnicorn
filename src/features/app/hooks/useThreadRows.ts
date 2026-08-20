import { useCallback } from "react";

import { DEFAULT_VISIBLE_THREAD_ROOT_COUNT } from "../constants";
import type { ThreadSummary } from "../../../types";
import { collectSharedHideIdentityKeys } from "../../shared-session/runtime/sharedHideIdentity";
import {
  buildSharedSidebarHiddenParentKeys,
  isSharedSidebarHiddenPup,
} from "../../shared-session/runtime/sharedSessionSummaries";
import { lastVerifiedSharedHide } from "../../threads/hooks/sharedNativeVisibility";
import { compareThreadSummariesByCreatedAtDesc } from "../../threads/utils/threadSummarySort";

type ThreadRow = {
  thread: ThreadSummary;
  depth: number;
  hasChildren?: boolean;
};

type ThreadRowResult = {
  pinnedRows: ThreadRow[];
  unpinnedRows: ThreadRow[];
  totalRoots: number;
  hasMoreRoots: boolean;
};

function isNativeCodexThread(thread: ThreadSummary): boolean {
  return String(thread.engineSource ?? "").trim().toLowerCase() === "codex";
}

function rememberIdentityKeys(
  byIdentity: Map<string, string>,
  threadId: string,
): void {
  for (const key of collectSharedHideIdentityKeys(threadId)) {
    if (!byIdentity.has(key)) {
      byIdentity.set(key, threadId);
    }
  }
}

function resolveVisibleParentThreadId(
  parentId: string | null | undefined,
  threadId: string,
  byIdentity: Map<string, string>,
): string | null {
  const parent = parentId?.trim();
  if (!parent || parent === threadId) {
    return null;
  }
  if (byIdentity.get(parent) === threadId) {
    return null;
  }
  for (const key of collectSharedHideIdentityKeys(parent)) {
    const visibleId = byIdentity.get(key);
    if (visibleId && visibleId !== threadId) {
      return visibleId;
    }
  }
  return null;
}

/**
 * 侧栏会话树。
 * Shared 下崽：parent 指向 shared: / Shared hidden native owner 时不进入侧栏树
 * （不进 roots、不进 children）。threads store 仍可保留这些行供幕布/Strip。
 * Codex native 崽：parent 用 uuid / rollout stem / engine 前缀互认；父会话不在
 * 当前页则丢弃，禁止升成顶层。
 */
export function useThreadRows(threadParentById: Record<string, string>) {
  const getThreadRows = useCallback(
    (
      threads: ThreadSummary[],
      isExpanded: boolean,
      workspaceId: string,
      getPinTimestamp: (workspaceId: string, threadId: string) => number | null,
      visibleThreadRootCount = DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
    ): ThreadRowResult => {
      const byIdentity = new Map<string, string>();
      threads.forEach((thread) => {
        rememberIdentityKeys(byIdentity, thread.id);
      });
      const sharedHiddenParentKeys = buildSharedSidebarHiddenParentKeys(
        threads,
        lastVerifiedSharedHide(workspaceId),
      );
      const childrenByParent = new Map<string, ThreadSummary[]>();
      const roots: ThreadSummary[] = [];

      threads.forEach((thread) => {
        const parentId = thread.parentThreadId ?? threadParentById[thread.id];
        // Shared 下崽：侧栏精准隐藏（不扩散到 setThreads / 幕布数据源）
        if (isSharedSidebarHiddenPup(thread, parentId, sharedHiddenParentKeys)) {
          return;
        }
        const visibleParentId = resolveVisibleParentThreadId(
          parentId,
          thread.id,
          byIdentity,
        );
        if (visibleParentId) {
          const list = childrenByParent.get(visibleParentId) ?? [];
          list.push(thread);
          childrenByParent.set(visibleParentId, list);
          return;
        }
        if (parentId && isNativeCodexThread(thread)) {
          // 父会话被首页截断或不在当前 workspace 页：Codex 崽不得升成 root。
          return;
        }
        roots.push(thread);
      });

      childrenByParent.forEach((children) => {
        children.sort(compareThreadSummariesByCreatedAtDesc);
      });
      roots.sort(compareThreadSummariesByCreatedAtDesc);

      const pinnedRoots: ThreadSummary[] = [];
      const unpinnedRoots: ThreadSummary[] = [];

      roots.forEach((thread) => {
        const pinTime = getPinTimestamp(workspaceId, thread.id);
        if (pinTime !== null) {
          pinnedRoots.push(thread);
        } else {
          unpinnedRoots.push(thread);
        }
      });

      pinnedRoots.sort((a, b) => {
        const aTime = getPinTimestamp(workspaceId, a.id) ?? 0;
        const bTime = getPinTimestamp(workspaceId, b.id) ?? 0;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return compareThreadSummariesByCreatedAtDesc(a, b);
      });

      const visibleRootCount = isExpanded
        ? unpinnedRoots.length
        : visibleThreadRootCount;
      const visibleRoots = unpinnedRoots.slice(0, visibleRootCount);

      const appendThread = (
        thread: ThreadSummary,
        depth: number,
        rows: ThreadRow[],
      ) => {
        const children = childrenByParent.get(thread.id) ?? [];
        rows.push({ thread, depth, hasChildren: children.length > 0 });
        children.forEach((child) => appendThread(child, depth + 1, rows));
      };

      const pinnedRows: ThreadRow[] = [];
      pinnedRoots.forEach((thread) => appendThread(thread, 0, pinnedRows));

      const unpinnedRows: ThreadRow[] = [];
      visibleRoots.forEach((thread) => appendThread(thread, 0, unpinnedRows));

      return {
        pinnedRows,
        unpinnedRows,
        totalRoots: unpinnedRoots.length,
        hasMoreRoots: unpinnedRoots.length > visibleRootCount,
      };
    },
    [threadParentById],
  );

  return { getThreadRows };
}
