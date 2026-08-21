/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDock } from "./BrowserDock";
import type { BrowserSession } from "../types";
import {
  BROWSER_OPEN_URL_EVENT,
  PENDING_BROWSER_URLS_KEY,
} from "../state/dockEvents";
import {
  closeBrowserAgentSession,
  createBrowserAgentSession,
  hideBrowserAgentWebview,
  listBrowserAgentSessions,
  openBrowserAgentWindow,
  showBrowserAgentTabContextMenuOverlay,
  validateBrowserAgentUrl,
} from "@/services/tauri";

const createSessionMock = vi.mocked(createBrowserAgentSession);
const listSessionsMock = vi.mocked(listBrowserAgentSessions);
const validateUrlMock = vi.mocked(validateBrowserAgentUrl);
const openWindowMock = vi.mocked(openBrowserAgentWindow);
const closeSessionMock = vi.mocked(closeBrowserAgentSession);
const hideEmbeddedWebviewMock = vi.mocked(hideBrowserAgentWebview);
const showTabContextMenuOverlayMock = vi.mocked(showBrowserAgentTabContextMenuOverlay);

type EventHandler = (event: { payload: unknown }) => void;
const tauriEventHandlers = new Map<string, EventHandler>();

vi.mock("@/services/tauri", () => ({
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  getBrowserAgentStatus: vi.fn(),
  listBrowserAgentSessions: vi.fn(),
  validateBrowserAgentUrl: vi.fn(),
  createBrowserAgentSession: vi.fn(),
  updateBrowserAgentSession: vi.fn(),
  closeBrowserAgentSession: vi.fn(),
  openBrowserAgentWindow: vi.fn(),
  mountBrowserAgentWebview: vi.fn(),
  hideBrowserAgentWebview: vi.fn().mockResolvedValue(undefined),
  syncBrowserAgentWebviewBounds: vi.fn().mockResolvedValue(undefined),
  showBrowserAgentTabContextMenuOverlay: vi.fn().mockResolvedValue(undefined),
  startBrowserAgentElementSelect: vi.fn(),
  stopBrowserAgentElementSelect: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: EventHandler) => {
    tauriEventHandlers.set(name, handler);
    return Promise.resolve(() => {
      tauriEventHandlers.delete(name);
    });
  }),
}));

vi.mock("../../../styles/featureStyleLoaders", () => ({
  loadBrowserAgentStyles: vi.fn().mockResolvedValue(undefined),
}));

function makeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    browserSessionId: "session-1",
    workspaceId: "workspace-1",
    label: "one",
    url: "https://one.example/",
    normalizedUrl: "https://one.example/",
    origin: "https://one.example",
    title: "One",
    status: "ready",
    featurePhase: "read_only_snapshot",
    platformCapability: {
      platform: "macos",
      webviewRuntime: "wkwebview",
      browserDock: "supported",
      snapshotCapture: "supported",
      screenshotCapture: "supported",
      navigationActions: "supported",
      elementActions: "supported",
      formSubmitActions: "supported",
      diagnosticsCapture: "supported",
      unsupportedReasons: [],
      degradedReasons: [],
    },
    createdAt: 1,
    updatedAt: 1,
    lastActivatedAt: 1,
    ...overrides,
  };
}

function dispatchOpenUrl(url: string) {
  window.dispatchEvent(
    new CustomEvent(BROWSER_OPEN_URL_EVENT, { detail: { url } }),
  );
}

