import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readStyleSheet(fileName: string) {
  return readFileSync(
    fileURLToPath(new URL(`./${fileName}`, import.meta.url)),
    "utf8",
  );
}

const buttonsCss = readStyleSheet("buttons.css");
const systemThemeCss = readStyleSheet("themes.system.css");
const lightThemeCss = readStyleSheet("themes.light.css");
const intentCanvasCss = readStyleSheet("intent-canvas.css");
const vendorDialogCss = readStyleSheet("settings.vendor-dialog.css");
const memoryPickGateCss = readStyleSheet("memory-pick-gate.css");

describe("global primary button contrast", () => {
  it("keeps invert-fill labels on a light foreground instead of --bg-primary", () => {
    // Regression: Windows close-confirm (and other AlertDialog primary
    // actions) used `color: var(--bg-primary)`. System-light flipped
    // `--text-primary` to dark while `--bg-primary` stayed on the dark
    // :root surface, producing a black pill with an invisible label.
    const primaryRule = buttonsCss.match(/\.primary\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(primaryRule).toContain("background: var(--text-primary);");
    expect(primaryRule).toContain(
      "color: var(--primary-foreground, #ffffff);",
    );
    expect(primaryRule).not.toContain("color: var(--bg-primary);");
  });

  it("keeps sibling invert-fill CTAs on a light foreground", () => {
    expect(intentCanvasCss).toContain(
      "color: var(--primary-foreground, #ffffff);",
    );
    expect(intentCanvasCss).not.toContain("color: var(--bg-primary);");
    expect(vendorDialogCss).toContain(
      "color: var(--primary-foreground, #fff);",
    );
    expect(vendorDialogCss).not.toContain("color: var(--surface-card, #fff);");
  });

  it("defines light invert-fill tokens for explicit-light and system-light", () => {
    expect(lightThemeCss).toContain("--bg-primary: #ffffff;");
    expect(systemThemeCss).toMatch(
      /:root:not\(\[data-theme\]\)\s*\{[\s\S]*--bg-primary:\s*#ffffff;/,
    );
    expect(systemThemeCss).toMatch(
      /:root:not\(\[data-theme\]\)\s*\{[\s\S]*--text-secondary:\s*#1a1a1a;/,
    );
    expect(systemThemeCss).toMatch(
      /:root:not\(\[data-theme\]\)\s*\{[\s\S]*--color-tool-bg:\s*rgba\(0, 0, 0, 0\.04\);/,
    );
  });

  it("applies memory-pick-gate light tokens on system-light as well as explicit light", () => {
    expect(memoryPickGateCss).toMatch(
      /@media \(prefers-color-scheme: light\) \{[\s\S]*:root:not\(\[data-theme\]\) \.memory-pick-gate/,
    );
  });
});
