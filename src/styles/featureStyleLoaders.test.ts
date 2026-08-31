import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loaderSource = readFileSync(
  new URL("./featureStyleLoaders.ts", import.meta.url),
  "utf8",
);

describe("feature style loader contracts", () => {
  it("loads shared diff styles before Git History is considered ready", () => {
    const gitHistoryLoader = loaderSource.slice(
      loaderSource.indexOf("export function loadGitHistoryStyles"),
      loaderSource.indexOf("export function loadExtensionsStyles"),
    );

    expect(gitHistoryLoader).toContain("loadDiffStyles()");
    expect(gitHistoryLoader).toContain('import("./git-history.css")');
    expect(gitHistoryLoader).toContain("Promise.all");
  });

  it("loads the shared CodeMirror compare styles with the Git diff surface", () => {
    const diffLoader = loaderSource.slice(
      loaderSource.indexOf("export function loadDiffStyles"),
      loaderSource.indexOf("export function loadRuntimeConsoleStyles"),
    );

    expect(diffLoader).toContain('import("./file-view-panel.css")');
  });

  it("loads vendor model-manager dialog styles without the full settings bundle", () => {
    const vendorLoader = loaderSource.slice(
      loaderSource.indexOf("export function loadVendorModelManagerStyles"),
      loaderSource.indexOf("export function loadReleaseNotesStyles"),
    );

    expect(vendorLoader).toContain('import("./settings.vendor-dialog.css")');
    expect(vendorLoader).toContain('import("./settings.part2.vendor-models.css")');
    expect(vendorLoader).not.toContain('import("./settings.css")');
  });

  it("exposes P1-1 deferred startup CSS loaders", () => {
    for (const name of [
      "loadTerminalStyles",
      "loadPlanStyles",
      "loadToolBlockStyles",
      "loadStatusPanelStyles",
      "loadSubagentStyles",
      "loadSessionActivityStyles",
      "loadDebugStyles",
      "loadWorktreeModalStyles",
      "loadCloneModalStyles",
    ]) {
      expect(loaderSource).toContain(`export function ${name}`);
    }
    expect(loaderSource).toContain('import("./terminal.css")');
    expect(loaderSource).toContain('import("./tool-blocks.css")');
    expect(loaderSource).toContain('import("./status-panel.css")');
    expect(loaderSource).toContain('import("./agent-bridge.css")');
  });

  it("loads run-status todo/plan list slices without the status-panel bundle", () => {
    const runStatusLoader = loaderSource.slice(
      loaderSource.indexOf("export function loadComposerRunStatusListStyles"),
      loaderSource.indexOf("export function loadSubagentStyles"),
    );

    expect(runStatusLoader).toContain('import("./todo-list.css")');
    expect(runStatusLoader).toContain('import("./status-panel.plan-list.css")');
    expect(runStatusLoader).not.toContain('import("./status-panel.css")');
    expect(runStatusLoader).not.toContain('import("./engine-task-output.css")');
  });
});

describe("bootstrap critical CSS surface (P1-1)", () => {
  it("keeps deferred surfaces out of bootstrap.ts static imports", () => {
    const bootstrapSource = readFileSync(
      new URL("../bootstrap.ts", import.meta.url),
      "utf8",
    );
    for (const deferred of [
      "terminal.css",
      "plan.css",
      "tool-blocks.css",
      "tool-call-block.css",
      "status-panel.css",
      "multi-agent.css",
      "agent-bridge.css",
      "session-activity.css",
      "debug.css",
      "worktree-modal.css",
      "clone-modal.css",
    ]) {
      expect(bootstrapSource).not.toContain(`import "./styles/${deferred}"`);
    }
    for (const critical of [
      "globals.css",
      "sidebar.css",
      "home.css",
      "composer.css",
      "messages.css",
      // Chat column host layout (ConversationInspectorSplit) — must stay critical
      "subagent-ui.css",
      "scrollbars.css",
    ]) {
      expect(bootstrapSource).toContain(critical);
    }
  });
});