describe("BrowserDock", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    tauriEventHandlers.clear();
    vi.clearAllMocks();
    listSessionsMock.mockResolvedValue([]);
    validateUrlMock.mockImplementation(async (url: string) => ({
      allowed: true,
      rawUrl: url,
      normalizedUrl: url,
      blockedReason: null,
      diagnostic: null,
      workspaceLocalAllowed: true,
    }));
    openWindowMock.mockImplementation(async (browserSessionId: string) =>
      makeSession({
        browserSessionId,
        title: browserSessionId === "session-2" ? "Two" : "One",
        normalizedUrl:
          browserSessionId === "session-2"
            ? "https://two.example/"
            : "https://one.example/",
      }),
    );
    closeSessionMock.mockImplementation(async (browserSessionId: string) =>
      makeSession({ browserSessionId, status: "closed" }),
    );
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("reactivates an existing tab when the same HTML is opened again", async () => {
    createSessionMock.mockImplementation(async (request) =>
      makeSession({
        browserSessionId: `session-${createSessionMock.mock.calls.length}`,
        normalizedUrl: request.url,
        url: request.url,
        title: null,
      }),
    );

    render(<BrowserDock workspaceId="workspace-1" enabled />);

    act(() => {
      dispatchOpenUrl("file:///demo.html");
    });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));

    act(() => {
      dispatchOpenUrl("file:///demo.html");
    });
    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole("tab")).toHaveLength(1);
    });
  });

  it("opens each explicit URL as its own tab even while another session is creating", async () => {
    let resolveFirstCreate: ((session: BrowserSession) => void) | undefined;
    createSessionMock
      .mockImplementationOnce(
        () =>
          new Promise<BrowserSession>((resolve) => {
            resolveFirstCreate = resolve;
          }),
      )
      .mockImplementation(async (request) =>
        makeSession({
          browserSessionId: `session-${createSessionMock.mock.calls.length}`,
          normalizedUrl: request.url,
          url: request.url,
        }),
      );

    render(<BrowserDock workspaceId="workspace-1" enabled />);

    act(() => {
      dispatchOpenUrl("file:///a.html");
    });
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1));

    act(() => {
      dispatchOpenUrl("file:///b.html");
      dispatchOpenUrl("file:///c.html");
    });
    expect(JSON.parse(window.sessionStorage.getItem(PENDING_BROWSER_URLS_KEY) ?? "[]")).toEqual([
      "file:///b.html",
      "file:///c.html",
    ]);

    await act(async () => {
      resolveFirstCreate?.(
        makeSession({
          browserSessionId: "session-1",
          normalizedUrl: "file:///a.html",
          url: "file:///a.html",
        }),
      );
    });

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(3));
    expect(createSessionMock.mock.calls.map(([request]) => request.url)).toEqual([
      "file:///a.html",
      "file:///b.html",
      "file:///c.html",
    ]);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
  });

  it("keeps the clicked tab active instead of jumping back to the last opened one", async () => {
    const first = makeSession({
      browserSessionId: "session-1",
      title: "Alpha",
      normalizedUrl: "file:///alpha.html",
    });
    const second = makeSession({
      browserSessionId: "session-2",
      title: "Beta",
      normalizedUrl: "file:///beta.html",
    });
    listSessionsMock.mockResolvedValue([second, first]);

    render(<BrowserDock workspaceId="workspace-1" enabled />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));

    fireEvent.click(screen.getByRole("tab", { name: /Alpha/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Alpha/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });
    expect(screen.getByRole("tab", { name: /Beta/i }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(openWindowMock).toHaveBeenCalledWith("session-1", expect.anything());
  });

  it("closes other tabs from the HTML context menu and keeps the invoked tab", async () => {
    const sessions = [
      makeSession({ browserSessionId: "session-1", title: "One" }),
      makeSession({
        browserSessionId: "session-2",
        title: "Two",
        normalizedUrl: "https://two.example/",
      }),
      makeSession({
        browserSessionId: "session-3",
        title: "Three",
        normalizedUrl: "https://three.example/",
      }),
    ];
    listSessionsMock.mockResolvedValue(sessions);

    render(<BrowserDock workspaceId="workspace-1" enabled />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));

    fireEvent.contextMenu(screen.getByRole("tab", { name: /Two/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));

    await waitFor(() => expect(closeSessionMock).toHaveBeenCalledTimes(2));
    const closedIds = closeSessionMock.mock.calls.map(([id]) => id);
    expect(closedIds.sort()).toEqual(["session-1", "session-3"]);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(screen.getByRole("tab", { name: /Two/i })).toBeTruthy();
  });

  it("uses an in-WebView overlay for embedded tabs without hiding the active page", async () => {
    const first = makeSession({ browserSessionId: "session-1", title: "One" });
    const second = makeSession({
      browserSessionId: "session-2",
      title: "Two",
      normalizedUrl: "https://two.example/",
    });
    listSessionsMock.mockResolvedValue([first, second]);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: () => {},
    };

    render(
      <BrowserDock
        workspaceId="workspace-1"
        enabled
        displayMode="embedded"
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    hideEmbeddedWebviewMock.mockClear();

    const contextEvent = fireEvent.contextMenu(screen.getByRole("tab", { name: /Two/i }), {
      clientX: 240,
      clientY: 96,
    });

    expect(contextEvent).toBe(false);
    await waitFor(() => {
      expect(showTabContextMenuOverlayMock).toHaveBeenCalledWith({
        browserSessionId: "session-2",
        x: 240,
        locale: "en",
        disabledActions: ["right"],
        theme: expect.objectContaining({
          colorScheme: expect.any(String),
          surface: expect.any(String),
          foreground: expect.any(String),
          border: expect.any(String),
          hoverSurface: expect.any(String),
          disabledForeground: expect.any(String),
          shadow: expect.any(String),
        }),
      });
    });
    expect(screen.queryByRole("menu", { name: "Browser tab actions" })).toBeNull();
    expect(hideEmbeddedWebviewMock).not.toHaveBeenCalled();
  });

  it("routes a child WebView menu action through the existing tab close pipeline", async () => {
    const sessions = [
      makeSession({ browserSessionId: "session-1", title: "One" }),
      makeSession({
        browserSessionId: "session-2",
        title: "Two",
        normalizedUrl: "https://two.example/",
      }),
      makeSession({
        browserSessionId: "session-3",
        title: "Three",
        normalizedUrl: "https://three.example/",
      }),
    ];
    listSessionsMock.mockResolvedValue(sessions);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: () => {},
    };

    render(
      <BrowserDock
        workspaceId="workspace-1"
        enabled
        displayMode="embedded"
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    await waitFor(() => {
      expect(tauriEventHandlers.get("browser-agent://tab-context-action")).toBeDefined();
    });

    await act(async () => {
      tauriEventHandlers.get("browser-agent://tab-context-action")?.({
        payload: { browserSessionId: "session-2", action: "others" },
      });
    });

    await waitFor(() => expect(closeSessionMock).toHaveBeenCalledTimes(2));
    expect(closeSessionMock.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      "session-1",
      "session-3",
    ]);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(screen.getByRole("tab", { name: /Two/i })).toBeTruthy();
  });

  it("renders a panel close control only when onClosePanel is provided", async () => {
    const onClosePanel = vi.fn();
    const { rerender } = render(
      <BrowserDock workspaceId="workspace-1" enabled />,
    );
    await waitFor(() => expect(screen.getByRole("tablist")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Close Browser Dock" })).toBeNull();

    rerender(
      <BrowserDock
        workspaceId="workspace-1"
        enabled
        onClosePanel={onClosePanel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Browser Dock" }));
    expect(onClosePanel).toHaveBeenCalledTimes(1);
  });
});
