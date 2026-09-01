use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::state::AppState;

use super::bridge::{
    AgentEndpoint, CreateDelegationRun, DelegationRun, DelegationRunStatus,
};
use super::graph::{AgentGraphPlan, ValidatedAgentGraph};

pub(crate) type AgentGraphBackendFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

/// Narrow Bridge boundary consumed by durable graph orchestration.
///
/// Production delegates to the one `AppState` owner. Tests can provide deterministic Bridge
/// facts without constructing an engine runtime or teaching the graph layer how to spawn one.
pub(crate) trait AgentGraphBridgeBackend: Sync {
    fn create_run(
        &self,
        request: CreateDelegationRun,
    ) -> AgentGraphBackendFuture<'_, DelegationRun>;
    fn dispatch_run(&self, run_id: String) -> AgentGraphBackendFuture<'_, DelegationRun>;
    fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String>;
}

pub(crate) struct AppStateGraphBackend<'a> {
    state: &'a AppState,
    app: &'a AppHandle,
}

impl<'a> AppStateGraphBackend<'a> {
    pub(crate) fn new(state: &'a AppState, app: &'a AppHandle) -> Self {
        Self { state, app }
    }
}

impl AgentGraphBridgeBackend for AppStateGraphBackend<'_> {
    fn create_run(
        &self,
        request: CreateDelegationRun,
    ) -> AgentGraphBackendFuture<'_, DelegationRun> {
        Box::pin(async move { self.state.create_delegation_run(request).await })
    }

    fn dispatch_run(&self, run_id: String) -> AgentGraphBackendFuture<'_, DelegationRun> {
        Box::pin(async move { self.state.dispatch_delegation_run(&run_id, self.app).await })
    }

    fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
        self.state.agent_bridge.get_run(run_id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentGraphNodeStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    Blocked,
}

impl AgentGraphNodeStatus {
    fn is_dependency_success(self) -> bool {
        matches!(self, Self::Completed)
    }

