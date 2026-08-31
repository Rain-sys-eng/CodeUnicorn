use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::engine::agent_event_bus::{AgentEventBus, RunSettlementStatus};
use crate::shared_session_v2::{
    shared_session_v2_cancel_attempt, shared_session_v2_interrupt_turn,
};
use crate::state::AppState;

use super::models::{DelegationExecutionScope, DelegationRun, DelegationRunStatus};
use super::service::AgentBridgeService;

const BRIDGE_CANCEL_REASON: &str = "agent-bridge-cancelled";

/// Cancel one delegated run without inventing a second engine-specific control path.
///
/// Queued runs have no runtime owner and settle locally. Once a durable backing attempt exists,
/// cancellation is routed through Shared V2 owner checks. Live runtime interrupt is attempted
/// first; if no runtime owner exists yet, the existing pre-dispatch cancel boundary is allowed to
/// consume the exact prepared attempt. Any ambiguous/failed control action leaves the Bridge run
/// non-terminal with its owner metadata intact for retry/diagnostics.
pub async fn cancel_run(
    service: Arc<AgentBridgeService>,
    run_id: String,
    app: AppHandle,
) -> Result<DelegationRun, String> {
    let run = service
        .get_run(&run_id)?
        .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
    if run.status.is_terminal() {
        return Ok(run);
    }
    if run.status == DelegationRunStatus::Queued {
        let cancelled = service.cancel(&run_id)?;
        publish_local_cancellation(&cancelled, &app);
        return Ok(cancelled);
    }

    let binding = run.dispatch_binding.clone().ok_or_else(|| {
        format!(
            "delegated cancel owner unavailable for {run_id}: dispatch binding is not durably established"
        )
    })?;
    let bound_runtime_workspace_id = binding
        .runtime_workspace_id
        .clone()
        .filter(|value| !value.trim().is_empty());
    let runtime_workspace_id = match run.execution_scope {
        DelegationExecutionScope::IsolatedWorktree => bound_runtime_workspace_id
            .filter(|value| value != &run.workspace_id)
            .ok_or_else(|| {
                format!(
                    "isolated delegated cancel owner unavailable for {run_id}: durable runtime workspace is missing or unsafe"
                )
            })?,
        _ => bound_runtime_workspace_id.unwrap_or_else(|| run.workspace_id.clone()),
    };

    let interrupt = shared_session_v2_interrupt_turn(
        runtime_workspace_id.clone(),
        binding.backing_thread_id.clone(),
        binding.attempt_id.clone(),
        app.state::<AppState>(),
    )
    .await;

    match interrupt {
        Ok(response) => settle_after_control_response(&service, &run_id, response, &app),
        Err(interrupt_error) => {
            let pre_dispatch = shared_session_v2_cancel_attempt(
                runtime_workspace_id,
                binding.backing_thread_id,
                binding.attempt_id,
                Some(BRIDGE_CANCEL_REASON.to_string()),
                app.state::<AppState>(),
            )
            .await;
            match pre_dispatch {
                Ok(response) => settle_after_control_response(&service, &run_id, response, &app),
                Err(pre_dispatch_error) => Err(format!(
                    "delegated cancel failed without releasing owner for {run_id}; interrupt={interrupt_error}; pre-dispatch={pre_dispatch_error}"
                )),
            }
        }
    }
}

fn settle_after_control_response(
    service: &AgentBridgeService,
    run_id: &str,
    response: Value,
    app: &AppHandle,
) -> Result<DelegationRun, String> {
    let (run, publish_cancellation) = apply_control_response(service, run_id, response)?;
    if publish_cancellation {
        publish_local_cancellation(&run, app);
    }
    Ok(run)
}

fn apply_control_response(
    service: &AgentBridgeService,
    run_id: &str,
    response: Value,
) -> Result<(DelegationRun, bool), String> {
    match response.get("status").and_then(Value::as_str) {
        Some("interrupted") | Some("cancelled") => {
            let cancelled = service.cancel(run_id)?;
            Ok((cancelled, true))
        }
        Some("terminal-committed") => service
            .get_run(run_id)?
            .map(|run| (run, false))
            .ok_or_else(|| format!("delegated run disappeared after terminal race: {run_id}")),
        Some(status) => Err(format!(
            "delegated cancel did not obtain a terminal/runtime-interrupt disposition for {run_id}: {status}"
        )),
        None => Err(format!(
            "delegated cancel control response is missing status for {run_id}"
        )),
    }
}

fn publish_local_cancellation(run: &DelegationRun, app: &AppHandle) {
    let binding = run.dispatch_binding.as_ref();
    let logical_session_id = binding
        .map(|binding| binding.backing_thread_id.as_str())
        .or(run.source.logical_session_id.as_deref())
        .unwrap_or(run.id.as_str());
    let runtime_turn_id = binding.and_then(|binding| binding.runtime_turn_id.as_deref());
    let native_session_id = binding
        .and_then(|binding| binding.native_session_id.as_deref())
        .or(run.target.native_session_id.as_deref());
    let bus: AgentEventBus = app.state::<AppState>().engine_manager.agent_event_bus();
    let _ = bus.publish_settlement(
        run.target_execution.engine,
        logical_session_id,
        native_session_id,
        &run.id,
        runtime_turn_id,
        RunSettlementStatus::Cancelled,
        json!({
            "workspaceId": run.workspace_id.as_str(),
            "source": "agent-bridge-control",
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, CreateDelegationRun, DelegationContextPolicy, DelegationExecutionScope,
        DelegationRunRegistry,
    };
    use crate::engine::EngineType;
    use crate::shared_event_log::canonical::types::CanonicalProviderProfileSource;
    use crate::shared_session_v2::ExecutionTargetInput;

    fn request() -> CreateDelegationRun {
        CreateDelegationRun {
            source: AgentEndpoint {
                engine_id: "claude".to_string(),
                logical_session_id: Some("source".to_string()),
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
                provider_profile_source: Some(CanonicalProviderProfileSource::Local),
                runtime_capability_fingerprint: None,
            }),
            workspace_id: "workspace-1".to_string(),
            task: "review".to_string(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
            parent_run_id: None,
        }
    }

    #[test]
    fn interrupted_response_settles_cancelled() {
        let registry = DelegationRunRegistry::new(Default::default());
        let run = registry.create(request()).expect("create");
        let service = AgentBridgeService::new(registry);
        let (cancelled, publish_cancellation) = apply_control_response(
            &service,
            &run.id,
            serde_json::json!({"status":"interrupted"}),
        )
        .expect("cancel");
        assert_eq!(cancelled.status, DelegationRunStatus::Cancelled);
        assert!(publish_cancellation);
    }
}
