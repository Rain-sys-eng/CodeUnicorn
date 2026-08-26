import { useEffect, useMemo } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";

import type { ThreadSummary } from "../../../types";
import { usePinnedSectionFold } from "../hooks/usePinnedSectionFold";
import type { ThreadMoveFolderTarget } from "../hooks/useSidebarMenus";
import type { ThreadStatusMap } from "./threadRowStatusStore";
import {
  findPinnedCalendarDateForThread,
  groupPinnedRowsByCalendarDay,
  type PinnedThreadCalendarRow,
} from "./pinnedThreadCalendarGroups";
import { ThreadList } from "./ThreadList";

type PinnedThreadListProps = {
  rows: PinnedThreadCalendarRow[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  showProviderLabels?: boolean;
  threadStatusById: ThreadStatusMap;
  moveFolderTargetsByWorkspaceId?: Record<string, ThreadMoveFolderTarget[]>;
  getThreadTime: (thread: ThreadSummary) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  onToggleThreadPin?: (workspaceId: string, threadId: string) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
    sizeBytes?: number,
    moveFolderTargets?: ThreadMoveFolderTarget[],
    currentFolderId?: string | null,
    canArchive?: boolean,
    workspacePath?: string,
  ) => void;
  deleteConfirmThreadId?: string | null;
  deleteConfirmWorkspaceId?: string | null;
  deleteConfirmBusy?: boolean;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
  renameThreadId?: string | null;
  renameWorkspaceId?: string | null;
  renameName?: string;
  onRenameChange?: (value: string) => void;
  onRenameCancel?: () => void;
  onRenameConfirm?: () => void;
  onPinnedThreadRowRender?: (threadId: string) => void;
};

const EMPTY_MOVE_FOLDER_TARGETS_BY_WORKSPACE: Record<
  string,
  ThreadMoveFolderTarget[]
> = {};

