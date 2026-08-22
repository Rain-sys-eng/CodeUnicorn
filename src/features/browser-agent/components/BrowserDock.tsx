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
import Globe from "lucide-react/dist/esm/icons/globe";
import { Card, CardContent } from "@/components/ui/card";
import { loadBrowserAgentStyles } from "../../../styles/featureStyleLoaders";
import type {
  BrowserSession,
  BrowserTabContextMenuTheme,
  BrowserWebviewEvent,
} from "../types";
import {
  clearActiveBrowserContextSession,
  setActiveBrowserContextSession,
} from "../state/activeBrowserContext";
import {
  BROWSER_OPEN_URL_EVENT,
  dequeuePendingBrowserUrl,
  enqueuePendingBrowserUrl,
} from "../state/dockEvents";
import {
  measureEmbeddedWebviewContainer,
  showEmbeddedBrowserWebview,
  unmountEmbeddedBrowserWebview,
  useEmbeddedBrowserWebview,
} from "../hooks/useEmbeddedBrowserWebview";
import {
  BrowserDockEditorChrome,
  type BrowserDockNotice,
} from "./BrowserDockEditorChrome";
import {
  resolveBrowserTabCloseTargets,
  type BrowserTabCloseAction,
} from "../utils/browserTabCloseTargets";
import { urlsPointToSameBrowserResource } from "../utils/browserTabUrlMatch";
import {
  closeBrowserAgentSession,
  createBrowserAgentSession,
  getAppSettings,
  getBrowserAgentStatus,
  listBrowserAgentSessions,
  openBrowserAgentWindow,
  showBrowserAgentTabContextMenuOverlay,
  updateBrowserAgentSession,
  updateAppSettings,
  validateBrowserAgentUrl,
} from "@/services/tauri";

const BROWSER_WEBVIEW_EVENT = "browser-agent://webview-event";
const BROWSER_TAB_CONTEXT_ACTION_EVENT = "browser-agent://tab-context-action";
const BROWSER_TAB_CLOSE_ACTIONS: BrowserTabCloseAction[] = [
  "current",
  "others",
  "right",
  "all",
];

type BrowserTabContextActionPayload = {
  browserSessionId: string;
  action: BrowserTabCloseAction;
};

type BrowserDockProps = {
  workspaceId: string;
  ownerSurface?: string;
  /**
   * floating（默认）：会话内容开在独立浮动窗（既有行为）。
   * embedded：会话内容作为主窗口子 webview 内嵌到 dock 容器矩形。
   */
  displayMode?: "floating" | "embedded";
  enabled?: boolean;
  className?: string;
  onSessionChange?: (session: BrowserSession | null) => void;
  /** 主窗口内嵌 Dock 才有：关掉整个 Browser Dock 分栏，不销毁 session。 */
  onClosePanel?: () => void;
};

type TauriInternalsWindow = Window & {
  __TAURI_INTERNALS__?: {
    transformCallback?: unknown;
  };
};

