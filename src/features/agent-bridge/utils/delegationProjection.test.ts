import { describe, expect, it } from "vitest";

import type { DelegationRun } from "../types";
import {
  formatDelegationElapsed,
  selectVisibleDelegationRuns,
} from "./delegationProjection";

function run(
  id: string,
  input: Partial<DelegationRun> = {},
): DelegationRun {
  return {
    id,
    rootRunId: id,
    parentRunId: null,
    depth: 0,
    source: {
      engineId: "claude",
      logicalSessionId: "claude:source-session",
      nativeSessionId: "source-session",
    },
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

describe("Agent Bridge delegation projection", () => {
  it("keeps isolated descendants with the source session and orders the tree", () => {
    const root = run("root");
    const child = run("child", {
      rootRunId: root.id,
      parentRunId: root.id,
      depth: 1,
      source: { engineId: "codex", nativeSessionId: "target-native" },
      workspaceId: "workspace-isolated",
      createdAtMs: 30,
    });
    const grandchild = run("grandchild", {
      rootRunId: root.id,
      parentRunId: child.id,
      depth: 2,
      source: { engineId: "kimi", nativeSessionId: "nested-native" },
      workspaceId: "workspace-isolated-2",
      createdAtMs: 20,
    });
    const unrelated = run("unrelated", {
      source: {
        engineId: "claude",
        nativeSessionId: "other-session",
      },
    });

    expect(
      selectVisibleDelegationRuns(
        [grandchild, unrelated, child, root],
        "claude:source-session",
        [],
      ).map((item) => item.id),
    ).toEqual(["root", "child", "grandchild"]);
  });

  it("matches a canonical native identity and fails closed without its root", () => {
    const root = run("root", {
      source: {
        engineId: "codex",
        nativeSessionId: "codex:2f960674-1ec6-4ab8-849d-64bc5c82d497",
      },
    });
    const orphan = run("orphan", {
      rootRunId: "missing-root",
      parentRunId: "missing-root",
      depth: 1,
    });

    expect(
      selectVisibleDelegationRuns(
        [orphan, root],
        null,
        ["2f960674-1ec6-4ab8-849d-64bc5c82d497"],
      ).map((item) => item.id),
    ).toEqual(["root"]);
  });

  it("formats elapsed time against terminal or live time", () => {
    expect(formatDelegationElapsed(run("live", { startedAtMs: 1_000 }), 66_000))
      .toBe("1:05");
    expect(
      formatDelegationElapsed(
        run("done", {
          startedAtMs: 1_000,
          completedAtMs: 3_500,
          status: "completed",
        }),
        99_000,
      ),
    ).toBe("0:02");
  });
});
