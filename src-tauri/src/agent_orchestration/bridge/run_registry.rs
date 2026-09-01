use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use super::models::{
    CreateDelegationRun, DelegationContextTransfer, DelegationDispatchBinding, DelegationResult,
    DelegationRun, DelegationRunStatus,
};
use super::persistence::AgentBridgePersistence;

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
    persistence: Option<AgentBridgePersistence>,
    persistence_error: Option<String>,
}

impl DelegationRunRegistry {
    /// Volatile registry used by focused tests and explicit in-memory callers.
    pub fn new(limits: DelegationRunLimits) -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(0),
            limits,
            persistence: None,
            persistence_error: None,
        }
    }

    pub(crate) fn persistent(
        persistence: AgentBridgePersistence,
        limits: DelegationRunLimits,
    ) -> Self {
        let loaded = persistence.load();
        let (mut runs, mut persistence_error) = match loaded {
            Ok(runs) => match recovered_map(runs) {
                Ok(runs) => (runs, None),
                Err(error) => (HashMap::new(), Some(error)),
            },
            Err(error) => (HashMap::new(), Some(error)),
        };

        let sequence = runs
            .keys()
            .filter_map(|run_id| run_id.rsplit('-').next()?.parse::<u64>().ok())
            .max()
            .unwrap_or(0);

        if persistence_error.is_none() && recover_stale_runtime_owners(&mut runs) {
            let snapshot = sorted_runs(&runs);
            if let Err(error) = persistence.save(&snapshot) {
                persistence_error = Some(format!(
                    "failed to persist Agent Bridge recovery state at {}: {error}",
                    persistence.path().display()
                ));
            }
        }

        Self {
            runs: Mutex::new(runs),
            sequence: AtomicU64::new(sequence),
            limits,
            persistence: Some(persistence),
            persistence_error,
        }
    }

    fn production_default(limits: DelegationRunLimits) -> Self {
        match AgentBridgePersistence::default_path() {
            Ok(path) => Self::persistent(AgentBridgePersistence::new(path), limits),
            Err(error) => Self {
                runs: Mutex::new(HashMap::new()),
                sequence: AtomicU64::new(0),
                limits,
                persistence: None,
                persistence_error: Some(format!(
                    "failed to resolve Agent Bridge durable store path: {error}"
                )),
            },
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

        self.ensure_active_capacity(&runs)?;

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

        let id = self.next_run_id(&runs);
        let root_run_id = if root_run_id.is_empty() {
            id.clone()
        } else {
            root_run_id
        };
        let run = DelegationRun {
            id: id.clone(),
            root_run_id,
            parent_run_id: request.parent_run_id,
            continuation_of_run_id: None,
            retry_of_run_id: None,
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
        let mut candidate = runs.clone();
        candidate.insert(id, run.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(run)
    }

    /// Create a new logical run for a follow-up turn while keeping the previous target session.
    /// Terminal immutability is preserved: the completed run is never reopened.
    pub fn create_continuation(
        &self,
        previous_run_id: &str,
        task: String,
    ) -> Result<DelegationRun, String> {
        let task = task.trim();
        if task.is_empty() {
            return Err("delegated continuation task is required".to_string());
        }
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        self.ensure_active_capacity(&runs)?;
        let previous = runs
            .get(previous_run_id)
            .cloned()
            .ok_or_else(|| format!("continuation source run not found: {previous_run_id}"))?;
        if previous.status != DelegationRunStatus::Completed {
            return Err(format!(
                "delegated continuation requires a completed run: {previous_run_id} is {:?}",
                previous.status
            ));
        }
        let previous_binding = previous.dispatch_binding.as_ref().ok_or_else(|| {
            format!("completed delegated run has no dispatch binding: {previous_run_id}")
        })?;
        let native_session_id = previous_binding
            .native_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!("completed delegated run has no reusable native session: {previous_run_id}")
            })?
            .to_string();

        let mut target = previous.target.clone();
        target.native_session_id = Some(native_session_id);

        let id = self.next_run_id(&runs);
        let run = DelegationRun {
            id: id.clone(),
            root_run_id: previous.root_run_id.clone(),
            parent_run_id: previous.parent_run_id.clone(),
            continuation_of_run_id: Some(previous.id.clone()),
            retry_of_run_id: None,
            depth: previous.depth,
            source: previous.source.clone(),
            target,
            target_execution: previous.target_execution.clone(),
            workspace_id: previous.workspace_id.clone(),
            task: task.to_string(),
            file_refs: Vec::new(),
            context_policy: previous.context_policy,
            execution_scope: previous.execution_scope,
            status: DelegationRunStatus::Queued,
            dispatch_binding: None,
            result: None,
            error: None,
            created_at_ms: now_ms(),
            started_at_ms: None,
            completed_at_ms: None,
        };
        let mut candidate = runs.clone();
        candidate.insert(id, run.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(run)
    }

    /// Create a fresh attempt for an explicitly retried terminal run without reopening or
    /// inheriting the previous runtime binding. Root/parent/depth are retained for UI and durable
    /// ownership projection, even when the original parent has since settled.
    pub fn create_retry(&self, previous_run_id: &str) -> Result<DelegationRun, String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        self.ensure_active_capacity(&runs)?;
        let previous = runs
            .get(previous_run_id)
            .cloned()
            .ok_or_else(|| format!("retry source run not found: {previous_run_id}"))?;
        if !matches!(
            previous.status,
            DelegationRunStatus::Failed | DelegationRunStatus::Cancelled
        ) {
            return Err(format!(
                "delegated retry requires a failed or cancelled run: {previous_run_id} is {:?}",
                previous.status
            ));
        }
        if let Some(parent_run_id) = previous.parent_run_id.as_deref() {
            let child_count = runs
                .values()
                .filter(|run| run.parent_run_id.as_deref() == Some(parent_run_id))
                .count();
            if child_count >= self.limits.max_children_per_parent {
                return Err(format!(
                    "delegated child limit reached for retry parent {parent_run_id}: {}",
                    self.limits.max_children_per_parent
                ));
            }
        }

        let id = self.next_run_id(&runs);
        let run = DelegationRun {
            id: id.clone(),
            root_run_id: previous.root_run_id.clone(),
            parent_run_id: previous.parent_run_id.clone(),
            continuation_of_run_id: None,
            retry_of_run_id: Some(previous.id.clone()),
            depth: previous.depth,
            source: previous.source.clone(),
            target: super::models::AgentEndpoint {
                engine_id: previous.target.engine_id.clone(),
                logical_session_id: None,
                native_session_id: None,
            },
            target_execution: previous.target_execution.clone(),
            workspace_id: previous.workspace_id.clone(),
            task: previous.task.clone(),
            file_refs: previous.file_refs.clone(),
            context_policy: previous.context_policy,
            execution_scope: previous.execution_scope,
            status: DelegationRunStatus::Queued,
            dispatch_binding: None,
            result: None,
            error: None,
            created_at_ms: now_ms(),
            started_at_ms: None,
            completed_at_ms: None,
        };
        let mut candidate = runs.clone();
        candidate.insert(id, run.clone());
        self.commit_candidate(&mut runs, candidate)?;
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
        Ok(sorted_runs(&runs))
    }

    pub fn backing_thread_ids_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<String>, String> {
        let runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let mut ids = runs
            .values()
            .filter_map(|run| {
                let binding = run.dispatch_binding.as_ref()?;
                let runtime_workspace_id = binding
                    .runtime_workspace_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(run.workspace_id.as_str());
                (runtime_workspace_id == workspace_id).then(|| binding.backing_thread_id.clone())
            })
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    /// Atomically owns the Queued -> Running dispatch edge. A second dispatcher cannot
    /// reuse a run that is already in-flight. Durable persistence commits before memory swaps.
    pub fn claim_dispatch(&self, run_id: &str) -> Result<DelegationRun, String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let existing = runs
            .get(run_id)
            .cloned()
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if existing.status != DelegationRunStatus::Queued {
            return Err(format!(
                "delegated run {run_id} cannot be dispatched from state {:?}",
                existing.status
            ));
        }
        let mut updated = existing;
        updated.status = DelegationRunStatus::Running;
        updated.started_at_ms = Some(now_ms());
        let mut candidate = runs.clone();
        candidate.insert(run_id.to_string(), updated.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(updated)
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
        let existing = runs
            .get(run_id)
            .cloned()
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        validate_dispatch_binding(&existing, &binding)?;
        if existing.status.is_terminal() {
            return Err(format!("cannot bind terminal delegated run: {run_id}"));
        }
        if let Some(existing_binding) = existing.dispatch_binding.as_ref() {
            if existing_binding == &binding {
                return Ok(existing);
            }
            return Err(format!(
                "delegated run {run_id} already owns a different dispatch binding"
            ));
        }
        let mut updated = existing;
        updated.target.logical_session_id = Some(binding.backing_thread_id.clone());
        updated.dispatch_binding = Some(binding);
        let mut candidate = runs.clone();
        candidate.insert(run_id.to_string(), updated.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(updated)
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
        let existing = runs
            .get(run_id)
            .cloned()
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if existing.status.is_terminal() {
            return Err(format!("cannot ACK terminal delegated run: {run_id}"));
        }
        let mut updated = existing;
        let binding = updated
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
        updated.target.native_session_id = Some(native_session_id.to_string());
        let mut candidate = runs.clone();
        candidate.insert(run_id.to_string(), updated.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(updated)
    }

    pub fn record_context_transfer(
        &self,
        run_id: &str,
        attempt_id: &str,
        transfer: DelegationContextTransfer,
    ) -> Result<DelegationRun, String> {
        transfer.validate()?;
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "agent bridge run registry lock poisoned".to_string())?;
        let existing = runs
            .get(run_id)
            .cloned()
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if existing.status.is_terminal() {
            return Err(format!(
                "cannot record context for terminal delegated run: {run_id}"
            ));
        }
        let mut updated = existing;
        let binding = updated
            .dispatch_binding
            .as_mut()
            .ok_or_else(|| format!("delegated run {run_id} has no dispatch binding"))?;
        if binding.attempt_id != attempt_id {
            return Err(format!(
                "delegated run {run_id} context attempt mismatch: expected {}, got {attempt_id}",
                binding.attempt_id
            ));
        }
        if let Some(existing_transfer) = binding.context_transfer.as_ref() {
            if existing_transfer == &transfer {
                return Ok(updated);
            }
            return Err(format!(
                "delegated run {run_id} already owns a different context transfer"
            ));
        }
        binding.context_transfer = Some(transfer);
        let mut candidate = runs.clone();
        candidate.insert(run_id.to_string(), updated.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(updated)
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
        let existing = runs
            .get(run_id)
            .cloned()
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if existing.status == next_status {
            return Ok(existing);
        }
        if existing.status.is_terminal() {
            return Err(format!(
                "delegated run {run_id} is already terminal: {:?}",
                existing.status
            ));
        }
        if next_status.is_terminal() {
            return Err(format!(
                "use settle_* for terminal delegated run transition: {run_id}"
            ));
        }
        match (existing.status, next_status) {
            (DelegationRunStatus::Queued, DelegationRunStatus::Running)
            | (DelegationRunStatus::Running, DelegationRunStatus::WaitingApproval)
            | (DelegationRunStatus::WaitingApproval, DelegationRunStatus::Running) => {}
            _ => {
                return Err(format!(
                    "invalid delegated run transition for {run_id}: {:?} -> {:?}",
                    existing.status, next_status
                ));
            }
        }
        let mut updated = existing;
        if next_status == DelegationRunStatus::Running && updated.started_at_ms.is_none() {
            updated.started_at_ms = Some(now_ms());
        }
        updated.status = next_status;
        let mut candidate = runs.clone();
        candidate.insert(run_id.to_string(), updated.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(updated)
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
        let existing = runs
            .get(run_id)
            .cloned()
            .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
        if existing.status == terminal_status {
            return Ok(existing);
        }
        if existing.status.is_terminal() {
            return Err(format!(
                "delegated run {run_id} already settled as {:?}",
                existing.status
            ));
        }
        let mut updated = existing;
        updated.status = terminal_status;
        updated.result = result;
        updated.error = error;
        updated.completed_at_ms = Some(now_ms());
        let mut candidate = runs.clone();
        candidate.insert(run_id.to_string(), updated.clone());
        self.commit_candidate(&mut runs, candidate)?;
        Ok(updated)
    }

    fn ensure_active_capacity(&self, runs: &HashMap<String, DelegationRun>) -> Result<(), String> {
        let active_runs = runs
            .values()
            .filter(|run| !run.status.is_terminal())
            .count();
        if active_runs >= self.limits.max_active_runs {
            return Err(format!(
                "agent bridge active run limit reached: {}",
                self.limits.max_active_runs
            ));
        }
        Ok(())
    }

    fn commit_candidate(
        &self,
        current: &mut HashMap<String, DelegationRun>,
        candidate: HashMap<String, DelegationRun>,
    ) -> Result<(), String> {
        if let Some(error) = self.persistence_error.as_deref() {
            return Err(format!("agent bridge persistence unavailable: {error}"));
        }
        if let Some(persistence) = self.persistence.as_ref() {
            persistence
                .save(&sorted_runs(&candidate))
                .map_err(|error| {
                    format!(
                        "failed to persist Agent Bridge run facts at {}: {error}",
                        persistence.path().display()
                    )
                })?;
        }
        *current = candidate;
        Ok(())
    }

    fn next_run_id(&self, existing: &HashMap<String, DelegationRun>) -> String {
        loop {
            let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
            let candidate = format!("delegation-{}-{sequence}", now_ms());
            if !existing.contains_key(&candidate) {
                return candidate;
            }
        }
    }
}

impl Default for DelegationRunRegistry {
    fn default() -> Self {
        #[cfg(test)]
        {
            Self::new(DelegationRunLimits::default())
        }
        #[cfg(not(test))]
        {
            Self::production_default(DelegationRunLimits::default())
        }
    }
}

fn sorted_runs(runs: &HashMap<String, DelegationRun>) -> Vec<DelegationRun> {
    let mut values = runs.values().cloned().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        left.created_at_ms
            .cmp(&right.created_at_ms)
            .then_with(|| left.id.cmp(&right.id))
    });
    values
}

fn recovered_map(runs: Vec<DelegationRun>) -> Result<HashMap<String, DelegationRun>, String> {
    let mut recovered = HashMap::new();
    for run in runs {
        if run.id.trim().is_empty() || run.root_run_id.trim().is_empty() {
            return Err(
                "Agent Bridge durable store contains an empty run/root identity".to_string(),
            );
        }
        let id = run.id.clone();
        if recovered.insert(id.clone(), run).is_some() {
            return Err(format!(
                "Agent Bridge durable store contains duplicate run identity: {id}"
            ));
        }
    }
    for run in recovered.values() {
        if run.continuation_of_run_id.is_some() && run.retry_of_run_id.is_some() {
            return Err(format!(
                "Agent Bridge durable store run has conflicting continuation/retry lineage: {}",
                run.id
            ));
        }
        validate_recovered_lineage(run, &recovered)?;
        if let Some(binding) = run.dispatch_binding.as_ref() {
            validate_dispatch_binding(run, binding).map_err(|error| {
                format!(
                    "Agent Bridge durable store dispatch binding is invalid for {}: {error}",
                    run.id
                )
            })?;
        }
        if let Some(transfer) = run
            .dispatch_binding
            .as_ref()
            .and_then(|binding| binding.context_transfer.as_ref())
        {
            transfer.validate().map_err(|error| {
                format!(
                    "Agent Bridge durable store context transfer is invalid for {}: {error}",
                    run.id
                )
            })?;
        }
        if let Some(previous_run_id) = run.continuation_of_run_id.as_deref() {
            let previous = recovered.get(previous_run_id).ok_or_else(|| {
                format!(
                    "Agent Bridge durable store continuation source is missing: {} -> {previous_run_id}",
                    run.id
                )
            })?;
            if previous.workspace_id != run.workspace_id
                || previous.target.engine_id != run.target.engine_id
                || previous.parent_run_id != run.parent_run_id
                || previous.root_run_id != run.root_run_id
                || previous.depth != run.depth
            {
                return Err(format!(
                    "Agent Bridge durable store continuation owner mismatch: {} -> {previous_run_id}",
                    run.id
                ));
            }
        }
        if let Some(previous_run_id) = run.retry_of_run_id.as_deref() {
            let previous = recovered.get(previous_run_id).ok_or_else(|| {
                format!(
                    "Agent Bridge durable store retry source is missing: {} -> {previous_run_id}",
                    run.id
                )
            })?;
            if !matches!(
                previous.status,
                DelegationRunStatus::Failed | DelegationRunStatus::Cancelled
            ) || previous.workspace_id != run.workspace_id
                || previous.source != run.source
                || previous.target.engine_id != run.target.engine_id
                || previous.target_execution != run.target_execution
                || previous.parent_run_id != run.parent_run_id
                || previous.root_run_id != run.root_run_id
                || previous.depth != run.depth
                || previous.task != run.task
                || previous.file_refs != run.file_refs
                || previous.context_policy != run.context_policy
                || previous.execution_scope != run.execution_scope
                || run.target.logical_session_id.is_some()
                || run.target.native_session_id.is_some()
            {
                return Err(format!(
                    "Agent Bridge durable store retry owner mismatch: {} -> {previous_run_id}",
                    run.id
                ));
            }
        }
    }
    Ok(recovered)
}

fn validate_recovered_lineage(
    run: &DelegationRun,
    recovered: &HashMap<String, DelegationRun>,
) -> Result<(), String> {
    let Some(parent_run_id) = run.parent_run_id.as_deref() else {
        // A root continuation/retry intentionally retains the original root identity while
        // keeping no nested parent. Its immutable source owner is validated separately above.
        if run.continuation_of_run_id.is_some() || run.retry_of_run_id.is_some() {
            return Ok(());
        }
        if run.depth != 0 || run.root_run_id != run.id {
            return Err(format!(
                "Agent Bridge durable store root lineage is invalid for {}",
                run.id
            ));
        }
        return Ok(());
    };

    let parent = recovered.get(parent_run_id).ok_or_else(|| {
        format!(
            "Agent Bridge durable store parent is missing: {} -> {parent_run_id}",
            run.id
        )
    })?;
    let expected_depth = parent.depth.checked_add(1).ok_or_else(|| {
        format!(
            "Agent Bridge durable store parent depth overflow: {} -> {parent_run_id}",
            run.id
        )
    })?;
    let parent_runtime_workspace_id = parent
        .dispatch_binding
        .as_ref()
        .and_then(|binding| binding.runtime_workspace_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(parent.workspace_id.as_str());
    if run.id == parent_run_id
        || run.root_run_id != parent.root_run_id
        || run.depth != expected_depth
        || run.source.engine_id != parent.target.engine_id
        || run.workspace_id != parent_runtime_workspace_id
    {
        return Err(format!(
            "Agent Bridge durable store parent lineage ownership is invalid: {} -> {parent_run_id}",
            run.id
        ));
    }
    Ok(())
}

fn validate_dispatch_binding(
    run: &DelegationRun,
    binding: &DelegationDispatchBinding,
) -> Result<(), String> {
    for (label, value) in [
        ("backing thread id", binding.backing_thread_id.as_str()),
        ("attempt id", binding.attempt_id.as_str()),
        ("logical turn id", binding.logical_turn_id.as_str()),
        ("binding key", binding.binding_key.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("delegated dispatch {label} is required"));
        }
    }
    let runtime_workspace_id = binding
        .runtime_workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match run.execution_scope {
        super::models::DelegationExecutionScope::IsolatedWorktree => {
            let runtime_workspace_id = runtime_workspace_id.ok_or_else(|| {
                "isolated delegated dispatch requires a durable runtime workspace".to_string()
            })?;
            if runtime_workspace_id == run.workspace_id {
                return Err(
                    "isolated delegated dispatch cannot use the source workspace as runtime owner"
                        .to_string(),
                );
            }
        }
        _ => {
            if runtime_workspace_id.is_some_and(|workspace_id| workspace_id != run.workspace_id) {
                return Err(
                    "non-isolated delegated dispatch runtime workspace does not match source workspace"
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

fn recover_stale_runtime_owners(runs: &mut HashMap<String, DelegationRun>) -> bool {
    let recovered_at = now_ms();
    let mut changed = false;
    for run in runs.values_mut() {
        let stale_running = matches!(
            run.status,
            DelegationRunStatus::Running | DelegationRunStatus::WaitingApproval
        );
        let inconsistent_queued = run.status == DelegationRunStatus::Queued
            && (run.started_at_ms.is_some() || run.dispatch_binding.is_some());
        if !stale_running && !inconsistent_queued {
            continue;
        }

        let detail = run
            .dispatch_binding
            .as_ref()
            .map(|binding| {
                format!(
                    "backingThreadId={}, attemptId={}, nativeSessionId={}, runtimeTurnId={}",
                    binding.backing_thread_id,
                    binding.attempt_id,
                    binding.native_session_id.as_deref().unwrap_or("<missing>"),
                    binding.runtime_turn_id.as_deref().unwrap_or("<missing>")
                )
            })
            .unwrap_or_else(|| "dispatch binding was not durably established".to_string());
        run.status = DelegationRunStatus::Failed;
        run.result = None;
        run.error = Some(format!(
            "recovery-required: app restarted without a provable live runtime owner; {detail}"
        ));
        run.completed_at_ms = Some(recovered_at);
        changed = true;
    }
    changed
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
    use uuid::Uuid;

    fn execution_target() -> ExecutionTargetInput {
        ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: None,
            model_catalog_entry_id: Some("gpt-5.6-sol".to_string()),
            model: Some("gpt-5.6-sol".to_string()),
            reasoning_effort: Some("low".to_string()),
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
        assert_eq!(child.continuation_of_run_id, None);
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
                    runtime_workspace_id: None,
                    native_session_id: None,
                    runtime_turn_id: None,
                    context_transfer: None,
                },
            )
            .expect("set binding");
        let acked = registry
            .record_runtime_ack(&run.id, "attempt-1", "native-1", "runtime-turn-1")
            .expect("record ack");

        assert_eq!(
            acked.target.logical_session_id.as_deref(),
            Some("shared:bridge-session")
        );
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
    fn isolated_dispatch_binding_requires_distinct_durable_runtime_workspace() {
        let registry = DelegationRunRegistry::default();
        let mut isolated_request = request(None);
        isolated_request.execution_scope = DelegationExecutionScope::IsolatedWorktree;
        let run = registry
            .create(isolated_request)
            .expect("create isolated run");
        registry
            .claim_dispatch(&run.id)
            .expect("claim isolated run");
        let binding = |runtime_workspace_id: Option<&str>| DelegationDispatchBinding {
            backing_thread_id: "shared:bridge-session".to_string(),
            attempt_id: "attempt-1".to_string(),
            logical_turn_id: "turn-1".to_string(),
            binding_key: "squad:run:delegate:codex:default".to_string(),
            runtime_workspace_id: runtime_workspace_id.map(str::to_string),
            native_session_id: None,
            runtime_turn_id: None,
            context_transfer: None,
        };

        assert!(registry
            .set_dispatch_binding(&run.id, binding(None))
            .expect_err("missing isolated owner")
            .contains("durable runtime workspace"));
        assert!(registry
            .set_dispatch_binding(&run.id, binding(Some("workspace-1")))
            .expect_err("source workspace is unsafe")
            .contains("source workspace"));
        assert!(registry
            .set_dispatch_binding(&run.id, binding(Some("workspace-isolated")))
            .is_ok());
        assert_eq!(
            registry
                .backing_thread_ids_for_workspace("workspace-isolated")
                .expect("runtime workspace backing lanes"),
            vec!["shared:bridge-session".to_string()]
        );
        assert!(registry
            .backing_thread_ids_for_workspace("workspace-1")
            .expect("source workspace lanes")
            .is_empty());
    }

    #[test]
    fn context_transfer_is_durable_and_attempt_scoped() {
        let registry = DelegationRunRegistry::default();
        let run = registry.create(request(None)).expect("create run");
        registry.claim_dispatch(&run.id).expect("claim dispatch");
        registry
            .set_dispatch_binding(
                &run.id,
                DelegationDispatchBinding {
                    backing_thread_id: "shared:bridge-session".to_string(),
                    attempt_id: "attempt-1".to_string(),
                    logical_turn_id: "turn-1".to_string(),
                    binding_key: "squad:run:delegate:codex:default".to_string(),
                    runtime_workspace_id: None,
                    native_session_id: None,
                    runtime_turn_id: None,
                    context_transfer: None,
                },
            )
            .expect("set binding");
        let transfer = DelegationContextTransfer {
            policy: DelegationContextPolicy::Portable,
            package_id: "package-1".to_string(),
            artifact_id: "artifact-1".to_string(),
            artifact_checksum: "sha256:artifact".to_string(),
            source_checksum: "sha256:source".to_string(),
            projection_mode: "portable-transcript".to_string(),
        };

        assert!(registry
            .record_context_transfer(&run.id, "other-attempt", transfer.clone())
            .is_err());
        let updated = registry
            .record_context_transfer(&run.id, "attempt-1", transfer.clone())
            .expect("record context");
        let repeated = registry
            .record_context_transfer(&run.id, "attempt-1", transfer.clone())
            .expect("idempotent context");

        assert_eq!(updated, repeated);
        assert_eq!(
            repeated
                .dispatch_binding
                .as_ref()
                .and_then(|binding| binding.context_transfer.as_ref()),
            Some(&transfer)
        );
    }

    #[test]
    fn continuation_gets_new_identity_without_reopening_completed_run() {
        let registry = DelegationRunRegistry::default();
        let run = registry.create(request(None)).expect("create run");
        registry.claim_dispatch(&run.id).expect("claim");
        registry
            .set_dispatch_binding(
                &run.id,
                DelegationDispatchBinding {
                    backing_thread_id: "shared:bridge-session".to_string(),
                    attempt_id: "attempt-1".to_string(),
                    logical_turn_id: "turn-1".to_string(),
                    binding_key: "squad:run:delegate:codex:default".to_string(),
                    runtime_workspace_id: None,
                    native_session_id: Some("native-1".to_string()),
                    runtime_turn_id: Some("runtime-turn-1".to_string()),
                    context_transfer: None,
                },
            )
            .expect("bind");
        registry
            .settle_completed(
                &run.id,
                DelegationResult {
                    summary: Some("done".to_string()),
                    changed_files: Vec::new(),
                    branch: None,
                    diff: None,
                    artifact_path: None,
                },
            )
            .expect("complete");

        let continuation = registry
            .create_continuation(&run.id, "check one more thing".to_string())
            .expect("continue");
        let original = registry.get(&run.id).expect("read").expect("original");

        assert_ne!(continuation.id, original.id);
        assert_eq!(original.status, DelegationRunStatus::Completed);
        assert_eq!(continuation.status, DelegationRunStatus::Queued);
        assert_eq!(
            continuation.continuation_of_run_id.as_deref(),
            Some(original.id.as_str())
        );
        assert_eq!(continuation.root_run_id, original.root_run_id);
        assert_eq!(continuation.depth, original.depth);
        assert_eq!(
            continuation.target.native_session_id.as_deref(),
            Some("native-1")
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
                    diff: None,
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
                    diff: None,
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
    fn retry_creates_fresh_immutable_run_without_reusing_runtime_identity() {
        let registry = DelegationRunRegistry::default();
        let run = registry.create(request(None)).expect("create run");
        registry.claim_dispatch(&run.id).expect("claim");
        registry
            .set_dispatch_binding(
                &run.id,
                DelegationDispatchBinding {
                    backing_thread_id: "shared:retry-source".to_string(),
                    attempt_id: "attempt-1".to_string(),
                    logical_turn_id: "turn-1".to_string(),
                    binding_key: "squad:retry:delegate:codex:default".to_string(),
                    runtime_workspace_id: Some("workspace-1".to_string()),
                    native_session_id: Some("native-1".to_string()),
                    runtime_turn_id: Some("runtime-1".to_string()),
                    context_transfer: None,
                },
            )
            .expect("bind");
        registry
            .settle_failed(&run.id, "failed".to_string())
            .expect("fail");

        let retried = registry.create_retry(&run.id).expect("retry");
        let original = registry.get(&run.id).expect("read").expect("original");

        assert_ne!(retried.id, original.id);
        assert_eq!(original.status, DelegationRunStatus::Failed);
        assert_eq!(retried.status, DelegationRunStatus::Queued);
        assert_eq!(
            retried.retry_of_run_id.as_deref(),
            Some(original.id.as_str())
        );
        assert_eq!(retried.root_run_id, original.root_run_id);
        assert_eq!(retried.task, original.task);
        assert!(retried.dispatch_binding.is_none());
        assert!(retried.target.logical_session_id.is_none());
        assert!(retried.target.native_session_id.is_none());
    }

    #[test]
    fn retry_rejects_non_retryable_terminal_and_active_states() {
        let registry = DelegationRunRegistry::default();
        let queued = registry.create(request(None)).expect("create queued");
        assert!(registry.create_retry(&queued.id).is_err());

        registry.claim_dispatch(&queued.id).expect("claim");
        registry
            .settle_completed(
                &queued.id,
                DelegationResult {
                    summary: Some("done".to_string()),
                    changed_files: Vec::new(),
                    branch: None,
                    diff: None,
                    artifact_path: None,
                },
            )
            .expect("complete");
        assert!(registry.create_retry(&queued.id).is_err());
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

    fn valid_recovered_lineage() -> Vec<DelegationRun> {
        let registry = DelegationRunRegistry::default();
        let root = registry.create(request(None)).expect("create root");
        let mut child_request = request(Some(root.id));
        child_request.source.engine_id = "codex".to_string();
        registry.create(child_request).expect("create valid child");
        registry.list().expect("list lineage")
    }

    #[test]
    fn durable_recovery_validates_nested_parent_ownership() {
        let valid = valid_recovered_lineage();
        recovered_map(valid.clone()).expect("valid lineage");

        let mut wrong_source = valid.clone();
        wrong_source
            .iter_mut()
            .find(|run| run.parent_run_id.is_some())
            .expect("child")
            .source
            .engine_id = "pi".to_string();
        assert!(recovered_map(wrong_source)
            .expect_err("source owner mismatch")
            .contains("parent lineage ownership"));

        let mut wrong_depth = valid.clone();
        wrong_depth
            .iter_mut()
            .find(|run| run.parent_run_id.is_some())
            .expect("child")
            .depth = 7;
        assert!(recovered_map(wrong_depth)
            .expect_err("depth mismatch")
            .contains("parent lineage ownership"));

        let child_only = valid
            .into_iter()
            .filter(|run| run.parent_run_id.is_some())
            .collect();
        assert!(recovered_map(child_only)
            .expect_err("missing parent")
            .contains("parent is missing"));
    }

    #[test]
    fn durable_registry_restores_terminal_facts_and_fails_stale_runtime_closed() {
        let root = std::env::temp_dir().join(format!("agent-bridge-registry-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("runs.json");
        let persistence = AgentBridgePersistence::new(path.clone());
        let registry =
            DelegationRunRegistry::persistent(persistence.clone(), DelegationRunLimits::default());
        let run = registry
            .create(request(None))
            .expect("create persisted run");
        registry
            .claim_dispatch(&run.id)
            .expect("claim persisted run");
        registry
            .set_dispatch_binding(
                &run.id,
                DelegationDispatchBinding {
                    backing_thread_id: "shared:bridge-session".to_string(),
                    attempt_id: "attempt-1".to_string(),
                    logical_turn_id: "turn-1".to_string(),
                    binding_key: "squad:run:delegate:codex:default".to_string(),
                    runtime_workspace_id: None,
                    native_session_id: Some("native-1".to_string()),
                    runtime_turn_id: Some("runtime-turn-1".to_string()),
                    context_transfer: None,
                },
            )
            .expect("persist binding");
        let transfer = DelegationContextTransfer {
            policy: DelegationContextPolicy::Inherited,
            package_id: "package-1".to_string(),
            artifact_id: "artifact-1".to_string(),
            artifact_checksum: "sha256:artifact".to_string(),
            source_checksum: "sha256:source".to_string(),
            projection_mode: "portable-transcript".to_string(),
        };
        registry
            .record_context_transfer(&run.id, "attempt-1", transfer.clone())
            .expect("persist context transfer");
        drop(registry);

        let recovered = DelegationRunRegistry::persistent(
            AgentBridgePersistence::new(path),
            DelegationRunLimits::default(),
        );
        let restored = recovered
            .get(&run.id)
            .expect("read recovered")
            .expect("restored run");

        assert_eq!(restored.status, DelegationRunStatus::Failed);
        assert!(restored
            .error
            .as_deref()
            .is_some_and(|error| error.contains("recovery-required")));
        assert_eq!(
            restored
                .dispatch_binding
                .as_ref()
                .and_then(|binding| binding.native_session_id.as_deref()),
            Some("native-1")
        );
        assert_eq!(
            restored
                .dispatch_binding
                .as_ref()
                .and_then(|binding| binding.context_transfer.as_ref()),
            Some(&transfer)
        );
        std::fs::remove_dir_all(root).ok();
    }
}
