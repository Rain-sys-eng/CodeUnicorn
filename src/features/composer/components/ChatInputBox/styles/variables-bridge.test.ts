import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const variablesBridgeCss = readFileSync(
  fileURLToPath(new URL("./variables-bridge.css", import.meta.url)),
  "utf8",
);

describe("chat input variables bridge", () => {
  it("defines monochrome codex context accents for shared composers", () => {
    expect(variablesBridgeCss).toContain("--codex-context-accent:");
    expect(variablesBridgeCss).toContain("--codex-context-accent-track:");
    expect(variablesBridgeCss).toContain("var(--text-primary, #e6e7ea) 86%");
    expect(variablesBridgeCss).toContain("var(--text-primary, #333333) 84%");
  });

  it("keeps dark composer placeholder and toolbar ink on the bright-dim ramp", () => {
    expect(variablesBridgeCss).toContain("--input-placeholder: var(--text-faint, #b4b4b4);");
    expect(variablesBridgeCss).toContain("--text-secondary: var(--text-muted, #c8c8c8);");
    expect(variablesBridgeCss).toContain("--text-muted: var(--text-faint, #b4b4b4);");
    expect(variablesBridgeCss).not.toContain(
      "--input-placeholder: color-mix(in srgb, var(--text-muted, #b3b3b3) 82%, transparent);",
    );
  });
});
