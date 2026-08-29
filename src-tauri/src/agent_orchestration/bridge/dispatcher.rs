use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::shared_event_log::canonical::types::{
    CanonicalBlock, CanonicalFact, CanonicalProviderProfileSource, OutcomeStatus,
};
use crate::shared_session_v2::{
    begin_squad_worker_turn_core, shared_session_v2_await_turn_terminal,
    shared_session_v2_dispatch_turn, shared_session_v2_prepare_delivery, BeginTurnStatus,
    ExecutionTargetInput,
};
use crate::shared_sessions::{
    parse_shared_session_id, start_shared_session, SharedSelectedReasoning, SharedSelectedTarget,
};
use crate::state::AppState;

use super::models::{
    DelegationContextPolicy, DelegationDispatchBinding, DelegationExecutionScope, DelegationResult,
    DelegationRun,
};
use super::service::AgentBridgeService;

const BRIDGE_NODE_ID: &str = "delegate";
const BRIDGE_WORKER_ROLE: &str = "delegated-agent";

/// Dispatch one already-created delegated run into the existing Shared V2 runtime path.
///
/// This module intentionally does not own or parse any CLI process. Shared V2 remains the
/// authoritative runtime boundary for target materialization, provider receipts, context ACK,
/// native session identity and terminal settlement.
pub async fn dispatch_run(
    service: Arc<AgentBridgeService>,
    run_id: String,
    app: AppHandle,
) -> Result<DelegationRun, String> {
    let run = service
        .get_run(&run_id)?
        .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
    ensure_dispatch_policy_supported(&run)?;

    // Claim before the first backing-session/runtime side effect so concurrent dispatchers
    // cannot send the same delegated task twice.
    let claimed = service.claim_dispatch(&run_id)?;
    match dispatch_claimed_run(Arc::clone(&service), claimed, app.clone()).await {
        Ok(run) => Ok(run),
        Err(error) => {
            let _ = service.settle_failed(&run_id, error.clone());
            Err(error)
        }
    }
}

async fn dispatch_claimed_run(
    service: Arc<AgentBridgeService>,
    run: DelegationRun,
    app: AppHandle,
) -> Result<DelegationRun, String> {
    // CU-A2A-001 phase 3 uses a fresh Shared session as the durable backing lane for
    // Explicit context. The Bridge has no public command/MCP entry yet; before exposing the
    // gateway, the backing lane will gain an internal/hidden presentation marker so it never
    // pollutes the normal Shared Session list.
    let backing_thread_id = create_backing_thread(&run, &app).await?;
    let shared_session_id = parse_shared_session_id(&backing_thread_id)?;
    let attempt_id = Uuid::new_v4().to_string();
    let logical_turn_id = Uuid::new_v4().to_string();
    let permission_class = permission_class(run.execution_scope)?;
    let prompt = explicit_delegation_prompt(&run);

    let binding_key = {
        let state = app.state::<AppState>();
        let writer = state
            .shared_event_writer
            .as_ref()
            .ok_or_else(|| "shared event log unavailable for Agent Bridge dispatch".to_string())?;
        let outcome = begin_squad_worker_turn_core(
            writer,
            &shared_session_id,
            &run.target_execution,
            prompt,
            None,
            &run.id,
            BRIDGE_NODE_ID,
            BRIDGE_WORKER_ROLE,
            permission_class,
            false,
            json!({
                "kind": "agent-bridge-delegation",
                "runId": run.id,
                "rootRunId": run.root_run_id,
                "parentRunId": run.parent_run_id,
                "contextPolicy": "explicit",
            }),
            attempt_id.clone(),
            logical_turn_id.clone(),
        )?;
        match outcome.status {
            BeginTurnStatus::Creating => outcome.binding_key,
            BeginTurnStatus::RecoveryRequired => {
                return Err(format!(
                    "delegated backing turn requires recovery: {}",
                    outcome.reason.unwrap_or_else(|| outcome.binding_key.clone())
                ));
            }
            BeginTurnStatus::TargetUnavailable => {
                return Err(format!(
                    "delegated target unavailable at Tx1: {}",
                    outcome.reason.unwrap_or_else(|| "unknown target error".to_string())
                ));
            }
        }
    };

    service.set_dispatch_binding(
        &run.id,
        DelegationDispatchBinding {
            backing_thread_id: backing_thread_id.clone(),
            attempt_id: attempt_id.clone(),
            logical_turn_id: logical_turn_id.clone(),
            binding_key,
            native_session_id: None,
            runtime_turn_id: None,
        },
    )?;

    let delivery = shared_session_v2_prepare_delivery(
        run.workspace_id.clone(),
        backing_thread_id.clone(),
        attempt_id.clone(),
        app.state::<AppState>(),
    )
    .await?;
    let artifact_id = required_json_string(&delivery, "artifactId")?;
    let artifact_checksum = required_json_string(&delivery, "artifactChecksum")?;

    let dispatch = shared_session_v2_dispatch_turn(
        run.workspace_id.clone(),
        backing_thread_id.clone(),
        attempt_id.clone(),
        artifact_id,
        artifact_checksum,
        None,
        None,
        None,
        None,
        None,
        None,
        app.state::<AppState>(),
        app.clone(),
    )
    .await?;

    let already_settled = dispatch
        .get("alreadySettled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let native_session_id = optional_json_string(&dispatch, "nativeThreadId");
    let runtime_turn_id = optional_json_string(&dispatch, "runtimeTurnId");
    match (native_session_id.as_deref(), runtime_turn_id.as_deref()) {
        (Some(native_session_id), Some(runtime_turn_id)) => {
            service.record_runtime_ack(
                &run.id,
                &attempt_id,
                native_session_id,
                runtime_turn_id,
            )?;
        }
        _ if already_settled => {}
        _ => {
            return Err(format!(
                "delegated runtime ACK missing native identity for run {}",
                run.id
            ));
        }
    }

    let waiter_service = Arc::clone(&service);
    let waiter_run_id = run.id.clone();
    let waiter_workspace_id = run.workspace_id.clone();
    let waiter_thread_id = backing_thread_id;
    let waiter_attempt_id = attempt_id;
    let waiter_app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = await_and_settle(
            Arc::clone(&waiter_service),
            &waiter_run_id,
            &waiter_workspace_id,
            &waiter_thread_id,
            &waiter_attempt_id,
            &waiter_app,
        )
        .await
        {
            let _ = waiter_service.settle_failed(&waiter_run_id, error.clone());
            log::warn!(
                "[agent-bridge] delegated run settlement failed (run={}): {}",
                waiter_run_id,
                error
            );
        }
    });

    service
        .get_run(&run.id)?
        .ok_or_else(|| format!("delegated run disappeared after dispatch: {}", run.id))
}

