// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { resetClientStorageForTests } from "../../../services/clientStorage";
import type { ThreadSummary } from "../../../types";
import { PinnedThreadList } from "./PinnedThreadList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "sidebar.pinned": "Pinned",
        "sidebar.pinnedCount": "· {{count}}",
        "sidebar.collapsePinnedSection": "Collapse pinned",
        "sidebar.expandPinnedSection": "Expand pinned",
        "sidebar.collapsePinnedDay": "Collapse {{date}}",
        "sidebar.expandPinnedDay": "Expand {{date}}",
        "threads.autoNaming": "Auto naming...",
        "threads.pin": "Pin",
        "threads.unpin": "Unpin",
        "threads.subagentTag": "Subagent",
        "threads.providerContinuationShort": "Continued",
        "threads.providerContinuationHint": "Provider continuation",
        "threads.providerContinuationFamilyGroup":
          "Continued sessions · {{count}}",
        "threads.subagentTreeExpand": "Expand subagent tree",
        "threads.subagentTreeCollapse": "Collapse subagent tree",
        "threads.runtimeProcessing": "Processing",
        "threads.runtimeReviewing": "Reviewing",
        "threads.runtimeCompleted": "Completed",
      };
      const template = translations[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) =>
        String(options?.[token] ?? ""),
      );
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

function localStamp(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour, 0, 0).getTime();
}

const thread: ThreadSummary = {
  id: "thread-1",
  name: "Pinned Alpha",
  updatedAt: 1000,
};

const otherThread: ThreadSummary = {
  id: "thread-2",
  name: "Pinned Beta",
  updatedAt: 800,
};

const statusMap = {
  "thread-1": { isProcessing: false, hasUnread: false, isReviewing: true },
  "thread-2": { isProcessing: true, hasUnread: false, isReviewing: false },
};

const baseProps = {
  rows: [{ thread, depth: 0, workspaceId: "ws-1", workspacePath: "/tmp/ws-1" }],
  activeWorkspaceId: "ws-1",
  activeThreadId: "thread-1",
  threadStatusById: statusMap,
  getThreadTime: () => "1h",
  isThreadPinned: () => true,
  isThreadAutoNaming: () => false,
  onToggleThreadPin: vi.fn(),
  onSelectThread: vi.fn(),
  onShowThreadMenu: vi.fn(),
};

