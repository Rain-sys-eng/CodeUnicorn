use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use super::models::{
    CreateDelegationRun, DelegationDispatchBinding, DelegationResult, DelegationRun,
    DelegationRunStatus,
};

#[derive(Debug, Clone, Copy)]
pub struct DelegationRunLimits {
    pub max_depth: u16,
    pub max_children_per_parent: usize,
    pub max_active_runs: usize,
}

impl Default for DelegationRunLimits {
    fn default() -> Self {
        Self {
            max_depth: 4,
            max_children_per_parent: 8,
            max_active_runs: 32,
        }
    }
}

pub struct DelegationRunRegistry {
    runs: Mutex<HashMap<String, DelegationRun>>,
    sequence: AtomicU64,
    limits: DelegationRunLimits,
}

impl DelegationRunRegistry {
    pub fn new(limits: DelegationRunLimits) -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(0),
            limits,
        }
    }

    pub fn create(&self, request: CreateDelegationRun) -> Result<DelegationRun, String> {
        request.validate()?;
        let target_execution = request
            .target_execution
            .clone()
            .ok_or_else(|| "resolved delegated target execution is required".to_string())?;
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;

        let active_runs = runs.values().filter(|run| !run.status.is_terminal()).count();
        if active_runs >= self.limits.max_active_runs {
            return Err(format!(
                "agent bridge active run limit reached: {}",
                self.limits.max_active_runs
            ));
        }

        let (root_run_id, depth) = if let Some(parent_run_id) = request.parent_run_id.as_deref() {
            let parent = runs
                .get(parent_run_id)
                .ok_or_else(|| format!("parent delegated run not found: {parent_run_id}"))?;
            if parent.status.is_terminal() {
                return Err(format!(
                    "cannot create child for terminal delegated run: {parent_run_id}"
                ));
            }
            let child_count = runs
                .values()
                .filter(|run| run.parent_run_id.as_deref() == Some(parent_run_id))
                .count();
            if child_count >= self.limits.max_children_per_parent {
                return Err(format!(
                    "delegated child limit reached for parent {parent_run_id}: {}",
                    self.limits.max_children_per_parent
                ));
            }
            let depth = parent.depth.saturating_add(1);
            if depth > self.limits.max_depth {
                return Err(format!(
                    "delegation depth {depth} exceeds configured max depth {}",
                    self.limits.max_depth
                ));
            }
            (parent.root_run_id.clone(), depth)
        } else {
            (String::new(), 0)
        };

        let id = self.next_run_id();
        let root_run_id = if root_run_id.is_empty() {
            id.clone()
        } else {
            root_run_id
        };
        let run = DelegationRun {
            id: id.clone(),
            root_run_id,
            parent_run_id: request.parent_run_id,
            depth,
            source: request.source,
            target: request.target,
            target_execution,
            workspace_id: request.workspace_id,
            task: request.task,
            file_refs: request.file_refs,
            context_policy: request.context_policy,
            execution_scope: request.execution_scope,
            status: DelegationRunStatus::Queued,
            dispatch_binding: None,
            result: None,
            error: None,
            created_at_ms: now_ms(),
            started_at_ms: None,
            completed_at_ms: None,
        };
        runs.insert(id, run.clone());
        Ok(run)
    }

    pub fn get(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
        let runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        Ok(runs.get(run_id).cloned())
    }

    pub fn list(&self) -> Result<Vec<DelegationRun>, String> {
        let runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let mut values = runs.values().cloned().collect::<Vec<_>>();
        values.sort_by_key(|run| run.created_at_ms);
        Ok(values)
    }

    /// Atomically owns the Queued -> Running dispatch edge. A second dispatcher cannot
    /// reuse a run that is already in-flight.
    pub fn claim_dispatch(&self, run_id: &str) -> Result<DelegationRun, String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if run.status != DelegationRunStatus::Queued {
            return Err(format!(
                "delegated run {run_id} cannot be dispatched from state {:?}",
                run.status
            ));
        }
        run.status = DelegationRunStatus::Running;
        run.started_at_ms = Some(now_ms());
        Ok(run.clone())
    }

    pub fn set_dispatch_binding(
        &self,
        run_id: &str,
        binding: DelegationDispatchBinding,
    ) -> Result<DelegationRun, String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if run.status.is_terminal() {
            return Err(format!("cannot bind terminal delegated run: {run_id}"));
        }
        if let Some(existing) = run.dispatch_binding.as_ref() {
            if existing == &binding {
                return Ok(run.clone());
            }
            return Err(format!(
                "delegated run {run_id} already owns a different dispatch binding"
            ));
        }
        run.target.logical_session_id = Some(binding.backing_thread_id.clone());
        run.dispatch_binding = Some(binding);
        Ok(run.clone())
    }

    pub fn record_runtime_ack(
        &self,
        run_id: &str,
        attempt_id: &str,
        native_session_id: &str,
        runtime_turn_id: &str,
    ) -> Result<DelegationRun, String> {
        let native_session_id = native_session_id.trim();
        let runtime_turn_id = runtime_turn_id.trim();
        if native_session_id.is_empty() || runtime_turn_id.is_empty() {
            return Err(format!(
                "delegated run {run_id} runtime ACK requires native session and turn identity"
            ));
        }
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if run.status.is_terminal() {
            return Err(format!("cannot ACK terminal delegated run: {run_id}"));
        }
        let binding = run
            .dispatch_binding
            .as_mut()
            .ok_or_else(|| format!("delegated run {run_id} has no dispatch binding"))?;
        if binding.attempt_id != attempt_id {
            return Err(format!(
                "delegated run {run_id} runtime ACK attempt mismatch: expected {}, got {attempt_id}",
                binding.attempt_id
            ));
        }
        if binding
            .native_session_id
            .as_deref()
            .is_some_and(|existing| existing != native_session_id)
            || binding
                .runtime_turn_id
                .as_deref()
                .is_some_and(|existing| existing != runtime_turn_id)
        {
            return Err(format!(
                "delegated run {run_id} received conflicting runtime ACK identity"
            ));
        }
        binding.native_session_id = Some(native_session_id.to_string());
        binding.runtime_turn_id = Some(runtime_turn_id.to_string());
        run.target.native_session_id = Some(native_session_id.to_string());
        Ok(run.clone())
    }

    pub fn transition(
        &self,
        run_id: &str,
        next_status: DelegationRunStatus,
    ) -> Result<DelegationRun, String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if run.status == next_status {
            return Ok(run.clone());
        }
        if run.status.is_terminal() {
            return Err(format!(
                "delegated run {run_id} is already terminal: {:?}",
                run.status
            ));
        }
        if next_status.is_terminal() {
            return Err(format!(
                "use settle_* for terminal delegated run transition: {run_id}"
            ));
        }
        match (run.status, next_status) {
            (DelegationRunStatus::Queued, DelegationRunStatus::Running)
            | (DelegationRunStatus::Running, DelegationRunStatus::WaitingApproval)
            | (DelegationRunStatus::WaitingApproval, DelegationRunStatus::Running) => {}
            _ => {
                return Err(format!(
                    "invalid delegated run transition for {run_id}: {:?} -> {:?}",
                    run.status, next_status
                ));
            }
        }
        if next_status == DelegationRunStatus::Running && run.started_at_ms.is_none() {
            run.started_at_ms = Some(now_ms());
        }
        run.status = next_status;
        Ok(run.clone())
    }

    pub fn settle_completed(
        &self,
        run_id: &str,
        result: DelegationResult,
    ) -> Result<DelegationRun, String> {
        self.settle(run_id, DelegationRunStatus::Completed, Some(result), None)
    }

    pub fn settle_failed(&self, run_id: &str, error: String) -> Result<DelegationRun, String> {
        if error.trim().is_empty() {
            return Err("delegated run failure reason is required".to_string());
        }
        self.settle(run_id, DelegationRunStatus::Failed, None, Some(error))
    }

    pub fn cancel(&self, run_id: &str) -> Result<DelegationRun, String> {
        self.settle(run_id, DelegationRunStatus::Cancelled, None, None)
    }

    fn settle(
        &self,
        run_id: &str,
        terminal_status: DelegationRunStatus,
        result: Option<DelegationResult>,
        error: Option<String>,
    ) -> Result<DelegationRun, String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if run.status == terminal_status {
            return Ok(run.clone());
        }
        if run.status.is_terminal() {
            return Err(format!(
                "delegated run {run_id} already settled as {:?}",
                run.status
            ));
        }
        run.status = terminal_status;
        run.result = result;
        run.error = error;
        run.completed_at_ms = Some(now_ms());
        Ok(run.clone())
    }

    fn next_run_id(&self) -> String {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        format!("delegation-{}-{sequence}", now_ms())
    }
}

