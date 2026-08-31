/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentBridgeRuntimeEvent } from "../../../services/events";
import type { DelegationRun } from "../types";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((event: AgentBridgeRuntimeEvent) => void) | null,
}));

vi.mock("../../../services/tauri/agentBridge", () => ({
  cancelAgentBridgeRun: mocks.cancel,
  getAgentBridgeRun: mocks.get,
  listAgentBridgeWorkspaceRuns: mocks.list,
}));

vi.mock("../../../services/events", () => ({
  subscribeAgentBridgeEvents: (
    listener: (event: AgentBridgeRuntimeEvent) => void,
  ) => {
    mocks.listener = listener;
    mocks.subscribe(listener);
    return mocks.unsubscribe;
  },
}));

import { useAgentBridgeRuns } from "./useAgentBridgeRuns";

function run(id: string, input: Partial<DelegationRun> = {}): DelegationRun {
  return {
    id,
    rootRunId: id,
    parentRunId: null,
    depth: 0,
    source: { engineId: "claude", nativeSessionId: "native-source" },
    target: { engineId: "codex" },
    targetExecution: { engine: "codex" },
    workspaceId: "workspace-1",
    task: id,
    fileRefs: [],
    contextPolicy: "explicit",
    executionScope: "sharedWorkspace",
    status: "running",
    createdAtMs: 10,
    ...input,
  };
}

function event(input: Partial<AgentBridgeRuntimeEvent>): AgentBridgeRuntimeEvent {
  return {
    schemaVersion: "1.0",
    eventId: "event-1",
    sequence: 1,
    timestampMs: 10,
    engine: "codex",
    workspaceId: "workspace-1",
    logicalSessionId: "shared:backing",
    runId: "root",
    kind: "run.started",
    lane: "critical",
    payload: {},
    ...input,
  };
}

describe("useAgentBridgeRuns", () => {
  beforeEach(() => {
    mocks.cancel.mockReset();
    mocks.get.mockReset();
    mocks.list.mockReset();
    mocks.subscribe.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.listener = null;
  });

  it("hydrates source-owned lineage, ignores delta state, refreshes critical facts, and cleans up", async () => {
    const root = run("root");
    const child = run("child", {
      rootRunId: root.id,
      parentRunId: root.id,
      depth: 1,
      workspaceId: "workspace-isolated",
    });
    mocks.list.mockResolvedValue([root, child]);
    mocks.get.mockResolvedValue({ ...root, status: "waitingApproval" });

    const rendered = renderHook(() =>
      useAgentBridgeRuns({
        workspaceId: "workspace-1",
        threadId: "claude:native-source",
        nativeThreadIds: [],
      }),
    );
    await waitFor(() => expect(rendered.result.current.runs).toHaveLength(2));

    act(() => {
      mocks.listener?.(event({ lane: "delta", kind: "assistant.delta" }));
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(mocks.get).not.toHaveBeenCalled();

    act(() => {
      mocks.listener?.(
        event({
          kind: "usage.updated",
          lane: "normal",
          payload: { type: "usage:update", inputTokens: 7, outputTokens: 5 },
        }),
      );
    });
    expect(rendered.result.current.activityByRunId.root?.totalTokens).toBe(12);
    expect(mocks.get).not.toHaveBeenCalled();

    act(() => {
      mocks.listener?.(event({ kind: "control.event" }));
    });
    await waitFor(() =>
      expect(rendered.result.current.runs[0]?.status).toBe("waitingApproval"),
    );
    expect(mocks.get).toHaveBeenCalledWith("workspace-1", "root");

    rendered.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("re-lists an unknown isolated run on a critical event", async () => {
    const root = run("root");
    const child = run("child", {
      rootRunId: root.id,
      parentRunId: root.id,
      depth: 1,
      workspaceId: "workspace-isolated",
    });
    mocks.list.mockResolvedValueOnce([root]).mockResolvedValueOnce([root, child]);

    const rendered = renderHook(() =>
      useAgentBridgeRuns({
        workspaceId: "workspace-1",
        threadId: null,
        nativeThreadIds: ["native-source"],
      }),
    );
    await waitFor(() => expect(rendered.result.current.runs).toHaveLength(1));
    act(() => {
      mocks.listener?.(
        event({
          runId: child.id,
          workspaceId: "workspace-isolated",
        }),
      );
    });
    await waitFor(() => expect(rendered.result.current.runs).toHaveLength(2));
  });

  it("exposes a readable error and keeps an empty safe state", async () => {
    mocks.list.mockRejectedValue(new Error("bridge unavailable"));
    const rendered = renderHook(() =>
      useAgentBridgeRuns({
        workspaceId: "workspace-1",
        threadId: "claude:native-source",
        nativeThreadIds: [],
      }),
    );
    await waitFor(() =>
      expect(rendered.result.current.error).toBe("bridge unavailable"),
    );
    expect(rendered.result.current.runs).toEqual([]);
  });

  it("settles a local Stop response into the visible durable snapshot", async () => {
    const root = run("root");
    mocks.list.mockResolvedValue([root]);
    mocks.cancel.mockResolvedValue({
      ...root,
      status: "cancelled",
      completedAtMs: 50,
    });
    const rendered = renderHook(() =>
      useAgentBridgeRuns({
        workspaceId: "workspace-1",
        threadId: "claude:native-source",
        nativeThreadIds: [],
      }),
    );
    await waitFor(() => expect(rendered.result.current.runs).toHaveLength(1));
    await act(async () => {
      await rendered.result.current.cancelRun(root.id);
    });
    expect(mocks.cancel).toHaveBeenCalledWith("workspace-1", root.id);
    expect(rendered.result.current.runs[0]?.status).toBe("cancelled");
  });
});
