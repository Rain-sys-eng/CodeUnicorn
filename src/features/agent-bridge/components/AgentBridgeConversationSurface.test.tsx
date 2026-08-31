/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DelegationRun } from "../types";

const mocks = vi.hoisted(() => ({
  cancelRun: vi.fn(),
  retryRun: vi.fn(),
  requestOpen: vi.fn(),
  pushErrorToast: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: null,
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "messages.liveTokenUsage") {
        return `${options?.tokens ?? 0} tokens`;
      }
      return (
        {
          "multiAgent.card.runTitle": "Multi-agent collab",
          "multiAgent.status.implementing": "Implementing",
          "multiAgent.status.awaiting-approval": "Awaiting approval",
          "multiAgent.stageStatus.running": "Streaming…",
          "multiAgent.actions.stop": "Stop",
          "multiAgent.actions.stopping": "Stopping…",
          "multiAgent.errors.stopFailedTitle": "Stop failed",
          "multiAgent.bridge.retry": "Retry",
          "multiAgent.bridge.retrying": "Retrying…",
          "multiAgent.bridge.retryFailed": "Retry failed",
          "multiAgent.bridge.openSession": "Open session",
          "multiAgent.bridge.viewResult": "View result",
          "multiAgent.bridge.viewDiff": "View diff",
          "multiAgent.bridge.resultTitle": "Delegated run result",
          "multiAgent.bridge.diffTitle": "Delegated run diff",
          "multiAgent.bridge.close": "Close",
          "multiAgent.bridge.summary": "Summary",
          "multiAgent.bridge.error": "Error",
          "multiAgent.bridge.branch": "Branch",
          "multiAgent.bridge.artifact": "Artifact",
          "multiAgent.bridge.changedFiles": "Changed files",
          "multiAgent.bridge.noResultDetails": "No result details",
        }[key] ?? key
      );
    },
  }),
}));

vi.mock("../../../styles/useFeatureStylesReady", () => ({
  useFeatureStylesReady: () => true,
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: mocks.pushErrorToast,
}));

vi.mock("../hooks/useAgentBridgeRuns", () => ({
  useAgentBridgeRuns: () => mocks.state,
}));

vi.mock("../store/navigationStore", () => ({
  requestAgentBridgeThreadOpen: mocks.requestOpen,
}));

import { AgentBridgeConversationSurface } from "./AgentBridgeConversationSurface";

function run(id: string, input: Partial<DelegationRun> = {}): DelegationRun {
  return {
    id,
    rootRunId: "root",
    parentRunId: id === "root" ? null : "root",
    depth: id === "root" ? 0 : 1,
    source: { engineId: "claude", nativeSessionId: "native-source" },
    target: { engineId: id === "root" ? "codex" : "kimi" },
    targetExecution: { engine: id === "root" ? "codex" : "kimi" },
    workspaceId: "workspace-1",
    task: id === "root" ? "Implement bridge" : "Review bridge",
    fileRefs: [],
    contextPolicy: "explicit",
    executionScope: "sharedWorkspace",
    status: "running",
    createdAtMs: 10,
    startedAtMs: 10,
    ...input,
  };
}

describe("AgentBridgeConversationSurface", () => {
  beforeEach(() => {
    mocks.cancelRun.mockReset();
    mocks.cancelRun.mockResolvedValue(undefined);
    mocks.retryRun.mockReset();
    mocks.retryRun.mockResolvedValue(undefined);
    mocks.requestOpen.mockReset();
    mocks.pushErrorToast.mockReset();
    mocks.state = {
      runs: [run("root"), run("child", { status: "waitingApproval" })],
      loading: false,
      error: null,
      cancellingRunIds: new Set<string>(),
      retryingRunIds: new Set<string>(),
      activityByRunId: {
        child: {
          inputTokens: 1_000,
          outputTokens: 250,
          totalTokens: 1_250,
          toolName: "Bash",
          toolStatus: "running",
          observedAtMs: 20,
        },
      },
      cancelRun: mocks.cancelRun,
      retryRun: mocks.retryRun,
    };
  });

  it("renders the delegated tree and leaves approval decisions to native UI", () => {
    const { container } = render(
      <AgentBridgeConversationSurface
        workspaceId="workspace-1"
        threadId="claude:native-source"
        nativeThreadIds={[]}
      />,
    );

    expect(container.querySelectorAll(".ab-run-row")).toHaveLength(2);
    expect(screen.getAllByText("Implement bridge")).toHaveLength(2);
    expect(screen.getByText("Review bridge")).toBeTruthy();
    expect(screen.getAllByText("Awaiting approval")).toHaveLength(1);
    expect(screen.getByText("Bash · Streaming…")).toBeTruthy();
    expect(screen.getByText(/1.3K tokens/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  it("routes Stop through the hook action", () => {
    render(
      <AgentBridgeConversationSurface
        workspaceId="workspace-1"
        threadId="claude:native-source"
        nativeThreadIds={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Stop: Review bridge" }),
    );
    expect(mocks.cancelRun).toHaveBeenCalledWith("child");
  });

  it("keeps terminal actions available and opens result and diff details", () => {
    mocks.state = {
      ...mocks.state,
      runs: [
        run("root", {
          status: "completed",
          completedAtMs: 100,
          dispatchBinding: {
            backingThreadId: "shared:backing",
            attemptId: "attempt-1",
            logicalTurnId: "turn-1",
            bindingKey: "binding-1",
            runtimeWorkspaceId: "workspace-runtime",
          },
          result: {
            summary: "Implemented safely",
            changedFiles: ["src/main.rs"],
            branch: "agent/run-1",
            artifactPath: "/tmp/result.md",
            diff: "+new line",
          },
        }),
      ],
    };
    const { container } = render(
      <AgentBridgeConversationSurface
        workspaceId="workspace-1"
        threadId="claude:native-source"
        nativeThreadIds={[]}
      />,
    );
    expect(container.querySelector(".ab-surface--terminal")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    expect(mocks.requestOpen).toHaveBeenCalledWith(
      "workspace-runtime",
      "shared:backing",
    );

    fireEvent.click(screen.getByRole("button", { name: "View result" }));
    expect(
      screen.getByRole("dialog", { name: "Delegated run result" }),
    ).toBeTruthy();
    expect(screen.getByText("Implemented safely")).toBeTruthy();
    expect(screen.getByText("src/main.rs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "View diff" }));
    expect(
      screen.getByRole("dialog", { name: "Delegated run diff" }),
    ).toBeTruthy();
    expect(screen.getByText("+new line")).toBeTruthy();
  });

  it("routes Retry through the hook action", () => {
    mocks.state = {
      ...mocks.state,
      runs: [run("root", { status: "failed", completedAtMs: 100 })],
    };
    render(
      <AgentBridgeConversationSurface
        workspaceId="workspace-1"
        threadId="claude:native-source"
        nativeThreadIds={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.retryRun).toHaveBeenCalledWith("root");
  });

  it("renders nothing when the current conversation has no delegated runs", () => {
    mocks.state = {
      ...mocks.state,
      runs: [],
    };
    const { container } = render(
      <AgentBridgeConversationSurface
        workspaceId="workspace-1"
        threadId="claude:native-source"
        nativeThreadIds={[]}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
