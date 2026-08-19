// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceMenuAction } from "../hooks/useSidebarMenus";
import { SidebarWorkspaceMenuOverlay } from "./SidebarWorkspaceMenuOverlay";

const translations: Record<string, string> = {
  "sidebar.sessionActionsGroup": "New session",
  "sidebar.workspaceActionsGroup": "Workspace actions",
  "sidebar.unavailableTag": "Unavailable",
  "common.refresh": "Refresh",
  "common.showOnWorkspaceRow": "Show on project row",
};

function t(key: string) {
  return translations[key] ?? key;
}

function createCodexAction(): WorkspaceMenuAction {
  return {
    id: "new-session-codex",
    label: "Codex",
    iconKind: "engine-codex",
    submenuTitle: "Provider selection",
    selectionHint: "Selected. Click Codex to create a session.",
    onSelect: vi.fn(),
    children: [
      {
        id: "provider-disk",
        label: "Disk config",
        badgeLabel: "Disk config",
        iconKind: "engine-codex",
        keepMenuOpen: true,
        onSelect: vi.fn(),
      },
      {
        id: "provider-openai",
        label: "OpenAI",
        badgeLabel: "Custom config",
        iconKind: "engine-codex",
        keepMenuOpen: true,
        onSelect: vi.fn(),
      },
    ],
  };
}

function createSharedAction(): WorkspaceMenuAction {
  return {
    id: "new-session-shared",
    label: "Shared CLI",
    iconKind: "new-shared",
    submenuOnly: true,
    onSelect: vi.fn(),
    children: [
      {
        id: "new-session-shared-grok",
        label: "Grok CLI",
        iconKind: "engine-grok",
        onSelect: vi.fn(),
      },
    ],
  };
}

