export type SharedRuntimeControlOwner = {
  attemptId: string;
  providerRuntimeKey: string;
  sharedThreadId: string;
  nativeThreadId: string;
  runtimeTurnId: string;
  engine: "claude" | "codex" | "kimi" | "grok" | "opencode" | "pi" | "qoder";
  providerProfileId: string | null;
};

export type ApprovalRequest = {
  workspace_id: string;
  request_id: number | string;
  method: string;
  params: Record<string, unknown>;
  /** Shared V2 control plane authority；响应时禁止再从 threadId 推断 Provider。 */
  shared_runtime_owner?: SharedRuntimeControlOwner;
};

/** L1 session directory grant lifetime. Never default to global always. */
export type DirectoryGrantScope = "once" | "session" | "workspace";

/**
 * Session-level request to expand L1 allowlist (outside workspace roots).
 * Distinct from file/command ApprovalRequest semantics.
 */
export type DirectoryGrantRequest = {
  workspace_id: string;
  request_id: number | string;
  /** App-server method, typically `item/directoryGrant/requestApproval`. */
  method: string;
  path: string;
  canonical_path: string;
  suggested_root: string;
  default_scope: DirectoryGrantScope;
  scope: DirectoryGrantScope;
  engine?: string | null;
  os?: string | null;
  is_sensitive_root?: boolean;
  message?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  tool_name?: string | null;
  retry_context?: Record<string, unknown> | null;
  params: Record<string, unknown>;
  shared_runtime_owner?: SharedRuntimeControlOwner;
};

export type DirectoryGrantDecision = {
  decision: "accept" | "decline";
  scope: DirectoryGrantScope;
};

export type RequestUserInputOption = {
  label: string;
  description: string;
};

export type RequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  multiSelect?: boolean;
  options?: RequestUserInputOption[];
};

export type RequestUserInputParams = {
  thread_id: string;
  turn_id: string;
  item_id: string;
  questions: RequestUserInputQuestion[];
  completed?: boolean;
};

export type RequestUserInputRequest = {
  workspace_id: string;
  request_id: number | string;
  params: RequestUserInputParams;
  /** Shared V2 control plane authority；响应时按 exact Runtime owner 路由。 */
  shared_runtime_owner?: SharedRuntimeControlOwner;
};

export type CollaborationModeBlockedParams = {
  thread_id: string;
  blocked_method: string;
  effective_mode: string;
  reason_code?: string;
  reason: string;
  suggestion?: string;
  request_id?: number | string | null;
};

export type CollaborationModeBlockedRequest = {
  workspace_id: string;
  params: CollaborationModeBlockedParams;
  shared_runtime_owner?: SharedRuntimeControlOwner;
};

export type CollaborationModeResolvedParams = {
  thread_id: string;
  selected_ui_mode: "plan" | "default";
  effective_runtime_mode: "plan" | "code";
  effective_ui_mode: "plan" | "default";
  fallback_reason?: string | null;
};

export type CollaborationModeResolvedRequest = {
  workspace_id: string;
  params: CollaborationModeResolvedParams;
};

export type RequestUserInputAnswer = {
  answers: string[];
};

export type RequestUserInputResponse = {
  answers: Record<string, RequestUserInputAnswer>;
  skippedQuestionIds?: string[];
};

export type RequestUserInputSettlementOptions = {
  staleSettlementHint?: "timeout";
};

export type RequestUserInputSettlementResult = {
  settlement: "accepted" | "stale";
};
