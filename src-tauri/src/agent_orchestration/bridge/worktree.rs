use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::types::{WorkspaceEntry, WorkspaceInfo};

use super::models::{DelegationExecutionScope, DelegationRun};

const DELEGATED_BRANCH_PREFIX: &str = "codeunicorn/delegate";
const RUN_BRANCH_FRAGMENT_LIMIT: usize = 36;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegatedWorktreeProvision {
    pub owner_run_id: String,
    pub source_workspace_id: String,
    pub workspace_id: String,
    pub branch: String,
    pub path: String,
}

/// Provision an isolated workspace for one delegated write run by reusing CodeUnicorn's existing
/// worktree workspace lifecycle.
///
/// This adapter deliberately does not execute `git worktree` itself. The existing workspace
/// command owns branch validation, worktree path allocation, persistent WorkspaceEntry creation,
/// remote-mode forwarding and runtime session setup.
pub(crate) async fn provision_delegated_worktree(
    run: &DelegationRun,
    app: &AppHandle,
) -> Result<DelegatedWorktreeProvision, String> {
    if run.execution_scope != DelegationExecutionScope::IsolatedWorktree {
        return Err(format!(
            "delegated run {} does not request isolated worktree execution",
            run.id
        ));
    }

    let state = app.state::<AppState>();
    let source = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&run.workspace_id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "source workspace not found for delegated worktree: {}",
                    run.workspace_id
                )
            })?
    };
    let (parent_id, base_ref) = delegated_worktree_base(&source)?;
    let branch = delegated_branch_name(&run.id)?;

    let workspace = crate::workspaces::add_worktree(
        parent_id,
        branch.clone(),
        Some(base_ref),
        Some(false),
        state,
        app.clone(),
    )
    .await?;

    Ok(provision_result(run, branch, workspace))
}

fn provision_result(
    run: &DelegationRun,
    branch: String,
    workspace: WorkspaceInfo,
) -> DelegatedWorktreeProvision {
    DelegatedWorktreeProvision {
        owner_run_id: run.id.clone(),
        source_workspace_id: run.workspace_id.clone(),
        workspace_id: workspace.id,
        branch,
        path: workspace.path,
    }
}

/// Worktree-from-worktree is forbidden by the existing workspace core. When delegation starts in
/// a user worktree, create the isolated child from its main parent but use the current worktree
/// branch as the base ref so the delegated agent sees the caller's branch state.
fn delegated_worktree_base(source: &WorkspaceEntry) -> Result<(String, String), String> {
    if source.kind.is_worktree() {
        let parent_id = source.parent_id.clone().ok_or_else(|| {
            format!(
                "worktree workspace {} is missing its parent workspace identity",
                source.id
            )
        })?;
        let base_ref = source
            .worktree
            .as_ref()
            .map(|worktree| worktree.branch.trim())
            .filter(|branch| !branch.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                format!(
                    "worktree workspace {} is missing its branch identity",
                    source.id
                )
            })?;
        return Ok((parent_id, base_ref));
    }
    Ok((source.id.clone(), "HEAD".to_string()))
}

fn delegated_branch_name(run_id: &str) -> Result<String, String> {
    let mut fragment = String::new();
    for character in run_id.trim().chars() {
        if fragment.len() >= RUN_BRANCH_FRAGMENT_LIMIT {
            break;
        }
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
            fragment.push(character.to_ascii_lowercase());
        } else if !fragment.ends_with('-') {
            fragment.push('-');
        }
    }
    let fragment = fragment.trim_matches('-');
    if fragment.is_empty() {
        return Err("delegated run id cannot produce a worktree branch name".to_string());
    }
    Ok(format!("{DELEGATED_BRANCH_PREFIX}/{fragment}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings, WorktreeInfo};

    fn workspace(kind: WorkspaceKind) -> WorkspaceEntry {
        WorkspaceEntry {
            id: "workspace-1".to_string(),
            name: "workspace".to_string(),
            path: "/tmp/repo".to_string(),
            codex_bin: None,
            kind,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    #[test]
    fn branch_is_deterministic_and_git_ref_safe() {
        assert_eq!(
            delegated_branch_name("Delegation:ABC/123").expect("branch"),
            "codeunicorn/delegate/delegation-abc-123"
        );
    }

    #[test]
    fn main_workspace_uses_head_as_base() {
        assert_eq!(
            delegated_worktree_base(&workspace(WorkspaceKind::Main)).expect("base"),
            ("workspace-1".to_string(), "HEAD".to_string())
        );
    }

    #[test]
    fn caller_worktree_rebases_provisioning_on_parent_and_current_branch() {
        let mut source = workspace(WorkspaceKind::Worktree);
        source.parent_id = Some("main-workspace".to_string());
        source.worktree = Some(WorktreeInfo {
            branch: "feature/current".to_string(),
            base_ref: Some("main".to_string()),
            base_commit: None,
            tracking: None,
            publish_error: None,
            publish_retry_command: None,
        });

        assert_eq!(
            delegated_worktree_base(&source).expect("base"),
            ("main-workspace".to_string(), "feature/current".to_string())
        );
    }
}
