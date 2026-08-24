import { describe, expect, it } from "vitest";
import {
  buildClientErrorLogSignature,
  buildClientErrorLogEntry,
  classifyClientStderr,
  createKnownSafeStderrDailyBudget,
  shouldPersistClientErrorLogEntry,
  shouldPersistKnownSafeStderrAggregate,
} from "./clientErrorLog";
import type { DebugEntry } from "../../../types";

function debugEntry(partial: Partial<DebugEntry>): DebugEntry {
  return {
    id: "entry-1",
    timestamp: Date.UTC(2026, 4, 29, 12, 0, 0),
    source: "client",
    label: "client info",
    ...partial,
  };
}

describe("clientErrorLog", () => {
  it("persists core errors and stuck-turn settlement diagnostics only", () => {
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({ source: "error", label: "terminal close error" }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label: "thread/session:turn-settlement:rejected",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:terminal-settlement-busy-residue",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:three-evidence-reconciliation-query-failed",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:codex-no-progress-suspected",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:codex-no-progress-watchdog-skipped",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:codex-no-progress-watchdog-fired",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:codex-no-progress-watchdog-scheduled",
        }),
      ),
    ).toBe(false);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:three-evidence-reconciliation-query-requested",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:three-evidence-reconciliation-query-skipped",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:three-evidence-reconciliation-query-resolved",
          payload: {
            status: "runtime-ended",
            decisionAction: "cleanup-residue",
          },
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:three-evidence-reconciliation-query-resolved",
          payload: {
            status: "running",
            decisionAction: "keep-running",
          },
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label:
            "thread/session:turn-diagnostic:three-evidence-reconciliation-cleanup-skipped",
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label: "thread/session:turn-diagnostic:three-evidence-dry-run",
          payload: { dryRunDecision: "wouldCleanupResidue" },
        }),
      ),
    ).toBe(true);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          label: "thread/session:turn-diagnostic:three-evidence-dry-run",
          payload: { dryRunDecision: "wouldSettle" },
        }),
      ),
    ).toBe(false);
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({ label: "thread/session:turn-diagnostic:first-token-delay" }),
      ),
    ).toBe(false);
  });

  it("redacts secrets and summarizes large text fields", () => {
    const persisted = buildClientErrorLogEntry(
      debugEntry({
        source: "stderr",
        label: "thread/session:turn-diagnostic:terminal-settlement-rejected",
        payload: {
          workspaceId: "ws-1",
          apiKey: "sk-demo",
          prompt: "hello user",
          nested: {
            stdout: "tool output",
            reason: "busy",
          },
        },
      }),
    );

    expect(persisted.timestamp).toBe("2026-05-29T12:00:00.000Z");
    expect(persisted.payload).toEqual({
      workspaceId: "ws-1",
      apiKey: "[redacted]",
      prompt: { redactedText: true, length: 10 },
      nested: {
        stdout: { redactedText: true, length: 11 },
        reason: "busy",
      },
    });
  });

  it("redacts a top-level string payload instead of persisting its content", () => {
    const persisted = buildClientErrorLogEntry(
      debugEntry({
        source: "stderr",
        label: "codex/stderr",
        payload: "private prompt and command output",
      }),
    );

    expect(persisted.payload).toEqual({
      redactedText: true,
      length: 33,
    });
    expect(JSON.stringify(persisted)).not.toContain("private prompt");
  });

  it("redacts strings nested inside a root array", () => {
    const persisted = buildClientErrorLogEntry(
      debugEntry({
        source: "stderr",
        label: "codex/stderr",
        payload: [
          "private stderr",
          { nested: "private command", count: 2 },
        ],
      }),
    );

    expect(persisted.payload).toEqual([
      { redactedText: true, length: 14 },
      {
        nested: { redactedText: true, length: 15 },
        count: 2,
      },
    ]);
    expect(JSON.stringify(persisted)).not.toContain("private");
  });

  it("propagates redaction through nested error arrays and objects", () => {
    const persisted = buildClientErrorLogEntry(
      debugEntry({
        source: "error",
        label: "runtime error",
        payload: {
          workspaceId: "ws-1",
          reasonCode: "runtime-failed",
          error: [
            "private failure",
            {
              cause: "private nested cause",
              retryable: false,
            },
          ],
          detail: {
            command: "private command",
          },
        },
      }),
    );

    expect(persisted.payload).toEqual({
      workspaceId: "ws-1",
      reasonCode: "runtime-failed",
      error: [
        { redactedText: true, length: 15 },
        {
          cause: { redactedText: true, length: 20 },
          retryable: false,
        },
      ],
      detail: {
        command: { redactedText: true, length: 15 },
      },
    });
    expect(JSON.stringify(persisted)).not.toContain("private");
  });

  it("classifies the known Codex model refresh timeout without retaining raw stderr", () => {
    const rawMessage =
      "WARN codex_models_manager refresh failed: timed out waiting for child process to exit";
    const classification = classifyClientStderr(rawMessage);

    expect(classification).toEqual({
      reasonCode: "codex-model-refresh-child-exit-timeout",
      redactedText: true,
      rawMessageLength: rawMessage.length,
    });
    expect(JSON.stringify(classification)).not.toContain("waiting for child");
  });

  it("builds a stable safe stderr signature without correlation ids or raw content", () => {
    const first = debugEntry({
      source: "stderr",
      label: "Codex/Stderr",
      payload: {
        workspaceId: "workspace-one",
        threadId: "thread-one",
        reasonCode: "codex-model-refresh-child-exit-timeout",
        raw: "private stderr one",
      },
    });
    const second = debugEntry({
      source: "stderr",
      label: "Codex/Stderr",
      payload: {
        workspaceId: "workspace-two",
        threadId: "thread-two",
        reasonCode: "codex-model-refresh-child-exit-timeout",
        raw: "private stderr two",
      },
    });

    expect(buildClientErrorLogSignature(first)).toBe(
      "stderr|codex/stderr|codex-model-refresh-child-exit-timeout",
    );
    expect(buildClientErrorLogSignature(second)).toBe(
      buildClientErrorLogSignature(first),
    );
    expect(buildClientErrorLogSignature(first)).not.toContain("workspace-one");
    expect(buildClientErrorLogSignature(first)).not.toContain("private");
  });

  it("does not persist the raw-only Debug panel entry", () => {
    expect(
      shouldPersistClientErrorLogEntry(
        debugEntry({
          source: "stderr",
          label: "stderr/raw",
          payload: "debug-only raw stderr",
        }),
      ),
    ).toBe(false);
  });

  it("keeps unclassified stderr aggregates fully persistable", () => {
    expect(
      shouldPersistKnownSafeStderrAggregate({
        reasonCode: "unclassified-stderr",
        rawCountTodayBefore: 500,
        incomingCount: 4,
      }),
    ).toBe(true);
  });

  it("persists the first known-safe model-refresh timeout, then only every 100 raw counts", () => {
    expect(
      shouldPersistKnownSafeStderrAggregate({
        reasonCode: "codex-model-refresh-child-exit-timeout",
        rawCountTodayBefore: 0,
        incomingCount: 12,
      }),
    ).toBe(true);
    expect(
      shouldPersistKnownSafeStderrAggregate({
        reasonCode: "codex-model-refresh-child-exit-timeout",
        rawCountTodayBefore: 12,
        incomingCount: 20,
      }),
    ).toBe(false);
    expect(
      shouldPersistKnownSafeStderrAggregate({
        reasonCode: "codex-model-refresh-child-exit-timeout",
        rawCountTodayBefore: 90,
        incomingCount: 20,
      }),
    ).toBe(true);
  });

  it("resets the known-safe stderr daily budget at local midnight", () => {
    let nowMs = new Date(2026, 7, 24, 15, 0, 0).getTime();
    const budget = createKnownSafeStderrDailyBudget(() => nowMs);

    expect(
      budget.consume("codex-model-refresh-child-exit-timeout", 8),
    ).toBe(true);
    expect(
      budget.consume("codex-model-refresh-child-exit-timeout", 8),
    ).toBe(false);

    nowMs = new Date(2026, 7, 25, 1, 0, 0).getTime();
    expect(
      budget.consume("codex-model-refresh-child-exit-timeout", 8),
    ).toBe(true);
  });
});