function normalizeUrlDraft(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  // Keep absolute schemes as-is (including local file:// HTML previews).
  if (/^(https?|file):\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function hasTauriEventBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return typeof (window as TauriInternalsWindow).__TAURI_INTERNALS__?.transformCallback === "function";
}

function readThemeToken(
  styles: CSSStyleDeclaration,
  token: string,
  fallback: string,
): string {
  return styles.getPropertyValue(token).trim() || fallback;
}

/** child WebView 不继承宿主 CSS variables；右键时读取当前主题并显式同步给菜单。 */
function readBrowserTabContextMenuTheme(): BrowserTabContextMenuTheme {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const configuredTheme = root.dataset.theme;
  const prefersLight =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  const colorScheme =
    configuredTheme === "light" || configuredTheme === "dark"
      ? configuredTheme
      : prefersLight
        ? "light"
        : "dark";

  return {
    colorScheme,
    surface: readThemeToken(styles, "--surface-popover", "Canvas"),
    foreground: readThemeToken(styles, "--text-strong", "CanvasText"),
    border: readThemeToken(styles, "--border-quiet", "ButtonBorder"),
    hoverSurface: readThemeToken(styles, "--surface-hover", "ButtonFace"),
    disabledForeground: readThemeToken(styles, "--text-muted", "GrayText"),
    shadow: readThemeToken(styles, "--shadow-accent", "none"),
  };
}

export function BrowserDock({
  workspaceId,
  ownerSurface = "vibecoding",
  displayMode = "floating",
  enabled,
  className,
  onSessionChange,
  onClosePanel,
}: BrowserDockProps) {
  useEffect(() => {
    void loadBrowserAgentStyles();
  }, []);
  const { t, i18n } = useTranslation();
  const [statusEnabled, setStatusEnabled] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<BrowserDockNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const openInFlightRef = useRef(false);
  const openSessionsRef = useRef<BrowserSession[]>([]);
  const activeSessionRef = useRef<BrowserSession | null>(null);
  const onSessionChangeRef = useRef(onSessionChange);
  const isEmbedded = displayMode === "embedded";
  // 内嵌模式：native 子 webview 对齐此容器矩形（tab 栏与地址行之间的 webview-frame）
  const webviewContainerRef = useRef<HTMLDivElement | null>(null);

  const openSessions = useMemo(
    () => sessions.filter((session) => session.status !== "closed"),
    [sessions],
  );
  openSessionsRef.current = openSessions;
  const activeSession = useMemo(() => {
    if (!activeSessionId) {
      return null;
    }
    return openSessions.find((session) => session.browserSessionId === activeSessionId) ?? null;
  }, [activeSessionId, openSessions]);
  activeSessionRef.current = activeSession;
  onSessionChangeRef.current = onSessionChange;

  const resolvedEnabled = enabled ?? statusEnabled;

  // 内嵌显隐纪律：切会话/关 dock/离开 chat（组件卸载）时显式 hide，bounds 随容器同步。
  // 右键菜单注入 child WebView 自身；它与页面同层渲染，不会触发 hide 或重建。
  useEmbeddedBrowserWebview({
    containerRef: webviewContainerRef,
    activeSession,
    active: isEmbedded && resolvedEnabled,
  });

  useEffect(() => {
    if (enabled !== undefined) {
      setStatusEnabled(enabled);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const status = await getBrowserAgentStatus();
        if (mounted) {
          setStatusEnabled(status.settings.enabled);
        }
      } catch (error) {
        if (mounted) {
          setStatusEnabled(false);
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [enabled]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const nextSessions = await listBrowserAgentSessions(workspaceId);
        if (!mounted) {
          return;
        }
        setSessions((current) => {
          const byId = new Map<string, BrowserSession>();
          for (const session of nextSessions) {
            byId.set(session.browserSessionId, session);
          }
          for (const session of current) {
            if (!byId.has(session.browserSessionId)) {
              byId.set(session.browserSessionId, session);
            }
          }
          return [...byId.values()];
        });
        setActiveSessionId((currentActiveId) => {
          if (currentActiveId) {
            return currentActiveId;
          }
          const nextActive =
            nextSessions.find((session) => session.status !== "closed") ?? null;
          if (nextActive) {
            setActiveBrowserContextSession(nextActive, { rendererBound: false });
            onSessionChangeRef.current?.(nextActive);
          } else {
            clearActiveBrowserContextSession();
            onSessionChangeRef.current?.(null);
          }
          return nextActive?.browserSessionId ?? null;
        });
      } catch (error) {
        if (mounted) {
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!hasTauriEventBridge()) {
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void listen<BrowserWebviewEvent>(BROWSER_WEBVIEW_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      setSessions((current) =>
        current.map((session) =>
          session.browserSessionId === payload.browserSessionId
            ? {
                ...session,
                url: payload.url ?? session.url,
                normalizedUrl: payload.url ?? session.normalizedUrl,
                title: payload.title ?? session.title,
                status: payload.status,
                errorCode: payload.errorCode ?? session.errorCode,
                diagnosticMessage:
                  payload.diagnosticMessage ?? session.diagnosticMessage,
                updatedAt: payload.occurredAt,
                lastActivatedAt: payload.occurredAt,
              }
            : session,
        ),
      );
      setActiveSessionId((current) => {
        if (current !== payload.browserSessionId) {
          return current;
        }
        if (payload.url) {
          setUrlDraft(payload.url);
        }
        const currentActiveSession = activeSessionRef.current;
        if (currentActiveSession) {
          const nextActiveSession = {
            ...currentActiveSession,
            url: payload.url ?? currentActiveSession.url,
            normalizedUrl: payload.url ?? currentActiveSession.normalizedUrl,
            title: payload.title ?? currentActiveSession.title,
            status: payload.status,
            errorCode: payload.errorCode ?? currentActiveSession.errorCode,
            diagnosticMessage:
              payload.diagnosticMessage ?? currentActiveSession.diagnosticMessage,
            updatedAt: payload.occurredAt,
            lastActivatedAt: payload.occurredAt,
          };
          setActiveBrowserContextSession(nextActiveSession, { rendererBound: true });
          onSessionChangeRef.current?.({ ...nextActiveSession });
        }
        return current;
      });
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    }).catch((error: unknown) => {
      if (disposed) {
        return;
      }
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const openSessionWindow = useCallback(async (session: BrowserSession, forceRemount = false) => {
    if (isEmbedded) {
      // tab 激活只更新 React state，由 useEmbeddedBrowserWebview 单点驱动 native
      // renderer。否则 click handler 与 effect 会对同一切换各发一次 mount。
      // 同 tab 的地址栏导航是唯一例外：它需要立即把 renderer 导向新 URL。
      if (forceRemount) {
        const bounds = measureEmbeddedWebviewContainer(webviewContainerRef.current);
        if (bounds) {
          await showEmbeddedBrowserWebview(
            session.browserSessionId,
            bounds,
            true,
          );
        }
        setActiveBrowserContextSession(session, { rendererBound: true });
      } else {
        setActiveBrowserContextSession(session, { rendererBound: false });
      }
      return session;
    }
    try {
      const openedSession = await openBrowserAgentWindow(session.browserSessionId, i18n.language);
      setActiveBrowserContextSession(openedSession, { rendererBound: true });
      return openedSession;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedSession = await updateBrowserAgentSession({
        browserSessionId: session.browserSessionId,
        status: "failed",
        errorCode: "browser_window_open_failed",
        diagnosticMessage: message,
      });
      setActiveBrowserContextSession(failedSession, { rendererBound: false });
      throw error;
    }
  }, [i18n.language, isEmbedded]);

  const handleActivateSession = useCallback(
    (session: BrowserSession) => {
      setActiveSessionId(session.browserSessionId);
      setUrlDraft(session.normalizedUrl);
      setNotice(null);
      setActiveBrowserContextSession(session, {
        rendererBound: false,
      });
      onSessionChangeRef.current?.(session);
      if (resolvedEnabled && session.status !== "closed") {
        void openSessionWindow(session)
          .then((openedSession) => {
            setSessions((current) =>
              current.map((item) =>
                item.browserSessionId === openedSession.browserSessionId
                  ? openedSession
                  : item,
              ),
            );
            onSessionChangeRef.current?.(openedSession);
          })
          .catch((error) => {
            setNotice({
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
      }
    },
    [openSessionWindow, resolvedEnabled],
  );

  const handleOpen = useCallback(async (nextUrl?: string) => {
    if (!resolvedEnabled) {
      return;
    }
    if (busy || openInFlightRef.current) {
      // 上一会话还在创建/挂载时打开新 URL：入 FIFO，busy 翻转后 drain，连点不得覆盖。
      if (nextUrl !== undefined) {
        enqueuePendingBrowserUrl(nextUrl);
      }
      return;
    }
    const normalizedDraft = normalizeUrlDraft(nextUrl ?? urlDraft);
    if (!normalizedDraft) {
      setNotice({ kind: "warning", message: t("browserAgent.dock.emptyUrl") });
      return;
    }

    openInFlightRef.current = true;
    setBusy(true);
    setNotice(null);
    const previousActiveId = activeSessionId;
    try {
      const validation = await validateBrowserAgentUrl(normalizedDraft, workspaceId);
      if (!validation.allowed || !validation.normalizedUrl) {
        setNotice({
          kind: "warning",
          message:
            validation.diagnostic?.message ?? t("browserAgent.dock.blockedUrl"),
        });
        return;
      }
      const existingSession = openSessionsRef.current.find((session) =>
        urlsPointToSameBrowserResource(
          session.normalizedUrl || session.url,
          validation.normalizedUrl,
        ),
      );
      if (existingSession && nextUrl !== undefined) {
        // 同一 HTML 再点一次：回到已有 tab，绝不能再 create/hide 把当前页弄没。
        handleActivateSession(existingSession);
        return;
      }
      if (activeSession && nextUrl === undefined) {
        const preparedSession = await updateBrowserAgentSession({
          browserSessionId: activeSession.browserSessionId,
          workspaceId,
          url: validation.normalizedUrl,
          status: "loading",
          diagnosticMessage: null,
          errorCode: null,
        });
        const openedSession = await openSessionWindow(preparedSession, true);
        setActiveSessionId(openedSession.browserSessionId);
        setUrlDraft(validation.normalizedUrl);
        setSessions((current) =>
          current.map((item) =>
            item.browserSessionId === openedSession.browserSessionId
              ? openedSession
              : item,
          ),
        );
        setNotice({ kind: "info", message: t("browserAgent.dock.opened") });
        return;
      }
      const preparedSession = await createBrowserAgentSession({
        workspaceId,
        url: validation.normalizedUrl,
        ownerSurface,
      });
      // 先落 tab，再 mount：mount 失败时用户至少看得到新标签，旧 webview 也还在。
      setActiveSessionId(preparedSession.browserSessionId);
      setUrlDraft(validation.normalizedUrl);
      setSessions((current) => [
        preparedSession,
        ...current.filter((item) => item.browserSessionId !== preparedSession.browserSessionId),
      ]);
      try {
        const openedSession = await openSessionWindow(preparedSession);
        setSessions((current) =>
          current.map((item) =>
            item.browserSessionId === openedSession.browserSessionId
              ? openedSession
              : item,
          ),
        );
      } catch (mountError) {
        if (previousActiveId) {
          setActiveSessionId(previousActiveId);
          const previousSession = openSessionsRef.current.find(
            (session) => session.browserSessionId === previousActiveId,
          );
          if (previousSession) {
            void openSessionWindow(previousSession).catch(() => {});
          }
        }
        throw mountError;
      }
      setNotice({ kind: "info", message: t("browserAgent.dock.opened") });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      openInFlightRef.current = false;
      setBusy(false);
    }
  }, [
    activeSession,
    activeSessionId,
    handleActivateSession,
    openSessionWindow,
    ownerSurface,
    resolvedEnabled,
    t,
    urlDraft,
    workspaceId,
  ]);

  useEffect(() => {
    const handleOpenUrl = (event: Event) => {
      if (!resolvedEnabled) {
        return;
      }
      const requestedUrl = (event as CustomEvent<{ url?: string }>).detail?.url;
      if (!requestedUrl) {
        const pendingUrl = dequeuePendingBrowserUrl();
        if (pendingUrl) {
          void handleOpen(pendingUrl);
        }
        return;
      }
      // 事件路径直接打开；若队列里有同一条则摘走，避免随后 drain 再开一次。
      dequeuePendingBrowserUrl(requestedUrl);
      void handleOpen(requestedUrl);
    };
    window.addEventListener(BROWSER_OPEN_URL_EVENT, handleOpenUrl);
    return () => {
      window.removeEventListener(BROWSER_OPEN_URL_EVENT, handleOpenUrl);
    };
  }, [handleOpen, resolvedEnabled]);

  useEffect(() => {
    if (!resolvedEnabled || busy) {
      return;
    }
    const pendingUrl = dequeuePendingBrowserUrl();
    if (pendingUrl) {
      void handleOpen(pendingUrl);
    }
  }, [busy, handleOpen, resolvedEnabled]);

  const handleEnableBrowserAgent = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const settings = await getAppSettings();
      await updateAppSettings({
        ...settings,
        browserAgentEnabled: true,
        browserAgentPreferBuiltIn: true,
      });
      setStatusEnabled(true);
      setNotice({ kind: "info", message: t("browserAgent.dock.enabled") });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  const handleCloseSessions = useCallback(async (
    sessionIds: string[],
    options?: { preferActiveId?: string },
  ) => {
    if (busy) {
      return;
    }
    const uniqueIds = [...new Set(sessionIds)].filter((sessionId) =>
      openSessions.some((session) => session.browserSessionId === sessionId),
    );
    if (uniqueIds.length === 0) {
      return;
    }

    setBusy(true);
    try {
      const closedById = new Map<string, BrowserSession>();
      let firstError: unknown = null;
      for (const sessionId of uniqueIds) {
        try {
          const closed = await closeBrowserAgentSession(sessionId);
          clearActiveBrowserContextSession(sessionId);
          if (isEmbedded) {
            // Rust 侧只会关闭与 session 绑定的唯一 renderer；此处同步前端协调器状态。
            unmountEmbeddedBrowserWebview(sessionId);
          }
          closedById.set(sessionId, closed);
        } catch (error) {
          firstError ??= error;
        }
      }

      if (closedById.size === 0) {
        throw firstError;
      }

      const closedIdSet = new Set(closedById.keys());
      setSessions((current) =>
        current.map((session) => closedById.get(session.browserSessionId) ?? session),
      );

      const remaining = openSessions.filter(
        (session) => !closedIdSet.has(session.browserSessionId),
      );
      const closedActive = Boolean(activeSessionId && closedIdSet.has(activeSessionId));
      if (closedActive) {
        const preferred = options?.preferActiveId
          ? remaining.find((session) => session.browserSessionId === options.preferActiveId)
          : undefined;
        const nextActive = preferred ?? remaining[0] ?? null;
        setActiveSessionId(nextActive?.browserSessionId ?? null);
        setUrlDraft(nextActive?.normalizedUrl ?? "");
        if (nextActive) {
          setActiveBrowserContextSession(nextActive, {
            rendererBound: false,
          });
        }
        onSessionChangeRef.current?.(nextActive);
        if (nextActive) {
          void openSessionWindow(nextActive)
            .then((openedSession) => {
              setSessions((current) =>
                current.map((session) =>
                  session.browserSessionId === openedSession.browserSessionId
                    ? openedSession
                    : session,
                ),
              );
              onSessionChangeRef.current?.(openedSession);
            })
            .catch((error) => {
              setNotice({
                kind: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            });
        }
      }

      if (firstError) {
        setNotice({
          kind: "error",
          message: firstError instanceof Error ? firstError.message : String(firstError),
        });
      } else {
        setNotice({ kind: "info", message: t("browserAgent.dock.closed") });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [activeSessionId, busy, isEmbedded, openSessionWindow, openSessions, t]);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    await handleCloseSessions([sessionId]);
  }, [handleCloseSessions]);

  const handleEmbeddedTabContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, browserSessionId: string) => {
      if (!hasTauriEventBridge()) {
        return;
      }
      const bounds = measureEmbeddedWebviewContainer(webviewContainerRef.current);
      const sessionIds = openSessionsRef.current.map(
        (session) => session.browserSessionId,
      );
      void showBrowserAgentTabContextMenuOverlay({
        browserSessionId,
        x: Math.max(12, event.clientX - (bounds?.x ?? 0)),
        locale: i18n.language,
        theme: readBrowserTabContextMenuTheme(),
        disabledActions: BROWSER_TAB_CLOSE_ACTIONS.filter(
          (action) =>
            busy ||
            resolveBrowserTabCloseTargets(sessionIds, browserSessionId, action)
              .length === 0,
        ),
      }).catch((error: unknown) => {
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [busy, i18n.language],
  );

  useEffect(() => {
    if (!isEmbedded || !hasTauriEventBridge()) {
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void listen<BrowserTabContextActionPayload>(
      BROWSER_TAB_CONTEXT_ACTION_EVENT,
      (event) => {
        if (disposed) {
          return;
        }
        const { browserSessionId, action } = event.payload;
        const sessionIds = openSessionsRef.current.map(
          (session) => session.browserSessionId,
        );
        const targets = resolveBrowserTabCloseTargets(
          sessionIds,
          browserSessionId,
          action,
        );
        if (targets.length === 0) {
          return;
        }
        void handleCloseSessions(
          targets,
          action === "others" || action === "right"
            ? { preferActiveId: browserSessionId }
            : undefined,
        );
      },
    )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [handleCloseSessions, isEmbedded]);

  // 弹出独立窗体：释放唯一内嵌 renderer，当前会话移交浮动窗（含注入工具条）。
  const handlePopOut = useCallback(async () => {
    if (!activeSession || busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      unmountEmbeddedBrowserWebview(activeSession.browserSessionId);
      const openedSession = await openBrowserAgentWindow(
        activeSession.browserSessionId,
        i18n.language,
      );
      setActiveBrowserContextSession(openedSession, { rendererBound: true });
      setNotice({ kind: "info", message: t("browserAgent.dock.opened") });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [activeSession, busy, i18n.language, t]);

  return (
    <Card className={className} data-browser-agent-dock="true">
      <CardContent
        className={`browser-agent-dock-content${resolvedEnabled ? "" : " is-disabled"} is-embedded p-0`}
      >
        <BrowserDockEditorChrome
          workspaceId={workspaceId}
          openSessions={openSessions}
          activeSession={activeSession}
          activeSessionId={activeSessionId}
          busy={busy}
          resolvedEnabled={resolvedEnabled}
          notice={notice}
          urlDraft={urlDraft}
          onUrlDraftChange={setUrlDraft}
          onOpen={() => void handleOpen()}
          onActivateSession={handleActivateSession}
          onCloseSession={(sessionId) => void handleCloseSession(sessionId)}
          onCloseSessions={(sessionIds, options) => {
            void handleCloseSessions(sessionIds, options);
          }}
          onEmbeddedTabContextMenu={
            isEmbedded && hasTauriEventBridge()
              ? handleEmbeddedTabContextMenu
              : undefined
          }
          onNewTab={() => {
            setActiveSessionId(null);
            setUrlDraft("");
            onSessionChange?.(null);
          }}
          onPopOut={() => void handlePopOut()}
          onEnable={() => void handleEnableBrowserAgent()}
          onClosePanel={onClosePanel}
          setBusy={setBusy}
          setNotice={setNotice}
        />
        {activeSession && resolvedEnabled ? (
          <div
            className="browser-agent-webview-frame"
            data-browser-agent-window-status="true"
            ref={webviewContainerRef}
          >
            <div className="browser-agent-webview-placeholder">
              <Globe size={18} aria-hidden />
              <span>{t("browserAgent.dock.windowOpened")}</span>
            </div>
          </div>
        ) : (
          <div className="browser-agent-webview-empty">
            {t("browserAgent.dock.noPage")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
