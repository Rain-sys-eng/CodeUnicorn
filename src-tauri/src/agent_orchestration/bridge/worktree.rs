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
    pub base_commit: String,
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
    branch: &str,
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
        workspaces.get(&run.workspace_id).cloned().ok_or_else(|| {
            format!(
                "source workspace not found for delegated worktree: {}",
                run.workspace_id
            )
        })?
    };
    let (parent_id, base_ref) = delegated_worktree_base(&source)?;
    let expected_parent_id = parent_id.clone();
    let expected_branch = delegated_branch_name(&run.id)?;
    if branch != expected_branch {
        return Err(format!(
            "delegated worktree branch does not match run owner {}: expected {expected_branch}, got {branch}",
            run.id
        ));
    }

    let workspace = crate::workspaces::add_worktree(
        parent_id,
        branch.to_string(),
        Some(base_ref),
        Some(false),
        state,
        app.clone(),
    )
    .await?;

    provision_result(run, branch.to_string(), &expected_parent_id, workspace)
}

fn provision_result(
    run: &DelegationRun,
    branch: String,
    expected_parent_id: &str,
    workspace: WorkspaceInfo,
) -> Result<DelegatedWorktreeProvision, String> {
    if !workspace.kind.is_worktree() {
        return Err("delegated worktree lifecycle returned a non-worktree workspace".to_string());
    }
    let actual_branch = workspace
        .worktree
        .as_ref()
        .map(|worktree| worktree.branch.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "delegated worktree lifecycle returned no branch identity".to_string())?;
    if actual_branch != branch {
        return Err(format!(
            "delegated worktree lifecycle branch mismatch: expected {branch}, got {actual_branch}"
        ));
    }
    let base_commit = workspace
        .worktree
        .as_ref()
        .and_then(|worktree| worktree.base_commit.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "delegated worktree lifecycle returned no base commit".to_string())?;
    if workspace.parent_id.as_deref() != Some(expected_parent_id) {
        return Err(format!(
            "delegated worktree lifecycle parent mismatch: expected {expected_parent_id}"
        ));
    }
    if workspace.id.trim().is_empty() || workspace.path.trim().is_empty() {
        return Err(
            "delegated worktree lifecycle returned incomplete workspace identity".to_string(),
        );
    }
    Ok(DelegatedWorktreeProvision {
        owner_run_id: run.id.clone(),
        source_workspace_id: run.workspace_id.clone(),
        workspace_id: workspace.id,
        branch,
        base_commit: base_commit.to_string(),
        path: workspace.path,
    })
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

pub(crate) fn delegated_branch_name(run_id: &str) -> Result<String, String> {
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

    #[test]
    fn provision_result_requires_exact_worktree_owner_metadata() {
        let run = DelegationRun {
            id: "run-1".to_string(),
            root_run_id: "run-1".to_string(),
            parent_run_id: None,
            continuation_of_run_id: None,
            retry_of_run_id: None,
            depth: 0,
            source: super::super::models::AgentEndpoint {
                engine_id: "claude".to_string(),
                logical_session_id: None,
                native_session_id: None,
            },
            target: super::super::models::AgentEndpoint {
                engine_id: "codex".to_string(),
                logical_session_id: None,
                native_session_id: None,
            },
            target_execution: crate::shared_session_v2::ExecutionTargetInput {
                engine: crate::engine::EngineType::Codex,
                provider_profile_id: None,
                model_catalog_entry_id: Some("gpt-5.6-sol".to_string()),
                model: Some("gpt-5.6-sol".to_string()),
                reasoning_effort: None,
                provider_profile_name_snapshot: Some("Local".to_string()),
                provider_profile_source: Some(
                    crate::shared_event_log::canonical::types::CanonicalProviderProfileSource::Local,
                ),
                runtime_capability_fingerprint: None,
            },
            workspace_id: "source".to_string(),
            task: "implement".to_string(),
            file_refs: Vec::new(),
            context_policy: super::super::models::DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::IsolatedWorktree,
            status: super::super::models::DelegationRunStatus::Running,
            dispatch_binding: None,
            result: None,
            error: None,
            created_at_ms: 1,
            started_at_ms: Some(1),
            completed_at_ms: None,
        };
        let workspace = WorkspaceInfo {
            id: "isolated".to_string(),
            name: "isolated".to_string(),
            path: "/tmp/isolated".to_string(),
            connected: true,
            codex_bin: None,
            kind: WorkspaceKind::Worktree,
            parent_id: Some("source".to_string()),
            worktree: Some(WorktreeInfo {
                branch: "codeunicorn/delegate/run-1".to_string(),
                base_ref: Some("HEAD".to_string()),
                base_commit: Some("0123456789abcdef".to_string()),
                tracking: None,
                publish_error: None,
                publish_retry_command: None,
            }),
            settings: WorkspaceSettings::default(),
        };

        assert!(provision_result(
            &run,
            "codeunicorn/delegate/run-1".to_string(),
            "source",
            workspace.clone()
        )
        .is_ok());
        assert!(provision_result(
            &run,
            "codeunicorn/delegate/run-1".to_string(),
            "other-parent",
            workspace
        )
        .expect_err("parent mismatch")
        .contains("parent mismatch"));
    }
}
