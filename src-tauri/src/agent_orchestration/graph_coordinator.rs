use tauri::AppHandle;

use crate::state::AppState;

use super::bridge::AgentEndpoint;
use super::graph::AgentGraphPlan;
use super::graph_store::{AgentGraphRegistry, DurableAgentGraphRun};
use super::scheduler::{dispatch_ready_batch, AgentGraphDispatchBatch, AgentGraphExecution};

/// Durable coordinator for Bridge-backed DAG execution.
///
/// The coordinator owns graph-level orchestration facts only. Each node's process/session/result
/// remains owned by Agent Bridge. Every graph mutation is persisted before the caller may observe
/// it as durable progress.
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

    /// Create the graph's durable identity before dispatching any target runtime.
    pub(crate) async fn start(
        &self,
        plan: AgentGraphPlan,
        workspace_id: String,
        source: AgentEndpoint,
        state: &AppState,
        app: &AppHandle,
    ) -> Result<AgentGraphDispatchBatch, String> {
        let (validated, execution) = AgentGraphExecution::new(&plan, workspace_id, source)?;
        let record = DurableAgentGraphRun::new(plan, execution.clone())?;
        let durable = self.registry.create(record)?;

        match dispatch_ready_batch(&validated, durable.execution.clone(), state, app).await {
            Ok(batch) => {
                self.registry
                    .update_execution(&batch.graph_id, batch.execution.clone())?;
                Ok(batch)
            }
            Err(error) => {
                // `dispatch_ready_batch` may have created/settled Bridge runs before a later error.
                // Reconcile the graph projection from those durable Bridge facts before returning.
                let mut recovered = durable.execution;
                let _ = recovered.reconcile(state);
                let _ = self
                    .registry
                    .update_execution(&recovered.graph_id, recovered);
                Err(error)
            }
        }
    }

    /// Advance one previously-created graph after one or more node runs changed state.
    ///
    /// Repeated calls are idempotent with respect to already-started nodes because the persisted
    /// node -> delegation run mapping is reconciled before calculating newly-ready nodes.
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
        let batch = dispatch_ready_batch(&validated, durable.execution, state, app).await?;
        self.registry
            .update_execution(graph_id, batch.execution.clone())?;
        Ok(batch)
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
