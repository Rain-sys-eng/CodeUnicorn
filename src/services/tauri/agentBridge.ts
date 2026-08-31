import { invoke } from "@tauri-apps/api/core";

import { isSupportedEngineType } from "../../features/engine/engineRegistry";
import type { AgentExecutionTarget } from "../../features/multi-agent/types";
import type {
  DelegationDispatchBinding,
  DelegationEndpoint,
  DelegationResult,
  DelegationRun,
  DelegationRunStatus,
} from "../../features/agent-bridge/types";

const DELEGATION_STATUSES = new Set<DelegationRunStatus>([
  "queued",
  "running",
  "waitingApproval",
  "completed",
  "failed",
  "cancelled",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeEndpoint(value: unknown): DelegationEndpoint | null {
  const source = record(value);
  const engineId = requiredString(source?.engineId);
  if (!source || !engineId) {
    return null;
  }
  return {
    engineId,
    logicalSessionId: optionalString(source.logicalSessionId),
    nativeSessionId: optionalString(source.nativeSessionId),
  };
}

function normalizeExecutionTarget(value: unknown): AgentExecutionTarget | null {
  const target = record(value);
  if (!target || !isSupportedEngineType(target.engine)) {
    return null;
  }
  return {
    engine: target.engine,
    providerProfileId: optionalString(target.providerProfileId),
    modelCatalogEntryId: optionalString(target.modelCatalogEntryId),
    model: optionalString(target.model),
    reasoningEffort: optionalString(target.reasoningEffort),
    providerProfileNameSnapshot: optionalString(
      target.providerProfileNameSnapshot,
    ),
    providerProfileSource: optionalString(target.providerProfileSource),
    runtimeCapabilityFingerprint: optionalString(
      target.runtimeCapabilityFingerprint,
    ),
  };
}

function normalizeBinding(value: unknown): DelegationDispatchBinding | null {
  if (value === null || value === undefined) {
    return null;
  }
  const binding = record(value);
  const backingThreadId = requiredString(binding?.backingThreadId);
  const attemptId = requiredString(binding?.attemptId);
  const logicalTurnId = requiredString(binding?.logicalTurnId);
  const bindingKey = requiredString(binding?.bindingKey);
  if (
    !binding ||
    !backingThreadId ||
    !attemptId ||
    !logicalTurnId ||
    !bindingKey
  ) {
    return null;
  }
  return {
    backingThreadId,
    attemptId,
    logicalTurnId,
    bindingKey,
    runtimeWorkspaceId: optionalString(binding.runtimeWorkspaceId),
    nativeSessionId: optionalString(binding.nativeSessionId),
    runtimeTurnId: optionalString(binding.runtimeTurnId),
  };
}

function normalizeResult(value: unknown): DelegationResult | null {
  if (value === null || value === undefined) {
    return null;
  }
  const result = record(value);
  if (!result) {
    return null;
  }
  return {
    summary: optionalString(result.summary),
    changedFiles: stringArray(result.changedFiles),
    branch: optionalString(result.branch),
    diff: optionalString(result.diff),
    artifactPath: optionalString(result.artifactPath),
  };
}

export function normalizeDelegationRun(value: unknown): DelegationRun | null {
  const run = record(value);
  const id = requiredString(run?.id);
  const rootRunId = requiredString(run?.rootRunId);
  const workspaceId = requiredString(run?.workspaceId);
  const task = requiredString(run?.task);
  const source = normalizeEndpoint(run?.source);
  const target = normalizeEndpoint(run?.target);
  const targetExecution = normalizeExecutionTarget(run?.targetExecution);
  const status = run?.status;
  const depth = optionalNumber(run?.depth);
  const createdAtMs = optionalNumber(run?.createdAtMs);
  if (
    !run ||
    !id ||
    !rootRunId ||
    !workspaceId ||
    !task ||
    !source ||
    !target ||
    !targetExecution ||
    typeof status !== "string" ||
    !DELEGATION_STATUSES.has(status as DelegationRunStatus) ||
    depth === null ||
    createdAtMs === null
  ) {
    return null;
  }

  const contextPolicy = run.contextPolicy;
  const executionScope = run.executionScope;
  const dispatchBinding = normalizeBinding(run.dispatchBinding);
  const result = normalizeResult(run.result);
  if (
    contextPolicy !== "explicit" &&
    contextPolicy !== "portable" &&
    contextPolicy !== "inherited"
  ) {
    return null;
  }
  if (
    executionScope !== "observe" &&
    executionScope !== "sharedWorkspace" &&
    executionScope !== "isolatedWorktree"
  ) {
    return null;
  }
  if (run.dispatchBinding != null && !dispatchBinding) {
    return null;
  }
  if (run.result != null && !result) {
    return null;
  }

  return {
    id,
    rootRunId,
    parentRunId: optionalString(run.parentRunId),
    continuationOfRunId: optionalString(run.continuationOfRunId),
    retryOfRunId: optionalString(run.retryOfRunId),
    depth,
    source,
    target,
    targetExecution,
    workspaceId,
    task,
    fileRefs: stringArray(run.fileRefs),
    contextPolicy,
    executionScope,
    status: status as DelegationRunStatus,
    dispatchBinding,
    result,
    error: optionalString(run.error),
    createdAtMs,
    startedAtMs: optionalNumber(run.startedAtMs),
    completedAtMs: optionalNumber(run.completedAtMs),
  };
}

function requireDelegationRun(value: unknown): DelegationRun {
  const run = normalizeDelegationRun(value);
  if (!run) {
    throw new Error("Invalid Agent Bridge run payload");
  }
  return run;
}

export async function listAgentBridgeWorkspaceRuns(
  workspaceId: string,
): Promise<DelegationRun[]> {
  const payload = await invoke<unknown>("agent_bridge_list_workspace_runs", {
    workspaceId,
  });
  if (!Array.isArray(payload)) {
    throw new Error("Invalid Agent Bridge run list payload");
  }
  return payload.map(requireDelegationRun);
}

export async function getAgentBridgeRun(
  workspaceId: string,
  runId: string,
): Promise<DelegationRun> {
  const payload = await invoke<unknown>("agent_bridge_get_run", {
    workspaceId,
    runId,
  });
  return requireDelegationRun(payload);
}

export async function cancelAgentBridgeRun(
  workspaceId: string,
  runId: string,
): Promise<DelegationRun> {
  const payload = await invoke<unknown>("agent_bridge_cancel_run", {
    workspaceId,
    runId,
  });
  return requireDelegationRun(payload);
}

export async function retryAgentBridgeRun(
  workspaceId: string,
  runId: string,
): Promise<DelegationRun> {
  const payload = await invoke<unknown>("agent_bridge_retry_run", {
    workspaceId,
    runId,
  });
  return requireDelegationRun(payload);
}
