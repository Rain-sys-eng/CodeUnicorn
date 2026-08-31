use std::collections::HashMap;

use tauri::{AppHandle, State};

use crate::state::AppState;

use super::DelegationRun;

#[tauri::command]
pub(crate) async fn agent_bridge_list_workspace_runs(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DelegationRun>, String> {
    require_workspace(&workspace_id, state.inner()).await?;
    let runs = state.agent_bridge.list_runs()?;
    Ok(visible_workspace_runs(runs, &workspace_id))
}

#[tauri::command]
pub(crate) async fn agent_bridge_get_run(
    workspace_id: String,
    run_id: String,
    state: State<'_, AppState>,
) -> Result<DelegationRun, String> {
    require_workspace(&workspace_id, state.inner()).await?;
    require_visible_run(state.inner(), &workspace_id, &run_id)
}

#[tauri::command]
pub(crate) async fn agent_bridge_cancel_run(
    workspace_id: String,
    run_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DelegationRun, String> {
    require_workspace(&workspace_id, state.inner()).await?;
    let _ = require_visible_run(state.inner(), &workspace_id, &run_id)?;
    state.cancel_delegation_run(&run_id, &app).await
}

async fn require_workspace(workspace_id: &str, state: &AppState) -> Result<(), String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("Agent Bridge UI workspace id is required".to_string());
    }
    if !state.workspaces.lock().await.contains_key(workspace_id) {
        return Err(format!(
            "workspace not found for Agent Bridge UI: {workspace_id}"
        ));
    }
    Ok(())
}

fn require_visible_run(
    state: &AppState,
    workspace_id: &str,
    run_id: &str,
) -> Result<DelegationRun, String> {
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Err("Agent Bridge UI run id is required".to_string());
    }
    let runs = state.agent_bridge.list_runs()?;
    visible_workspace_runs(runs, workspace_id)
        .into_iter()
        .find(|run| run.id == run_id)
        .ok_or_else(|| {
            format!(
                "delegated run is not visible in Agent Bridge UI workspace: {run_id}"
            )
        })
}

fn visible_workspace_runs(runs: Vec<DelegationRun>, workspace_id: &str) -> Vec<DelegationRun> {
    let workspace_id = workspace_id.trim();
    let by_id = runs
        .iter()
        .map(|run| (run.id.as_str(), run))
        .collect::<HashMap<_, _>>();
    let mut visible = runs
        .iter()
        .filter(|run| run_is_visible_in_workspace(run, workspace_id, &by_id))
        .cloned()
        .collect::<Vec<_>>();
    visible.sort_by(|left, right| {
        left.created_at_ms
            .cmp(&right.created_at_ms)
            .then_with(|| left.id.cmp(&right.id))
    });
    visible
}

fn run_is_visible_in_workspace(
    run: &DelegationRun,
    workspace_id: &str,
    by_id: &HashMap<&str, &DelegationRun>,
) -> bool {
    if run.workspace_id == workspace_id
        || run
            .dispatch_binding
            .as_ref()
            .and_then(|binding| binding.runtime_workspace_id.as_deref())
            == Some(workspace_id)
    {
        return true;
    }
    by_id
        .get(run.root_run_id.as_str())
        .is_some_and(|root| root.workspace_id == workspace_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, CreateDelegationRun, DelegationContextPolicy,
        DelegationDispatchBinding, DelegationExecutionScope, DelegationRunRegistry,
    };
    use crate::engine::EngineType;
    use crate::shared_session_v2::ExecutionTargetInput;

    fn request(
        workspace_id: &str,
        source_engine: &str,
        parent_run_id: Option<String>,
        scope: DelegationExecutionScope,
    ) -> CreateDelegationRun {
        CreateDelegationRun {
            source: AgentEndpoint {
                engine_id: source_engine.to_string(),
                logical_session_id: Some(format!("runtime-{source_engine}")),
                native_session_id: None,
            },
            target: AgentEndpoint {
                engine_id: "codex".to_string(),
                logical_session_id: None,
                native_session_id: None,
            },
            target_execution: Some(ExecutionTargetInput {
                engine: EngineType::Codex,
                provider_profile_id: None,
                model_catalog_entry_id: Some("gpt-5.6-sol".to_string()),
                model: Some("gpt-5.6-sol".to_string()),
                reasoning_effort: Some("low".to_string()),
                provider_profile_name_snapshot: Some("Local".to_string()),
                provider_profile_source: None,
                runtime_capability_fingerprint: None,
            }),
            workspace_id: workspace_id.to_string(),
            task: "review".to_string(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: scope,
            parent_run_id,
        }
    }

    #[test]
    fn workspace_projection_keeps_isolated_descendants_with_the_source_root() {
        let registry = DelegationRunRegistry::default();
        let root = registry
            .create(request(
                "workspace-main",
                "claude",
                None,
                DelegationExecutionScope::IsolatedWorktree,
            ))
            .expect("root");
        registry.claim_dispatch(&root.id).expect("claim root");
        registry
            .set_dispatch_binding(
                &root.id,
                DelegationDispatchBinding {
                    backing_thread_id: "shared:root".to_string(),
                    attempt_id: "attempt-root".to_string(),
                    logical_turn_id: "logical-root".to_string(),
                    binding_key: "squad:root:delegate:codex:default".to_string(),
                    runtime_workspace_id: Some("workspace-isolated".to_string()),
                    native_session_id: Some("native-root".to_string()),
                    runtime_turn_id: Some("runtime-root".to_string()),
                    context_transfer: None,
                },
            )
            .expect("bind root");
        let child = registry
            .create(request(
                "workspace-isolated",
                "codex",
                Some(root.id.clone()),
                DelegationExecutionScope::Observe,
            ))
            .expect("child");

        let runs = registry.list().expect("runs");
        let main = visible_workspace_runs(runs.clone(), "workspace-main");
        let isolated = visible_workspace_runs(runs.clone(), "workspace-isolated");
        let unrelated = visible_workspace_runs(runs, "workspace-other");

        assert_eq!(
            main.iter().map(|run| run.id.as_str()).collect::<Vec<_>>(),
            vec![root.id.as_str(), child.id.as_str()]
        );
        assert_eq!(isolated.len(), 2);
        assert!(unrelated.is_empty());
    }
}
