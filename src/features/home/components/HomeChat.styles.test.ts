import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("HomeChat styles", () => {
  it("does not desaturate the homepage engine icon", () => {
    const cssPath = resolve(process.cwd(), "src/styles/home-chat.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/\.home-chat-engine-icon\s*\{[\s\S]*grayscale\(/);
  });

  it("keeps homepage codex context accents monochrome", () => {
    const homeCssPath = resolve(process.cwd(), "src/styles/home-chat.css");
    const contextBarCssPath = resolve(
      process.cwd(),
      "src/features/composer/components/ChatInputBox/styles/context-bar.css",
    );
    const homeCss = readFileSync(homeCssPath, "utf8");
    const contextBarCss = readFileSync(contextBarCssPath, "utf8");

    expect(homeCss).toContain("--codex-context-accent:");
    expect(homeCss).toContain("--codex-context-accent-track:");
    expect(contextBarCss).toContain("var(--codex-context-accent, var(--text-primary))");
    expect(contextBarCss).toContain("var(--codex-context-accent-track, color-mix(in srgb, var(--text-primary) 24%, transparent))");
  });

  it("styles the homepage workspace popup like a lightweight anchored menu", () => {
    const cssPath = resolve(process.cwd(), "src/styles/home-chat.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toContain('.home-chat-workspace-picker-popover[data-slot="popover-content"]');
    expect(css).toContain("width: min(304px, calc(100vw - 24px)) !important;");
    expect(css).toContain("overflow: hidden;");
  });

  it("adds a searchable workspace panel with a dedicated add-project action", () => {
    const cssPath = resolve(process.cwd(), "src/styles/home-chat.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toContain(".home-chat-workspace-picker-search");
    expect(css).toContain("grid-template-columns: 16px 1fr;");
    expect(css).toContain(".home-chat-workspace-picker-add");
  });

  it("keeps homepage workspace selection states neutral and understated", () => {
    const cssPath = resolve(process.cwd(), "src/styles/home-chat.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toContain('.home-chat-workspace-picker-item[data-selected="true"]');
    expect(css).toContain("background: #f7f5f2;");
    expect(css).toContain("background: #f5f5f4;");
  });

  it("keeps the homepage composer send button blue across themes", () => {
    const cssPath = resolve(process.cwd(), "src/styles/home-chat.css");
    const css = readFileSync(cssPath, "utf8");
    const submitRule =
      css.match(/\.home-chat-composer-host \.submit-button\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const lightSubmitRule =
      css.match(/\[data-theme="light"\] \.home-chat \.home-chat-composer-host \.submit-button\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const systemLightSubmitRule =
      css.match(/:root:not\(\[data-theme\]\) \.home-chat \.home-chat-composer-host \.submit-button\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";

    expect(submitRule).toContain("--composer-submit-button-bg: #2563eb;");
    expect(submitRule).toContain("background: var(--composer-submit-button-bg);");
    expect(lightSubmitRule).toContain("background: var(--composer-submit-button-bg);");
    expect(systemLightSubmitRule).toContain("background: var(--composer-submit-button-bg);");
  });

  it("inherits the shared compact submit button geometry at every viewport width", () => {
    const homeCss = readFileSync(
      resolve(process.cwd(), "src/styles/home-chat.css"),
      "utf8",
    );
    const sharedButtonCss = readFileSync(
      resolve(
        process.cwd(),
        "src/features/composer/components/ChatInputBox/styles/buttons.css",
      ),
      "utf8",
    );
    const sharedSubmitRule =
      sharedButtonCss.match(/\.submit-button\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(sharedSubmitRule).toContain("width: 26px;");
    expect(sharedSubmitRule).toContain("height: 26px;");
    expect(homeCss).not.toMatch(
      /\.home-chat-composer-host \.submit-button\s*\{[^}]*(?:width|height)\s*:/s,
    );
  });

  it("keeps the homepage workspace selector close to the composer", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/home-chat.css"),
      "utf8",
    );
    const metaRule =
      css.match(/\.home-chat-composer-meta\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(metaRule).toContain("margin-top: 4px;");
    expect(metaRule).not.toContain("margin-top: 10px;");
  });

  it("does not override shared input-area padding or min-height on Home composer", () => {
    const homeCss = readFileSync(
      resolve(process.cwd(), "src/styles/home-chat.css"),
      "utf8",
    );
    const sharedInputCss = readFileSync(
      resolve(
        process.cwd(),
        "src/features/composer/components/ChatInputBox/styles/input-area.css",
      ),
      "utf8",
    );
    const sharedWrapperRule =
      sharedInputCss.match(/\.input-editable-wrapper\s*\{([\s\S]*?)\n\}/)?.[1] ??
      "";

    expect(sharedWrapperRule).toContain("padding: 12px 14px 10px;");
    expect(homeCss).not.toMatch(
      /\.home-chat-composer-host \.input-editable-wrapper\s*\{/s,
    );
    expect(homeCss).not.toMatch(
      /\.home-chat-composer-host \.input-editable\s*\{/s,
    );
  });
});
