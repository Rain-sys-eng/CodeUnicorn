use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::state::AppState;

use super::bridge::{
    AgentEndpoint, CreateDelegationRun, DelegationRun, DelegationRunStatus,
};
use super::graph::{AgentGraphPlan, ValidatedAgentGraph};

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphDispatchBatch {
    pub graph_id: String,
    pub dispatched: Vec<DelegationRun>,
    pub execution: AgentGraphExecution,
}

impl AgentGraphExecution {
    pub fn new(
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

    pub(crate) fn reconcile(&mut self, state: &AppState) -> Result<(), String> {
        for execution in self.nodes.values_mut() {
            let Some(run_id) = execution.delegation_run_id.as_deref() else {
                continue;
            };
            let Some(run) = state.agent_bridge.get_run(run_id)? else {
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

/// Reconcile the current graph projection and dispatch every newly-ready node through Agent Bridge.
///
/// Fan-out nodes are created/dispatched independently so the underlying target runtimes can run in
/// parallel. This function does not implement a second engine runtime or a direct CLI send path.
/// Graph-level durable persistence and automatic wake-up are intentionally left to the next layer;
/// callers must persist the returned `AgentGraphExecution` before treating it as durable state.
pub(crate) async fn dispatch_ready_batch(
    graph: &ValidatedAgentGraph,
    mut execution: AgentGraphExecution,
    state: &AppState,
    app: &AppHandle,
) -> Result<AgentGraphDispatchBatch, String> {
    execution.reconcile(state)?;
    execution.block_failed_dependencies(graph);
    let ready = execution.ready_node_ids(graph);
    let mut dispatched = Vec::with_capacity(ready.len());

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

        let run = match state.create_delegation_run(request).await {
            Ok(run) => run,
            Err(error) => {
                if let Some(node_execution) = execution.nodes.get_mut(&node_id) {
                    node_execution.status = AgentGraphNodeStatus::Failed;
                    node_execution.error = Some(error.clone());
                }
                continue;
            }
        };
        if let Some(node_execution) = execution.nodes.get_mut(&node_id) {
            node_execution.status = AgentGraphNodeStatus::Running;
            node_execution.delegation_run_id = Some(run.id.clone());
            node_execution.error = None;
        }

        match state.dispatch_delegation_run(&run.id, app).await {
            Ok(dispatched_run) => dispatched.push(dispatched_run),
            Err(error) => {
                // dispatcher is responsible for settling the delegated run fail-closed; mirror its
                // durable fact back into the graph projection on the next reconcile.
                if let Some(node_execution) = execution.nodes.get_mut(&node_id) {
                    node_execution.error = Some(error);
                }
            }
        }
    }

    execution.reconcile(state)?;
    execution.block_failed_dependencies(graph);
    Ok(AgentGraphDispatchBatch {
        graph_id: execution.graph_id.clone(),
        dispatched,
        execution,
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