    fn blocks_dependents(self) -> bool {
        matches!(self, Self::Failed | Self::Cancelled | Self::Blocked)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphNodeExecution {
    pub node_id: String,
    pub status: AgentGraphNodeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphExecution {
    pub graph_id: String,
    pub workspace_id: String,
    pub source: AgentEndpoint,
    pub nodes: BTreeMap<String, AgentGraphNodeExecution>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreparedAgentGraphBatch {
    pub(crate) graph_id: String,
    pub(crate) runs: Vec<DelegationRun>,
    pub(crate) execution: AgentGraphExecution,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphDispatchBatch {
    pub graph_id: String,
    pub dispatched: Vec<DelegationRun>,
    pub execution: AgentGraphExecution,
}

impl AgentGraphExecution {
    pub(crate) fn new(
        graph: &AgentGraphPlan,
        workspace_id: String,
        source: AgentEndpoint,
    ) -> Result<(ValidatedAgentGraph, Self), String> {
        source.validate("graph source")?;
        let workspace_id = workspace_id.trim().to_string();
        if workspace_id.is_empty() {
            return Err("orchestration graph workspace id is required".to_string());
        }
        let validated = graph.validate()?;
        let nodes = validated
            .nodes
            .keys()
            .map(|node_id| {
                (
                    node_id.clone(),
                    AgentGraphNodeExecution {
                        node_id: node_id.clone(),
                        status: AgentGraphNodeStatus::Pending,
                        delegation_run_id: None,
                        error: None,
                    },
                )
            })
            .collect();
        Ok((
            validated,
            Self {
                graph_id: graph.id.trim().to_string(),
                workspace_id,
                source,
                nodes,
            },
        ))
    }

    pub(crate) fn reconcile(
        &mut self,
        backend: &dyn AgentGraphBridgeBackend,
    ) -> Result<(), String> {
        for execution in self.nodes.values_mut() {
            let Some(run_id) = execution.delegation_run_id.as_deref() else {
                continue;
            };
            let Some(run) = backend.get_run(run_id)? else {
                execution.status = AgentGraphNodeStatus::Failed;
                execution.error = Some(format!(
                    "delegation run disappeared from Agent Bridge registry: {run_id}"
                ));
                continue;
            };
            execution.status = graph_status_from_delegation(run.status);
            execution.error = run.error;
        }
        Ok(())
    }

    fn block_failed_dependencies(&mut self, graph: &ValidatedAgentGraph) {
        for node_id in &graph.topological_order {
            let Some(node) = graph.nodes.get(node_id) else {
                continue;
            };
            let current_status = self
                .nodes
                .get(node_id)
                .map(|value| value.status)
                .unwrap_or(AgentGraphNodeStatus::Failed);
            if current_status != AgentGraphNodeStatus::Pending {
                continue;
            }
            let blocker = node.depends_on.iter().find_map(|dependency| {
                self.nodes
                    .get(dependency)
                    .filter(|value| value.status.blocks_dependents())
                    .map(|value| (dependency.clone(), value.status))
            });
            if let Some((dependency, status)) = blocker {
                if let Some(execution) = self.nodes.get_mut(node_id) {
                    execution.status = AgentGraphNodeStatus::Blocked;
                    execution.error = Some(format!(
                        "dependency {dependency} settled as {status:?}"
                    ));
                }
            }
        }
    }

    fn ready_node_ids(&self, graph: &ValidatedAgentGraph) -> Vec<String> {
        graph
            .topological_order
            .iter()
            .filter(|node_id| {
                self.nodes
                    .get(*node_id)
                    .is_some_and(|value| value.status == AgentGraphNodeStatus::Pending)
            })
            .filter(|node_id| {
                graph.nodes.get(*node_id).is_some_and(|node| {
                    node.depends_on.iter().all(|dependency| {
                        self.nodes
                            .get(dependency)
                            .is_some_and(|value| value.status.is_dependency_success())
                    })
                })
            })
            .cloned()
            .collect()
    }
}

/// Phase 1: create durable Bridge run identities for every newly-ready node without starting any
/// target runtime. Callers MUST persist the returned graph execution before invoking phase 2.
pub(crate) async fn prepare_ready_batch(
    graph: &ValidatedAgentGraph,
    mut execution: AgentGraphExecution,
    backend: &dyn AgentGraphBridgeBackend,
) -> Result<PreparedAgentGraphBatch, String> {
    execution.reconcile(backend)?;
    execution.block_failed_dependencies(graph);
    let ready = execution.ready_node_ids(graph);
    let mut runs = Vec::with_capacity(ready.len());

    for node_id in ready {
        let node = graph
            .nodes
            .get(&node_id)
            .ok_or_else(|| format!("validated graph node disappeared: {node_id}"))?;
        let request = CreateDelegationRun {
            source: execution.source.clone(),
            target: AgentEndpoint {
                engine_id: node.target_engine_id.clone(),
                logical_session_id: None,
                native_session_id: None,
            },
            target_execution: None,
            workspace_id: execution.workspace_id.clone(),
            task: node.task.clone(),
            file_refs: node.file_refs.clone(),
            context_policy: node.context_policy,
            execution_scope: node.execution_scope,
            // DAG dependency is graph-level ordering, not nested Agent-to-Agent lineage.
            parent_run_id: None,
        };

        match backend.create_run(request).await {
            Ok(run) => {
                if let Some(node_execution) = execution.nodes.get_mut(&node_id) {
                    // The Bridge run itself is durable, but no runtime side effect has happened yet.
                    node_execution.status = AgentGraphNodeStatus::Running;
                    node_execution.delegation_run_id = Some(run.id.clone());
                    node_execution.error = None;
                }
                runs.push(run);
            }
            Err(error) => {
                if let Some(node_execution) = execution.nodes.get_mut(&node_id) {
                    node_execution.status = AgentGraphNodeStatus::Failed;
                    node_execution.error = Some(error);
                }
            }
        }
    }

    execution.block_failed_dependencies(graph);
    Ok(PreparedAgentGraphBatch {
        graph_id: execution.graph_id.clone(),
        runs,
        execution,
    })
}

/// Phase 2: start only Bridge runs whose graph mapping was already durably persisted by the
/// coordinator. This preserves graph-owner-before-runtime-side-effect ordering.
pub(crate) async fn dispatch_prepared_batch(
    graph: &ValidatedAgentGraph,
    mut prepared: PreparedAgentGraphBatch,
    backend: &dyn AgentGraphBridgeBackend,
) -> Result<AgentGraphDispatchBatch, String> {
    let mut dispatched = Vec::with_capacity(prepared.runs.len());
    for run in prepared.runs {
        match backend.dispatch_run(run.id.clone()).await {
            Ok(dispatched_run) => dispatched.push(dispatched_run),
            Err(error) => {
                if let Some(node_execution) = prepared.execution.nodes.values_mut().find(|node| {
                    node.delegation_run_id.as_deref() == Some(run.id.as_str())
                }) {
                    node_execution.error = Some(error);
                }
            }
        }
    }
    prepared.execution.reconcile(backend)?;
    prepared.execution.block_failed_dependencies(graph);
    Ok(AgentGraphDispatchBatch {
        graph_id: prepared.graph_id,
        dispatched,
        execution: prepared.execution,
    })
}

fn graph_status_from_delegation(status: DelegationRunStatus) -> AgentGraphNodeStatus {
    match status {
        DelegationRunStatus::Queued
        | DelegationRunStatus::Running
        | DelegationRunStatus::WaitingApproval => AgentGraphNodeStatus::Running,
        DelegationRunStatus::Completed => AgentGraphNodeStatus::Completed,
        DelegationRunStatus::Failed => AgentGraphNodeStatus::Failed,
        DelegationRunStatus::Cancelled => AgentGraphNodeStatus::Cancelled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        DelegationContextPolicy, DelegationExecutionScope,
    };
    use crate::agent_orchestration::graph::AgentGraphNode;

    fn node(id: &str, dependencies: &[&str]) -> AgentGraphNode {
        AgentGraphNode {
            id: id.to_string(),
            target_engine_id: "codex".to_string(),
            task: format!("task-{id}"),
            depends_on: dependencies.iter().map(|value| value.to_string()).collect(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
        }
    }

    fn source() -> AgentEndpoint {
        AgentEndpoint {
            engine_id: "claude".to_string(),
            logical_session_id: Some("runtime-source".to_string()),
            native_session_id: Some("native-source".to_string()),
        }
    }

    #[test]
    fn execution_starts_with_only_roots_ready() {
        let plan = AgentGraphPlan {
            id: "pipeline".to_string(),
            nodes: vec![
                node("root", &[]),
                node("review-a", &["root"]),
                node("review-b", &["root"]),
            ],
        };
        let (graph, execution) = AgentGraphExecution::new(
            &plan,
            "workspace-1".to_string(),
            source(),
        )
        .expect("execution");
        assert_eq!(execution.ready_node_ids(&graph), vec!["root"]);
    }

    #[test]
    fn failed_dependency_blocks_downstream_without_marking_siblings() {
        let plan = AgentGraphPlan {
            id: "pipeline".to_string(),
            nodes: vec![
                node("root", &[]),
                node("review-a", &["root"]),
                node("independent", &[]),
            ],
        };
        let (graph, mut execution) = AgentGraphExecution::new(
            &plan,
            "workspace-1".to_string(),
            source(),
        )
        .expect("execution");
        execution.nodes.get_mut("root").expect("root").status = AgentGraphNodeStatus::Failed;
        execution.block_failed_dependencies(&graph);

        assert_eq!(
            execution.nodes["review-a"].status,
            AgentGraphNodeStatus::Blocked
        );
        assert_eq!(
            execution.nodes["independent"].status,
            AgentGraphNodeStatus::Pending
        );
        assert_eq!(execution.ready_node_ids(&graph), vec!["independent"]);
    }
}
