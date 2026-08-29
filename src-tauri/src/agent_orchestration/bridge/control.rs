use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::shared_session_v2::{
    shared_session_v2_cancel_attempt, shared_session_v2_interrupt_turn,
};
use crate::state::AppState;

use super::models::{DelegationRun, DelegationRunStatus};
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
        return service.cancel(&run_id);
    }

    let binding = run
        .dispatch_binding
        .clone()
        .ok_or_else(|| {
            format!(
                "delegated cancel owner unavailable for {run_id}: dispatch binding is not durably established"
            )
        })?;

    let interrupt = shared_session_v2_interrupt_turn(
        run.workspace_id.clone(),
        binding.backing_thread_id.clone(),
        binding.attempt_id.clone(),
        app.state::<AppState>(),
    )
    .await;

    match interrupt {
        Ok(response) => settle_after_control_response(&service, &run_id, response),
        Err(interrupt_error) => {
            let pre_dispatch = shared_session_v2_cancel_attempt(
                run.workspace_id.clone(),
                binding.backing_thread_id,
                binding.attempt_id,
                Some(BRIDGE_CANCEL_REASON.to_string()),
                app.state::<AppState>(),
            )
            .await;
            match pre_dispatch {
                Ok(response) => settle_after_control_response(&service, &run_id, response),
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
) -> Result<DelegationRun, String> {
    match response.get("status").and_then(Value::as_str) {
        Some("interrupted") | Some("cancelled") => service.cancel(run_id),
        Some("terminal-committed") => service
            .get_run(run_id)?
            .ok_or_else(|| format!("delegated run disappeared after terminal race: {run_id}")),
        Some(status) => Err(format!(
            "delegated cancel did not obtain a terminal/runtime-interrupt disposition for {run_id}: {status}"
        )),
        None => Err(format!(
            "delegated cancel control response is missing status for {run_id}"
        )),
    }
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
        let service = AgentBridgeService::new(DelegationRunRegistry::new(Default::default()));
        let run = service.runs_for_test_create(request()).expect("create");
        let cancelled = settle_after_control_response(
            &service,
            &run.id,
            serde_json::json!({"status":"interrupted"}),
        )
        .expect("cancel");
        assert_eq!(cancelled.status, DelegationRunStatus::Cancelled);
    }
}
