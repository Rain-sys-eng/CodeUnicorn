use serde::{Deserialize, Serialize};

use crate::shared_session_v2::ExecutionTargetInput;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DelegationContextPolicy {
    Explicit,
    Portable,
    Inherited,
}

impl Default for DelegationContextPolicy {
    fn default() -> Self {
        Self::Explicit
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DelegationExecutionScope {
    Observe,
    SharedWorkspace,
    IsolatedWorktree,
}

impl Default for DelegationExecutionScope {
    fn default() -> Self {
        Self::Observe
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DelegationRunStatus {
    Queued,
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Cancelled,
}

impl DelegationRunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEndpoint {
    pub engine_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logical_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
}

impl AgentEndpoint {
    pub fn validate(&self, label: &str) -> Result<(), String> {
        if self.engine_id.trim().is_empty() {
            return Err(format!("{label} engine id is required"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationDispatchBinding {
    pub backing_thread_id: String,
    pub attempt_id: String,
    pub logical_turn_id: String,
    pub binding_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationRun {
    pub id: String,
    pub root_run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_run_id: Option<String>,
    /// Multi-turn continuation lineage is intentionally separate from nested delegation.
    /// A continuation keeps the same delegation depth and reuses the previous backing/native
    /// session, while parentRunId means the target Agent itself delegated another Agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_of_run_id: Option<String>,
    pub depth: u16,
    pub source: AgentEndpoint,
    pub target: AgentEndpoint,
    /// Fully-resolved target snapshot frozen before any runtime side effect.
    pub target_execution: ExecutionTargetInput,
    pub workspace_id: String,
    pub task: String,
    #[serde(default)]
    pub file_refs: Vec<String>,
    #[serde(default)]
    pub context_policy: DelegationContextPolicy,
    #[serde(default)]
    pub execution_scope: DelegationExecutionScope,
    pub status: DelegationRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatch_binding: Option<DelegationDispatchBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<DelegationResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateDelegationRun {
    pub source: AgentEndpoint,
    pub target: AgentEndpoint,
    /// Optional caller-selected target. AgentBridgeService resolves and freezes a local
    /// default when omitted, then the registry requires this field to be populated.
    pub target_execution: Option<ExecutionTargetInput>,
    pub workspace_id: String,
    pub task: String,
    pub file_refs: Vec<String>,
    pub context_policy: DelegationContextPolicy,
    pub execution_scope: DelegationExecutionScope,
    pub parent_run_id: Option<String>,
}

impl CreateDelegationRun {
    pub fn validate(&self) -> Result<(), String> {
        self.source.validate("source")?;
        self.target.validate("target")?;
        if self.workspace_id.trim().is_empty() {
            return Err("workspace id is required".to_string());
        }
        if self.task.trim().is_empty() {
            return Err("delegated task is required".to_string());
        }
        Ok(())
    }
}
