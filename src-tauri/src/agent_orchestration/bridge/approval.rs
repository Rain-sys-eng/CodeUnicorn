use std::sync::{Arc, OnceLock};

use tauri::{AppHandle, Manager};

use crate::engine::agent_event_bus::MossxAgentEvent;
use crate::engine::events::EngineEvent;
use crate::state::AppState;

use super::models::DelegationRunStatus;
use super::service::AgentBridgeService;

const APPROVAL_OBSERVER_CAPACITY: usize = 256;
static APPROVAL_OBSERVER_STARTED: OnceLock<()> = OnceLock::new();

/// Start one process-wide observer that mirrors delegated approval lifecycle into durable
/// `DelegationRun.status` facts.
///
/// The observer consumes the existing AgentEventBus after Bridge re-attribution. It does not
/// approve or reject anything: the native engine/UI approval owner remains authoritative.
pub(crate) fn ensure_observer_started(app: &AppHandle) -> Result<(), String> {
    if APPROVAL_OBSERVER_STARTED.get().is_some() {
        return Ok(());
    }

    let state = app.state::<AppState>();
    let service = Arc::clone(&state.agent_bridge);
    let mut subscription = state
        .engine_manager
        .agent_event_bus()
        .subscribe(APPROVAL_OBSERVER_CAPACITY);

    APPROVAL_OBSERVER_STARTED
        .set(())
        .map_err(|_| "Agent Bridge approval observer was initialized concurrently".to_string())?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = subscription.recv().await {
            if let Err(error) = observe_bus_event(service.as_ref(), &event) {
                log::warn!(
                    "[agent-bridge] approval lifecycle sync failed (run={} kind={}): {}",
                    event.run_id,
                    event.kind,
                    error
                );
            }
        }
    });
    Ok(())
}

fn observe_bus_event(
    service: &AgentBridgeService,
    event: &MossxAgentEvent,
) -> Result<(), String> {
    // Native runtime events use native turn ids and therefore are not Bridge-owned. Only the
    // re-attributed copy has a DelegationRun id and can change Bridge state.
    let Some(run) = service.get_run(&event.run_id)? else {
        return Ok(());
    };
    if run.status.is_terminal() || event.kind == "run.settled" {
        return Ok(());
    }

    let Ok(engine_event) = serde_json::from_value::<EngineEvent>(event.payload.clone()) else {
        return Ok(());
    };
    sync_engine_event(service, &event.run_id, &engine_event)
}

fn sync_engine_event(
    service: &AgentBridgeService,
    run_id: &str,
    event: &EngineEvent,
) -> Result<(), String> {
    match event {
        EngineEvent::ApprovalRequest { .. } => {
            transition_if_current(
                service,
                run_id,
                DelegationRunStatus::Running,
                DelegationRunStatus::WaitingApproval,
            )?;
        }
        EngineEvent::TextDelta { .. }
        | EngineEvent::ReasoningDelta { .. }
        | EngineEvent::ToolStarted { .. }
        | EngineEvent::ToolCompleted { .. }
        | EngineEvent::ToolInputUpdated { .. }
        | EngineEvent::ToolOutputDelta { .. }
        | EngineEvent::BackgroundTaskStarted { .. }
        | EngineEvent::BackgroundTaskUpdated { .. } => {
            // These events are evidence that the target resumed after the approval gate. We
            // intentionally ignore heartbeat/usage/raw/session events because they can occur while
            // a runtime is still blocked waiting for the user.
            transition_if_current(
                service,
                run_id,
                DelegationRunStatus::WaitingApproval,
                DelegationRunStatus::Running,
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn transition_if_current(
    service: &AgentBridgeService,
    run_id: &str,
    expected: DelegationRunStatus,
    next: DelegationRunStatus,
) -> Result<(), String> {
    let Some(before) = service.get_run(run_id)? else {
        return Ok(());
    };
    if before.status != expected {
        return Ok(());
    }

    match service.transition(run_id, next) {
        Ok(_) => Ok(()),
        Err(error) => {
            // Terminal settlement may win the race between the read above and transition. That is
            // expected; terminal facts remain authoritative and must never be reopened.
            if service
                .get_run(run_id)?
                .is_some_and(|run| run.status.is_terminal())
            {
                return Ok(());
            }
            Err(error)
        }
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
    use serde_json::json;

    fn running_service() -> (AgentBridgeService, String) {
        let registry = DelegationRunRegistry::new(Default::default());
        let run = registry
            .create(CreateDelegationRun {
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
            })
            .expect("create");
        registry.claim_dispatch(&run.id).expect("running");
        (AgentBridgeService::new(registry), run.id)
    }

    #[test]
    fn approval_request_moves_running_run_to_waiting_approval() {
        let (service, run_id) = running_service();
        sync_engine_event(
            &service,
            &run_id,
            &EngineEvent::ApprovalRequest {
                workspace_id: "workspace-1".to_string(),
                request_id: json!("approval-1"),
                tool_name: "shell".to_string(),
                input: Some(json!({"command":"git status"})),
                message: None,
            },
        )
        .expect("sync approval");

        assert_eq!(
            service.get_run(&run_id).expect("read").expect("run").status,
            DelegationRunStatus::WaitingApproval
        );
    }

    #[test]
    fn real_progress_after_approval_restores_running_state() {
        let (service, run_id) = running_service();
        service
            .transition(&run_id, DelegationRunStatus::WaitingApproval)
            .expect("wait");

        sync_engine_event(
            &service,
            &run_id,
            &EngineEvent::TextDelta {
                workspace_id: "workspace-1".to_string(),
                text: "resumed".to_string(),
            },
        )
        .expect("resume");

        assert_eq!(
            service.get_run(&run_id).expect("read").expect("run").status,
            DelegationRunStatus::Running
        );
    }

    #[test]
    fn heartbeat_does_not_fake_approval_resolution() {
        let (service, run_id) = running_service();
        service
            .transition(&run_id, DelegationRunStatus::WaitingApproval)
            .expect("wait");

        sync_engine_event(
            &service,
            &run_id,
            &EngineEvent::ProcessingHeartbeat {
                workspace_id: "workspace-1".to_string(),
                pulse: 1,
            },
        )
        .expect("heartbeat");

        assert_eq!(
            service.get_run(&run_id).expect("read").expect("run").status,
            DelegationRunStatus::WaitingApproval
        );
    }
}
