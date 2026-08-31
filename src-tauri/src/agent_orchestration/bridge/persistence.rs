use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::storage::{backup_corrupted_file, write_json_file};

use super::models::DelegationRun;

const BRIDGE_RUN_STORE_FILENAME: &str = "agent-bridge-runs.json";
const BRIDGE_RUN_STORE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct AgentBridgePersistence {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DurableDelegationRunStore {
    schema_version: u32,
    #[serde(default)]
    runs: Vec<DelegationRun>,
}

impl AgentBridgePersistence {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn default_path() -> Result<PathBuf, String> {
        Ok(crate::app_paths::app_home_dir()?.join(BRIDGE_RUN_STORE_FILENAME))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<Vec<DelegationRun>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let data = std::fs::read_to_string(&self.path).map_err(|error| {
            format!(
                "failed to read Agent Bridge durable store {}: {error}",
                self.path.display()
            )
        })?;
        let store = match serde_json::from_str::<DurableDelegationRunStore>(&data) {
            Ok(store) => store,
            Err(error) => {
                let path = self.path.clone();
                let detail = format!("failed to parse Agent Bridge durable store: {error}");
                if backup_corrupted_file(&path, &detail).is_some() {
                    return Ok(Vec::new());
                }
                return Err(format!(
                    "agent bridge durable store is malformed and could not be quarantined ({}): {error}",
                    self.path.display()
                ));
            }
        };

        if store.schema_version != BRIDGE_RUN_STORE_SCHEMA_VERSION {
            return Err(format!(
                "unsupported Agent Bridge run store schema version {} (expected {}) at {}",
                store.schema_version,
                BRIDGE_RUN_STORE_SCHEMA_VERSION,
                self.path.display()
            ));
        }
        Ok(store.runs)
    }

    pub fn save(&self, runs: &[DelegationRun]) -> Result<(), String> {
        let mut stable = runs.to_vec();
        stable.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        write_json_file(
            &self.path,
            &DurableDelegationRunStore {
                schema_version: BRIDGE_RUN_STORE_SCHEMA_VERSION,
                runs: stable,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, DelegationContextPolicy, DelegationExecutionScope, DelegationRunStatus,
    };
    use crate::engine::EngineType;
    use crate::shared_event_log::canonical::types::CanonicalProviderProfileSource;
    use crate::shared_session_v2::ExecutionTargetInput;
    use uuid::Uuid;

    fn sample_run(id: &str) -> DelegationRun {
        DelegationRun {
            id: id.to_string(),
            root_run_id: id.to_string(),
            parent_run_id: None,
            continuation_of_run_id: None,
            retry_of_run_id: None,
            depth: 0,
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
            target_execution: ExecutionTargetInput {
                engine: EngineType::Codex,
                provider_profile_id: None,
                model_catalog_entry_id: Some("gpt-5.6-sol".to_string()),
                model: Some("gpt-5.6-sol".to_string()),
                reasoning_effort: Some("low".to_string()),
                provider_profile_name_snapshot: Some("Local".to_string()),
                provider_profile_source: Some(CanonicalProviderProfileSource::Local),
                runtime_capability_fingerprint: None,
            },
            workspace_id: "workspace-1".to_string(),
            task: "review authentication".to_string(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
            status: DelegationRunStatus::Queued,
            dispatch_binding: None,
            result: None,
            error: None,
            created_at_ms: 1,
            started_at_ms: None,
            completed_at_ms: None,
        }
    }

    #[test]
    fn round_trip_preserves_versioned_run_facts() {
        let root = std::env::temp_dir().join(format!("agent-bridge-store-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let persistence = AgentBridgePersistence::new(root.join("runs.json"));
        let run = sample_run("delegation-1");

        persistence.save(std::slice::from_ref(&run)).expect("save");
        let loaded = persistence.load().expect("load");

        assert_eq!(loaded, vec![run]);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn unsupported_schema_fails_closed_without_overwrite() {
        let root = std::env::temp_dir().join(format!("agent-bridge-store-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("runs.json");
        std::fs::write(&path, r#"{"schemaVersion":99,"runs":[]}"#).expect("write future store");
        let persistence = AgentBridgePersistence::new(path.clone());

        let error = persistence
            .load()
            .expect_err("future schema must fail closed");

        assert!(error.contains("unsupported Agent Bridge run store schema"));
        assert!(path.exists());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn malformed_store_is_quarantined_before_reset() {
        let root = std::env::temp_dir().join(format!("agent-bridge-store-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("runs.json");
        std::fs::write(&path, "{not-json").expect("write malformed store");
        let persistence = AgentBridgePersistence::new(path.clone());

        let loaded = persistence.load().expect("corrupt file should quarantine");

        assert!(loaded.is_empty());
        assert!(!path.exists());
        assert!(std::fs::read_dir(&root)
            .expect("read temp dir")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("corrupted-")));
        std::fs::remove_dir_all(root).ok();
    }
}