async fn create_backing_thread(run: &DelegationRun, app: &AppHandle) -> Result<String, String> {
    let selected_target = shared_selected_target(&run.target_execution)?;
    let started = start_shared_session(
        run.workspace_id.clone(),
        Some(selected_target),
        app.state::<AppState>(),
    )
    .await?;
    started
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Agent Bridge backing Shared Session did not return thread identity".to_string())
}

fn shared_selected_target(target: &ExecutionTargetInput) -> Result<SharedSelectedTarget, String> {
    let provider_profile_source = match target.provider_profile_source {
        Some(CanonicalProviderProfileSource::Local) => Some("disk".to_string()),
        Some(CanonicalProviderProfileSource::Managed) => Some("managed".to_string()),
        None => None,
    };
    Ok(SharedSelectedTarget {
        engine: target.engine,
        provider_profile_id: target.provider_profile_id.clone(),
        model_catalog_entry_id: target.model_catalog_entry_id.clone(),
        model: target.model.clone(),
        reasoning: target
            .reasoning_effort
            .as_ref()
            .map(|effort| SharedSelectedReasoning {
                effort: effort.clone(),
            }),
        provider_profile_name_snapshot: target.provider_profile_name_snapshot.clone(),
        provider_profile_source,
    })
}

fn ensure_dispatch_policy_supported(run: &DelegationRun) -> Result<(), String> {
    if run.context_policy != DelegationContextPolicy::Explicit {
        return Err(format!(
            "delegation context policy is not implemented by the current dispatcher: {:?}",
            run.context_policy
        ));
    }
    if run.execution_scope == DelegationExecutionScope::IsolatedWorktree {
        return Err(
            "isolated worktree delegation is not implemented by the current dispatcher"
                .to_string(),
        );
    }
    Ok(())
}

fn permission_class(scope: DelegationExecutionScope) -> Result<&'static str, String> {
    match scope {
        DelegationExecutionScope::Observe => Ok("read-only"),
        DelegationExecutionScope::SharedWorkspace => Ok("current-workspace"),
        DelegationExecutionScope::IsolatedWorktree => Err(
            "isolated worktree delegation must be provisioned before runtime dispatch".to_string(),
        ),
    }
}

fn explicit_delegation_prompt(run: &DelegationRun) -> String {
    let mut prompt = run.task.trim().to_string();
    let file_refs = run
        .file_refs
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if !file_refs.is_empty() {
        prompt.push_str("\n\nExplicit file references supplied by the caller:\n");
        for file_ref in file_refs {
            prompt.push_str("- ");
            prompt.push_str(file_ref);
            prompt.push('\n');
        }
    }
    prompt.trim_end().to_string()
}

