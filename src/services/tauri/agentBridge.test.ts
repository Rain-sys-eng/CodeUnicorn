import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelAgentBridgeRun,
  getAgentBridgeRun,
  listAgentBridgeWorkspaceRuns,
  normalizeDelegationRun,
} from "./agentBridge";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("Agent Bridge Tauri service", () => {
  const run = {
    id: "delegate-1",
    rootRunId: "delegate-1",
    parentRunId: null,
    depth: 0,
    source: {
      engineId: "claude",
      logicalSessionId: "claude:source-1",
      nativeSessionId: "source-1",
    },
    target: { engineId: "codex" },
    targetExecution: {
      engine: "codex",
      model: "gpt-5.6-sol",
    },
    workspaceId: "workspace-1",
    task: "review the change",
    fileRefs: [],
    contextPolicy: "explicit",
    executionScope: "sharedWorkspace",
    status: "running",
    createdAtMs: 10,
  };

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("keeps workspace and run ownership in every command payload", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ ...run, status: "cancelled" });
    await listAgentBridgeWorkspaceRuns("workspace-1");
    expect(invoke).toHaveBeenLastCalledWith(
      "agent_bridge_list_workspace_runs",
      { workspaceId: "workspace-1" },
    );

    await getAgentBridgeRun("workspace-1", "delegate-1");
    expect(invoke).toHaveBeenLastCalledWith("agent_bridge_get_run", {
      workspaceId: "workspace-1",
      runId: "delegate-1",
    });

    await cancelAgentBridgeRun("workspace-1", "delegate-1");
    expect(invoke).toHaveBeenLastCalledWith("agent_bridge_cancel_run", {
      workspaceId: "workspace-1",
      runId: "delegate-1",
    });
  });

  it("normalizes optional durable fields before the payload reaches UI", () => {
    expect(
      normalizeDelegationRun({
        ...run,
        fileRefs: ["src/main.rs", 42],
        result: { changedFiles: ["src/main.rs", null] },
      }),
    ).toEqual(
      expect.objectContaining({
        fileRefs: ["src/main.rs"],
        result: expect.objectContaining({ changedFiles: ["src/main.rs"] }),
      }),
    );
    expect(normalizeDelegationRun({ ...run, status: "invented" })).toBeNull();
    expect(normalizeDelegationRun({ ...run, targetExecution: null })).toBeNull();
  });

  it("fails closed when a command returns a malformed run", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([{ ...run, id: "" }]);
    await expect(listAgentBridgeWorkspaceRuns("workspace-1")).rejects.toThrow(
      "Invalid Agent Bridge run payload",
    );
  });
});
