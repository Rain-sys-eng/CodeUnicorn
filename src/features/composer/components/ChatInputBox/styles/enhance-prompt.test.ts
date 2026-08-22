import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const enhancePromptCss = readFileSync(
  fileURLToPath(new URL("./enhance-prompt.css", import.meta.url)),
  "utf8",
);

describe("prompt enhancer light-theme actions", () => {
  it("keeps primary actions blue and gives disabled actions a readable light-blue state", () => {
    expect(enhancePromptCss).toMatch(
      /:root\[data-theme="light"\] \.prompt-enhancer-btn\.primary\s*\{[^}]*background:\s*#2563eb[^}]*color:\s*#ffffff[^}]*opacity:\s*1/s,
    );
    expect(enhancePromptCss).toMatch(
      /:root\[data-theme="light"\] \.prompt-enhancer-btn\.primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*#1d4ed8[^}]*opacity:\s*1/s,
    );
    expect(enhancePromptCss).toMatch(
      /:root\[data-theme="light"\] \.prompt-enhancer-btn\.primary:disabled\s*\{[^}]*background:\s*#dbeafe[^}]*color:\s*#5b7db1[^}]*opacity:\s*1/s,
    );
  });

  it("raises portaled ModelSelect menus above the enhancer overlay", () => {
    expect(enhancePromptCss).toMatch(
      /\.prompt-enhancer-overlay\s*\{[^}]*z-index:\s*2000/s,
    );
    expect(enhancePromptCss).toMatch(
      /\.prompt-enhancer-model-menu\s*\{[^}]*z-index:\s*2100/s,
    );
  });
});