export function PinnedThreadList({
  rows,
  activeWorkspaceId,
  activeThreadId,
  systemProxyEnabled = false,
  systemProxyUrl = null,
  showProviderLabels = false,
  threadStatusById,
  moveFolderTargetsByWorkspaceId = EMPTY_MOVE_FOLDER_TARGETS_BY_WORKSPACE,
  getThreadTime,
  isThreadPinned,
  isThreadAutoNaming,
  onToggleThreadPin,
  onSelectThread,
  onShowThreadMenu,
  deleteConfirmThreadId = null,
  deleteConfirmWorkspaceId = null,
  deleteConfirmBusy = false,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
  renameThreadId = null,
  renameWorkspaceId = null,
  renameName = "",
  onRenameChange,
  onRenameCancel,
  onRenameConfirm,
  onPinnedThreadRowRender,
}: PinnedThreadListProps) {
  const { t } = useTranslation();
  const {
    isSectionExpanded,
    isDayExpanded,
    toggleSection,
    toggleDay,
    ensureDayExpanded,
  } = usePinnedSectionFold();
  const dayGroups = useMemo(() => groupPinnedRowsByCalendarDay(rows), [rows]);
  const latestDateKey = dayGroups[0]?.dateKey ?? null;
  const totalRootCount = useMemo(
    () =>
      dayGroups.reduce(
        (sum, dayGroup) =>
          sum +
          dayGroup.workspaceRuns.reduce(
            (runSum, run) => runSum + run.rootCount,
            0,
          ),
        0,
      ),
    [dayGroups],
  );
  const activeDateKey = useMemo(
    () => findPinnedCalendarDateForThread(dayGroups, activeThreadId),
    [activeThreadId, dayGroups],
  );

  useEffect(() => {
    // 总折叠是显式用户状态：段收起时不被 active thread 冲开，
    // 日级 auto-expand 仅在段已展开时生效。
    if (!isSectionExpanded) {
      return;
    }
    if (!activeDateKey) {
      return;
    }
    if (!isDayExpanded(activeDateKey, latestDateKey)) {
      ensureDayExpanded(activeDateKey, latestDateKey);
    }
  }, [
    activeDateKey,
    ensureDayExpanded,
    isDayExpanded,
    isSectionExpanded,
    latestDateKey,
  ]);

  if (dayGroups.length === 0) {
    return null;
  }

  return (
    <div className="sidebar-pinned-list" data-sidebar-pinned-section="">
      <button
        type="button"
        className={`sidebar-section-header sidebar-pinned-section-header${
          isSectionExpanded ? "" : " is-collapsed"
        }`}
        data-sidebar-pinned-section-header=""
        aria-expanded={isSectionExpanded}
        aria-label={
          isSectionExpanded
            ? t("sidebar.collapsePinnedSection")
            : t("sidebar.expandPinnedSection")
        }
        onClick={toggleSection}
      >
        <span className="sidebar-section-title sidebar-pinned-section-label">
          {t("sidebar.pinned")}
          <span className="sidebar-pinned-section-count">
            {t("sidebar.pinnedCount", { count: totalRootCount })}
          </span>
        </span>
        {isSectionExpanded ? (
          <ChevronDown
            size={12}
            className="sidebar-pinned-section-chevron"
            aria-hidden
          />
        ) : (
          <ChevronRight
            size={12}
            className="sidebar-pinned-section-chevron"
            aria-hidden
          />
        )}
      </button>
      {isSectionExpanded ? (
        <div className="pinned-section sidebar-pinned-section">
          {dayGroups.map((dayGroup) => {
            const dayOpen = isDayExpanded(dayGroup.dateKey, latestDateKey);
            return (
              <div
                key={dayGroup.dateKey}
                className="sidebar-pinned-day"
                data-sidebar-pinned-day={dayGroup.dateKey}
              >
                <button
                  type="button"
                  className={`sidebar-section-header sidebar-pinned-day-header${
                    dayOpen ? "" : " is-collapsed"
                  }`}
                  data-sidebar-pinned-day-header={dayGroup.dateKey}
                  aria-expanded={dayOpen}
                  aria-label={
                    dayOpen
                      ? t("sidebar.collapsePinnedDay", {
                          date: dayGroup.dateKey,
                        })
                      : t("sidebar.expandPinnedDay", {
                          date: dayGroup.dateKey,
                        })
                  }
                  onClick={() => toggleDay(dayGroup.dateKey, latestDateKey)}
                >
                  <span className="sidebar-section-title sidebar-pinned-day-label">
                    {dayGroup.dateKey}
                  </span>
                </button>
                {dayOpen
                  ? dayGroup.workspaceRuns.map((run) => (
                      <ThreadList
                        key={`${dayGroup.dateKey}:${run.key}`}
                        workspaceId={run.workspaceId}
                        workspacePath={run.workspacePath}
                        pinnedRows={run.rows}
                        unpinnedRows={[]}
                        totalThreadRoots={run.rootCount}
                        visibleThreadRootCount={run.rootCount}
                        isExpanded
                        nextCursor={null}
                        isPaging={false}
                        showPagingControls={false}
                        listClassName="pinned-thread-list"
                        moveFolderTargets={
                          moveFolderTargetsByWorkspaceId[run.workspaceId]
                        }
                        activeWorkspaceId={activeWorkspaceId}
                        activeThreadId={activeThreadId}
                        systemProxyEnabled={systemProxyEnabled}
                        systemProxyUrl={systemProxyUrl}
                        showProviderLabels={showProviderLabels}
                        threadStatusById={threadStatusById}
                        getThreadTime={getThreadTime}
                        isThreadPinned={isThreadPinned}
                        isThreadAutoNaming={isThreadAutoNaming}
                        onToggleThreadPin={onToggleThreadPin}
                        onToggleExpanded={() => undefined}
                        onLoadOlderThreads={() => undefined}
                        onSelectThread={onSelectThread}
                        onShowThreadMenu={onShowThreadMenu}
                        deleteConfirmThreadId={deleteConfirmThreadId}
                        deleteConfirmWorkspaceId={deleteConfirmWorkspaceId}
                        deleteConfirmBusy={deleteConfirmBusy}
                        onCancelDeleteConfirm={onCancelDeleteConfirm}
                        onConfirmDeleteConfirm={onConfirmDeleteConfirm}
                        renameThreadId={renameThreadId}
                        renameWorkspaceId={renameWorkspaceId}
                        renameName={renameName}
                        onRenameChange={onRenameChange}
                        onRenameCancel={onRenameCancel}
                        onRenameConfirm={onRenameConfirm}
                        onThreadRowRender={onPinnedThreadRowRender}
                      />
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
