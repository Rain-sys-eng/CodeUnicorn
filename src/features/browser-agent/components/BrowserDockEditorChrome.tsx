import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import Crosshair from "lucide-react/dist/esm/icons/crosshair";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Globe from "lucide-react/dist/esm/icons/globe";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import Plus from "lucide-react/dist/esm/icons/plus";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RendererContextMenu } from "@/components/ui/RendererContextMenu";
import {
  startBrowserAgentElementSelect,
  stopBrowserAgentElementSelect,
} from "@/services/tauri";
import type { BrowserSession } from "../types";
import {
  useBrowserTabContextMenu,
  type BrowserTabCloseSessionsHandler,
} from "../hooks/useBrowserTabContextMenu";
import { requestBrowserContextAttachment } from "../state/browserContextAttachmentCommands";
import { resolveBrowserTabLabel } from "../utils/browserTabLabel";

const BROWSER_ELEMENT_SELECT_ENDED_EVENT = "browser-agent://element-select-ended";

type TauriInternalsWindow = Window & {
  __TAURI_INTERNALS__?: {
    transformCallback?: unknown;
  };
};

function hasTauriEventBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return typeof (window as TauriInternalsWindow).__TAURI_INTERNALS__?.transformCallback === "function";
}

export type BrowserDockNotice = {
  kind: "info" | "warning" | "error";
  message: string;
};

/** tab 状态点：ready 绿 / loading 黄 / 异常红 / 其余灰。 */
function sessionStatusDotClass(session: BrowserSession): string {
  if (session.status === "ready") {
    return "is-ready";
  }
  if (session.status === "loading") {
    return "is-loading";
  }
  if (session.status === "failed" || session.status === "blocked") {
    return "is-attention";
  }
  return "is-idle";
}

type BrowserDockEditorChromeProps = {
  workspaceId: string;
  openSessions: BrowserSession[];
  activeSession: BrowserSession | null;
  activeSessionId: string | null;
  busy: boolean;
  resolvedEnabled: boolean;
  notice: BrowserDockNotice | null;
  urlDraft: string;
  onUrlDraftChange: (value: string) => void;
  onOpen: () => void;
  onActivateSession: (session: BrowserSession) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessions: BrowserTabCloseSessionsHandler;
  /** 内嵌模式在 child WebView 内注入菜单；未传入时保留 HTML fallback。 */
  onEmbeddedTabContextMenu?: (
    event: ReactMouseEvent<HTMLDivElement>,
    sessionId: string,
  ) => void;
  onTabMenuOpenChange?: (open: boolean) => void;
  onNewTab: () => void;
  onPopOut: () => void;
  onEnable: () => void;
  /** 主窗口内嵌 Dock 才有：关掉整个 Browser Dock 分栏，不销毁 session。 */
  onClosePanel?: () => void;
  setBusy: (busy: boolean) => void;
  setNotice: (notice: BrowserDockNotice | null) => void;
};

/**
 * Dock 编辑器标签 chrome：顶栏只留 tab，地址行沉底且仅 icon 操作。
 * 旧悬浮岛 / 恢复条不再走这条渲染路径。
 */
