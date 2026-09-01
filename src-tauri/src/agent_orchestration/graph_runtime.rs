use std::sync::{Arc, OnceLock};

use tauri::{AppHandle, Manager};

use crate::state::AppState;

use super::graph_coordinator::AgentGraphCoordinator;

const GRAPH_OBSERVER_CAPACITY: usize = 256;
static GRAPH_COORDINATOR: OnceLock<Arc<AgentGraphCoordinator>> = OnceLock::new();
static GRAPH_OBSERVER_STARTED: OnceLock<()> = OnceLock::new();

pub(crate) fn coordinator() -> &'static Arc<AgentGraphCoordinator> {
    GRAPH_COORDINATOR.get_or_init(|| Arc::new(AgentGraphCoordinator::default()))
}

/// Start one process-wide wake observer for durable DAGs.
///
/// Only delegated settlement events that are already referenced by a durable graph can wake that
/// graph. Ordinary single-agent turns and non-DAG Bridge delegations remain unaffected.
pub(crate) fn ensure_observer_started(app: &AppHandle) -> Result<(), String> {
    let _ = coordinator();
    if GRAPH_OBSERVER_STARTED.get().is_some() {
        return Ok(());
    }

    let state = app.state::<AppState>();
    let mut subscription = state
        .engine_manager
        .agent_event_bus()
        .subscribe(GRAPH_OBSERVER_CAPACITY);
    let app = app.clone();
    GRAPH_OBSERVER_STARTED
        .set(())
        .map_err(|_| "DAG wake observer was initialized concurrently".to_string())?;

    // Subscribe before scanning durable graphs so settlements racing with startup are buffered.
    // Recovery and live wake handling may contend, but the coordinator serializes every advance
    // and immutable Bridge run mappings prevent duplicate node creation.
    let recovery_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let graph_ids = match all_graph_ids(coordinator().as_ref()) {
            Ok(graph_ids) => graph_ids,
            Err(error) => {
                log::warn!(
                    "[agent-orchestration] failed to enumerate durable DAGs for startup recovery: {}",
                    error
                );
                return;
            }
        };
        for graph_id in graph_ids {
            let state = recovery_app.state::<AppState>();
            if let Err(error) = coordinator()
                .tick(&graph_id, state.inner(), &recovery_app)
                .await
            {
                log::warn!(
                    "[agent-orchestration] startup DAG recovery tick failed (graph={}): {}",
                    graph_id,
                    error
                );
            }
        }
    });

    tauri::async_runtime::spawn(async move {
        while let Some(event) = subscription.recv().await {
            if event.kind != "run.settled" {
                continue;
            }
            let graph_ids = match graphs_referencing_run(coordinator().as_ref(), &event.run_id) {
                Ok(graph_ids) => graph_ids,
                Err(error) => {
                    log::warn!(
                        "[agent-orchestration] failed to resolve DAG wake target for run {}: {}",
                        event.run_id,
                        error
                    );
                    continue;
                }
            };
            for graph_id in graph_ids {
                let state = app.state::<AppState>();
                if let Err(error) = coordinator()
                    .tick(&graph_id, state.inner(), &app)
                    .await
                {
                    log::warn!(
                        "[agent-orchestration] DAG wake tick failed (graph={} settledRun={}): {}",
                        graph_id,
                        event.run_id,
                        error
                    );
                }
            }
        }
    });
    Ok(())
}

fn all_graph_ids(coordinator: &AgentGraphCoordinator) -> Result<Vec<String>, String> {
    let mut graph_ids = coordinator
        .list()?
        .into_iter()
        .map(|record| record.plan.id)
        .collect::<Vec<_>>();
    graph_ids.sort();
    graph_ids.dedup();
    Ok(graph_ids)
}

fn graphs_referencing_run(
    coordinator: &AgentGraphCoordinator,
    run_id: &str,
) -> Result<Vec<String>, String> {
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Ok(Vec::new());
    }
    let mut graph_ids = coordinator
        .list()?
        .into_iter()
        .filter(|record| {
            record.execution.nodes.values().any(|node| {
                node.delegation_run_id.as_deref() == Some(run_id)
            })
        })
        .map(|record| record.plan.id)
        .collect::<Vec<_>>();
    graph_ids.sort();
    graph_ids.dedup();
    Ok(graph_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, DelegationContextPolicy, DelegationExecutionScope,
    };
    use crate::agent_orchestration::graph::{AgentGraphNode, AgentGraphPlan};
    use crate::agent_orchestration::graph_store::{AgentGraphRegistry, DurableAgentGraphRun};
    use crate::agent_orchestration::scheduler::AgentGraphExecution;

    fn record(graph_id: &str, run_id: Option<&str>) -> DurableAgentGraphRun {
        let plan = AgentGraphPlan {
            id: graph_id.to_string(),
            nodes: vec![AgentGraphNode {
                id: "root".to_string(),
                target_engine_id: "codex".to_string(),
                task: "review".to_string(),
                depends_on: Vec::new(),
                file_refs: Vec::new(),
                context_policy: DelegationContextPolicy::Explicit,
                execution_scope: DelegationExecutionScope::Observe,
            }],
        };
        let (_, mut execution) = AgentGraphExecution::new(
            &plan,
            "workspace-1".to_string(),
            AgentEndpoint {
                engine_id: "claude".to_string(),
                logical_session_id: Some("runtime".to_string()),
                native_session_id: None,
            },
        )
        .expect("execution");
        execution.nodes.get_mut("root").expect("root").delegation_run_id =
            run_id.map(str::to_string);
        DurableAgentGraphRun::new(plan, execution).expect("record")
    }

    #[test]
    fn only_graphs_referencing_settled_run_are_woken() {
        let registry = AgentGraphRegistry::volatile();
        registry.create(record("graph-a", Some("run-1"))).expect("a");
        registry.create(record("graph-b", Some("run-2"))).expect("b");
        registry.create(record("graph-c", None)).expect("c");
        let coordinator = AgentGraphCoordinator::new(registry);

        assert_eq!(
            graphs_referencing_run(&coordinator, "run-1").expect("wake"),
            vec!["graph-a"]
        );
        assert!(graphs_referencing_run(&coordinator, "ordinary-run")
            .expect("ordinary")
            .is_empty());
    }

    #[test]
    fn startup_recovery_enumerates_every_durable_graph_deterministically() {
        let registry = AgentGraphRegistry::volatile();
        registry.create(record("graph-b", Some("run-2"))).expect("b");
        registry.create(record("graph-a", None)).expect("a");
        let coordinator = AgentGraphCoordinator::new(registry);

        assert_eq!(
            all_graph_ids(&coordinator).expect("startup graphs"),
            vec!["graph-a", "graph-b"]
        );
    }
}