describe("PinnedThreadList", () => {
  beforeEach(() => {
    resetClientStorageForTests();
  });

  it("puts yyyy-mm-dd at the outer layer and only opens the latest day", () => {
    const latestStamp = localStamp(2026, 8, 18);
    const olderStamp = localStamp(2026, 8, 17);
    const { container } = render(
      <PinnedThreadList
        {...baseProps}
        activeThreadId={null}
        rows={[
          {
            thread: { ...thread, id: "today", name: "Today pin", updatedAt: latestStamp },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
          {
            thread: {
              ...otherThread,
              id: "yesterday",
              name: "Yesterday pin",
              updatedAt: olderStamp,
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    // 总折叠行回归：段头 = pin icon + "Pinned" + 数量 + chevron
    const sectionHeader = container.querySelector(
      "[data-sidebar-pinned-section-header]",
    );
    expect(sectionHeader).toBeTruthy();
    expect(sectionHeader?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getByText("· 2")).toBeTruthy();
    // 日期头仍无 chevron / 数量角标
    expect(container.querySelector(".sidebar-pinned-day-chevron")).toBeNull();

    const latestHeader = container.querySelector(
      '[data-sidebar-pinned-day-header="2026-08-18"]',
    );
    expect(latestHeader?.classList.contains("sidebar-section-header")).toBe(
      true,
    );
    expect(latestHeader?.textContent).toBe("2026-08-18");
    expect(latestHeader?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("2026-08-17")).toBeTruthy();
    expect(screen.getByText("Today pin")).toBeTruthy();
    expect(screen.queryByText("Yesterday pin")).toBeNull();
    expect(screen.queryByText("今天")).toBeNull();
    expect(screen.queryByText("昨天")).toBeNull();
    expect(screen.queryByText("更早")).toBeNull();
  });

  it("collapses and expands the whole pinned section from the master row", () => {
    const latestStamp = localStamp(2026, 8, 18);
    const olderStamp = localStamp(2026, 8, 17);
    const { container } = render(
      <PinnedThreadList
        {...baseProps}
        activeThreadId={null}
        rows={[
          {
            thread: { ...thread, id: "today", name: "Today pin", updatedAt: latestStamp },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
          {
            thread: {
              ...otherThread,
              id: "yesterday",
              name: "Yesterday pin",
              updatedAt: olderStamp,
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse pinned" }));

    // 整区收起：只留总折叠行，日组头与会话行都不渲染
    expect(
      container.querySelector("[data-sidebar-pinned-section-header]"),
    ).toBeTruthy();
    expect(
      container.querySelector("[data-sidebar-pinned-day-header]"),
    ).toBeNull();
    expect(screen.queryByText("Today pin")).toBeNull();

    // 再点展开：日组恢复，且日折叠态不变（最新日开、更早收）
    fireEvent.click(screen.getByRole("button", { name: "Expand pinned" }));
    expect(screen.getByText("2026-08-18")).toBeTruthy();
    expect(screen.getByText("Today pin")).toBeTruthy();
    expect(screen.queryByText("Yesterday pin")).toBeNull();
  });

  it("persists the master fold state across remounts", () => {
    const { unmount } = render(
      <PinnedThreadList {...baseProps} activeThreadId={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse pinned" }));
    unmount();

    const { container } = render(
      <PinnedThreadList {...baseProps} activeThreadId={null} />,
    );
    // 重挂载后仍是折叠态，不先展开再闪回
    expect(
      container.querySelector("[data-sidebar-pinned-day-header]"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand pinned" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
  });

  it("does not auto-expand the collapsed section for the active thread", () => {
    const first = render(
      <PinnedThreadList {...baseProps} activeThreadId="thread-1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse pinned" }));
    first.unmount();

    // 当前会话在置顶区也不冲开总折叠
    const { container } = render(
      <PinnedThreadList {...baseProps} activeThreadId="thread-1" />,
    );
    expect(
      container.querySelector("[data-sidebar-pinned-day-header]"),
    ).toBeNull();
    expect(screen.queryByText("Pinned Alpha")).toBeNull();
    expect(
      container.querySelector("[data-sidebar-pinned-section-header]"),
    ).toBeTruthy();
  });

  it("expands only the clicked calendar day", () => {
    render(
      <PinnedThreadList
        {...baseProps}
        activeThreadId={null}
        rows={[
          {
            thread: {
              ...thread,
              id: "today",
              name: "Today pin",
              updatedAt: localStamp(2026, 8, 18),
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
          {
            thread: {
              ...otherThread,
              id: "yesterday",
              name: "Yesterday pin",
              updatedAt: localStamp(2026, 8, 17),
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand 2026-08-17" }));

    expect(screen.getByText("Today pin")).toBeTruthy();
    expect(screen.getByText("Yesterday pin")).toBeTruthy();
  });

  it("auto-expands the active thread day without collapsing the section", async () => {
    render(
      <PinnedThreadList
        {...baseProps}
        activeThreadId="yesterday"
        rows={[
          {
            thread: {
              ...thread,
              id: "today",
              name: "Today pin",
              updatedAt: localStamp(2026, 8, 18),
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
          {
            thread: {
              ...otherThread,
              id: "yesterday",
              name: "Yesterday pin",
              updatedAt: localStamp(2026, 8, 17),
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Yesterday pin")).toBeTruthy();
    });
    expect(screen.getByText("Today pin")).toBeTruthy();
    // 段保持展开：总折叠行在且 aria-expanded=true（日级 auto-expand 不动总折叠）
    const sectionHeader = screen.getByRole("button", { name: "Collapse pinned" });
    expect(sectionHeader.getAttribute("aria-expanded")).toBe("true");
  });

  it("hydrates pinned rows in StrictMode without mounting Radix row anchors", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const rows = Array.from({ length: 6 }, (_, index) => ({
      thread: { ...thread, id: `pinned-${index}`, name: `Pinned ${index + 1}` },
      depth: 0,
      workspaceId: "ws-1",
      workspacePath: "/tmp/ws-1",
    }));

    try {
      const { container } = render(
        <StrictMode>
          <ScrollArea style={{ width: 320, height: 480 }}>
            <PinnedThreadList {...baseProps} rows={rows} />
          </ScrollArea>
        </StrictMode>,
      );

      expect(container.querySelectorAll(".thread-row")).toHaveLength(
        rows.length,
      );
      expect(
        container.querySelector('[data-slot="tooltip-trigger"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-slot="popover-anchor"]'),
      ).toBeNull();
      expect(
        consoleErrorSpy.mock.calls.some((call) =>
          call.some((entry) =>
            /Maximum update depth exceeded|Minified React error #185/.test(
              String(entry),
            ),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("renders pinned rows and handles click/context menu", () => {
    const onSelectThread = vi.fn();
    const onShowThreadMenu = vi.fn();

    render(
      <PinnedThreadList
        {...baseProps}
        onSelectThread={onSelectThread}
        onShowThreadMenu={onShowThreadMenu}
      />,
    );

    const row = screen.getByText("Pinned Alpha").closest(".thread-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing pinned row");
    }
    expect(row.classList.contains("active")).toBe(true);
    expect(row.classList.contains("is-pinned-thread")).toBe(true);
    expect(row.querySelector(".thread-status")?.className).toContain(
      "reviewing",
    );
    const pinToggle = row.querySelector(".thread-pin-toggle");
    expect(pinToggle).toBeTruthy();
    expect(pinToggle?.classList.contains("is-pinned")).toBe(true);

    fireEvent.click(row);
    expect(onSelectThread).toHaveBeenCalledWith("ws-1", "thread-1");

    fireEvent.contextMenu(row);
    expect(onShowThreadMenu).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "thread-1",
      true,
      undefined,
      undefined,
      null,
      true,
      "/tmp/ws-1",
    );
  });

  it("defaults pinned continuation family members to collapsed", () => {
    const onSelectThread = vi.fn();
    const { container } = render(
      <PinnedThreadList
        {...baseProps}
        onSelectThread={onSelectThread}
        rows={[
          {
            thread: {
              ...thread,
              id: "continuation",
              familyId: "family-1",
              originKind: "provider-continuation",
              sourceSessionId: "source",
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
          {
            thread: {
              ...otherThread,
              id: "source",
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    const familyToggle = screen.getByRole("button", {
      name: "Continued sessions · 2",
    });
    expect(familyToggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelectorAll('[data-continuation-family-id="family-1"]'),
    ).toHaveLength(1);

    fireEvent.click(familyToggle);
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(familyToggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelectorAll('[data-continuation-family-id="family-1"]'),
    ).toHaveLength(2);
  });

  it("marks shared pinned rows as not archivable for the context menu", () => {
    const onShowThreadMenu = vi.fn();

    render(
      <PinnedThreadList
        {...baseProps}
        rows={[
          {
            thread: {
              ...thread,
              id: "shared:thread-1",
              threadKind: "shared",
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
        onShowThreadMenu={onShowThreadMenu}
      />,
    );

    const row = screen.getByText("Pinned Alpha").closest(".thread-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing shared pinned row");
    }

    fireEvent.contextMenu(row);
    expect(onShowThreadMenu).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "shared:thread-1",
      true,
      undefined,
      undefined,
      null,
      false,
      "/tmp/ws-1",
    );
  });

  it("routes callbacks for rows across workspaces", () => {
    const onSelectThread = vi.fn();
    const onShowThreadMenu = vi.fn();

    render(
      <PinnedThreadList
        {...baseProps}
        rows={[
          { thread, depth: 0, workspaceId: "ws-1", workspacePath: "/tmp/ws-1" },
          {
            thread: otherThread,
            depth: 0,
            workspaceId: "ws-2",
            workspacePath: "/tmp/ws-2",
          },
        ]}
        onSelectThread={onSelectThread}
        onShowThreadMenu={onShowThreadMenu}
      />,
    );

    const secondRow = screen.getByText("Pinned Beta").closest(".thread-row");
    expect(secondRow).toBeTruthy();
    if (!secondRow) {
      throw new Error("Missing second pinned row");
    }

    fireEvent.click(secondRow);
    expect(onSelectThread).toHaveBeenCalledWith("ws-2", "thread-2");

    fireEvent.contextMenu(secondRow);
    expect(onShowThreadMenu).toHaveBeenCalledWith(
      expect.anything(),
      "ws-2",
      "thread-2",
      true,
      undefined,
      undefined,
      null,
      true,
      "/tmp/ws-2",
    );

    const engineBadge = secondRow.querySelector(".thread-engine-badge");
    expect(engineBadge?.classList.contains("is-processing")).toBe(true);
  });

  it("allows unpinning from pinned list without selecting the thread", () => {
    const onToggleThreadPin = vi.fn();
    const onSelectThread = vi.fn();

    const { container } = render(
      <PinnedThreadList
        {...baseProps}
        onToggleThreadPin={onToggleThreadPin}
        onSelectThread={onSelectThread}
      />,
    );

    const row = container.querySelector(".thread-row");
    expect(row).toBeTruthy();
    if (!row) {
      throw new Error("Missing pinned row");
    }
    const pinToggle = row.querySelector(".thread-pin-toggle");
    expect(pinToggle).toBeTruthy();
    if (!pinToggle) {
      throw new Error("Missing pin toggle");
    }

    fireEvent.click(pinToggle);
    expect(onToggleThreadPin).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("shows auto naming loading badge for pinned thread", () => {
    render(
      <PinnedThreadList
        {...baseProps}
        isThreadAutoNaming={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-1"
        }
      />,
    );

    expect(screen.getByText("Auto naming...")).toBeTruthy();
  });

  it("shows a compact proxy badge on a processing pinned row even when workspace is inactive", () => {
    const { container } = render(
      <PinnedThreadList
        {...baseProps}
        rows={[
          {
            thread: otherThread,
            depth: 0,
            workspaceId: "ws-2",
            workspacePath: "/tmp/ws-2",
          },
        ]}
        activeWorkspaceId="ws-1"
        activeThreadId={null}
        systemProxyEnabled
        systemProxyUrl="http://127.0.0.1:7890"
      />,
    );

    const row = container.querySelector(".thread-row");
    const badge = row?.querySelector(".thread-proxy-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent ?? "").toBe("");
    expect(badge?.classList.contains("proxy-status-badge--animated")).toBe(
      false,
    );
  });

  it("reuses workspace subagent row rendering for pinned children", () => {
    const onSelectThread = vi.fn();
    const parentThread: ThreadSummary = {
      ...thread,
      id: "claude:parent",
      name: "Pinned parent",
      engineSource: "claude",
    };
    const pendingChildThread: ThreadSummary = {
      id: "claude-pending-subagent:claude:parent:toolu_agent_1",
      name: "Pasteur",
      updatedAt: 900,
      parentThreadId: "claude:parent",
      engineSource: "claude",
    };

    render(
      <PinnedThreadList
        {...baseProps}
        activeThreadId="claude:parent"
        rows={[
          {
            thread: parentThread,
            depth: 0,
            hasChildren: true,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
          {
            thread: pendingChildThread,
            depth: 1,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
        onSelectThread={onSelectThread}
      />,
    );

    const parentRow = screen.getByText("Pinned parent").closest(".thread-row");
    expect(parentRow?.classList.contains("is-subagent-parent")).toBe(true);
    fireEvent.click(
      parentRow?.querySelector(".thread-tree-expander") as HTMLElement,
    );

    const childRow = screen.getByText("Pasteur").closest(".thread-row");
    expect(childRow?.classList.contains("is-subagent")).toBe(true);
    expect(childRow?.classList.contains("is-pending-subagent")).toBe(true);
    expect(childRow?.querySelector(".thread-engine-badge")).toBeNull();
    expect(childRow?.querySelector(".thread-subagent-tag")?.textContent).toBe(
      "Subagent",
    );
    if (!childRow) {
      throw new Error("Missing pinned subagent row");
    }

    fireEvent.click(childRow);
    expect(onSelectThread).toHaveBeenCalledWith("ws-1", "claude:parent");
  });

  it("keeps an unchanged pinned row stable across unrelated status updates", () => {
    const renderCountByThreadId = new Map<string, number>();
    const rows = [
      { thread, depth: 0, workspaceId: "ws-1", workspacePath: "/tmp/ws-1" },
      {
        thread: otherThread,
        depth: 0,
        workspaceId: "ws-2",
        workspacePath: "/tmp/ws-2",
      },
    ];
    const onPinnedThreadRowRender = vi.fn((threadId: string) => {
      renderCountByThreadId.set(
        threadId,
        (renderCountByThreadId.get(threadId) ?? 0) + 1,
      );
    });

    const { rerender } = render(
      <PinnedThreadList
        {...baseProps}
        rows={rows}
        threadStatusById={{
          "thread-1": {
            isProcessing: false,
            hasUnread: true,
            isReviewing: false,
          },
          "thread-2": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
          },
        }}
        onPinnedThreadRowRender={onPinnedThreadRowRender}
      />,
    );

    expect(renderCountByThreadId.get("thread-1")).toBe(1);

    for (let index = 0; index < 1000; index += 1) {
      rerender(
        <PinnedThreadList
          {...baseProps}
          rows={rows}
          threadStatusById={{
            "thread-1": {
              isProcessing: false,
              hasUnread: true,
              isReviewing: false,
            },
            "thread-2": {
              isProcessing: index % 2 === 0,
              hasUnread: false,
              isReviewing: false,
            },
          }}
          onPinnedThreadRowRender={onPinnedThreadRowRender}
        />,
      );
    }

    expect(renderCountByThreadId.get("thread-1")).toBe(1);
    expect(onPinnedThreadRowRender).toHaveBeenCalledWith("thread-2");
  });

  it("hides codex provider metadata by default and keeps explicit pinned badges opt-in", () => {
    const { container, rerender } = render(
      <PinnedThreadList
        {...baseProps}
        rows={[
          {
            thread: {
              ...thread,
              sourceLabel: "project/openai",
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    expect(container.querySelector(".thread-provider-label")).toBeNull();

    rerender(
      <PinnedThreadList
        {...baseProps}
        showProviderLabels
        rows={[
          {
            thread: {
              ...thread,
              sourceLabel: "project/openai",
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    expect(screen.getByText("project/openai")).toBeTruthy();

    rerender(
      <PinnedThreadList
        {...baseProps}
        showProviderLabels
        rows={[
          {
            thread: {
              ...thread,
              engineSource: "codex",
              providerProfileId: "provider-a",
              providerProfileName: " ",
              sourceLabel: " ",
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    expect(screen.getByText("provider-a")).toBeTruthy();

    rerender(
      <PinnedThreadList
        {...baseProps}
        showProviderLabels
        rows={[
          {
            thread: {
              ...thread,
              engineSource: "codex",
              providerProfileId: "   ",
              providerProfileName: " ",
              sourceLabel: " ",
            },
            depth: 0,
            workspaceId: "ws-1",
            workspacePath: "/tmp/ws-1",
          },
        ]}
      />,
    );

    expect(container.querySelector(".thread-provider-label")).toBeNull();
  });
});
