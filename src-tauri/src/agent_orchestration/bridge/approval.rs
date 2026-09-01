use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{AppHandle, Manager};

use crate::engine::agent_event_bus::MossxAgentEvent;
use crate::engine::events::EngineEvent;
use crate::state::AppState;

use super::models::DelegationRunStatus;
use super::service::AgentBridgeService;

const APPROVAL_OBSERVER_CAPACITY: usize = 256;
static APPROVAL_OBSERVER_STARTED: OnceLock<()> = OnceLock::new();
static PENDING_APPROVALS: OnceLock<Mutex<HashMap<String, HashSet<String>>>> = OnceLock::new();

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
    if event.kind == "run.settled" {
        clear_pending_approvals(&event.run_id)?;
        return Ok(());
    }
    // Native runtime events use native turn ids and therefore are not Bridge-owned. Only the
    // re-attributed copy has a DelegationRun id and can change Bridge state.
    let Some(run) = service.get_run(&event.run_id)? else {
        return Ok(());
    };
    if run.status.is_terminal() {
        clear_pending_approvals(&event.run_id)?;
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
        EngineEvent::ApprovalRequest { request_id, .. } => {
            track_pending_approval(run_id, request_id)?;
            transition_if_current(
                service,
                run_id,
                DelegationRunStatus::Running,
                DelegationRunStatus::WaitingApproval,
            )?;
        }
        EngineEvent::ApprovalResolved {
            request_id,
            approved,
            ..
        } => {
            let resolution = resolve_pending_approval(run_id, request_id)?;
            if !approved {
                clear_pending_approvals(run_id)?;
                settle_rejected_if_active(service, run_id)?;
            } else if resolution.was_pending && resolution.remaining == 0 {
                transition_if_current(
                    service,
                    run_id,
                    DelegationRunStatus::WaitingApproval,
                    DelegationRunStatus::Running,
                )?;
            }
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
            // a runtime is still blocked waiting for the user. Progress also cannot release the
            // gate while another request from the same delegated turn remains pending.
            if !has_pending_approvals(run_id)? {
                transition_if_current(
                    service,
                    run_id,
                    DelegationRunStatus::WaitingApproval,
                    DelegationRunStatus::Running,
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ApprovalResolution {
    was_pending: bool,
    remaining: usize,
}

fn approval_request_key(request_id: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(request_id)
        .map_err(|error| format!("serialize Agent Bridge approval request identity: {error}"))
}

fn pending_approvals() -> &'static Mutex<HashMap<String, HashSet<String>>> {
    PENDING_APPROVALS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn track_pending_approval(
    run_id: &str,
    request_id: &serde_json::Value,
) -> Result<(), String> {
    let request_key = approval_request_key(request_id)?;
    let mut pending = pending_approvals()
        .lock()
        .map_err(|_| "Agent Bridge approval tracker lock poisoned".to_string())?;
    pending
        .entry(run_id.to_string())
        .or_default()
        .insert(request_key);
    Ok(())
}

fn resolve_pending_approval(
    run_id: &str,
    request_id: &serde_json::Value,
) -> Result<ApprovalResolution, String> {
    let request_key = approval_request_key(request_id)?;
    let mut pending = pending_approvals()
        .lock()
        .map_err(|_| "Agent Bridge approval tracker lock poisoned".to_string())?;
    let Some(requests) = pending.get_mut(run_id) else {
        return Ok(ApprovalResolution {
            was_pending: false,
            remaining: 0,
        });
    };
    let was_pending = requests.remove(&request_key);
    let remaining = requests.len();
    if requests.is_empty() {
        pending.remove(run_id);
    }
    Ok(ApprovalResolution {
        was_pending,
        remaining,
    })
}

fn has_pending_approvals(run_id: &str) -> Result<bool, String> {
    let pending = pending_approvals()
        .lock()
        .map_err(|_| "Agent Bridge approval tracker lock poisoned".to_string())?;
    Ok(pending
        .get(run_id)
        .is_some_and(|requests| !requests.is_empty()))
}

fn clear_pending_approvals(run_id: &str) -> Result<(), String> {
    let mut pending = pending_approvals()
        .lock()
        .map_err(|_| "Agent Bridge approval tracker lock poisoned".to_string())?;
    pending.remove(run_id);
    Ok(())
}

fn settle_rejected_if_active(
    service: &AgentBridgeService,
    run_id: &str,
) -> Result<(), String> {
    match service.settle_failed(
        run_id,
        "approval-rejected: user rejected delegated target approval".to_string(),
    ) {
        Ok(_) => Ok(()),
        Err(error) => {
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

    fn approval_request(request_id: &str) -> EngineEvent {
        EngineEvent::ApprovalRequest {
            workspace_id: "workspace-1".to_string(),
            request_id: json!(request_id),
            tool_name: "shell".to_string(),
            input: Some(json!({"command":"git status"})),
            message: None,
        }
    }

    fn approval_resolved(request_id: &str, approved: bool) -> EngineEvent {
        EngineEvent::ApprovalResolved {
            workspace_id: "workspace-1".to_string(),
            request_id: json!(request_id),
            approved,
        }
    }

    #[test]
    fn approval_request_moves_running_run_to_waiting_approval() {
        let (service, run_id) = running_service();
        sync_engine_event(&service, &run_id, &approval_request("approval-1"))
            .expect("sync approval");

        assert_eq!(
            service.get_run(&run_id).expect("read").expect("run").status,
            DelegationRunStatus::WaitingApproval
        );
    }

    #[test]
    fn all_pending_approvals_must_be_accepted_before_running_resumes() {
        let (service, run_id) = running_service();
        sync_engine_event(&service, &run_id, &approval_request("approval-1"))
            .expect("first approval");
        sync_engine_event(&service, &run_id, &approval_request("approval-2"))
            .expect("second approval");

        sync_engine_event(
            &service,
            &run_id,
            &approval_resolved("approval-1", true),
        )
        .expect("accept first");
        assert_eq!(
            service.get_run(&run_id).expect("read").expect("run").status,
            DelegationRunStatus::WaitingApproval
        );

        sync_engine_event(
            &service,
            &run_id,
            &approval_resolved("approval-2", true),
        )
        .expect("accept second");
        assert_eq!(
            service.get_run(&run_id).expect("read").expect("run").status,
            DelegationRunStatus::Running
        );
    }

    #[test]
    fn rejected_approval_fails_run_immediately() {
        let (service, run_id) = running_service();
        sync_engine_event(&service, &run_id, &approval_request("approval-1"))
            .expect("approval");
        sync_engine_event(
            &service,
            &run_id,
            &approval_resolved("approval-1", false),
        )
        .expect("reject");

        let run = service.get_run(&run_id).expect("read").expect("run");
        assert_eq!(run.status, DelegationRunStatus::Failed);
        assert!(run
            .error
            .as_deref()
            .is_some_and(|error| error.contains("approval-rejected")));
    }

    #[test]
    fn tool_progress_cannot_bypass_an_unresolved_approval() {
        let (service, run_id) = running_service();
        sync_engine_event(&service, &run_id, &approval_request("approval-1"))
            .expect("approval");

        sync_engine_event(
            &service,
            &run_id,
            &EngineEvent::ToolCompleted {
                workspace_id: "workspace-1".to_string(),
                tool_id: "tool-1".to_string(),
                tool_name: Some("shell".to_string()),
                output: None,
                error: None,
            },
        )
        .expect("tool progress");

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
