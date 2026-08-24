import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { TopbarSessionTabs } from "../../app/components/TopbarSessionTabs";
import {
  clampRendererContextMenuPosition,
  RendererContextMenu,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import type { ThreadSummary } from "../../../types";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";
import {
  TOPBAR_SESSION_TAB_MAX,
  buildTopbarSessionTabItems,
  createEmptyTopbarSessionWindows,
  dismissAllTopbarSessionTabs,
  dismissCompletedTopbarSessionTabs,
  dismissTopbarSessionTab,
  dismissTopbarSessionTabsToLeft,
  dismissTopbarSessionTabsToRight,
  pickAdjacentOpenSessionTab,
  pickAdjacentTopbarSessionFallbackTab,
  pruneTopbarSessionWindows,
  recordTopbarSessionActivation,
  type TopbarSessionWindows,
} from "./topbarSessionTabs";

type TopbarThreadStatus = {
  isProcessing: boolean;
};

type UseLayoutTopbarSessionTabsInput = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  closeCurrentSessionShortcut: string | null;
  cycleOpenSessionNextShortcut: string | null;
  cycleOpenSessionPrevShortcut: string | null;
  isPhone: boolean;
  isTablet: boolean;
  showTopSessionTabs: boolean;
  threadStatusById: Record<string, TopbarThreadStatus>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  t: (key: string) => string;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onClearActiveThread: (workspaceId: string) => void;
};

type UseLayoutTopbarSessionTabsResult = {
  contextMenuNode: ReactNode;
  sessionTabsNode: ReactNode;
};

function toTopbarTabKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}::${threadId}`;
}

export function useLayoutTopbarSessionTabs(
  input: UseLayoutTopbarSessionTabsInput,
): UseLayoutTopbarSessionTabsResult {
  const [topbarSessionEpoch, forceTopbarSessionRender] = useReducer((value: number) => value + 1, 0);
  const [topbarTabContextMenu, setTopbarTabContextMenu] =
    useState<RendererContextMenuState | null>(null);
  const topbarSessionWindowsRef = useRef<TopbarSessionWindows>(
    createEmptyTopbarSessionWindows(),
  );
  const pendingTopbarSelectionRef = useRef<{
    workspaceId: string;
    threadId: string;
    setAt: number;
  } | null>(null);
  const dismissedTopbarTabKeysRef = useRef<Set<string>>(new Set());
  const lastActivationRef = useRef<{
    initialized: boolean;
    workspaceId: string | null;
    threadId: string | null;
  }>({
    initialized: false,
    workspaceId: null,
    threadId: null,
  });

  topbarSessionWindowsRef.current = pruneTopbarSessionWindows(
    topbarSessionWindowsRef.current,
    input.threadsByWorkspace,
  );

  const currentActivation = {
    workspaceId: input.activeWorkspaceId,
    threadId: input.activeThreadId,
  };
  if (!lastActivationRef.current.initialized) {
    lastActivationRef.current = {
      initialized: true,
      workspaceId: currentActivation.workspaceId,
      threadId: currentActivation.threadId,
    };
  } else {
    const isActivationChanged =
      currentActivation.workspaceId !== lastActivationRef.current.workspaceId ||
      currentActivation.threadId !== lastActivationRef.current.threadId;
    if (
      isActivationChanged &&
      currentActivation.workspaceId &&
      currentActivation.threadId
    ) {
      dismissedTopbarTabKeysRef.current.delete(
        toTopbarTabKey(
          currentActivation.workspaceId,
          currentActivation.threadId,
        ),
      );
      topbarSessionWindowsRef.current = recordTopbarSessionActivation(
        topbarSessionWindowsRef.current,
        currentActivation.workspaceId,
        currentActivation.threadId,
        input.threadsByWorkspace,
        TOPBAR_SESSION_TAB_MAX,
      );
    }
    lastActivationRef.current = {
      initialized: true,
      workspaceId: currentActivation.workspaceId,
      threadId: currentActivation.threadId,
    };
  }

  if (currentActivation.workspaceId && currentActivation.threadId) {
    const activeKey = toTopbarTabKey(
      currentActivation.workspaceId,
      currentActivation.threadId,
    );
    const activeExists = topbarSessionWindowsRef.current.tabs.some(
      (tab) =>
        tab.workspaceId === currentActivation.workspaceId &&
        tab.threadId === currentActivation.threadId,
    );
    if (!activeExists && !dismissedTopbarTabKeysRef.current.has(activeKey)) {
      topbarSessionWindowsRef.current = recordTopbarSessionActivation(
        topbarSessionWindowsRef.current,
        currentActivation.workspaceId,
        currentActivation.threadId,
        input.threadsByWorkspace,
        TOPBAR_SESSION_TAB_MAX,
      );
    }
  }

  const pendingSelection = pendingTopbarSelectionRef.current;
  if (
    pendingSelection &&
    pendingSelection.workspaceId === input.activeWorkspaceId &&
    pendingSelection.threadId === input.activeThreadId
  ) {
    pendingTopbarSelectionRef.current = null;
  } else if (
    pendingSelection &&
    Date.now() - pendingSelection.setAt > 1800
  ) {
    pendingTopbarSelectionRef.current = null;
  }

  const highlightedWorkspaceId =
    pendingTopbarSelectionRef.current?.workspaceId ?? input.activeWorkspaceId;
  const highlightedThreadId =
    pendingTopbarSelectionRef.current?.threadId ?? input.activeThreadId;
  const selectedWorkspaceId = input.activeWorkspaceId;
  const selectedThreadId = input.activeThreadId;
  const selectThread = input.onSelectThread;
  const clearActiveThread = input.onClearActiveThread;
  // 解构为裸标识符供 useMemo/useCallback deps 使用：eslint-plugin-react-hooks v4
  // 对 input.x 形式的成员依赖会误报 missing 'input'，裸标识符可精确匹配。
  const threadStatusById = input.threadStatusById;
  const t = input.t;
  const isPhone = input.isPhone;
  const isTablet = input.isTablet;
  const showTopSessionTabs = input.showTopSessionTabs;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (
        isEditableShortcutTarget(event.target) ||
        isEditableShortcutTarget(document.activeElement)
      ) {
        return;
      }
      const matchesNext = matchesShortcutForPlatform(
        event,
        input.cycleOpenSessionNextShortcut,
      );
      const matchesPrev = matchesShortcutForPlatform(
        event,
        input.cycleOpenSessionPrevShortcut,
      );
      if (!matchesNext && !matchesPrev) {
        return;
      }
      const targetTab = pickAdjacentOpenSessionTab(
        topbarSessionWindowsRef.current,
        input.activeWorkspaceId,
        input.activeThreadId,
        matchesNext ? "next" : "prev",
      );
      if (!targetTab) {
        return;
      }
      event.preventDefault();
      pendingTopbarSelectionRef.current = {
        workspaceId: targetTab.workspaceId,
        threadId: targetTab.threadId,
        setAt: Date.now(),
      };
      forceTopbarSessionRender();
      selectThread(targetTab.workspaceId, targetTab.threadId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    input.activeThreadId,
    input.activeWorkspaceId,
    input.cycleOpenSessionNextShortcut,
    input.cycleOpenSessionPrevShortcut,
    selectThread,
  ]);

  // 稳定 tab items 身份：sessionTabsNode 的 useMemo 依赖它，若每次 render 新建数组
  // 会让 mainHeaderNode / desktopTopbarLeftNode 的 memo 失效（AppLayout 无法提前返回）。
  // topbarSessionWindowsRef 在 render 期被同步/mutation 推进，mutation 路径由
  // forceTopbarSessionRender 触发重渲染，故用 epoch 作为 ref 内容的版本号入 deps。
  const topbarSessionTabItems = useMemo(
    () =>
      buildTopbarSessionTabItems(
        highlightedWorkspaceId,
        highlightedThreadId,
        input.threadsByWorkspace,
        topbarSessionWindowsRef.current,
        input.t("threads.untitledThread"),
        {
          codex: input.t("settings.projectSessionEngineCodex"),
          claude: input.t("settings.projectSessionEngineClaude"),
          gemini: input.t("settings.projectSessionEngineGemini"),
          opencode: input.t("settings.projectSessionEngineOpencode"),
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topbarSessionEpoch 是 topbarSessionWindowsRef 的版本号
    [
      highlightedWorkspaceId,
      highlightedThreadId,
      input.threadsByWorkspace,
      input.t,
      topbarSessionEpoch,
    ],
  );

  const applyTopbarWindowMutation = useCallback(
    (mutate: (windows: TopbarSessionWindows) => TopbarSessionWindows) => {
      const previousWindows = topbarSessionWindowsRef.current;
      const nextWindows = mutate(previousWindows);
      if (nextWindows === previousWindows) {
        return;
      }
      const previousTabKeys = new Set(
        previousWindows.tabs.map((tab) => toTopbarTabKey(tab.workspaceId, tab.threadId)),
      );
      const nextTabKeys = new Set(
        nextWindows.tabs.map((tab) => toTopbarTabKey(tab.workspaceId, tab.threadId)),
      );
      previousTabKeys.forEach((tabKey) => {
        if (!nextTabKeys.has(tabKey)) {
          dismissedTopbarTabKeysRef.current.add(tabKey);
        }
      });
      topbarSessionWindowsRef.current = nextWindows;
      if (pendingTopbarSelectionRef.current) {
        const pendingKey = toTopbarTabKey(
          pendingTopbarSelectionRef.current.workspaceId,
          pendingTopbarSelectionRef.current.threadId,
        );
        if (!nextTabKeys.has(pendingKey)) {
          pendingTopbarSelectionRef.current = null;
        }
      }
      const activeWorkspaceId = selectedWorkspaceId;
      const activeThreadId = selectedThreadId;
      const activeKey =
        activeWorkspaceId && activeThreadId
          ? toTopbarTabKey(activeWorkspaceId, activeThreadId)
          : null;
      const isActiveRemoved = Boolean(activeKey && !nextTabKeys.has(activeKey));
      forceTopbarSessionRender();
      if (!isActiveRemoved || !activeWorkspaceId || !activeThreadId) {
        return;
      }
      const fallbackTab = pickAdjacentTopbarSessionFallbackTab(
        previousWindows,
        nextWindows,
        activeWorkspaceId,
        activeThreadId,
      );
      if (fallbackTab) {
        pendingTopbarSelectionRef.current = {
          workspaceId: fallbackTab.workspaceId,
          threadId: fallbackTab.threadId,
          setAt: Date.now(),
        };
        forceTopbarSessionRender();
        selectThread(fallbackTab.workspaceId, fallbackTab.threadId);
        return;
      }
      // 无剩余 tab：清空会话选择落空画布（方案 A）。禁止走 selectWorkspace——
      // 它会经 planWorkspaceNavigationThread 恢复 workspace last thread（就是刚被
      // 关闭的会话），导致画布幽灵内容 + 已关闭 tab 复活。dismissed key 保留，
      // 之后从侧栏重新激活该会话时 tab 自然回归。
      clearActiveThread(activeWorkspaceId);
    },
    [selectedThreadId, selectedWorkspaceId, selectThread, clearActiveThread],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (!matchesShortcutForPlatform(event, input.closeCurrentSessionShortcut)) {
        return;
      }
      event.preventDefault();
      if (!input.activeWorkspaceId || !input.activeThreadId) {
        return;
      }
      applyTopbarWindowMutation((windows) =>
        dismissTopbarSessionTab(
          windows,
          input.activeWorkspaceId ?? "",
          input.activeThreadId ?? "",
        ),
      );
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    applyTopbarWindowMutation,
    input.activeThreadId,
    input.activeWorkspaceId,
    input.closeCurrentSessionShortcut,
  ]);

  const showTopbarTabMenu = useCallback(
    (
      position: { x: number; y: number },
      workspaceId: string,
      threadId: string,
    ) => {
      const currentWindows = topbarSessionWindowsRef.current;
      const targetIndex = currentWindows.tabs.findIndex(
        (tab) => tab.workspaceId === workspaceId && tab.threadId === threadId,
      );
      if (targetIndex < 0) {
        return;
      }
      const hasLeftTabs = targetIndex > 0;
      const hasRightTabs = targetIndex < currentWindows.tabs.length - 1;
      const hasCompletedTabs = currentWindows.tabs.some(
        (tab) => threadStatusById[tab.threadId]?.isProcessing === false,
      );
      const clampedPosition = clampRendererContextMenuPosition(position.x, position.y, {
        width: 260,
        height: 220,
      });
      setTopbarTabContextMenu({
        ...clampedPosition,
        label: t("threads.topbarSessionTabsAriaLabel"),
        items: [
          {
            type: "item",
            id: "close-tab",
            label: t("threads.closeTab"),
            onSelect: () => {
              applyTopbarWindowMutation((windows) =>
                dismissTopbarSessionTab(windows, workspaceId, threadId),
              );
            },
          },
          {
            type: "item",
            id: "close-left-tabs",
            label: t("threads.closeLeftTabs"),
            disabled: !hasLeftTabs,
            onSelect: () => {
              applyTopbarWindowMutation((windows) =>
                dismissTopbarSessionTabsToLeft(windows, workspaceId, threadId),
              );
            },
          },
          {
            type: "item",
            id: "close-right-tabs",
            label: t("threads.closeRightTabs"),
            disabled: !hasRightTabs,
            onSelect: () => {
              applyTopbarWindowMutation((windows) =>
                dismissTopbarSessionTabsToRight(windows, workspaceId, threadId),
              );
            },
          },
          {
            type: "item",
            id: "close-all-tabs",
            label: t("threads.closeAllTabs"),
            onSelect: () => {
              applyTopbarWindowMutation((windows) =>
                dismissAllTopbarSessionTabs(windows),
              );
            },
          },
          {
            type: "item",
            id: "close-completed-tabs",
            label: t("threads.closeCompletedTabs"),
            disabled: !hasCompletedTabs,
            onSelect: () => {
              applyTopbarWindowMutation((windows) =>
                dismissCompletedTopbarSessionTabs(windows, threadStatusById),
              );
            },
          },
        ],
      });
    },
    [applyTopbarWindowMutation, threadStatusById, t],
  );

  // 稳定 sessionTabsNode / contextMenuNode 身份：它们经 mainHeaderNode /
  // desktopTopbarLeftNode 传入 AppLayout，若每次 render 新建元素，AppLayout memo 失效。
  const sessionTabsNode = useMemo(
    () =>
      !isPhone && !isTablet && showTopSessionTabs ? (
      <TopbarSessionTabs
        tabs={topbarSessionTabItems}
        ariaLabel={t("threads.topbarSessionTabsAriaLabel")}
        onSelectThread={(workspaceId, threadId) => {
          const isCurrentTab =
            workspaceId === selectedWorkspaceId &&
            threadId === selectedThreadId;
          if (isCurrentTab) {
            return;
          }
          pendingTopbarSelectionRef.current = {
            workspaceId,
            threadId,
            setAt: Date.now(),
          };
          forceTopbarSessionRender();
          selectThread(workspaceId, threadId);
        }}
        onCloseThread={(workspaceId, threadId) => {
          applyTopbarWindowMutation((windows) =>
            dismissTopbarSessionTab(windows, workspaceId, threadId),
          );
        }}
        onShowTabMenu={showTopbarTabMenu}
      />
      ) : null,
    [
      isPhone,
      isTablet,
      showTopSessionTabs,
      topbarSessionTabItems,
      t,
      selectedWorkspaceId,
      selectedThreadId,
      selectThread,
      applyTopbarWindowMutation,
      showTopbarTabMenu,
    ],
  );

  const contextMenuNode = useMemo(
    () =>
      topbarTabContextMenu ? (
        <RendererContextMenu
          menu={topbarTabContextMenu}
          onClose={() => setTopbarTabContextMenu(null)}
          className="renderer-context-menu topbar-session-context-menu"
        />
      ) : null,
    [topbarTabContextMenu],
  );

  return {
    contextMenuNode,
    sessionTabsNode,
  };
}
