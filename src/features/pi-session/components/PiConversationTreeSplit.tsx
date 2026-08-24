import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  shallowEqual,
  useActiveCanvasSelector,
} from "../../layout/hooks/activeCanvasStore";
import { usePiTreeOverlayKey } from "../store/piSessionStore";
import { PiSessionTreePanel } from "./PiSessionTreePanel";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";

const DOCK_WIDTH_KEY = "piTreeDockWidth";
const DEFAULT_DOCK_WIDTH = 380;
const MIN_DOCK_WIDTH = 280;
const MAX_DOCK_WIDTH = 640;

function clampDockWidth(value: number): number {
  return Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, Math.round(value)));
}

function readStoredDockWidth(): number {
  const stored = getClientStoreSync<number>("layout", DOCK_WIDTH_KEY);
  return typeof stored === "number" && Number.isFinite(stored)
    ? clampDockWidth(stored)
    : DEFAULT_DOCK_WIDTH;
}

/**
 * 「上（幕布）下（composer）｜ 右（会话树）」中间对话区 dock。
 *
 * pi 独立容器：只是包裹聊天列，不复用也不改动 subAgent
 * ConversationInspectorSplit / ConversationHost 的任何逻辑。树开态由
 * pi-session store 驱动（topbar 按钮 / tab chip / 侧栏徽标写入）。
 * 分隔条拖拽调宽（pi 自有实现，宽度持久化到 clientStore）。
 */
export function PiConversationTreeSplit({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const scope = useActiveCanvasSelector(
    (state) => ({
      threadId: state.threadId,
      workspaceId: state.workspaceId,
    }),
    shallowEqual,
  );
  const treeOverlayKey = usePiTreeOverlayKey();
  const [dockWidth, setDockWidth] = useState(readStoredDockWidth);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    onMove: ((event: PointerEvent) => void) | null;
    onUp: (() => void) | null;
  } | null>(null);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.onMove) {
      window.removeEventListener("pointermove", drag.onMove);
    }
    if (drag?.onUp) {
      window.removeEventListener("pointerup", drag.onUp);
      window.removeEventListener("pointercancel", drag.onUp);
    }
    dragRef.current = null;
    document.body.classList.remove("pi-tree-dock-resizing");
  }, []);

  const persistWidth = useCallback((value: number) => {
    writeClientStoreValue("layout", DOCK_WIDTH_KEY, value);
  }, []);

  const handleDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      // 双通道：元素 pointer capture 为主（失败不致命），window 监听兜底——
      // 某些 WebView 的 capture 会抛错或丢事件，单靠任一通道都出现过
      // 「拖不动」的验收事故。
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 忽略：走 window 兜底通道
      }
      const drag = {
        startX: event.clientX,
        startWidth: dockWidth,
        onMove: null as ((event: PointerEvent) => void) | null,
        onUp: null as (() => void) | null,
      };
      drag.onMove = (moveEvent: PointerEvent) => {
        // dock 在右侧：向左拖变宽，向右拖变窄
        setDockWidth(
          clampDockWidth(drag.startWidth + (drag.startX - moveEvent.clientX)),
        );
      };
      drag.onUp = () => {
        endDrag();
        setDockWidth((current) => {
          persistWidth(current);
          return current;
        });
      };
      dragRef.current = drag;
      document.body.classList.add("pi-tree-dock-resizing");
      window.addEventListener("pointermove", drag.onMove);
      window.addEventListener("pointerup", drag.onUp);
      window.addEventListener("pointercancel", drag.onUp);
    },
    [dockWidth, endDrag, persistWidth],
  );

  const handleDividerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      setDockWidth(
        clampDockWidth(drag.startWidth + (drag.startX - event.clientX)),
      );
    },
    [],
  );

  const handleDividerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) {
        return;
      }
      endDrag();
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // 忽略
      }
      setDockWidth((current) => {
        persistWidth(current);
        return current;
      });
    },
    [endDrag, persistWidth],
  );

  const openKey =
    scope.workspaceId && scope.threadId
      ? `${scope.workspaceId}:${scope.threadId}`
      : null;
  const isPiThread = scope.threadId?.startsWith("pi:") ?? false;
  // 打开态按 workspace + pi 判定，不按精确 thread：树内跳转会切换
  // activeThread（跳到分支），面板必须跟随会话族保持打开（跳转后面板
  // 消失 = 不好用，2026-08-23 验收）。面板数据按当前 thread 刷新，
  // 会话族全图天然包含所有 lane。
  const requestWorkspace = treeOverlayKey?.split(":")[0] ?? null;
  const treeOpen =
    isPiThread &&
    requestWorkspace !== null &&
    requestWorkspace === scope.workspaceId &&
    openKey !== null;

  return (
    <div className="pi-chat-tree-split">
      <div className="pi-chat-tree-main">{children}</div>
      {treeOpen && scope.workspaceId && scope.threadId ? (
        <>
          <div
            className="pi-tree-dock-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("piSession.tree.resizeAria")}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
            onPointerCancel={handleDividerPointerUp}
            onDoubleClick={() => {
              setDockWidth(DEFAULT_DOCK_WIDTH);
              persistWidth(DEFAULT_DOCK_WIDTH);
            }}
          />
          <div className="pi-tree-dock" style={{ width: dockWidth }}>
            <PiSessionTreePanel
              workspaceId={scope.workspaceId}
              threadId={scope.threadId}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
