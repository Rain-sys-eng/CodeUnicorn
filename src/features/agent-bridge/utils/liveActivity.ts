import type { AgentBridgeRuntimeEvent } from "../../../services/events";

export type DelegationToolStatus = "running" | "completed" | "failed";

export type DelegationLiveActivity = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  toolName: string | null;
  toolStatus: DelegationToolStatus | null;
  observedAtMs: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function toolName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function reduceDelegationLiveActivity(
  current: DelegationLiveActivity | null,
  event: AgentBridgeRuntimeEvent,
): DelegationLiveActivity | null {
  const payload = record(event.payload);
  if (!payload) {
    return current;
  }

  if (event.kind === "usage.updated") {
    const nextInputTokens = tokenCount(payload.inputTokens);
    const nextOutputTokens = tokenCount(payload.outputTokens);
    if (nextInputTokens === null && nextOutputTokens === null) {
      return current;
    }
    const inputTokens = nextInputTokens ?? current?.inputTokens ?? null;
    const outputTokens = nextOutputTokens ?? current?.outputTokens ?? null;
    return {
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      toolName: current?.toolName ?? null,
      toolStatus: current?.toolStatus ?? null,
      observedAtMs: event.timestampMs,
    };
  }

  if (event.kind !== "tool.started" && event.kind !== "tool.completed") {
    return current;
  }
  const name = toolName(payload.toolName) ?? current?.toolName ?? null;
  if (!name) {
    return current;
  }
  return {
    inputTokens: current?.inputTokens ?? null,
    outputTokens: current?.outputTokens ?? null,
    totalTokens: current?.totalTokens ?? null,
    toolName: name,
    toolStatus:
      event.kind === "tool.started"
        ? "running"
        : typeof payload.error === "string" && payload.error.trim()
          ? "failed"
          : "completed",
    observedAtMs: event.timestampMs,
  };
}
