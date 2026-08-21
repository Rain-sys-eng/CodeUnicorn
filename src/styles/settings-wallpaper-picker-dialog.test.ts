import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsCss = readFileSync(
  new URL("./settings.part2.basic-redesign.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("settings wallpaper picker dialog", () => {
  it("keeps the portaled picker opaque and theme-owned, not inherited from settings-section-basic", () => {
    expect(settingsCss).toContain(
      '.settings-wallpaper-picker-dialog[data-slot="dialog-content"],\n[data-slot="dialog-content"].settings-wallpaper-picker-dialog {',
    );
    expect(settingsCss).toContain("background-color: #ffffff;");
    expect(settingsCss).toContain("background-image: none;");
    expect(settingsCss).toContain("backdrop-filter: none;");
    expect(settingsCss).not.toMatch(
      /\.settings-wallpaper-picker-dialog[^{]*\{[^}]*background:\s*var\(--settings-basic-surface,\s*#fff\)/s,
    );
  });

  it("paints a solid dark surface when appearance is dark or dim", () => {
    expect(settingsCss).toContain(
      ':root[data-theme="dark"] .settings-wallpaper-picker-dialog[data-slot="dialog-content"]',
    );
    expect(settingsCss).toContain(
      ':root[data-theme="dim"] .settings-wallpaper-picker-dialog[data-slot="dialog-content"]',
    );
    expect(settingsCss).toContain(
      ':root[data-appearance="dark"] .settings-wallpaper-picker-dialog[data-slot="dialog-content"]',
    );
    expect(settingsCss).toContain("background-color: #1c1c1e;");
    expect(settingsCss).toContain(
      ".settings-wallpaper-picker-dialog .settings-pref-segmented",
    );
    expect(settingsCss).toContain(
      ".settings-wallpaper-picker-dialog .settings-web-btn",
    );
    expect(settingsCss).toContain(
      ".settings-wallpaper-picker-dialog .settings-pref-reset",
    );
    expect(settingsCss).toContain(
      '.settings-wallpaper-picker-dialog [data-slot="dialog-title"]',
    );
  });
});
