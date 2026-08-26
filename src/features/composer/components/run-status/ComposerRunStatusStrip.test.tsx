/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ComposerRunStatusStrip } from "./ComposerRunStatusStrip";
import {
  applyBackgroundTaskUpdate,
  resetBackgroundTaskStoreForTests,
} from "../../../messages/utils/backgroundTaskStore";

describe("ComposerRunStatusStrip styles", () => {
  it("loads deferred todo/plan list styles from the strip host", () => {
    const stripSource = readFileSync(
      resolve(process.cwd(), "src/features/composer/components/run-status/ComposerRunStatusStrip.tsx"),
      "utf8",
    );
    expect(stripSource).toContain("loadComposerRunStatusListStyles");
    expect(stripSource).toContain("useFeatureStylesReady");
    expect(stripSource).toContain("listStylesReady");
  });

  it("keeps expanded panels out of document flow (absolute overlay)", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/composer-run-status.css"),
      "utf8",
    );
    const shellRule =
      css.match(
        /\.composer-run-status-panel-shell\s*\{([\s\S]*?)\n\}/,
      )?.[1] ?? "";
    const rootRule =
      css.match(/\.composer-run-status\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    // 展开壳绝对定位，不撑高 strip / 不挤压 messages
    expect(shellRule).toContain("position: absolute");
    expect(shellRule).toContain("bottom: calc(100% + 6px)");
    expect(rootRule).toContain("position: relative");
    expect(rootRule).toContain("overflow: visible");
    // 不得再用 in-flow 的 margin 去占位
    expect(css).not.toMatch(
      /\.composer-run-status-panel-shell\.is-open\s*\{[\s\S]*margin-bottom\s*:/,
    );
  });

  it("loads TodoList layout CSS without waiting for StatusPanel", () => {
    const stripCss = readFileSync(
      resolve(process.cwd(), "src/styles/composer-run-status.css"),
      "utf8",
    );
    const todoCss = readFileSync(
      resolve(process.cwd(), "src/styles/todo-list.css"),
      "utf8",
    );

    expect(stripCss).toMatch(/@import\s+["']\.\/todo-list\.css["']/);
    expect(todoCss).toMatch(/\.sp-todo-header\s*\{[\s\S]*display:\s*flex/);
    expect(todoCss).toMatch(/\.sp-todo-item\s*\{[\s\S]*display:\s*flex/);
  });

  it("uses success green only inside completed subagent rows", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/composer-run-status.css"),
      "utf8",
    );

    expect(css).not.toMatch(/\.composer-run-status-pill\.is-completed/);
    expect(css).toMatch(
      /\.crs-subagent-row\.is-completed \.crs-subagent-dot[\s\S]*--status-success/,
    );
    expect(css).toMatch(
      /\.crs-subagent-row\.is-completed \.crs-subagent-status[\s\S]*--status-success/,
    );
  });
});

describe("ComposerRunStatusStrip background task pill", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("renders the pill from the store even without other run-status activity", () => {
    applyBackgroundTaskUpdate("ws-1", "pi:s1", {
      toolId: "tool-1",
      task: { id: "t-1", name: "spike", status: "running" },
      source: "receipt",
    });

    const { container } = render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={null}
        backgroundTasksScope={{ workspaceId: "ws-1", threadId: "pi:s1" }}
      />,
    );
    const strip = container.querySelector('[data-testid="composer-run-status"]');
    expect(strip).not.toBeNull();
    const pill = container.querySelector(
      '[data-section="backgroundTask"]',
    ) as HTMLElement | null;
    expect(pill).not.toBeNull();
    expect(pill.classList.contains("is-running")).toBe(true);
    expect(pill.textContent).toContain("1/1");
  });

  it("expands the task panel on pill click with running rows and terminal rows", () => {
    applyBackgroundTaskUpdate("ws-1", "pi:s1", {
      toolId: "tool-1",
      task: { id: "t-1", name: "spike", status: "running", startTime: 1 },
      source: "receipt",
    });
    applyBackgroundTaskUpdate("ws-1", "pi:s1", {
      toolId: null,
      task: { id: "t-2", name: "build", status: "completed", exitCode: 0 },
      source: "notification",
    });

    const { container } = render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={null}
        backgroundTasksScope={{ workspaceId: "ws-1", threadId: "pi:s1" }}
      />,
    );

    fireEvent.click(
      container.querySelector('[data-section="backgroundTask"]') as HTMLElement,
    );

    const runningList = screen.getByTestId("composer-run-status-bg-list-running");
    expect(
      runningList.querySelectorAll('[data-testid="composer-run-status-bg-row"]'),
    ).toHaveLength(1);
    expect(runningList.textContent).toContain("spike");
    const doneList = screen.getByTestId("composer-run-status-bg-list-done");
    expect(
      doneList.querySelectorAll('[data-testid="composer-run-status-bg-row"]'),
    ).toHaveLength(1);
    expect(doneList.textContent).toContain("build");
    expect(doneList.textContent).toContain("exit 0");
  });

  it("hides the pill for threads without tasks (无任务不占位)", () => {
    applyBackgroundTaskUpdate("ws-1", "pi:s1", {
      toolId: "tool-1",
      task: { id: "t-1", status: "running" },
      source: "receipt",
    });

    const { container } = render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={null}
        backgroundTasksScope={{ workspaceId: "ws-1", threadId: "pi:other" }}
      />,
    );
    expect(
      container.querySelector('[data-testid="composer-run-status"]'),
    ).toBeNull();
  });
});

