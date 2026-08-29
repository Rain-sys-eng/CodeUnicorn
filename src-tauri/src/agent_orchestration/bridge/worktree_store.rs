use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::storage::{backup_corrupted_file, write_json_file};

use super::worktree::DelegatedWorktreeProvision;

const WORKTREE_STORE_FILENAME: &str = "agent-bridge-worktrees.json";
const WORKTREE_STORE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DurableWorktreeStore {
    schema_version: u32,
    #[serde(default)]
    by_run_id: BTreeMap<String, DelegatedWorktreeProvision>,
}

#[derive(Debug, Clone)]
pub(crate) struct AgentBridgeWorktreeStore {
    path: PathBuf,
}

impl AgentBridgeWorktreeStore {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub(crate) fn default_path() -> Result<PathBuf, String> {
        Ok(crate::app_paths::app_home_dir()?.join(WORKTREE_STORE_FILENAME))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn load(
        &self,
    ) -> Result<BTreeMap<String, DelegatedWorktreeProvision>, String> {
        if !self.path.exists() {
            return Ok(BTreeMap::new());
        }
        let data = std::fs::read_to_string(&self.path).map_err(|error| {
            format!(
                "failed to read Agent Bridge worktree store {}: {error}",
                self.path.display()
            )
        })?;
        let store = match serde_json::from_str::<DurableWorktreeStore>(&data) {
            Ok(store) => store,
            Err(error) => {
                let detail = format!("failed to parse Agent Bridge worktree store: {error}");
                if backup_corrupted_file(&self.path, &detail).is_some() {
                    return Ok(BTreeMap::new());
                }
                return Err(format!(
                    "agent bridge worktree store is malformed and could not be quarantined ({}): {error}",
                    self.path.display()
                ));
            }
        };
        if store.schema_version != WORKTREE_STORE_SCHEMA_VERSION {
            return Err(format!(
                "unsupported Agent Bridge worktree store schema version {} (expected {}) at {}",
                store.schema_version,
                WORKTREE_STORE_SCHEMA_VERSION,
                self.path.display()
            ));
        }
        validate_ownership(&store.by_run_id)?;
        Ok(store.by_run_id)
    }

    pub(crate) fn save(
        &self,
        ownership: &BTreeMap<String, DelegatedWorktreeProvision>,
    ) -> Result<(), String> {
        validate_ownership(ownership)?;
        write_json_file(
            &self.path,
            &DurableWorktreeStore {
                schema_version: WORKTREE_STORE_SCHEMA_VERSION,
                by_run_id: ownership.clone(),
            },
        )
    }
}

fn validate_ownership(
    ownership: &BTreeMap<String, DelegatedWorktreeProvision>,
) -> Result<(), String> {
    let mut workspace_owners = BTreeMap::<&str, &str>::new();
    let mut branch_owners = BTreeMap::<&str, &str>::new();
    for (run_id, provision) in ownership {
        if run_id.trim().is_empty() || provision.owner_run_id.trim().is_empty() {
            return Err("Agent Bridge worktree ownership contains an empty run id".to_string());
        }
        if run_id != &provision.owner_run_id {
            return Err(format!(
                "Agent Bridge worktree ownership key mismatch: key={run_id} owner={}",
                provision.owner_run_id
            ));
        }
        for (label, value) in [
            ("source workspace id", provision.source_workspace_id.as_str()),
            ("workspace id", provision.workspace_id.as_str()),
            ("branch", provision.branch.as_str()),
            ("path", provision.path.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(format!(
                    "Agent Bridge worktree ownership for {run_id} has empty {label}"
                ));
            }
        }
        if let Some(previous) = workspace_owners.insert(&provision.workspace_id, run_id) {
            return Err(format!(
                "Agent Bridge worktree workspace {} has multiple owners: {previous}, {run_id}",
                provision.workspace_id
            ));
        }
        if let Some(previous) = branch_owners.insert(&provision.branch, run_id) {
            return Err(format!(
                "Agent Bridge worktree branch {} has multiple owners: {previous}, {run_id}",
                provision.branch
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn provision(run_id: &str) -> DelegatedWorktreeProvision {
        DelegatedWorktreeProvision {
            owner_run_id: run_id.to_string(),
            source_workspace_id: "source-workspace".to_string(),
            workspace_id: format!("workspace-{run_id}"),
            branch: format!("codeunicorn/delegate/{run_id}"),
            path: format!("/tmp/{run_id}"),
        }
    }

    #[test]
    fn round_trip_preserves_durable_worktree_owner() {
        let root = std::env::temp_dir().join(format!("bridge-worktree-store-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temp dir");
        let store = AgentBridgeWorktreeStore::new(root.join("worktrees.json"));
        let ownership = BTreeMap::from([("run-1".to_string(), provision("run-1"))]);
        store.save(&ownership).expect("save");
        assert_eq!(store.load().expect("load"), ownership);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn duplicate_workspace_owner_fails_closed() {
        let mut second = provision("run-2");
        second.workspace_id = "workspace-run-1".to_string();
        let ownership = BTreeMap::from([
            ("run-1".to_string(), provision("run-1")),
            ("run-2".to_string(), second),
        ]);
        assert!(validate_ownership(&ownership)
            .expect_err("duplicate workspace must fail")
            .contains("multiple owners"));
    }

    #[test]
    fn key_owner_mismatch_fails_closed() {
        let ownership = BTreeMap::from([("run-1".to_string(), provision("run-other"))]);
        assert!(validate_ownership(&ownership)
            .expect_err("mismatch must fail")
            .contains("key mismatch"));
    }
}
