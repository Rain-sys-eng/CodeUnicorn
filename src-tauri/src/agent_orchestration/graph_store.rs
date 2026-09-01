use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::storage::{backup_corrupted_file, write_json_file};

use super::graph::AgentGraphPlan;
use super::scheduler::AgentGraphExecution;

const GRAPH_STORE_FILENAME: &str = "agent-orchestration-graphs.json";
const GRAPH_STORE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DurableAgentGraphRun {
    pub plan: AgentGraphPlan,
    pub execution: AgentGraphExecution,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

impl DurableAgentGraphRun {
    pub(crate) fn new(plan: AgentGraphPlan, execution: AgentGraphExecution) -> Result<Self, String> {
        let plan_id = plan.id.trim();
        if plan_id.is_empty() || execution.graph_id.trim().is_empty() {
            return Err("durable orchestration graph id is required".to_string());
        }
        if plan_id != execution.graph_id {
            return Err(format!(
                "orchestration graph plan/execution id mismatch: plan={plan_id} execution={}",
                execution.graph_id
            ));
        }
        // Re-run semantic validation before a plan can become durable.
        plan.validate()?;
        let now = now_millis();
        Ok(Self {
            plan,
            execution,
            created_at_ms: now,
            updated_at_ms: now,
        })
    }

    pub(crate) fn update_execution(
        &self,
        execution: AgentGraphExecution,
    ) -> Result<Self, String> {
        if execution.graph_id != self.plan.id {
            return Err(format!(
                "orchestration graph execution id changed: expected {}, got {}",
                self.plan.id, execution.graph_id
            ));
        }
        Ok(Self {
            plan: self.plan.clone(),
            execution,
            created_at_ms: self.created_at_ms,
            updated_at_ms: now_millis(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DurableGraphStoreFile {
    schema_version: u32,
    #[serde(default)]
    graphs: BTreeMap<String, DurableAgentGraphRun>,
}

#[derive(Debug, Clone)]
struct AgentGraphPersistence {
    path: PathBuf,
}

impl AgentGraphPersistence {
    fn default_path() -> Result<PathBuf, String> {
        Ok(crate::app_paths::app_home_dir()?.join(GRAPH_STORE_FILENAME))
    }

    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> Result<BTreeMap<String, DurableAgentGraphRun>, String> {
        if !self.path.exists() {
            return Ok(BTreeMap::new());
        }
        let raw = std::fs::read_to_string(&self.path).map_err(|error| {
            format!(
                "failed to read durable orchestration graph store {}: {error}",
                self.path.display()
            )
        })?;
        let store = match serde_json::from_str::<DurableGraphStoreFile>(&raw) {
            Ok(store) => store,
            Err(error) => {
                let detail = format!("failed to parse orchestration graph store: {error}");
                if backup_corrupted_file(&self.path, &detail).is_some() {
                    return Ok(BTreeMap::new());
                }
                return Err(format!(
                    "orchestration graph store is malformed and could not be quarantined ({}): {error}",
                    self.path.display()
                ));
            }
        };
        if store.schema_version != GRAPH_STORE_SCHEMA_VERSION {
            return Err(format!(
                "unsupported orchestration graph store schema version {} (expected {})",
                store.schema_version, GRAPH_STORE_SCHEMA_VERSION
            ));
        }
        validate_graph_records(&store.graphs)?;
        Ok(store.graphs)
    }

    fn save(&self, graphs: &BTreeMap<String, DurableAgentGraphRun>) -> Result<(), String> {
        validate_graph_records(graphs)?;
        write_json_file(
            &self.path,
            &DurableGraphStoreFile {
                schema_version: GRAPH_STORE_SCHEMA_VERSION,
                graphs: graphs.clone(),
            },
        )
    }
}

/// Durable graph-level source of truth. Delegated task runtime facts remain owned by Agent Bridge;
/// this registry persists only the orchestration plan and each node's mapping to Bridge run ids.
pub(crate) struct AgentGraphRegistry {
    graphs: Mutex<BTreeMap<String, DurableAgentGraphRun>>,
    persistence: Option<AgentGraphPersistence>,
    load_error: Option<String>,
}

impl AgentGraphRegistry {
    pub(crate) fn volatile() -> Self {
        Self {
            graphs: Mutex::new(BTreeMap::new()),
            persistence: None,
            load_error: None,
        }
    }

    pub(crate) fn durable_default() -> Result<Self, String> {
        let persistence = AgentGraphPersistence::new(AgentGraphPersistence::default_path()?);
        let graphs = persistence.load()?;
        Ok(Self {
            graphs: Mutex::new(graphs),
            persistence: Some(persistence),
            load_error: None,
        })
    }

    fn degraded(error: String) -> Self {
        Self {
            graphs: Mutex::new(BTreeMap::new()),
            persistence: None,
            load_error: Some(error),
        }
    }

    pub(crate) fn create(&self, record: DurableAgentGraphRun) -> Result<DurableAgentGraphRun, String> {
        self.ensure_available()?;
        let graph_id = record.plan.id.clone();
        let mut current = self.lock()?;
        if current.contains_key(&graph_id) {
            return Err(format!("orchestration graph already exists: {graph_id}"));
        }
        let mut candidate = current.clone();
        candidate.insert(graph_id, record.clone());
        self.persist(&candidate)?;
        *current = candidate;
        Ok(record)
    }

    pub(crate) fn get(&self, graph_id: &str) -> Result<Option<DurableAgentGraphRun>, String> {
        self.ensure_available()?;
        Ok(self.lock()?.get(graph_id).cloned())
    }

    pub(crate) fn list(&self) -> Result<Vec<DurableAgentGraphRun>, String> {
        self.ensure_available()?;
        Ok(self.lock()?.values().cloned().collect())
    }

    pub(crate) fn update_execution(
        &self,
        graph_id: &str,
        execution: AgentGraphExecution,
    ) -> Result<DurableAgentGraphRun, String> {
        self.ensure_available()?;
        let mut current = self.lock()?;
        let existing = current
            .get(graph_id)
            .cloned()
            .ok_or_else(|| format!("orchestration graph not found: {graph_id}"))?;
        let updated = existing.update_execution(execution)?;
        let mut candidate = current.clone();
        candidate.insert(graph_id.to_string(), updated.clone());
        self.persist(&candidate)?;
        *current = candidate;
        Ok(updated)
    }

    fn ensure_available(&self) -> Result<(), String> {
        self.load_error.as_ref().map_or(Ok(()), |error| {
            Err(format!(
                "orchestration graph store is unavailable; refusing mutation/read until durable evidence is repaired: {error}"
            ))
        })
    }

    fn persist(&self, candidate: &BTreeMap<String, DurableAgentGraphRun>) -> Result<(), String> {
        self.ensure_available()?;
        if let Some(persistence) = self.persistence.as_ref() {
            persistence.save(candidate)?;
        }
        Ok(())
    }

    fn lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, BTreeMap<String, DurableAgentGraphRun>>, String> {
        self.graphs
            .lock()
            .map_err(|_| "orchestration graph registry lock poisoned".to_string())
    }
}

impl Default for AgentGraphRegistry {
    fn default() -> Self {
        match Self::durable_default() {
            Ok(registry) => registry,
            Err(error) => {
                log::error!(
                    "[agent-orchestration] failed to load durable graph store; graph mutations disabled: {}",
                    error
                );
                Self::degraded(error)
            }
        }
    }
}

fn validate_graph_records(graphs: &BTreeMap<String, DurableAgentGraphRun>) -> Result<(), String> {
    for (graph_id, record) in graphs {
        if graph_id != &record.plan.id || graph_id != &record.execution.graph_id {
            return Err(format!(
                "durable orchestration graph key mismatch for {graph_id}"
            ));
        }
        record.plan.validate()?;
        if record.execution.workspace_id.trim().is_empty() {
            return Err(format!(
                "durable orchestration graph {graph_id} is missing workspace identity"
            ));
        }
        record.execution.source.validate("graph source")?;
        let expected = record
            .plan
            .nodes
            .iter()
            .map(|node| node.id.trim().to_string())
            .collect::<std::collections::BTreeSet<_>>();
        let actual = record
            .execution
            .nodes
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        if expected != actual {
            return Err(format!(
                "durable orchestration graph {graph_id} plan/execution node set mismatch"
            ));
        }
    }
    Ok(())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, DelegationContextPolicy, DelegationExecutionScope,
    };
    use crate::agent_orchestration::graph::AgentGraphNode;
    use uuid::Uuid;

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

    fn record() -> DurableAgentGraphRun {
        let plan = plan();
        let (_, execution) = AgentGraphExecution::new(
            &plan,
            "workspace-1".to_string(),
            AgentEndpoint {
                engine_id: "claude".to_string(),
                logical_session_id: Some("runtime-1".to_string()),
                native_session_id: None,
            },
        )
        .expect("execution");
        DurableAgentGraphRun::new(plan, execution).expect("record")
    }

    #[test]
    fn durable_registry_round_trip() {
        let root = std::env::temp_dir().join(format!("agent-graph-store-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temp dir");
        let path = root.join("graphs.json");
        let persistence = AgentGraphPersistence::new(path.clone());
        let registry = AgentGraphRegistry {
            graphs: Mutex::new(BTreeMap::new()),
            persistence: Some(persistence),
            load_error: None,
        };
        let created = registry.create(record()).expect("create");
        let loaded = AgentGraphPersistence::new(path)
            .load()
            .expect("load persisted graph");
        assert_eq!(loaded["graph-1"], created);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn future_or_unreadable_store_can_be_represented_fail_closed() {
        let registry = AgentGraphRegistry::degraded("future schema".to_string());
        assert!(registry.list().expect_err("must fail").contains("unavailable"));
        assert!(registry
            .create(record())
            .expect_err("must fail")
            .contains("unavailable"));
    }
}
