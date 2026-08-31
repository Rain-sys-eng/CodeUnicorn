/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DelegationRun } from "../types";

const mocks = vi.hoisted(() => ({
  cancelRun: vi.fn(),
  pushErrorToast: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "messages.liveTokenUsage") {
        return `${options?.tokens ?? 0} tokens`;
      }
      return ({
        "multiAgent.card.runTitle": "Multi-agent collab",
        "multiAgent.status.implementing": "Implementing",
        "multiAgent.status.awaiting-approval": "Awaiting approval",
        "multiAgent.stageStatus.running": "Streaming…",
        "multiAgent.actions.stop": "Stop",
        "multiAgent.actions.stopping": "Stopping…",
        "multiAgent.errors.stopFailedTitle": "Stop failed",
      })[key] ?? key;
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
    mocks.pushErrorToast.mockReset();
    mocks.state = {
      runs: [run("root"), run("child", { status: "waitingApproval" })],
      loading: false,
      error: null,
      cancellingRunIds: new Set<string>(),
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
    fireEvent.click(screen.getByRole("button", { name: "Stop: Review bridge" }));
    expect(mocks.cancelRun).toHaveBeenCalledWith("child");
  });

  it("hides the sticky projection after all visible runs settle", () => {
    mocks.state = {
      ...mocks.state,
      runs: [run("root", { status: "completed", completedAtMs: 100 })],
    };
    const { container } = render(
      <AgentBridgeConversationSurface
        workspaceId="workspace-1"
        threadId="claude:native-source"
        nativeThreadIds={[]}
      />,
    );
    expect(container.querySelector(".ab-surface")).toBeNull();
  });
});