describe("SidebarWorkspaceMenuOverlay", () => {
  it("opens submenu-only actions on click without running their default action", () => {
    const sharedAction = createSharedAction();
    const onAction = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [sharedAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Shared CLI" }));

    expect(
      screen.getByRole("menuitemradio", { name: "Grok CLI" }),
    ).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(sharedAction.onSelect).not.toHaveBeenCalled();
  });

  it("still opens an unavailable parent submenu so the user can pick another provider", () => {
    const claudeAction: WorkspaceMenuAction = {
      id: "new-session-claude",
      label: "Claude Code",
      iconKind: "engine-claude",
      unavailable: true,
      statusLabel: "Provider unavailable",
      onSelect: vi.fn(),
      children: [
        {
          id: "provider-local",
          label: "Local",
          iconKind: "engine-claude",
          keepMenuOpen: true,
          onSelect: vi.fn(),
        },
        {
          id: "provider-dead",
          label: "DS-zkp",
          iconKind: "engine-claude",
          unavailable: true,
          keepMenuOpen: true,
          onSelect: vi.fn(),
        },
      ],
    };
    const onAction = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [claudeAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    fireEvent.click(
      screen.getByRole("menuitem", { name: /Claude Code/ }),
    );

    expect(screen.getByRole("menuitemradio", { name: "Local" })).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(claudeAction.onSelect).not.toHaveBeenCalled();
  });

  it("defaults workspace actions to collapsed and toggles them from the group header", () => {
    const reloadAction: WorkspaceMenuAction = {
      id: "reload-threads",
      label: "Reload threads",
      iconKind: "reload",
      onSelect: vi.fn(),
    };

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [createCodexAction()],
            },
            {
              id: "workspace-actions",
              label: "Workspace actions",
              collapsible: true,
              defaultCollapsed: true,
              actions: [reloadAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Workspace actions" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menuitem", { name: "Reload threads" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Codex" })).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("menuitem", { name: "Reload threads" }),
    ).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menuitem", { name: "Reload threads" })).toBeNull();
  });

  it("renders child options in a fixed flyout outside the root menu", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 560,
    });
    const codexAction = createCodexAction();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const trigger = screen.getByRole("menuitem", { name: "Codex" });
    const rootMenu = screen.getByRole("menu", { name: "New session" });
    rootMenu.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 32,
          right: 272,
          top: 28,
          bottom: 160,
          width: 240,
          height: 132,
          x: 32,
          y: 28,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    trigger.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 40,
          right: 296,
          top: 96,
          bottom: 130,
          width: 256,
          height: 34,
          x: 40,
          y: 96,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    fireEvent.mouseEnter(trigger);

    const submenu = screen.getByRole("menu", { name: "Codex" });
    expect(submenu.classList.contains("sidebar-workspace-submenu")).toBe(true);
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-x")).toBe("272px");
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-y")).toBe("96px");
    expect(screen.getByText("Provider selection")).toBeTruthy();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getAllByText("Disk config")).toHaveLength(2);
    expect(screen.getByText("Custom config")).toBeTruthy();
  });

  it("shows the selection hint after picking a provider that keeps the menu open", () => {
    const codexAction = createCodexAction();
    const onAction = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Codex" }));
    expect(
      screen.queryByText("Selected. Click Codex to create a session."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /OpenAI/ }));

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "provider-openai" }),
    );
    expect(
      screen.getByText("Selected. Click Codex to create a session."),
    ).toBeTruthy();
  });

  it("toggles pinned workspace actions without running the action", () => {
    const onAction = vi.fn();
    const onSelect = vi.fn();
    const onTogglePinned = vi.fn();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "workspace-actions",
              label: "Workspace actions",
              actions: [
                {
                  id: "reload-threads",
                  label: "Reload threads",
                  iconKind: "reload",
                  onSelect,
                  pinnable: true,
                  pinned: true,
                  onTogglePinned,
                },
              ],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={onAction}
        renderIcon={() => null}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Show on project row" });
    expect((checkbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(checkbox);

    expect(onTogglePinned).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the child flyout to the left of the root menu near the viewport edge", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 620,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 560,
    });
    const codexAction = createCodexAction();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 330,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const trigger = screen.getByRole("menuitem", { name: "Codex" });
    const rootMenu = screen.getByRole("menu", { name: "New session" });
    rootMenu.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 330,
          right: 570,
          top: 28,
          bottom: 160,
          width: 240,
          height: 132,
          x: 330,
          y: 28,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    trigger.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 338,
          right: 562,
          top: 96,
          bottom: 130,
          width: 224,
          height: 34,
          x: 338,
          y: 96,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    fireEvent.mouseEnter(trigger);

    const submenu = screen.getByRole("menu", { name: "Codex" });
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-x")).toBe("70px");
    expect(submenu.style.getPropertyValue("--sidebar-workspace-submenu-y")).toBe("96px");
  });

  it("opens the child flyout with ArrowRight on the parent menu item", () => {
    const codexAction = createCodexAction();

    render(
      <SidebarWorkspaceMenuOverlay
        menu={{
          x: 32,
          y: 28,
          groups: [
            {
              id: "new-session",
              label: "New session",
              actions: [codexAction],
            },
          ],
        }}
        t={t}
        onClose={vi.fn()}
        onAction={vi.fn()}
        renderIcon={() => null}
      />,
    );

    const trigger = screen.getByRole("menuitem", { name: "Codex" });
    expect(screen.queryByRole("menu", { name: "Codex" })).toBeNull();

    fireEvent.keyDown(trigger, { key: "ArrowRight" });

    expect(screen.getByRole("menu", { name: "Codex" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: /OpenAI/ })).toBeTruthy();
  });

  it("portals the overlay to document.body so wallpaper stacking cannot bury it", () => {
    const { container } = render(
      <div className="sidebar">
        <SidebarWorkspaceMenuOverlay
          menu={{
            x: 32,
            y: 28,
            groups: [
              {
                id: "new-session",
                label: "New session",
                actions: [createSharedAction()],
              },
            ],
          }}
          t={t}
          onClose={vi.fn()}
          onAction={vi.fn()}
          renderIcon={() => null}
        />
      </div>,
    );

    const menu = screen.getByRole("menu", { name: "New session" });
    expect(menu.closest(".sidebar")).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
    expect(container.querySelector(".sidebar-workspace-menu")).toBeNull();
  });
});