export function BrowserDockEditorChrome({
  workspaceId,
  openSessions,
  activeSession,
  activeSessionId,
  busy,
  resolvedEnabled,
  notice,
  urlDraft,
  onUrlDraftChange,
  onOpen,
  onActivateSession,
  onCloseSession,
  onCloseSessions,
  onEmbeddedTabContextMenu,
  onTabMenuOpenChange,
  onNewTab,
  onPopOut,
  onEnable,
  onClosePanel,
  setBusy,
  setNotice,
}: BrowserDockEditorChromeProps) {
  const { t } = useTranslation();
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const [elementSelectArmed, setElementSelectArmed] = useState(false);
  const sessionIds = useMemo(
    () => openSessions.map((session) => session.browserSessionId),
    [openSessions],
  );
  const { menu: tabContextMenu, openMenu: openTabContextMenu, closeMenu: closeTabContextMenu } =
    useBrowserTabContextMenu({
      sessionIds,
      busy,
      onCloseSessions,
    });

  useEffect(() => {
    onTabMenuOpenChange?.(Boolean(tabContextMenu));
  }, [onTabMenuOpenChange, tabContextMenu]);

  useEffect(() => {
    return () => {
      onTabMenuOpenChange?.(false);
    };
  }, [onTabMenuOpenChange]);

  const handleTabContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, sessionId: string) => {
      if (onEmbeddedTabContextMenu) {
        event.preventDefault();
        event.stopPropagation();
        onEmbeddedTabContextMenu(event, sessionId);
        return;
      }
      openTabContextMenu(event, sessionId);
    },
    [onEmbeddedTabContextMenu, openTabContextMenu],
  );

  // ⌘L / Ctrl+L 聚焦地址栏（浏览器肌肉记忆；组件仅在内嵌展开态挂载）
  useEffect(() => {
    const handleFocusUrlShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleFocusUrlShortcut);
    return () => {
      window.removeEventListener("keydown", handleFocusUrlShortcut);
    };
  }, []);

  useEffect(() => {
    setElementSelectArmed(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (!hasTauriEventBridge()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ browserSessionId?: string }>(
      BROWSER_ELEMENT_SELECT_ENDED_EVENT,
      (event) => {
        const endedSessionId = event.payload?.browserSessionId;
        if (!endedSessionId || endedSessionId === activeSessionId) {
          setElementSelectArmed(false);
        }
      },
    ).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeSessionId]);

  // 关联浏览器上下文：主窗口内本地 listener 直达 Composer（与浮动窗注入工具条同一事件通道）
  const handleAttachContext = useCallback(() => {
    if (!activeSession || busy) {
      return;
    }
    requestBrowserContextAttachment({
      workspaceId,
      browserSessionId: activeSession.browserSessionId,
    });
  }, [activeSession, busy, workspaceId]);

  // 选择网页元素：再点一次走 stop，只 cleanup，不再重新注入选择器
  const handleToggleElementSelect = useCallback(async () => {
    if (!activeSession || busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (elementSelectArmed) {
        await stopBrowserAgentElementSelect(activeSession.browserSessionId);
        setElementSelectArmed(false);
      } else {
        await startBrowserAgentElementSelect(activeSession.browserSessionId);
        setElementSelectArmed(true);
      }
    } catch (error) {
      setElementSelectArmed(false);
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [activeSession, busy, elementSelectArmed, setBusy, setNotice]);

  const sessionActionsDisabled = !activeSession || busy;

  return (
    <>
      <div className="browser-agent-editor-tabbar">
        <div className="browser-agent-tab-track" role="tablist" aria-label={t("browserAgent.dock.tabs")}>
          {openSessions.map((session) => {
            const tabLabel = resolveBrowserTabLabel(session);
            return (
            <div
              key={session.browserSessionId}
              className={`browser-agent-tab browser-agent-editor-tab${session.browserSessionId === activeSessionId ? " is-active" : ""}`}
              role="presentation"
              onContextMenu={(event) => handleTabContextMenu(event, session.browserSessionId)}
            >
              <button
                type="button"
                role="tab"
                aria-selected={session.browserSessionId === activeSessionId}
                className="browser-agent-tab-main"
                onClick={() => onActivateSession(session)}
                title={tabLabel}
              >
                <span className="browser-agent-tab-main-content">
                  <span className="browser-agent-editor-tab-avatar" aria-hidden>
                    {tabLabel.charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="browser-agent-tab-label">
                    {tabLabel}
                  </span>
                  <span
                    className={`browser-agent-editor-tab-status ${sessionStatusDotClass(session)}`}
                    aria-hidden
                  />
                </span>
              </button>
              <button
                type="button"
                className="browser-agent-tab-close"
                aria-label={t("browserAgent.dock.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseSession(session.browserSessionId);
                }}
                disabled={busy}
              >
                <X size={11} aria-hidden />
              </button>
            </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="browser-agent-tab-new"
            onClick={onNewTab}
            aria-label={t("browserAgent.dock.newTab")}
          >
            <Plus size={14} aria-hidden />
          </Button>
        </div>
        {onClosePanel ? (
          <button
            type="button"
            className="browser-agent-editor-close"
            onClick={onClosePanel}
            aria-label={t("browserAgent.dock.closePanel")}
            title={t("browserAgent.dock.closePanel")}
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="browser-agent-editor-urlbar">
        {!resolvedEnabled ? (
          <Button type="button" className="browser-agent-dock-enable" onClick={onEnable} disabled={busy}>
            {busy ? t("browserAgent.dock.busy") : t("browserAgent.dock.enable")}
          </Button>
        ) : (
          <div className="browser-agent-editor-url-row">
            <Globe size={14} aria-hidden className="browser-agent-editor-url-icon" />
            <Input
              ref={urlInputRef}
              unstyled
              className="browser-agent-editor-url-input"
              value={urlDraft}
              onChange={(event) => onUrlDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onOpen();
                }
              }}
              placeholder="https://example.com"
              disabled={!resolvedEnabled || busy}
              aria-invalid={notice?.kind === "error" || notice?.kind === "warning"}
              aria-label="Browser Agent URL"
              title={notice?.message}
            />
          </div>
        )}
        <div className="browser-agent-editor-urlbar-side">
          <button
            type="button"
            className="browser-agent-dock-icon"
            onClick={onOpen}
            disabled={!resolvedEnabled || busy}
            aria-label={t("browserAgent.dock.open")}
            title={`${t("browserAgent.dock.open")} (⌘L)`}
          >
            <ArrowRight size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="browser-agent-dock-icon"
            onClick={handleAttachContext}
            disabled={sessionActionsDisabled}
            aria-label={t("browserAgent.dock.attachContext")}
            title={t("browserAgent.dock.attachContext")}
          >
            <Link2 size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`browser-agent-dock-icon${elementSelectArmed ? " is-on" : ""}`}
            onClick={() => void handleToggleElementSelect()}
            disabled={sessionActionsDisabled}
            aria-pressed={elementSelectArmed}
            aria-label={
              elementSelectArmed
                ? t("browserAgent.dock.cancelSelectElement")
                : t("browserAgent.dock.selectElement")
            }
            title={
              elementSelectArmed
                ? t("browserAgent.dock.cancelSelectElement")
                : t("browserAgent.dock.selectElement")
            }
          >
            <Crosshair size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="browser-agent-dock-icon"
            onClick={onPopOut}
            disabled={sessionActionsDisabled}
            aria-label={t("browserAgent.dock.popOutWindow")}
            title={t("browserAgent.dock.popOutWindow")}
          >
            <ExternalLink size={14} aria-hidden />
          </button>
        </div>
      </div>
      {tabContextMenu && !onEmbeddedTabContextMenu ? (
        <RendererContextMenu
          menu={tabContextMenu}
          onClose={closeTabContextMenu}
          className="renderer-context-menu"
        />
      ) : null}
    </>
  );
}
