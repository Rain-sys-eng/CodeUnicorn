import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listSharedSessions,
  persistSharedSessionSelectedTarget,
  setSharedSessionSelectedEngine,
  sharedSessionV2DispatchTurn,
  sharedSessionV2InterruptTurn,
  sharedSessionV2MarkRecovery,
  startSharedSession,
  syncSharedSessionSnapshot,
} from "./sharedSessions";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const RESOLVED_TARGET = {
  engine: "codex" as const,
  providerProfileId: "provider-a",
  modelCatalogEntryId: "catalog-entry-a",
  model: "runtime-model-a",
  reasoning: { effort: "high" },
  providerProfileNameSnapshot: "Provider A",
  providerProfileSource: "managed" as const,
};

describe("startSharedSession", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("persists the exact complete initial target in the start RPC", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await startSharedSession("ws-1", RESOLVED_TARGET);

    expect(invoke).toHaveBeenCalledWith("start_shared_session", {
      workspaceId: "ws-1",
      initialTarget: RESOLVED_TARGET,
    });
  });

  it("rejects a partial initial target before invoking Rust", async () => {
    await expect(
      startSharedSession("ws-1", { engine: "codex" }),
    ).rejects.toThrow("Execution Target 不完整");

    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a missing initial target instead of creating a partial session", async () => {
    await expect(
      startSharedSession("ws-1", null as never),
    ).rejects.toThrow("Execution Target 不完整");

    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses initialTarget as the only start authority", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await startSharedSession("ws-1", {
      ...RESOLVED_TARGET,
      engine: "claude",
    });

    expect(invoke).toHaveBeenCalledWith("start_shared_session", {
      workspaceId: "ws-1",
      initialTarget: {
        ...RESOLVED_TARGET,
        engine: "claude",
      },
    });
  });
});

describe("listSharedSessions", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("filters canonical Agent Bridge backing lanes from the ordinary Shared list", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([
        { id: "ordinary", threadId: "shared:ordinary" },
        { id: "bridge", threadId: "shared:bridge" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "1:control",
          kind: "systemNotice",
          content: {
            text: "Control: agent-bridge.internalBackingSession",
          },
          fidelity: "canonical",
          checksum: "checksum-1",
        },
      ]);

    const sessions = await listSharedSessions("ws-1");

    expect(sessions).toEqual([
      { id: "ordinary", threadId: "shared:ordinary" },
    ]);
    expect(invoke).toHaveBeenNthCalledWith(1, "list_shared_sessions", {
      workspaceId: "ws-1",
    });
    expect(invoke).toHaveBeenCalledWith("load_shared_projection", {
      workspaceId: "ws-1",
      threadId: "shared:bridge",
    });
  });

  it("does not hide an ordinary session when its projection cannot be read", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: "ordinary", threadId: "shared:ordinary" }])
      .mockRejectedValueOnce(new Error("projection unavailable"));

    const sessions = await listSharedSessions("ws-1");

    expect(sessions).toEqual([
      { id: "ordinary", threadId: "shared:ordinary" },
    ]);
  });
});

describe("setSharedSessionSelectedEngine", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("persists catalog identity separately from the runtime model", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await setSharedSessionSelectedEngine(
      "ws-1",
      "shared:thread-1",
      "claude",
      "provider-b",
      {
        engine: "claude",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "settings-reasoning",
        model: "deepseek-v4-pro",
        reasoning: { effort: "high" },
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
      },
    );

    expect(invoke).toHaveBeenCalledWith(
      "set_shared_session_selected_engine",
      {
        workspaceId: "ws-1",
        threadId: "shared:thread-1",
        selectedEngine: "claude",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "settings-reasoning",
        model: "deepseek-v4-pro",
        reasoningEffort: "high",
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
      },
    );
  });

  it("persists a complete V2 target without provisioning a binding", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await persistSharedSessionSelectedTarget(
      "ws-1",
      "shared:thread-1",
      RESOLVED_TARGET,
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("set_shared_session_selected_engine", {
      workspaceId: "ws-1",
      threadId: "shared:thread-1",
      selectedEngine: "codex",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "catalog-entry-a",
      model: "runtime-model-a",
      reasoningEffort: "high",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
    });
  });

  it("rejects a partial V2 target before invoking Rust", async () => {
    await expect(
      persistSharedSessionSelectedTarget("ws-1", "shared:thread-1", {
        engine: "codex",
      }),
    ).rejects.toThrow("Execution Target 不完整");

    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("sharedSessionV2DispatchTurn", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("sends only attempt/artifact identity and non-Target operational options", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await sharedSessionV2DispatchTurn("ws-1", "shared:thread-1", {
      attemptId: "attempt-1",
      artifactId: "artifact-1",
      artifactChecksum: "sha256:artifact",
      accessMode: "current",
      images: ["/tmp/example.png"],
    });

    expect(invoke).toHaveBeenCalledWith("shared_session_v2_dispatch_turn", {
      workspaceId: "ws-1",
      threadId: "shared:thread-1",
      attemptId: "attempt-1",
      artifactId: "artifact-1",
      artifactChecksum: "sha256:artifact",
      disableThinking: null,
      accessMode: "current",
      images: ["/tmp/example.png"],
      collaborationMode: null,
      preferredLanguage: null,
      customSpecRoot: null,
    });
  });
});

describe("sharedSessionV2MarkRecovery", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("derives binding and target identity from the durable attempt", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await sharedSessionV2MarkRecovery(
      "ws-1",
      "shared:thread-1",
      "attempt-1",
      "runtime-delivery-ambiguous: timeout",
    );

    expect(invoke).toHaveBeenCalledWith("shared_session_v2_mark_recovery", {
      workspaceId: "ws-1",
      threadId: "shared:thread-1",
      attemptId: "attempt-1",
      reason: "runtime-delivery-ambiguous: timeout",
    });
  });
});

describe("sharedSessionV2InterruptTurn", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("sends only the durable attempt owner identity", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await sharedSessionV2InterruptTurn(
      "ws-1",
      "shared:thread-1",
      "attempt-1",
    );

    expect(invoke).toHaveBeenCalledWith("shared_session_v2_interrupt_turn", {
      workspaceId: "ws-1",
      threadId: "shared:thread-1",
      attemptId: "attempt-1",
    });
  });
});

describe("syncSharedSessionSnapshot", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("marks V2 snapshots as presentation metadata only", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await syncSharedSessionSnapshot(
      "ws-1",
      "shared:thread-1",
      [{ id: "message-1" }],
      "codex",
      false,
    );

    expect(invoke).toHaveBeenCalledWith("sync_shared_session_snapshot", {
      workspaceId: "ws-1",
      threadId: "shared:thread-1",
      items: [{ id: "message-1" }],
      selectedEngine: "codex",
      legacySnapshotEnabled: false,
    });
  });
});
