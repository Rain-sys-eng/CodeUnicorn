// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDockEditorChrome } from "./BrowserDockEditorChrome";
import type { BrowserSession } from "../types";

vi.mock("../state/browserContextAttachmentCommands", () => ({
  requestBrowserContextAttachment: vi.fn(),
}));

const startBrowserAgentElementSelect = vi.fn();
const stopBrowserAgentElementSelect = vi.fn();

vi.mock("@/services/tauri", () => ({
  startBrowserAgentElementSelect: (...args: unknown[]) =>
    startBrowserAgentElementSelect(...args),
  stopBrowserAgentElementSelect: (...args: unknown[]) =>
    stopBrowserAgentElementSelect(...args),
}));

function makeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    browserSessionId: "session-1",
    workspaceId: "workspace-1",
    label: "example",
    url: "https://example.com",
    normalizedUrl: "https://example.com/",
    origin: "https://example.com",
    title: "Example",
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

function renderChrome(
  overrides: Partial<Parameters<typeof BrowserDockEditorChrome>[0]> = {},
) {
  const session = makeSession();
  const props = {
    workspaceId: "workspace-1",
    openSessions: [session],
    activeSession: session,
    activeSessionId: session.browserSessionId,
    busy: false,
    resolvedEnabled: true,
    notice: null,
    urlDraft: "https://example.com",
    onUrlDraftChange: vi.fn(),
    onOpen: vi.fn(),
    onActivateSession: vi.fn(),
    onCloseSession: vi.fn(),
    onCloseSessions: vi.fn(),
    onNewTab: vi.fn(),
    onPopOut: vi.fn(),
    onEnable: vi.fn(),
    setBusy: vi.fn(),
    setNotice: vi.fn(),
    ...overrides,
  };
  const view = render(<BrowserDockEditorChrome {...props} />);
  return { ...view, props };
}

