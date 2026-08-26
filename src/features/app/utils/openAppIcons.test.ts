import { beforeAll, describe, expect, it } from "vitest";
import {
  CHROME_APP_ICON,
  GENERIC_APP_ICON,
  SUBLIME_APP_ICON,
  ensureKnownOpenAppIconsLoaded,
  getKnownOpenAppIcon,
  getKnownOpenAppIconByRef,
  resolveOpenAppDisplayIcon,
} from "./openAppIcons";

describe("openAppIcons", () => {
  // PNG icon URLs live in lazy chunks; hydrate the cache like production
  // consumers do (via useKnownOpenAppIcons) before asserting on sync getters.
  beforeAll(async () => {
    await ensureKnownOpenAppIconsLoaded();
  });
  it("matches icons by app path / label without double-encoding colors", () => {
    const chrome = getKnownOpenAppIconByRef(
      "/Applications/Google Chrome.app",
      "Chrome",
    );
    const sublime = getKnownOpenAppIconByRef(
      "/Applications/Sublime Text.app",
      "Sublime",
    );
    expect(chrome).toBe(CHROME_APP_ICON);
    expect(sublime).toBe(SUBLIME_APP_ICON);
    // Double-encoded %2523 would break fills into black squares.
    expect(chrome).not.toContain("%2523");
    expect(sublime).not.toContain("%2523");
    expect(chrome).toContain("%23"); // encodeURIComponent('#')
    expect(sublime).toContain("FF9800");
  });

  it("uses the official IntelliJ product icon instead of the three-bar placeholder", () => {
    const ideaIcon = getKnownOpenAppIcon("idea");
    expect(ideaIcon).not.toBeNull();
    expect(getKnownOpenAppIcon("intellij")).toBe(ideaIcon);
    expect(ideaIcon).not.toContain("data:image/svg+xml");
    expect(ideaIcon).toMatch(/idea\.png/);
  });

  it("prefers OS-extracted icons over built-in fallbacks", () => {
    const osIcon = "data:image/png;base64,aaa";
    const icon = resolveOpenAppDisplayIcon(
      {
        id: "chrome-1",
        kind: "app",
        label: "Google Chrome",
        appName: "/Applications/Google Chrome.app",
        command: null,
      },
      { "chrome-1": osIcon },
    );
    expect(icon).toBe(osIcon);
  });

  it("uses finder glyph for file manager kind", () => {
    const icon = resolveOpenAppDisplayIcon({
      id: "uuid-finder",
      kind: "finder",
      label: "访达",
      appName: null,
      command: null,
    });
    expect(icon).toBeTruthy();
    expect(icon).not.toBe(GENERIC_APP_ICON);
  });

  it("uses command glyph for empty-ish command targets", () => {
    const icon = resolveOpenAppDisplayIcon({
      id: "cmd-1",
      kind: "command",
      label: "命令",
      appName: null,
      command: "",
    });
    expect(icon).toBeTruthy();
  });
});
