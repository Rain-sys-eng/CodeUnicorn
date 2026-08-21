import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const inputAreaCss = readFileSync(
  fileURLToPath(new URL("./input-area.css", import.meta.url)),
  "utf8",
);

const dropdownCss = readFileSync(
  fileURLToPath(new URL("./dropdown.css", import.meta.url)),
  "utf8",
);

function getCssRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

describe("composer input-area scrollbar", () => {
  it("clips horizontal overflow and hides the horizontal native bar", () => {
    const rule = getCssRule(inputAreaCss, ".input-editable-wrapper");
    const horizontalBarRule = getCssRule(
      inputAreaCss,
      ".input-editable-wrapper::-webkit-scrollbar:horizontal",
    );

    expect(rule).toContain("overflow-x: clip;");
    expect(rule).toContain("overflow-y: auto;");
    expect(rule).toContain("min-width: 0;");
    expect(horizontalBarRule).toContain("display: none;");
    expect(horizontalBarRule).toContain("height: 0;");
  });

  it("does not keep a local thick composer scrollbar; thin chrome comes from .scrollable", () => {
    expect(inputAreaCss).not.toMatch(
      /\.input-editable-wrapper::-webkit-scrollbar\s*\{[^}]*width:\s*4px/s,
    );
  });
});

describe("composer portal tooltip / dropdown theme fallbacks", () => {
  it("uses theme-aware surfaces for tool-menu CSS tooltips (mail / live / enhance)", () => {
    // Regression: DropdownMenuContent portals to body, so these tooltips only
    // see :root tokens. A hard `var(--tooltip-bg, #1a1c24)` fallback painted a
    // black card on system-light when --tooltip-bg was still the dark default.
    const rule =
      inputAreaCss.match(
        /\.context-tool-btn\.has-tooltip:hover::after[\s\S]*?\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(rule).toContain("--tooltip-bg");
    expect(rule).toContain("--surface-popover");
    expect(rule).toContain("--popover-foreground");
    expect(rule).not.toMatch(/background:\s*var\(--tooltip-bg,\s*#1a1c24\)/);
  });

  it("uses theme-aware surfaces for code-snippet tag tooltips", () => {
    const rule = getCssRule(inputAreaCss, ".code-snippet-tag.has-tooltip:hover::after");

    expect(rule).toContain("--tooltip-bg");
    expect(rule).toContain("--surface-popover");
    expect(rule).not.toMatch(/background:\s*var\(--tooltip-bg,\s*#1a1c24\)/);
  });

  it("uses theme-aware surfaces for fixed completion dropdown portals", () => {
    const rule = getCssRule(dropdownCss, ".completion-dropdown");

    expect(rule).toContain("--dropdown-bg");
    expect(rule).toContain("--surface-popover");
    expect(rule).not.toMatch(/background:\s*var\(--dropdown-bg,\s*#252526\)/);
  });
});
