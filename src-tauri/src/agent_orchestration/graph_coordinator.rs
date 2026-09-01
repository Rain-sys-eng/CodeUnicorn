use std::collections::BTreeSet;

use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::state::AppState;

use super::bridge::{AgentEndpoint, DelegationRun, DelegationRunStatus};
use super::graph::AgentGraphPlan;
use super::graph_store::{AgentGraphRegistry, DurableAgentGraphRun};
use super::scheduler::{
    dispatch_prepared_batch, prepare_ready_batch, AgentGraphBridgeBackend,
    AgentGraphDispatchBatch, AgentGraphExecution, AppStateGraphBackend,
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
        let backend = AppStateGraphBackend::new(state, app);
        self.start_with_backend(plan, workspace_id, source, &backend)
            .await
    }

    async fn start_with_backend(
        &self,
        plan: AgentGraphPlan,
        workspace_id: String,
        source: AgentEndpoint,
        backend: &dyn AgentGraphBridgeBackend,
    ) -> Result<AgentGraphDispatchBatch, String> {
        let _guard = self.advance_lock.lock().await;
        let (validated, execution) = AgentGraphExecution::new(&plan, workspace_id, source)?;
        let record = DurableAgentGraphRun::new(plan, execution)?;
        let durable = self.registry.create(record)?;
        self.advance_record(&validated, durable, backend).await
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
        let backend = AppStateGraphBackend::new(state, app);
        self.tick_with_backend(graph_id, &backend).await
    }

    async fn tick_with_backend(
        &self,
        graph_id: &str,
        backend: &dyn AgentGraphBridgeBackend,
    ) -> Result<AgentGraphDispatchBatch, String> {
        let _guard = self.advance_lock.lock().await;
        let durable = self
            .registry
            .get(graph_id)?
            .ok_or_else(|| format!("orchestration graph not found: {graph_id}"))?;
        let validated = durable.plan.validate()?;
        self.advance_record(&validated, durable, backend).await
    }

    async fn advance_record(
        &self,
        validated: &super::graph::ValidatedAgentGraph,
        durable: DurableAgentGraphRun,
        backend: &dyn AgentGraphBridgeBackend,
    ) -> Result<AgentGraphDispatchBatch, String> {
        let graph_id = durable.plan.id.clone();
        let mut execution = durable.execution;

        // Recovery phase: mapping is already durable, therefore it is safe to start any Bridge run
        // that was created before a crash but never claimed by the runtime dispatcher.
        let mut dispatched = self
            .dispatch_mapped_queued_runs(&execution, backend)
            .await?;
        execution.reconcile(backend)?;
        self.registry
            .update_execution(&graph_id, execution.clone())?;

        let prepared = prepare_ready_batch(validated, execution, backend).await?;

        // Critical ordering guarantee: the graph's mapping to each freshly-created Bridge run is
        // durable before any target runtime side effect occurs.
        self.registry
            .update_execution(&prepared.graph_id, prepared.execution.clone())?;

        match dispatch_prepared_batch(validated, prepared, backend).await {
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
                let _ = recovered.reconcile(backend);
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
        backend: &dyn AgentGraphBridgeBackend,
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
            let Some(run) = backend.get_run(&run_id)? else {
                continue;
            };
            if run.status != DelegationRunStatus::Queued {
                continue;
            }
            match backend.dispatch_run(run_id.clone()).await {
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
    use std::collections::BTreeMap;
    use std::sync::Mutex as StdMutex;

    use super::*;
    use crate::agent_orchestration::bridge::{
        CreateDelegationRun, DelegationContextPolicy, DelegationExecutionScope,
    };
    use crate::agent_orchestration::graph::AgentGraphNode;
    use crate::engine::EngineType;
    use crate::shared_session_v2::ExecutionTargetInput;

    #[derive(Default)]
    struct FakeGraphBridgeBackend {
        runs: StdMutex<BTreeMap<String, DelegationRun>>,
        created_tasks: StdMutex<Vec<String>>,
        dispatched_run_ids: StdMutex<Vec<String>>,
    }

    impl FakeGraphBridgeBackend {
        fn settle(&self, run_id: &str, status: DelegationRunStatus) {
            let mut runs = self.runs.lock().expect("runs");
            let run = runs.get_mut(run_id).expect("run");
            run.status = status;
            run.completed_at_ms = status.is_terminal().then_some(2);
        }

        fn created_tasks(&self) -> Vec<String> {
            self.created_tasks.lock().expect("created tasks").clone()
        }

        fn dispatched_run_ids(&self) -> Vec<String> {
            self.dispatched_run_ids
                .lock()
                .expect("dispatched runs")
                .clone()
        }
    }

    impl AgentGraphBridgeBackend for FakeGraphBridgeBackend {
        fn create_run(
            &self,
            request: CreateDelegationRun,
        ) -> super::super::scheduler::AgentGraphBackendFuture<'_, DelegationRun> {
            Box::pin(async move {
                request.validate()?;
                let mut runs = self.runs.lock().map_err(|_| "runs lock poisoned".to_string())?;
                let run_id = format!("fake-run-{}", runs.len() + 1);
                let run = DelegationRun {
                    id: run_id.clone(),
                    root_run_id: run_id.clone(),
                    parent_run_id: request.parent_run_id,
                    continuation_of_run_id: None,
                    retry_of_run_id: None,
                    depth: 0,
                    source: request.source,
                    target: request.target,
                    target_execution: ExecutionTargetInput {
                        engine: EngineType::Codex,
                        provider_profile_id: None,
                        model_catalog_entry_id: None,
                        model: None,
                        reasoning_effort: None,
                        provider_profile_name_snapshot: None,
                        provider_profile_source: None,
                        runtime_capability_fingerprint: None,
                    },
                    workspace_id: request.workspace_id,
                    task: request.task.clone(),
                    file_refs: request.file_refs,
                    context_policy: request.context_policy,
                    execution_scope: request.execution_scope,
                    status: DelegationRunStatus::Queued,
                    dispatch_binding: None,
                    result: None,
                    error: None,
                    created_at_ms: 1,
                    started_at_ms: None,
                    completed_at_ms: None,
                };
                runs.insert(run_id, run.clone());
                self.created_tasks
                    .lock()
                    .map_err(|_| "created tasks lock poisoned".to_string())?
                    .push(request.task);
                Ok(run)
            })
        }

        fn dispatch_run(
            &self,
            run_id: String,
        ) -> super::super::scheduler::AgentGraphBackendFuture<'_, DelegationRun> {
            Box::pin(async move {
                let mut runs = self.runs.lock().map_err(|_| "runs lock poisoned".to_string())?;
                let run = runs
                    .get_mut(&run_id)
                    .ok_or_else(|| format!("run not found: {run_id}"))?;
                if run.status == DelegationRunStatus::Queued {
                    run.status = DelegationRunStatus::Running;
                    run.started_at_ms = Some(1);
                    self.dispatched_run_ids
                        .lock()
                        .map_err(|_| "dispatch lock poisoned".to_string())?
                        .push(run_id);
                }
                Ok(run.clone())
            })
        }

        fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
            Ok(self
                .runs
                .lock()
                .map_err(|_| "runs lock poisoned".to_string())?
                .get(run_id)
                .cloned())
        }
    }

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

    fn fanout_plan() -> AgentGraphPlan {
        let node = |id: &str, depends_on: &[&str]| AgentGraphNode {
            id: id.to_string(),
            target_engine_id: "codex".to_string(),
            task: format!("task-{id}"),
            depends_on: depends_on.iter().map(|value| value.to_string()).collect(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
        };
        AgentGraphPlan {
            id: "fanout-graph".to_string(),
            nodes: vec![
                node("root", &[]),
                node("fan-a", &["root"]),
                node("fan-b", &["root"]),
                node("join", &["fan-a", "fan-b"]),
            ],
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

    #[tokio::test]
    async fn concurrent_ticks_create_each_parallel_fanout_run_exactly_once() {
        let coordinator = AgentGraphCoordinator::volatile();
        let backend = FakeGraphBridgeBackend::default();

        let initial = coordinator
            .start_with_backend(
                fanout_plan(),
                "workspace-1".to_string(),
                source(),
                &backend,
            )
            .await
            .expect("start graph");
        assert_eq!(initial.dispatched.len(), 1);
        let root_run_id = initial.execution.nodes["root"]
            .delegation_run_id
            .clone()
            .expect("root run");
        backend.settle(&root_run_id, DelegationRunStatus::Completed);

        let (first_tick, second_tick) = tokio::join!(
            coordinator.tick_with_backend("fanout-graph", &backend),
            coordinator.tick_with_backend("fanout-graph", &backend)
        );
        first_tick.expect("first fan-out tick");
        second_tick.expect("second fan-out tick");

        let fanout = coordinator
            .get("fanout-graph")
            .expect("get graph")
            .expect("graph");
        let fan_a = fanout.execution.nodes["fan-a"]
            .delegation_run_id
            .clone()
            .expect("fan-a run");
        let fan_b = fanout.execution.nodes["fan-b"]
            .delegation_run_id
            .clone()
            .expect("fan-b run");
        assert_ne!(fan_a, fan_b);
        assert_eq!(backend.created_tasks(), vec!["task-root", "task-fan-a", "task-fan-b"]);

        backend.settle(&fan_a, DelegationRunStatus::Completed);
        backend.settle(&fan_b, DelegationRunStatus::Completed);
        let (first_join, second_join) = tokio::join!(
            coordinator.tick_with_backend("fanout-graph", &backend),
            coordinator.tick_with_backend("fanout-graph", &backend)
        );
        first_join.expect("first join tick");
        second_join.expect("second join tick");

        let completed_fanout = coordinator
            .get("fanout-graph")
            .expect("get graph")
            .expect("graph");
        assert!(completed_fanout.execution.nodes["join"]
            .delegation_run_id
            .is_some());
        assert_eq!(
            backend.created_tasks(),
            vec!["task-root", "task-fan-a", "task-fan-b", "task-join"]
        );
        let dispatched = backend.dispatched_run_ids();
        assert_eq!(dispatched.len(), 4);
        assert_eq!(dispatched.iter().collect::<BTreeSet<_>>().len(), 4);
    }
}