fn required_json_string(value: &Value, key: &str) -> Result<String, String> {
    optional_json_string(value, key)
        .ok_or_else(|| format!("Agent Bridge runtime response is missing {key}"))
}

fn optional_json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn await_and_settle(
    service: Arc<AgentBridgeService>,
    run_id: &str,
    workspace_id: &str,
    backing_thread_id: &str,
    attempt_id: &str,
    app: &AppHandle,
) -> Result<(), String> {
    shared_session_v2_await_turn_terminal(
        workspace_id.to_string(),
        backing_thread_id.to_string(),
        attempt_id.to_string(),
        app.state::<AppState>(),
    )
    .await?;

    let shared_session_id = parse_shared_session_id(backing_thread_id)?;
    let committed = {
        let state = app.state::<AppState>();
        let writer = state
            .shared_event_writer
            .as_ref()
            .ok_or_else(|| "shared event log unavailable during Agent Bridge settlement".to_string())?;
        let event = writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|event| {
                event.fact_type == "conversation.turnCommitted"
                    && event.attempt_id.as_deref() == Some(attempt_id)
            })
            .ok_or_else(|| {
                format!(
                    "delegated attempt {attempt_id} ended without conversation.turnCommitted"
                )
            })?;
        let fact = serde_json::from_str::<CanonicalFact>(&event.payload_json)
            .map_err(|error| format!("parse delegated turnCommitted payload: {error}"))?;
        match fact {
            CanonicalFact::TurnCommitted(committed) => committed,
            _ => return Err("delegated terminal event has unexpected fact type".to_string()),
        }
    };

    match committed.outcome.status {
        OutcomeStatus::Completed => {
            let summary = committed
                .assistant
                .blocks
                .iter()
                .filter_map(|block| match block {
                    CanonicalBlock::Text { text } => Some(text.trim()),
                    _ => None,
                })
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            service.settle_completed(
                run_id,
                DelegationResult {
                    summary: (!summary.is_empty()).then_some(summary),
                    changed_files: Vec::new(),
                    branch: None,
                    artifact_path: committed
                        .artifact_refs
                        .first()
                        .map(|artifact| artifact.locator.clone()),
                },
            )?;
        }
        OutcomeStatus::Failed => {
            let error = committed
                .outcome
                .error_message
                .filter(|value| !value.trim().is_empty())
                .or(committed.outcome.error_code)
                .unwrap_or_else(|| "delegated target failed without an error message".to_string());
            service.settle_failed(run_id, error)?;
        }
        OutcomeStatus::Cancelled | OutcomeStatus::Replaced => {
            service.cancel(run_id)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::AgentEndpoint;
    use crate::engine::EngineType;

    fn run_with_scope(scope: DelegationExecutionScope) -> DelegationRun {
        DelegationRun {
            id: "run-1".to_string(),
            root_run_id: "run-1".to_string(),
            parent_run_id: None,
            depth: 0,
            source: AgentEndpoint {
                engine_id: "claude".to_string(),
                logical_session_id: None,
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
                model_catalog_entry_id: Some("gpt-5.3-codex-spark".to_string()),
                model: Some("gpt-5.3-codex-spark".to_string()),
                reasoning_effort: None,
                provider_profile_name_snapshot: Some("Local".to_string()),
                provider_profile_source: Some(CanonicalProviderProfileSource::Local),
                runtime_capability_fingerprint: None,
            },
            workspace_id: "workspace-1".to_string(),
            task: "Review authentication".to_string(),
            file_refs: vec!["src/auth.rs".to_string(), "  ".to_string()],
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: scope,
            status: super::super::DelegationRunStatus::Queued,
            dispatch_binding: None,
            result: None,
            error: None,
            created_at_ms: 1,
            started_at_ms: None,
            completed_at_ms: None,
        }
    }

    #[test]
    fn explicit_prompt_contains_only_task_and_explicit_file_refs() {
        let prompt = explicit_delegation_prompt(&run_with_scope(DelegationExecutionScope::Observe));
        assert_eq!(
            prompt,
            "Review authentication\n\nExplicit file references supplied by the caller:\n- src/auth.rs"
        );
    }

    #[test]
    fn scope_maps_to_existing_squad_permission_contract() {
        assert_eq!(
            permission_class(DelegationExecutionScope::Observe).expect("observe"),
            "read-only"
        );
        assert_eq!(
            permission_class(DelegationExecutionScope::SharedWorkspace).expect("shared"),
            "current-workspace"
        );
        assert!(permission_class(DelegationExecutionScope::IsolatedWorktree).is_err());
    }
}
