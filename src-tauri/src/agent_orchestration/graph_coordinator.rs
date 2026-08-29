use tauri::AppHandle;

use crate::state::AppState;

use super::bridge::AgentEndpoint;
use super::graph::AgentGraphPlan;
use super::graph_store::{AgentGraphRegistry, DurableAgentGraphRun};
use super::scheduler::{
    dispatch_prepared_batch, prepare_ready_batch, AgentGraphDispatchBatch, AgentGraphExecution,
};

/// Durable coordinator for Bridge-backed DAG execution.
///
/// The coordinator owns graph-level orchestration facts only. Each node's process/session/result
/// remains owned by Agent Bridge. Graph identity and node -> Bridge run mappings are persisted
/// before the corresponding target runtime may start.
pub(crate) struct AgentGraphCoordinator {
    registry: AgentGraphRegistry,
}

impl AgentGraphCoordinator {
    pub(crate) fn new(registry: AgentGraphRegistry) -> Self {
        Self { registry }
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
        let (validated, execution) = AgentGraphExecution::new(&plan, workspace_id, source)?;
        let record = DurableAgentGraphRun::new(plan, execution)?;
        let durable = self.registry.create(record)?;
        self.advance_record(&validated, durable, state, app).await
    }

    /// Advance one previously-created graph after one or more node runs changed state.
    pub(crate) async fn tick(
        &self,
        graph_id: &str,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<AgentGraphDispatchBatch, String> {
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
        let prepared = prepare_ready_batch(validated, durable.execution, state).await?;

        // Critical ordering guarantee: the graph's mapping to each freshly-created Bridge run is
        // durable before any target runtime side effect occurs.
        self.registry
            .update_execution(&prepared.graph_id, prepared.execution.clone())?;

        match dispatch_prepared_batch(validated, prepared, state, app).await {
            Ok(batch) => {
                self.registry
                    .update_execution(&batch.graph_id, batch.execution.clone())?;
                Ok(batch)
            }
            Err(error) => {
                let current = self
                    .registry
                    .get(&durable.plan.id)?
                    .ok_or_else(|| {
                        format!(
                            "orchestration graph disappeared during recovery: {}",
                            durable.plan.id
                        )
                    })?;
                let mut recovered = current.execution;
                let _ = recovered.reconcile(state);
                let _ = self
                    .registry
                    .update_execution(&recovered.graph_id, recovered);
                Err(error)
            }
        }
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