describe("ComposerRunStatusStrip", () => {
  it("renders nothing without activity", () => {
    const { container } = render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={null}
      />,
    );
    expect(container.querySelector('[data-testid="composer-run-status"]')).toBeNull();
  });

  it("renders pills and expands edited files list on click", () => {
    render(
      <ComposerRunStatusStrip
        todos={[
          { content: "【演示】任务 A", status: "completed" },
          { content: "【演示】任务 B", status: "pending" },
        ]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={{
          files: [
            {
              path: "src/a.ts",
              additions: 10,
              deletions: 2,
              status: "completed",
            },
            {
              path: "src/b.ts",
              additions: 1,
              deletions: 0,
              status: "completed",
            },
          ],
          totalAdditions: 11,
          totalDeletions: 2,
        }}
      />,
    );

    expect(screen.getByTestId("composer-run-status")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    const editTab =
      tabs.find((tab) => tab.getAttribute("data-section") === "edit") ??
      tabs[tabs.length - 1]!;
    // pill 行级 +add/-del：目标值在 data-value（NumberFlow 首帧可能仍是 0 在滚）
    expect(
      screen.getByTestId("composer-run-status-edit-additions").getAttribute(
        "data-value",
      ),
    ).toBe("11");
    expect(
      screen.getByTestId("composer-run-status-edit-deletions").getAttribute(
        "data-value",
      ),
    ).toBe("2");
    expect(editTab.getAttribute("data-section")).toBe("edit");

    fireEvent.click(editTab);
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
  });

  it("wires file revert actions into the edited files panel", async () => {
    const onRevertFile = vi.fn().mockResolvedValue(undefined);
    const onRevertAllFiles = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={{
          files: [
            {
              path: "src/a.ts",
              additions: 10,
              deletions: 2,
              status: "completed",
            },
            {
              path: "src/b.ts",
              additions: 1,
              deletions: 0,
              status: "completed",
            },
          ],
          totalAdditions: 11,
          totalDeletions: 2,
        }}
        onRevertFile={onRevertFile}
        onRevertAllFiles={onRevertAllFiles}
      />,
    );

    const editTab = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("data-section") === "edit")!;
    fireEvent.click(editTab);

    expect(screen.getByTestId("turn-files-changed-revert-all")).toBeTruthy();
    fireEvent.click(screen.getByTestId("turn-files-changed-revert-all"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "messages.turnFilesChanged.revertAllConfirmAction",
      }),
    );
    await waitFor(() => {
      expect(onRevertAllFiles).toHaveBeenCalledWith(["src/a.ts", "src/b.ts"]);
    });
  });

  it("clears the edit pill after undo-all succeeds", async () => {
    const onRevertAllFiles = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerRunStatusStrip
        todos={[]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionScopeKey="thread-1"
        sessionFileChanges={{
          files: [
            {
              path: "src/a.ts",
              additions: 10,
              deletions: 2,
              status: "completed",
            },
          ],
          totalAdditions: 10,
          totalDeletions: 2,
        }}
        onRevertAllFiles={onRevertAllFiles}
      />,
    );

    const editTab = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("data-section") === "edit")!;
    fireEvent.click(editTab);
    fireEvent.click(screen.getByTestId("turn-files-changed-revert-all"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "messages.turnFilesChanged.revertAllConfirmAction",
      }),
    );

    await waitFor(() => {
      expect(onRevertAllFiles).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(
        screen
          .queryAllByRole("tab")
          .find((tab) => tab.getAttribute("data-section") === "edit"),
      ).toBeUndefined();
    });
    // 仅编辑段时撤销全部后整条 strip 也应消失
    expect(screen.queryByTestId("composer-run-status")).toBeNull();
  });

  it("collapses pills via chrome toggle and restores them", () => {
    window.localStorage.setItem("ccgui.composer.runStatusChromeOpen", "1");
    render(
      <ComposerRunStatusStrip
        todos={[{ content: "任务 A", status: "pending" }]}
        subagents={[]}
        plan={null}
        isPlanMode={false}
        isProcessing={false}
        mergePlanIntoTodos={false}
        sessionFileChanges={null}
      />,
    );

    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    const toggle = screen.getByTestId("composer-run-status-chrome-toggle");
    fireEvent.click(toggle);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId("composer-run-status").dataset.chromeOpen).toBe(
      "false",
    );

    fireEvent.click(toggle);
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    expect(screen.getByTestId("composer-run-status").dataset.chromeOpen).toBe(
      "true",
    );
  });
});
