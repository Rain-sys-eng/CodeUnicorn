import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("sidebar codex icon tone", () => {
  it("keeps sidebar codex icons monochrome instead of hardcoding a brand color", () => {
    const sidebarComponent = readFileSync(
      resolve(process.cwd(), "src/features/app/components/Sidebar.tsx"),
      "utf8",
    );
    const sidebarStyles = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );

    expect(sidebarComponent).not.toContain('engine="codex" size={14} style={{ color: "#10a37f" }}');
    expect(sidebarStyles).toContain(".thread-engine-badge.thread-engine-codex");
    expect(sidebarStyles).toContain("color: var(--text-strong);");
    expect(sidebarStyles).not.toMatch(
      /\.thread-engine-badge\.thread-engine-shared\s*\{[^}]*#f59e0b/,
    );
  });

  it("does not recolor engine icons while a session is processing", () => {
    const sidebarStyles = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );

    // Processing must not paint the badge blue — that color only applies while
    // the row is inactive, so switching away from a running thread flips tone.
    const processingRule = sidebarStyles.match(
      /\.thread-engine-badge\.is-processing\s*\{[^}]*\}/,
    )?.[0];
    expect(processingRule).toBeTruthy();
    expect(processingRule).not.toMatch(/color\s*:/);
    expect(processingRule).not.toContain("#7db7ff");
  });
});