impl Default for DelegationRunRegistry {
    fn default() -> Self {
        Self::new(DelegationRunLimits::default())
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::models::{
        AgentEndpoint, DelegationContextPolicy, DelegationExecutionScope,
    };
    use crate::engine::EngineType;
    use crate::shared_event_log::canonical::types::CanonicalProviderProfileSource;
    use crate::shared_session_v2::ExecutionTargetInput;

    fn execution_target() -> ExecutionTargetInput {
        ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: None,
            model_catalog_entry_id: Some("gpt-5.3-codex-spark".to_string()),
            model: Some("gpt-5.3-codex-spark".to_string()),
            reasoning_effort: None,
            provider_profile_name_snapshot: Some("Local".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        }
    }

    fn request(parent_run_id: Option<String>) -> CreateDelegationRun {
        CreateDelegationRun {
            source: AgentEndpoint {
                engine_id: "claude".to_string(),
                logical_session_id: Some("source-session".to_string()),
                native_session_id: None,
            },
            target: AgentEndpoint {
                engine_id: "codex".to_string(),
                logical_session_id: None,
                native_session_id: None,
            },
            target_execution: Some(execution_target()),
            workspace_id: "workspace-1".to_string(),
            task: "review authentication".to_string(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
            parent_run_id,
        }
    }

    #[test]
    fn root_and_child_runs_preserve_lineage() {
        let registry = DelegationRunRegistry::default();
        let root = registry.create(request(None)).expect("create root");
        let child = registry
            .create(request(Some(root.id.clone())))
            .expect("create child");

        assert_eq!(root.root_run_id, root.id);
        assert_eq!(root.depth, 0);
        assert_eq!(child.root_run_id, root.id);
        assert_eq!(child.parent_run_id.as_deref(), Some(root.id.as_str()));
        assert_eq!(child.depth, 1);
    }

    #[test]
    fn dispatch_claim_is_single_owner_and_runtime_ack_updates_binding() {
        let registry = DelegationRunRegistry::default();
        let run = registry.create(request(None)).expect("create run");
        registry.claim_dispatch(&run.id).expect("claim dispatch");
        assert!(registry.claim_dispatch(&run.id).is_err());
        registry
            .set_dispatch_binding(
                &run.id,
                DelegationDispatchBinding {
                    backing_thread_id: "shared:bridge-session".to_string(),
                    attempt_id: "attempt-1".to_string(),
                    logical_turn_id: "turn-1".to_string(),
                    binding_key: "squad:run:delegate:codex:default".to_string(),
                    native_session_id: None,
                    runtime_turn_id: None,
                },
            )
            .expect("set binding");
        let acked = registry
            .record_runtime_ack(&run.id, "attempt-1", "native-1", "runtime-turn-1")
            .expect("record ack");

        assert_eq!(acked.target.logical_session_id.as_deref(), Some("shared:bridge-session"));
        assert_eq!(acked.target.native_session_id.as_deref(), Some("native-1"));
        assert_eq!(
            acked
                .dispatch_binding
                .as_ref()
                .and_then(|binding| binding.runtime_turn_id.as_deref()),
            Some("runtime-turn-1")
        );
    }

    #[test]
    fn terminal_run_rejects_reopen_and_duplicate_same_settlement_is_idempotent() {
        let registry = DelegationRunRegistry::default();
        let run = registry.create(request(None)).expect("create run");
        registry
            .transition(&run.id, DelegationRunStatus::Running)
            .expect("start run");
        let completed = registry
            .settle_completed(
                &run.id,
                DelegationResult {
                    summary: Some("done".to_string()),
                    changed_files: Vec::new(),
                    branch: None,
                    artifact_path: None,
                },
            )
            .expect("complete run");
        let repeated = registry
            .settle_completed(
                &run.id,
                DelegationResult {
                    summary: Some("different late payload".to_string()),
                    changed_files: Vec::new(),
                    branch: None,
                    artifact_path: None,
                },
            )
            .expect("same settlement is idempotent");

        assert_eq!(completed, repeated);
        assert!(registry
            .transition(&run.id, DelegationRunStatus::Running)
            .is_err());
    }

    #[test]
    fn depth_limit_blocks_child_before_creation() {
        let registry = DelegationRunRegistry::new(DelegationRunLimits {
            max_depth: 1,
            max_children_per_parent: 8,
            max_active_runs: 32,
        });
        let root = registry.create(request(None)).expect("create root");
        let child = registry
            .create(request(Some(root.id.clone())))
            .expect("create child");
        let error = registry
            .create(request(Some(child.id.clone())))
            .expect_err("depth limit must reject grandchild");

        assert!(error.contains("max depth"));
        assert_eq!(registry.list().expect("list runs").len(), 2);
    }
}