describe("BrowserDockEditorChrome", () => {
  beforeEach(() => {
    startBrowserAgentElementSelect.mockReset();
    stopBrowserAgentElementSelect.mockReset();
    startBrowserAgentElementSelect.mockResolvedValue(undefined);
    stopBrowserAgentElementSelect.mockResolvedValue(undefined);
  });

  it("keeps only icon actions on the bottom url bar", () => {
    renderChrome();

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByText("Attach browser context")).toBeNull();
    expect(screen.queryByText("Open")).toBeNull();
    expect(screen.queryByText("Readable")).toBeNull();

    const urlBar = document.querySelector(".browser-agent-editor-urlbar");
    expect(urlBar).toBeTruthy();
    expect(urlBar?.querySelectorAll(".browser-agent-dock-icon")).toHaveLength(4);

    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach browser context" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select page element for chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pop out to a separate window" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse browser controls" })).toBeNull();
  });

  it("shows a short file name instead of the raw file url", () => {
    renderChrome({
      openSessions: [
        makeSession({
          title: "file:///Users/demo/docs/intro.html",
          normalizedUrl: "file:///Users/demo/docs/intro.html",
        }),
      ],
    });

    expect(screen.getByRole("tab", { name: /intro\.html/i })).toBeTruthy();
    expect(screen.queryByText(/file:\/\//)).toBeNull();
  });

  it("uses the HTML fallback menu when no native context menu handler is supplied", () => {
    const onTabMenuOpenChange = vi.fn();
    renderChrome({ onTabMenuOpenChange });

    fireEvent.contextMenu(screen.getByRole("tab"));
    expect(onTabMenuOpenChange).toHaveBeenCalledWith(true);

    fireEvent.click(document.querySelector(".renderer-context-menu-backdrop")!);
    expect(onTabMenuOpenChange).toHaveBeenCalledWith(false);
  });

  it("delegates an embedded tab right-click to its WebView menu without opening an HTML overlay", () => {
    const onEmbeddedTabContextMenu = vi.fn();
    const onTabMenuOpenChange = vi.fn();
    renderChrome({ onEmbeddedTabContextMenu, onTabMenuOpenChange });

    const contextEvent = fireEvent.contextMenu(screen.getByRole("tab"), {
      clientX: 80,
      clientY: 24,
    });

    expect(contextEvent).toBe(false);
    expect(onEmbeddedTabContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
    );
    expect(screen.queryByRole("menu", { name: "Browser tab actions" })).toBeNull();
    expect(onTabMenuOpenChange).not.toHaveBeenCalledWith(true);
  });

  it("opens a close menu on tab right-click and blocks the native menu", () => {
    const first = makeSession({
      browserSessionId: "session-1",
      title: null,
      normalizedUrl: "https://one.example/",
    });
    const second = makeSession({
      browserSessionId: "session-2",
      title: null,
      normalizedUrl: "https://two.example/",
    });
    renderChrome({
      openSessions: [first, second],
      activeSession: first,
      activeSessionId: first.browserSessionId,
    });

    const tab = screen.getByRole("tab", { name: /one\.example/i });
    const contextEvent = fireEvent.contextMenu(tab, {
      clientX: 80,
      clientY: 24,
    });
    expect(contextEvent).toBe(false);

    const menu = screen.getByRole("menu", { name: "Browser tab actions" });
    expect(screen.getByRole("menuitem", { name: "Close tab" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Close other tabs" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Close tabs to the right" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Close all tabs" })).toBeTruthy();
    expect(menu).toBeTruthy();
  });

  it("disables close-other and close-right when only one tab is open", () => {
    renderChrome();

    fireEvent.contextMenu(screen.getByRole("tab"));

    expect(
      (screen.getByRole("menuitem", { name: "Close other tabs" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("menuitem", {
          name: "Close tabs to the right",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("does not put attach / pop-out / collapse on the tab bar", () => {
    renderChrome();

    const tabBar = document.querySelector(".browser-agent-editor-tabbar");
    expect(tabBar).toBeTruthy();
    expect(tabBar?.querySelector(".browser-agent-dock-icon")).toBeNull();
    expect(tabBar?.querySelector(".browser-agent-editor-attach")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Browser Dock" })).toBeNull();
  });

  it("shows a tab-bar close control when onClosePanel is provided", () => {
    const onClosePanel = vi.fn();
    renderChrome({ onClosePanel });

    const closeButton = screen.getByRole("button", { name: "Close Browser Dock" });
    const tabBar = document.querySelector(".browser-agent-editor-tabbar");
    expect(tabBar?.contains(closeButton)).toBe(true);

    fireEvent.click(closeButton);
    expect(onClosePanel).toHaveBeenCalledTimes(1);
  });

  it("invokes open from the url-bar icon", () => {
    const { props } = renderChrome();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it("toggles element select on and off instead of restarting", async () => {
    startBrowserAgentElementSelect.mockResolvedValue(undefined);
    stopBrowserAgentElementSelect.mockResolvedValue(undefined);
    renderChrome();

    const selectButton = screen.getByRole("button", {
      name: "Select page element for chat",
    });
    await act(async () => {
      fireEvent.click(selectButton);
    });
    expect(startBrowserAgentElementSelect).toHaveBeenCalledWith("session-1");
    expect(stopBrowserAgentElementSelect).not.toHaveBeenCalled();

    const armedButton = await screen.findByRole("button", {
      name: "Cancel page element selection",
    });
    expect(armedButton.className).toContain("is-on");
    expect(armedButton.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fireEvent.click(armedButton);
    });
    expect(stopBrowserAgentElementSelect).toHaveBeenCalledWith("session-1");
    expect(startBrowserAgentElementSelect).toHaveBeenCalledTimes(1);

    const idleButton = await screen.findByRole("button", {
      name: "Select page element for chat",
    });
    expect(idleButton.className).not.toContain("is-on");
    expect(idleButton.getAttribute("aria-pressed")).toBe("false");
  });
});
