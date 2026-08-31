use std::collections::BTreeSet;

use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::state::AppState;

use super::bridge::{AgentEndpoint, DelegationRun, DelegationRunStatus};
use super::graph::AgentGraphPlan;
use super::graph_store::{AgentGraphRegistry, DurableAgentGraphRun};
use super::scheduler::{
    dispatch_prepared_batch, prepare_ready_batch, AgentGraphDispatchBatch, AgentGraphExecution,
};

/// Durable coordinator for Bridge-backed DAG execution.
///
/// The coordinator owns graph-level orchestration facts only. Each node's process/session/result
/// remains owned by Agent Bridge. Graph identity and node -> Bridge run mappings are persisted
/// before the corresponding target runtime may start. `advance_lock` serializes graph state
/// transitions so simultaneous fan-out settlements cannot create the same downstream node twice.
pub(crate) struct AgentGraphCoordinator {
    registry: AgentGraphRegistry,
    advance_lock: Mutex<()>,
}

impl AgentGraphCoordinator {
    pub(crate) fn new(registry: AgentGraphRegistry) -> Self {
        Self {
            registry,
            advance_lock: Mutex::new(()),
        }
    }

    pub(crate) fn volatile() -> Self {
        Self::new(AgentGraphRegistry::volatile())
    }

    pub(crate) fn get(&self, graph_id: &str) -> Result<Option<DurableAgentGraphRun>, String> {
        self.registry.get(graph_id)
    }

    pub(crate) fn list(&self) -> Result<Vec<DurableAgentGraphRun>, String> {
        self.registry.list()
    }

    /// Create graph identity, prepare Bridge runs, persist their graph mapping, then start runtimes.
    pub(crate) async fn start(
        &self,
        plan: AgentGraphPlan,
        workspace_id: String,
        source: AgentEndpoint,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<AgentGraphDispatchBatch, String> {
        let _guard = self.advance_lock.lock().await;
        let (validated, execution) = AgentGraphExecution::new(&plan, workspace_id, source)?;
        let record = DurableAgentGraphRun::new(plan, execution)?;
        let durable = self.registry.create(record)?;
        self.advance_record(&validated, durable, state, app).await
    }

    /// Advance one previously-created graph after one or more node runs changed state or after app
    /// restart. Any node mapping that already points at a clean Queued Bridge run is dispatched
    /// before new ready nodes are created, closing the crash window between mapping persistence and
    /// target runtime start.
    pub(crate) async fn tick(
        &self,
        graph_id: &str,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<AgentGraphDispatchBatch, String> {
        let _guard = self.advance_lock.lock().await;
        let durable = self
            .registry
            .get(graph_id)?
            .ok_or_else(|| format!("orchestration graph not found: {graph_id}"))?;
        let validated = durable.plan.validate()?;
        self.advance_record(&validated, durable, state, app).await
    }

    async fn advance_record(
        &self,
        validated: &super::graph::ValidatedAgentGraph,
        durable: DurableAgentGraphRun,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<AgentGraphDispatchBatch, String> {
        let graph_id = durable.plan.id.clone();
        let mut execution = durable.execution;

        // Recovery phase: mapping is already durable, therefore it is safe to start any Bridge run
        // that was created before a crash but never claimed by the runtime dispatcher.
        let mut dispatched = self
            .dispatch_mapped_queued_runs(&execution, state, app)
            .await?;
        execution.reconcile(state)?;
        self.registry
            .update_execution(&graph_id, execution.clone())?;

        let prepared = prepare_ready_batch(validated, execution, state).await?;

        // Critical ordering guarantee: the graph's mapping to each freshly-created Bridge run is
        // durable before any target runtime side effect occurs.
        self.registry
            .update_execution(&prepared.graph_id, prepared.execution.clone())?;

        match dispatch_prepared_batch(validated, prepared, state, app).await {
            Ok(mut batch) => {
                if !dispatched.is_empty() {
                    dispatched.append(&mut batch.dispatched);
                    batch.dispatched = dispatched;
                }
                self.registry
                    .update_execution(&batch.graph_id, batch.execution.clone())?;
                Ok(batch)
            }
            Err(error) => {
                let current = self
                    .registry
                    .get(&graph_id)?
                    .ok_or_else(|| {
                        format!("orchestration graph disappeared during recovery: {graph_id}")
                    })?;
                let mut recovered = current.execution;
                let _ = recovered.reconcile(state);
                let recovered_graph_id = recovered.graph_id.clone();
                let _ = self
                    .registry
                    .update_execution(&recovered_graph_id, recovered);
                Err(error)
            }
        }
    }

    async fn dispatch_mapped_queued_runs(
        &self,
        execution: &AgentGraphExecution,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<Vec<DelegationRun>, String> {
        let mut seen = BTreeSet::new();
        let run_ids = execution
            .nodes
            .values()
            .filter_map(|node| node.delegation_run_id.as_deref())
            .filter(|run_id| seen.insert((*run_id).to_string()))
            .map(str::to_string)
            .collect::<Vec<_>>();
        let mut dispatched = Vec::new();

        for run_id in run_ids {
            let Some(run) = state.agent_bridge.get_run(&run_id)? else {
                continue;
            };
            if run.status != DelegationRunStatus::Queued {
                continue;
            }
            match state.dispatch_delegation_run(&run_id, app).await {
                Ok(run) => dispatched.push(run),
                Err(error) => {
                    // Dispatcher owns fail-closed settlement. Do not create a replacement run; the
                    // graph remains mapped to this immutable Bridge identity and reconcile below
                    // observes whichever durable status won the race.
                    log::warn!(
                        "[agent-orchestration] queued DAG run recovery dispatch failed (graph={} run={}): {}",
                        execution.graph_id,
                        run_id,
                        error
                    );
                }
            }
        }
        Ok(dispatched)
    }
}

impl Default for AgentGraphCoordinator {
    fn default() -> Self {
        Self::new(AgentGraphRegistry::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        DelegationContextPolicy, DelegationExecutionScope,
    };
    use crate::agent_orchestration::graph::AgentGraphNode;

    fn plan() -> AgentGraphPlan {
        AgentGraphPlan {
            id: "graph-1".to_string(),
            nodes: vec![AgentGraphNode {
                id: "root".to_string(),
                target_engine_id: "codex".to_string(),
                task: "review".to_string(),
                depends_on: Vec::new(),
                file_refs: Vec::new(),
                context_policy: DelegationContextPolicy::Explicit,
                execution_scope: DelegationExecutionScope::Observe,
            }],
        }
    }

    fn source() -> AgentEndpoint {
        AgentEndpoint {
            engine_id: "claude".to_string(),
            logical_session_id: Some("runtime-1".to_string()),
            native_session_id: None,
        }
    }

    #[test]
    fn coordinator_can_persist_graph_identity_before_runtime_is_available() {
        let coordinator = AgentGraphCoordinator::volatile();
        let plan = plan();
        let (_, execution) = AgentGraphExecution::new(
            &plan,
            "workspace-1".to_string(),
            source(),
        )
        .expect("execution");
        coordinator
            .registry
            .create(DurableAgentGraphRun::new(plan, execution).expect("record"))
            .expect("create");
        assert_eq!(coordinator.list().expect("list").len(), 1);
    }
}
