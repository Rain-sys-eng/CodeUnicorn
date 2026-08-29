use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::storage::{backup_corrupted_file, write_json_file};

use super::worktree::DelegatedWorktreeProvision;

const WORKTREE_STORE_FILENAME: &str = "agent-bridge-worktrees.json";
const WORKTREE_STORE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DelegatedWorktreeOwnershipState {
    Reserved,
    Provisioned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DelegatedWorktreeOwnership {
    pub owner_run_id: String,
    pub source_workspace_id: String,
    pub branch: String,
    pub state: DelegatedWorktreeOwnershipState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl DelegatedWorktreeOwnership {
    pub(crate) fn reserved(
        owner_run_id: String,
        source_workspace_id: String,
        branch: String,
    ) -> Self {
        Self {
            owner_run_id,
            source_workspace_id,
            branch,
            state: DelegatedWorktreeOwnershipState::Reserved,
            workspace_id: None,
            path: None,
        }
    }

    pub(crate) fn complete(
        self,
        provision: &DelegatedWorktreeProvision,
    ) -> Result<Self, String> {
        if self.owner_run_id != provision.owner_run_id
            || self.source_workspace_id != provision.source_workspace_id
            || self.branch != provision.branch
        {
            return Err(format!(
                "delegated worktree provision does not match reserved owner {}",
                self.owner_run_id
            ));
        }
        Ok(Self {
            state: DelegatedWorktreeOwnershipState::Provisioned,
            workspace_id: Some(provision.workspace_id.clone()),
            path: Some(provision.path.clone()),
            ..self
        })
    }

    pub(crate) fn as_provision(&self) -> Result<DelegatedWorktreeProvision, String> {
        if self.state != DelegatedWorktreeOwnershipState::Provisioned {
            return Err(format!(
                "delegated worktree owner {} is reserved but not provisioned",
                self.owner_run_id
            ));
        }
        Ok(DelegatedWorktreeProvision {
            owner_run_id: self.owner_run_id.clone(),
            source_workspace_id: self.source_workspace_id.clone(),
            workspace_id: self
                .workspace_id
                .clone()
                .ok_or_else(|| "provisioned worktree is missing workspace id".to_string())?,
            branch: self.branch.clone(),
            path: self
                .path
                .clone()
                .ok_or_else(|| "provisioned worktree is missing path".to_string())?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DurableWorktreeStore {
    schema_version: u32,
    #[serde(default)]
    by_run_id: BTreeMap<String, DelegatedWorktreeOwnership>,
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
    ) -> Result<BTreeMap<String, DelegatedWorktreeOwnership>, String> {
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
        ownership: &BTreeMap<String, DelegatedWorktreeOwnership>,
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

/// Thread-safe Bridge worktree ownership registry.
///
/// Every mutation uses the same disk-first rule as delegated runs: write the candidate durable
/// map first and publish it to memory only after the atomic write succeeds. If startup cannot read
/// the durable owner store, the registry remains available for diagnostics but all reads/mutations
/// fail closed instead of silently switching to a writable volatile map.
pub(crate) struct AgentBridgeWorktreeRegistry {
    ownership: Mutex<BTreeMap<String, DelegatedWorktreeOwnership>>,
    persistence: Option<AgentBridgeWorktreeStore>,
    load_error: Option<String>,
}

impl AgentBridgeWorktreeRegistry {
    pub(crate) fn volatile() -> Self {
        Self {
            ownership: Mutex::new(BTreeMap::new()),
            persistence: None,
            load_error: None,
        }
    }

    fn degraded(error: String) -> Self {
        Self {
            ownership: Mutex::new(BTreeMap::new()),
            persistence: None,
            load_error: Some(error),
        }
    }

    pub(crate) fn durable_default() -> Result<Self, String> {
        let store = AgentBridgeWorktreeStore::new(AgentBridgeWorktreeStore::default_path()?);
        let ownership = store.load()?;
        Ok(Self {
            ownership: Mutex::new(ownership),
            persistence: Some(store),
            load_error: None,
        })
    }

    pub(crate) fn get(
        &self,
        run_id: &str,
    ) -> Result<Option<DelegatedWorktreeOwnership>, String> {
        self.ensure_available()?;
        Ok(self.lock()?.get(run_id).cloned())
    }

    pub(crate) fn reserve(
        &self,
        run_id: &str,
        source_workspace_id: &str,
        branch: &str,
    ) -> Result<DelegatedWorktreeOwnership, String> {
        self.ensure_available()?;
        let run_id = run_id.trim();
        let source_workspace_id = source_workspace_id.trim();
        let branch = branch.trim();
        if run_id.is_empty() || source_workspace_id.is_empty() || branch.is_empty() {
            return Err("delegated worktree reservation identity is incomplete".to_string());
        }

        let mut current = self.lock()?;
        if let Some(existing) = current.get(run_id) {
            if existing.source_workspace_id == source_workspace_id && existing.branch == branch {
                return Ok(existing.clone());
            }
            return Err(format!(
                "delegated worktree run {run_id} already owns a different reservation"
            ));
        }
        if let Some((owner, _)) = current.iter().find(|(_, value)| value.branch == branch) {
            return Err(format!(
                "delegated worktree branch {branch} is already reserved by run {owner}"
            ));
        }

        let reserved = DelegatedWorktreeOwnership::reserved(
            run_id.to_string(),
            source_workspace_id.to_string(),
            branch.to_string(),
        );
        let mut candidate = current.clone();
        candidate.insert(run_id.to_string(), reserved.clone());
        self.persist(&candidate)?;
        *current = candidate;
        Ok(reserved)
    }

    pub(crate) fn complete(
        &self,
        provision: &DelegatedWorktreeProvision,
    ) -> Result<DelegatedWorktreeOwnership, String> {
        self.ensure_available()?;
        let mut current = self.lock()?;
        let reserved = current
            .get(&provision.owner_run_id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "delegated worktree provision has no durable reservation: {}",
                    provision.owner_run_id
                )
            })?;
        let completed = reserved.complete(provision)?;
        let mut candidate = current.clone();
        candidate.insert(provision.owner_run_id.clone(), completed.clone());
        self.persist(&candidate)?;
        *current = candidate;
        Ok(completed)
    }

    pub(crate) fn provision_for_run(
        &self,
        run_id: &str,
    ) -> Result<Option<DelegatedWorktreeProvision>, String> {
        self.get(run_id)?
            .map(|ownership| ownership.as_provision())
            .transpose()
    }

    fn ensure_available(&self) -> Result<(), String> {
        match self.load_error.as_deref() {
            Some(error) => Err(format!(
                "Agent Bridge worktree ownership is unavailable; refusing mutation/read until durable evidence is repaired: {error}"
            )),
            None => Ok(()),
        }
    }

    fn persist(
        &self,
        candidate: &BTreeMap<String, DelegatedWorktreeOwnership>,
    ) -> Result<(), String> {
        self.ensure_available()?;
        if let Some(store) = self.persistence.as_ref() {
            store.save(candidate)?;
        }
        Ok(())
    }

    fn lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, BTreeMap<String, DelegatedWorktreeOwnership>>, String> {
        self.ownership
            .lock()
            .map_err(|_| "Agent Bridge worktree ownership lock poisoned".to_string())
    }
}

impl Default for AgentBridgeWorktreeRegistry {
    fn default() -> Self {
        match Self::durable_default() {
            Ok(registry) => registry,
            Err(error) => {
                log::error!(
                    "[agent-bridge] failed to load durable worktree ownership; isolated-worktree operations are disabled: {}",
                    error
                );
                Self::degraded(error)
            }
        }
    }
}

fn validate_ownership(
    ownership: &BTreeMap<String, DelegatedWorktreeOwnership>,
) -> Result<(), String> {
    let mut workspace_owners = BTreeMap::<&str, &str>::new();
    let mut branch_owners = BTreeMap::<&str, &str>::new();
    for (run_id, owner) in ownership {
        if run_id.trim().is_empty() || owner.owner_run_id.trim().is_empty() {
            return Err("Agent Bridge worktree ownership contains an empty run id".to_string());
        }
        if run_id != &owner.owner_run_id {
            return Err(format!(
                "Agent Bridge worktree ownership key mismatch: key={run_id} owner={}",
                owner.owner_run_id
            ));
        }
        if owner.source_workspace_id.trim().is_empty() || owner.branch.trim().is_empty() {
            return Err(format!(
                "Agent Bridge worktree ownership for {run_id} has incomplete reservation identity"
            ));
        }
        if let Some(previous) = branch_owners.insert(&owner.branch, run_id) {
            return Err(format!(
                "Agent Bridge worktree branch {} has multiple owners: {previous}, {run_id}",
                owner.branch
            ));
        }

        match owner.state {
            DelegatedWorktreeOwnershipState::Reserved => {
                if owner.workspace_id.is_some() || owner.path.is_some() {
                    return Err(format!(
                        "reserved Agent Bridge worktree {run_id} unexpectedly has provisioned identity"
                    ));
                }
            }
            DelegatedWorktreeOwnershipState::Provisioned => {
                let workspace_id = owner
                    .workspace_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        format!("provisioned Agent Bridge worktree {run_id} has no workspace id")
                    })?;
                owner
                    .path
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        format!("provisioned Agent Bridge worktree {run_id} has no path")
                    })?;
                if let Some(previous) = workspace_owners.insert(workspace_id, run_id) {
                    return Err(format!(
                        "Agent Bridge worktree workspace {workspace_id} has multiple owners: {previous}, {run_id}"
                    ));
                }
            }
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

    fn provisioned_owner(run_id: &str) -> DelegatedWorktreeOwnership {
        DelegatedWorktreeOwnership::reserved(
            run_id.to_string(),
            "source-workspace".to_string(),
            format!("codeunicorn/delegate/{run_id}"),
        )
        .complete(&provision(run_id))
        .expect("complete")
    }

    #[test]
    fn round_trip_preserves_reserved_and_provisioned_owner() {
        let root = std::env::temp_dir().join(format!("bridge-worktree-store-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temp dir");
        let store = AgentBridgeWorktreeStore::new(root.join("worktrees.json"));
        let ownership = BTreeMap::from([
            (
                "run-reserved".to_string(),
                DelegatedWorktreeOwnership::reserved(
                    "run-reserved".to_string(),
                    "source-workspace".to_string(),
                    "codeunicorn/delegate/run-reserved".to_string(),
                ),
            ),
            ("run-1".to_string(), provisioned_owner("run-1")),
        ]);
        store.save(&ownership).expect("save");
        assert_eq!(store.load().expect("load"), ownership);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn registry_persists_reservation_before_completion() {
        let root = std::env::temp_dir().join(format!("bridge-worktree-registry-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temp dir");
        let path = root.join("worktrees.json");
        let registry = AgentBridgeWorktreeRegistry {
            ownership: Mutex::new(BTreeMap::new()),
            persistence: Some(AgentBridgeWorktreeStore::new(path.clone())),
            load_error: None,
        };
        registry
            .reserve(
                "run-1",
                "source-workspace",
                "codeunicorn/delegate/run-1",
            )
            .expect("reserve");
        let loaded = AgentBridgeWorktreeStore::new(path).load().expect("load");
        assert_eq!(
            loaded["run-1"].state,
            DelegatedWorktreeOwnershipState::Reserved
        );
        registry.complete(&provision("run-1")).expect("complete");
        assert!(registry
            .provision_for_run("run-1")
            .expect("get")
            .is_some());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn degraded_registry_rejects_mutation() {
        let registry = AgentBridgeWorktreeRegistry::degraded("future schema".to_string());
        let error = registry
            .reserve("run-1", "source", "codeunicorn/delegate/run-1")
            .expect_err("degraded registry must fail closed");
        assert!(error.contains("ownership is unavailable"));
    }

    #[test]
    fn duplicate_workspace_owner_fails_closed() {
        let first = provisioned_owner("run-1");
        let mut second = provisioned_owner("run-2");
        second.workspace_id = first.workspace_id.clone();
        let ownership = BTreeMap::from([
            ("run-1".to_string(), first),
            ("run-2".to_string(), second),
        ]);
        assert!(validate_ownership(&ownership)
            .expect_err("duplicate workspace must fail")
            .contains("multiple owners"));
    }

    #[test]
    fn reserved_owner_rejects_provisioned_fields() {
        let mut owner = DelegatedWorktreeOwnership::reserved(
            "run-1".to_string(),
            "source-workspace".to_string(),
            "codeunicorn/delegate/run-1".to_string(),
        );
        owner.workspace_id = Some("unexpected".to_string());
        let ownership = BTreeMap::from([("run-1".to_string(), owner)]);
        assert!(validate_ownership(&ownership)
            .expect_err("reserved owner cannot look provisioned")
            .contains("unexpectedly has provisioned identity"));
    }

    #[test]
    fn key_owner_mismatch_fails_closed() {
        let ownership = BTreeMap::from([("run-1".to_string(), provisioned_owner("run-other"))]);
        assert!(validate_ownership(&ownership)
            .expect_err("mismatch must fail")
            .contains("key mismatch"));
    }
}
