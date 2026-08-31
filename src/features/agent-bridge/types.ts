import type { AgentExecutionTarget } from "../multi-agent/types";

export type DelegationRunStatus =
  | "queued"
  | "running"
  | "waitingApproval"
  | "completed"
  | "failed"
  | "cancelled";

export type DelegationContextPolicy = "explicit" | "portable" | "inherited";

export type DelegationExecutionScope =
  "observe" | "sharedWorkspace" | "isolatedWorktree";

export type DelegationEndpoint = {
  engineId: string;
  logicalSessionId?: string | null;
  nativeSessionId?: string | null;
};

export type DelegationResult = {
  summary?: string | null;
  changedFiles: string[];
  branch?: string | null;
  diff?: string | null;
  artifactPath?: string | null;
};

export type DelegationDispatchBinding = {
  backingThreadId: string;
  attemptId: string;
  logicalTurnId: string;
  bindingKey: string;
  runtimeWorkspaceId?: string | null;
  nativeSessionId?: string | null;
  runtimeTurnId?: string | null;
};

export type DelegationRun = {
  id: string;
  rootRunId: string;
  parentRunId?: string | null;
  continuationOfRunId?: string | null;
  retryOfRunId?: string | null;
  depth: number;
  source: DelegationEndpoint;
  target: DelegationEndpoint;
  targetExecution: AgentExecutionTarget;
  workspaceId: string;
  task: string;
  fileRefs: string[];
  contextPolicy: DelegationContextPolicy;
  executionScope: DelegationExecutionScope;
  status: DelegationRunStatus;
  dispatchBinding?: DelegationDispatchBinding | null;
  result?: DelegationResult | null;
  error?: string | null;
  createdAtMs: number;
  startedAtMs?: number | null;
  completedAtMs?: number | null;
};

export function isDelegationTerminal(status: DelegationRunStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
