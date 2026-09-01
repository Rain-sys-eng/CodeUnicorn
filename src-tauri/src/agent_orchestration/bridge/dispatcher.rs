use std::collections::HashSet;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::engine::agent_event_bus::{
    AgentEventBus, AgentEventSubscription, MossxAgentEvent, RunSettlementStatus,
};
use crate::engine::events::EngineEvent;
use crate::engine::EngineType;
use crate::shared_event_log::canonical::types::{
    CanonicalBlock, CanonicalFact, CanonicalProviderProfileSource, OutcomeStatus,
};
use crate::shared_session_v2::{
    begin_squad_worker_turn_core, shared_session_v2_await_turn_terminal,
    shared_session_v2_dispatch_turn, shared_session_v2_prepare_delivery,
    shared_session_v2_prepare_delivery_with_package, BeginTurnStatus, ExecutionTargetInput,
};
use crate::shared_sessions::{
    parse_shared_session_id, start_shared_session, SharedSelectedReasoning, SharedSelectedTarget,
};
use crate::state::AppState;

use super::models::{
    DelegationContextPolicy, DelegationContextTransfer, DelegationDispatchBinding,
    DelegationExecutionScope, DelegationResult, DelegationRun, DelegationRunStatus,
};
use super::presentation::ensure_backing_session_hidden;
use super::service::AgentBridgeService;
use super::worktree::{delegated_branch_name, provision_delegated_worktree, DelegatedWorktreeProvision};
use super::worktree_store::DelegatedWorktreeOwnershipState;

const BRIDGE_NODE_ID: &str = "delegate";
const BRIDGE_WORKER_ROLE: &str = "delegated-agent";
const BRIDGE_EVENT_SUBSCRIPTION_CAPACITY: usize = 256;
const BRIDGE_RESULT_DIFF_MAX_FILES: usize = 40;
const BRIDGE_RESULT_DIFF_MAX_BYTES_PER_FILE: usize = 64 * 1024;
const BRIDGE_RESULT_DIFF_MAX_TOTAL_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
struct BridgeDispatchLane {
    backing_thread_id: String,
    /// Stable run identity used only to derive the scoped Shared binding key. Continuations
    /// keep this owner so `begin_squad_worker_turn_core` reuses the same native session.
    binding_owner_run_id: String,
}

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
    // Resolve continuation ownership before provisioning. Isolated continuations reuse the
    // original worktree/backing/native owner; a new nested run receives its own owner.
    let continuation_lane = if run.continuation_of_run_id.is_some() {
        Some(resolve_continuation_lane(&service, &run)?)
    } else {
        None
    };
    let worktree_owner_run_id = continuation_lane
        .as_ref()
        .map(|lane| lane.binding_owner_run_id.as_str())
        .unwrap_or(run.id.as_str());
    let (dispatch_workspace_id, worktree_provision) =
        resolve_dispatch_workspace(&service, &run, worktree_owner_run_id, &app).await?;
    // Root delegations get a fresh durable Shared backing lane. A continuation resolves the
    // original lane and scoped binding owner, so the existing native CLI session is reused.
    let lane = match continuation_lane {
        Some(lane) => lane,
        None => BridgeDispatchLane {
            backing_thread_id: create_backing_thread(&run, &dispatch_workspace_id, &app).await?,
            binding_owner_run_id: run.id.clone(),
        },
    };
    let backing_thread_id = lane.backing_thread_id.clone();
    {
        // Presentation hiding is a canonical Shared fact, not an in-memory/UI-only convention.
        // Mark before any runtime dispatch so an internal backing lane never behaves like an
        // ordinary user-created Shared session after the Bridge starts using it.
        let state = app.state::<AppState>();
        let writer = state.shared_event_writer.as_ref().ok_or_else(|| {
            "shared event log unavailable for Agent Bridge presentation marker".to_string()
        })?;
        ensure_backing_session_hidden(writer, &backing_thread_id, &lane.binding_owner_run_id)?;
    }
    let shared_session_id = parse_shared_session_id(&backing_thread_id)?;
    let attempt_id = Uuid::new_v4().to_string();
    let logical_turn_id = Uuid::new_v4().to_string();
    let permission_class = permission_class(
        run.execution_scope,
        &run.workspace_id,
        &dispatch_workspace_id,
    )?;
    let prompt = explicit_delegation_prompt(&run);

    // Subscribe before the target runtime can emit. The existing Shared event sink publishes
    // native runtime ownership into this same bus; after dispatch ACK we replay the buffered
    // scoped events with DelegationRun.id as the logical run id. No engine-specific parser or
    // second streaming bus is introduced.
    let event_bus = app.state::<AppState>().engine_manager.agent_event_bus();
    let event_subscription = event_bus.subscribe(BRIDGE_EVENT_SUBSCRIPTION_CAPACITY);

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
            &lane.binding_owner_run_id,
            BRIDGE_NODE_ID,
            BRIDGE_WORKER_ROLE,
            permission_class,
            false,
            json!({
                "kind": "agent-bridge-delegation",
                "runId": run.id.clone(),
                "rootRunId": run.root_run_id.clone(),
                "parentRunId": run.parent_run_id.clone(),
                "continuationOfRunId": run.continuation_of_run_id.clone(),
                "retryOfRunId": run.retry_of_run_id.clone(),
                "bindingOwnerRunId": lane.binding_owner_run_id.clone(),
                "contextPolicy": run.context_policy,
            }),
            attempt_id.clone(),
            logical_turn_id.clone(),
        )?;
        match outcome.status {
            BeginTurnStatus::Creating => outcome.binding_key,
            BeginTurnStatus::RecoveryRequired => {
                let reason = outcome
                    .reason
                    .unwrap_or_else(|| outcome.binding_key.clone());
                return Err(format!(
                    "delegated backing turn requires recovery: {reason}"
                ));
            }
            BeginTurnStatus::TargetUnavailable => {
                let reason = outcome
                    .reason
                    .unwrap_or_else(|| "unknown target error".to_string());
                return Err(format!("delegated target unavailable at Tx1: {reason}"));
            }
        }
    };

    service.set_dispatch_binding(
        &run.id,
        DelegationDispatchBinding {
            backing_thread_id: backing_thread_id.clone(),
            attempt_id: attempt_id.clone(),
            logical_turn_id: logical_turn_id.clone(),
            binding_key: binding_key.clone(),
            runtime_workspace_id: Some(dispatch_workspace_id.clone()),
            native_session_id: None,
            runtime_turn_id: None,
            context_transfer: None,
        },
    )?;

    let context_package = super::context::compile_delegation_context(
        &service,
        &run,
        &binding_key,
        &backing_thread_id,
        &attempt_id,
        &dispatch_workspace_id,
        &app,
    )
    .await?;
    let delivery = match context_package {
        Some(package) => {
            let delivery = shared_session_v2_prepare_delivery_with_package(
                dispatch_workspace_id.clone(),
                backing_thread_id.clone(),
                attempt_id.clone(),
                package,
                app.state::<AppState>(),
            )
            .await?;
            service.record_context_transfer(
                &run.id,
                &attempt_id,
                DelegationContextTransfer {
                    policy: run.context_policy,
                    package_id: required_json_string(&delivery, "packageId")?,
                    artifact_id: required_json_string(&delivery, "artifactId")?,
                    artifact_checksum: required_json_string(&delivery, "artifactChecksum")?,
                    source_checksum: required_json_string(&delivery, "sourceChecksum")?,
                    projection_mode: required_json_string(&delivery, "mode")?,
                },
            )?;
            delivery
        }
        None => {
            shared_session_v2_prepare_delivery(
                dispatch_workspace_id.clone(),
                backing_thread_id.clone(),
                attempt_id.clone(),
                app.state::<AppState>(),
            )
            .await?
        }
    };
    let artifact_id = required_json_string(&delivery, "artifactId")?;
    let artifact_checksum = required_json_string(&delivery, "artifactChecksum")?;

    let dispatch = shared_session_v2_dispatch_turn(
        dispatch_workspace_id.clone(),
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
            service.record_runtime_ack(&run.id, &attempt_id, native_session_id, runtime_turn_id)?;
        }
        _ if already_settled => {}
        _ => {
            return Err(format!(
                "delegated runtime ACK missing native identity for run {}",
                run.id
            ));
        }
    }

    spawn_bridge_event_reattribution(
        event_bus,
        event_subscription,
        backing_thread_id.clone(),
        run.id.clone(),
        run.target_execution.engine,
    );

    let waiter_service = Arc::clone(&service);
    let waiter_run_id = run.id.clone();
    let waiter_workspace_id = dispatch_workspace_id;
    let waiter_thread_id = backing_thread_id;
    let waiter_attempt_id = attempt_id;
    let waiter_worktree_provision = worktree_provision;
    let waiter_app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = await_and_settle(
            Arc::clone(&waiter_service),
            &waiter_run_id,
            &waiter_workspace_id,
            &waiter_thread_id,
            &waiter_attempt_id,
            waiter_worktree_provision.as_ref(),
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

async fn resolve_dispatch_workspace(
    service: &AgentBridgeService,
    run: &DelegationRun,
    owner_run_id: &str,
    app: &AppHandle,
) -> Result<(String, Option<DelegatedWorktreeProvision>), String> {
    if run.execution_scope != DelegationExecutionScope::IsolatedWorktree {
        return Ok((run.workspace_id.clone(), None));
    }

    let owner = service
        .get_run(owner_run_id)?
        .ok_or_else(|| format!("isolated worktree owner run not found: {owner_run_id}"))?;
    if owner.execution_scope != DelegationExecutionScope::IsolatedWorktree {
        return Err(format!(
            "isolated worktree owner scope mismatch: {} is {:?}",
            owner.id, owner.execution_scope
        ));
    }
    let branch = delegated_branch_name(&owner.id)?;
    let ownership = service.reserve_worktree(&owner.id, &owner.workspace_id, &branch)?;
    let provision = match ownership.state {
        DelegatedWorktreeOwnershipState::Provisioned => ownership.as_provision()?,
        DelegatedWorktreeOwnershipState::Reserved => {
            let provision = match recover_reserved_worktree(&owner, &branch, app).await? {
                Some(provision) => provision,
                None => provision_delegated_worktree(&owner, &branch, app).await?,
            };
            service.complete_worktree(&provision)?.as_provision()?
        }
    };
    validate_worktree_provision(&owner, &provision, app).await?;

    if owner.id != run.id {
        let binding = owner.dispatch_binding.as_ref().ok_or_else(|| {
            format!(
                "isolated continuation owner has no dispatch binding: {}",
                owner.id
            )
        })?;
        let runtime_workspace_id = binding
            .runtime_workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!(
                    "isolated continuation owner has no durable runtime workspace: {}",
                    owner.id
                )
            })?;
        if runtime_workspace_id != provision.workspace_id {
            return Err(format!(
                "isolated continuation runtime workspace does not match worktree owner: {}",
                owner.id
            ));
        }
    }

    Ok((provision.workspace_id.clone(), Some(provision)))
}

async fn recover_reserved_worktree(
    owner: &DelegationRun,
    branch: &str,
    app: &AppHandle,
) -> Result<Option<DelegatedWorktreeProvision>, String> {
    let state = app.state::<AppState>();
    let workspaces = state.workspaces.lock().await;
    let source = workspaces.get(&owner.workspace_id).ok_or_else(|| {
        format!(
            "source workspace not found while recovering delegated worktree: {}",
            owner.workspace_id
        )
    })?;
    let expected_parent_id = if source.kind.is_worktree() {
        source
            .parent_id
            .as_deref()
            .ok_or_else(|| format!("source worktree is missing parent identity: {}", source.id))?
    } else {
        source.id.as_str()
    };
    let matches = workspaces
        .values()
        .filter(|workspace| workspace.kind.is_worktree())
        .filter(|workspace| workspace.parent_id.as_deref() == Some(expected_parent_id))
        .filter(|workspace| {
            workspace
                .worktree
                .as_ref()
                .map(|worktree| worktree.branch.trim())
                == Some(branch)
        })
        .collect::<Vec<_>>();
    if matches.len() > 1 {
        return Err(format!(
            "delegated worktree reservation resolves to multiple workspace owners: {}",
            owner.id
        ));
    }
    let Some(workspace) = matches.first() else {
        return Ok(None);
    };
    let base_commit = workspace
        .worktree
        .as_ref()
        .and_then(|worktree| worktree.base_commit.clone())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "reserved delegated worktree is missing base commit: {}",
                workspace.id
            )
        })?;
    Ok(Some(DelegatedWorktreeProvision {
        owner_run_id: owner.id.clone(),
        source_workspace_id: owner.workspace_id.clone(),
        workspace_id: workspace.id.clone(),
        branch: branch.to_string(),
        base_commit,
        path: workspace.path.clone(),
    }))
}

async fn validate_worktree_provision(
    owner: &DelegationRun,
    provision: &DelegatedWorktreeProvision,
    app: &AppHandle,
) -> Result<(), String> {
    if provision.owner_run_id != owner.id
        || provision.source_workspace_id != owner.workspace_id
        || provision.branch != delegated_branch_name(&owner.id)?
    {
        return Err(format!(
            "delegated worktree provision ownership mismatch for run {}",
            owner.id
        ));
    }
    let state = app.state::<AppState>();
    let workspaces = state.workspaces.lock().await;
    let source = workspaces.get(&owner.workspace_id).ok_or_else(|| {
        format!(
            "delegated worktree source workspace is no longer registered: {}",
            owner.workspace_id
        )
    })?;
    let expected_parent_id = if source.kind.is_worktree() {
        source.parent_id.as_deref().ok_or_else(|| {
            format!(
                "delegated worktree source is missing parent identity: {}",
                source.id
            )
        })?
    } else {
        source.id.as_str()
    };
    let workspace = workspaces.get(&provision.workspace_id).ok_or_else(|| {
        format!(
            "delegated worktree workspace is no longer registered: {}",
            provision.workspace_id
        )
    })?;
    if !workspace.kind.is_worktree()
        || workspace.parent_id.as_deref() != Some(expected_parent_id)
        || workspace.path != provision.path
        || workspace
            .worktree
            .as_ref()
            .map(|worktree| worktree.branch.trim())
            != Some(provision.branch.as_str())
        || workspace
            .worktree
            .as_ref()
            .and_then(|worktree| worktree.base_commit.as_deref())
            .map(str::trim)
            != Some(provision.base_commit.as_str())
    {
        return Err(format!(
            "delegated worktree path/branch ownership validation failed: {}",
            provision.workspace_id
        ));
    }
    Ok(())
}

fn resolve_continuation_lane(
    service: &AgentBridgeService,
    run: &DelegationRun,
) -> Result<BridgeDispatchLane, String> {
    let mut cursor_id = run
        .continuation_of_run_id
        .clone()
        .ok_or_else(|| format!("delegated run {} is not a continuation", run.id))?;
    let mut seen = HashSet::new();
    let mut backing_thread_id: Option<String> = None;
    let mut runtime_workspace_id: Option<String> = None;

    loop {
        if !seen.insert(cursor_id.clone()) {
            return Err(format!(
                "delegated continuation cycle detected while resolving run {}",
                run.id
            ));
        }
        let previous = service
            .get_run(&cursor_id)?
            .ok_or_else(|| format!("continuation source run not found: {cursor_id}"))?;
        if previous.status != DelegationRunStatus::Completed {
            return Err(format!(
                "continuation lane owner is not completed: {} is {:?}",
                previous.id, previous.status
            ));
        }
        if previous.workspace_id != run.workspace_id
            || previous.target.engine_id != run.target.engine_id
            || previous.target_execution != run.target_execution
            || previous.execution_scope != run.execution_scope
        {
            return Err(format!(
                "continuation lane ownership mismatch: {} -> {}",
                run.id, previous.id
            ));
        }
        let binding = previous.dispatch_binding.as_ref().ok_or_else(|| {
            format!(
                "continuation source run has no dispatch binding: {}",
                previous.id
            )
        })?;
        let previous_runtime_workspace_id = binding
            .runtime_workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(previous.workspace_id.as_str());
        match runtime_workspace_id.as_deref() {
            Some(expected) if expected != previous_runtime_workspace_id => {
                return Err(format!(
                    "continuation chain changed runtime workspace: {} -> {}",
                    run.id, previous.id
                ));
            }
            None => runtime_workspace_id = Some(previous_runtime_workspace_id.to_string()),
            _ => {}
        }
        let previous_backing = binding.backing_thread_id.trim();
        if previous_backing.is_empty() {
            return Err(format!(
                "continuation source run has empty backing thread identity: {}",
                previous.id
            ));
        }
        if binding
            .native_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            return Err(format!(
                "continuation source run has no reusable native session: {}",
                previous.id
            ));
        }
        match backing_thread_id.as_deref() {
            Some(expected) if expected != previous_backing => {
                return Err(format!(
                    "continuation chain changed backing thread: {} -> {}",
                    run.id, previous.id
                ));
            }
            None => backing_thread_id = Some(previous_backing.to_string()),
            _ => {}
        }

        if let Some(older) = previous.continuation_of_run_id.clone() {
            cursor_id = older;
            continue;
        }
        return Ok(BridgeDispatchLane {
            backing_thread_id: backing_thread_id.ok_or_else(|| {
                format!(
                    "continuation lane missing backing thread for run {}",
                    run.id
                )
            })?,
            binding_owner_run_id: previous.id,
        });
    }
}

fn spawn_bridge_event_reattribution(
    bus: AgentEventBus,
    mut subscription: AgentEventSubscription,
    backing_thread_id: String,
    delegated_run_id: String,
    engine: EngineType,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = subscription.recv().await {
            if event.logical_session_id != backing_thread_id
                || event.engine != engine
                || event.run_id == delegated_run_id
            {
                continue;
            }
            let is_terminal = event.kind == "run.settled";
            if let Err(error) = reattribute_bridge_event(
                &bus,
                &event,
                &backing_thread_id,
                &delegated_run_id,
                engine,
            ) {
                log::warn!(
                    "[agent-bridge] event re-attribution failed (run={} kind={}): {}",
                    delegated_run_id,
                    event.kind,
                    error
                );
            }
            if is_terminal {
                break;
            }
        }
    });
}

fn reattribute_bridge_event(
    bus: &AgentEventBus,
    event: &MossxAgentEvent,
    backing_thread_id: &str,
    delegated_run_id: &str,
    engine: EngineType,
) -> Result<(), String> {
    if event.kind == "run.settled" {
        let status_value = event
            .payload
            .get("status")
            .cloned()
            .ok_or_else(|| "delegated settlement event is missing status".to_string())?;
        let status = serde_json::from_value::<RunSettlementStatus>(status_value)
            .map_err(|error| format!("parse delegated settlement status: {error}"))?;
        let evidence = event
            .payload
            .get("evidence")
            .cloned()
            .unwrap_or(Value::Null);
        let _ = bus.publish_settlement(
            engine,
            backing_thread_id,
            event.native_session_id.as_deref(),
            delegated_run_id,
            event.turn_id.as_deref(),
            status,
            evidence,
        );
        return Ok(());
    }

    let engine_event = serde_json::from_value::<EngineEvent>(event.payload.clone())
        .map_err(|error| format!("parse delegated EngineEvent payload: {error}"))?;
    let _ = bus.publish_engine_event(
        engine,
        backing_thread_id,
        event.native_session_id.as_deref(),
        delegated_run_id,
        event.turn_id.as_deref(),
        &engine_event,
    );
    Ok(())
}

async fn create_backing_thread(
    run: &DelegationRun,
    workspace_id: &str,
    app: &AppHandle,
) -> Result<String, String> {
    let selected_target = shared_selected_target(&run.target_execution);
    let started = start_shared_session(
        workspace_id.to_string(),
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
        .ok_or_else(|| {
            "Agent Bridge backing Shared Session did not return thread identity".to_string()
        })
}

fn shared_selected_target(target: &ExecutionTargetInput) -> SharedSelectedTarget {
    let provider_profile_source = match target.provider_profile_source {
        Some(CanonicalProviderProfileSource::Local) => Some("disk".to_string()),
        Some(CanonicalProviderProfileSource::Managed) => Some("managed".to_string()),
        None => None,
    };
    SharedSelectedTarget {
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
    }
}

fn permission_class(
    scope: DelegationExecutionScope,
    source_workspace_id: &str,
    dispatch_workspace_id: &str,
) -> Result<&'static str, String> {
    match scope {
        DelegationExecutionScope::Observe | DelegationExecutionScope::SharedWorkspace
            if dispatch_workspace_id.trim().is_empty()
                || dispatch_workspace_id != source_workspace_id =>
        {
            Err(
                "non-isolated delegation runtime workspace must match its source workspace"
                    .to_string(),
            )
        }
        DelegationExecutionScope::Observe => Ok("read-only"),
        DelegationExecutionScope::SharedWorkspace => Ok("current-workspace"),
        DelegationExecutionScope::IsolatedWorktree => {
            if dispatch_workspace_id.trim().is_empty()
                || dispatch_workspace_id == source_workspace_id
            {
                return Err(
                    "isolated worktree delegation must own a distinct provisioned workspace before runtime dispatch"
                        .to_string(),
                );
            }
            Ok("current-workspace")
        }
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
    worktree_provision: Option<&DelegatedWorktreeProvision>,
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
        let writer = state.shared_event_writer.as_ref().ok_or_else(|| {
            "shared event log unavailable during Agent Bridge settlement".to_string()
        })?;
        let event = writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|event| {
                event.fact_type == "conversation.turnCommitted"
                    && event.attempt_id.as_deref() == Some(attempt_id)
            })
            .ok_or_else(|| {
                format!("delegated attempt {attempt_id} ended without conversation.turnCommitted")
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
            let (changed_files, branch, diff) = match worktree_provision {
                Some(provision) => collect_worktree_result_evidence(provision, app).await?,
                None => (Vec::new(), None, None),
            };
            service.settle_completed(
                run_id,
                DelegationResult {
                    summary: (!summary.is_empty()).then_some(summary),
                    changed_files,
                    branch,
                    diff,
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

async fn collect_worktree_result_evidence(
    provision: &DelegatedWorktreeProvision,
    app: &AppHandle,
) -> Result<(Vec<String>, Option<String>, Option<String>), String> {
    let status = crate::git::get_git_status(
        provision.workspace_id.clone(),
        None,
        app.clone(),
        app.state::<AppState>(),
    )
    .await
    .map_err(|error| format!("delegated worktree status evidence unavailable: {error}"))?;
    if status.get("isGitRepository").and_then(Value::as_bool) != Some(true) {
        return Err(format!(
            "delegated worktree is no longer a Git repository: {}",
            provision.workspace_id
        ));
    }
    let branch = required_json_string(&status, "branchName")?;
    if branch != provision.branch {
        return Err(format!(
            "delegated worktree branch changed outside its owner: expected {}, got {branch}",
            provision.branch
        ));
    }
    let base_diff = crate::git::get_git_worktree_diff_against_branch(
        provision.workspace_id.clone(),
        provision.base_commit.clone(),
        app.clone(),
        app.state::<AppState>(),
    )
    .await
    .map_err(|error| format!("delegated worktree base diff evidence unavailable: {error}"))?;
    let mut changed_files = base_diff
        .iter()
        .map(|file| file.path.trim())
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    changed_files.sort();
    changed_files.dedup();

    let mut previews = Vec::new();
    let mut total_bytes = 0usize;
    for path in changed_files.iter().take(BRIDGE_RESULT_DIFF_MAX_FILES) {
        if total_bytes >= BRIDGE_RESULT_DIFF_MAX_TOTAL_BYTES {
            break;
        }
        let file = crate::git::get_git_worktree_file_diff_against_branch(
            provision.workspace_id.clone(),
            provision.base_commit.clone(),
            path.clone(),
            app.clone(),
            app.state::<AppState>(),
        )
        .await
        .map_err(|error| {
            format!("delegated worktree file diff evidence unavailable for {path}: {error}")
        })?;
        let remaining = BRIDGE_RESULT_DIFF_MAX_TOTAL_BYTES - total_bytes;
        let preview = truncate_result_diff(
            file.diff.trim(),
            remaining.min(BRIDGE_RESULT_DIFF_MAX_BYTES_PER_FILE),
        );
        if preview.is_empty() {
            continue;
        }
        total_bytes += preview.len();
        previews.push(preview);
    }
    if changed_files.len() > BRIDGE_RESULT_DIFF_MAX_FILES {
        previews.push(format!(
            "[Agent Bridge diff preview omitted {} additional changed file(s)]",
            changed_files.len() - BRIDGE_RESULT_DIFF_MAX_FILES
        ));
    }
    let diff = truncate_result_diff(&previews.join("\n\n"), BRIDGE_RESULT_DIFF_MAX_TOTAL_BYTES);
    Ok((
        changed_files,
        Some(branch),
        (!diff.is_empty()).then_some(diff),
    ))
}

fn truncate_result_diff(value: &str, max_bytes: usize) -> String {
    if value.is_empty() || max_bytes == 0 {
        return String::new();
    }
    if value.len() <= max_bytes {
        return value.to_string();
    }
    const MARKER: &str = "\n[Agent Bridge diff preview truncated]";
    if max_bytes <= MARKER.len() {
        return String::new();
    }
    let mut end = max_bytes - MARKER.len();
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &value[..end], MARKER)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, CreateDelegationRun, DelegationRunRegistry,
    };

    fn target() -> ExecutionTargetInput {
        ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: None,
            model_catalog_entry_id: Some("gpt-5.6-sol".to_string()),
            model: Some("gpt-5.6-sol".to_string()),
            reasoning_effort: Some("low".to_string()),
            provider_profile_name_snapshot: Some("Local".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        }
    }

    fn run_with_scope(scope: DelegationExecutionScope) -> DelegationRun {
        DelegationRun {
            id: "run-1".to_string(),
            root_run_id: "run-1".to_string(),
            parent_run_id: None,
            continuation_of_run_id: None,
            retry_of_run_id: None,
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
            target_execution: target(),
            workspace_id: "workspace-1".to_string(),
            task: "Review authentication".to_string(),
            file_refs: vec!["src/auth.rs".to_string(), "  ".to_string()],
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: scope,
            status: DelegationRunStatus::Queued,
            dispatch_binding: None,
            result: None,
            error: None,
            created_at_ms: 1,
            started_at_ms: None,
            completed_at_ms: None,
        }
    }

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
            target_execution: Some(target()),
            workspace_id: "workspace-1".to_string(),
            task: "review".to_string(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
            parent_run_id: None,
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
    fn result_diff_truncation_preserves_utf8_boundary_and_budget() {
        let preview = truncate_result_diff(&"甲".repeat(40), 64);

        assert!(preview.len() <= 64);
        assert!(preview.is_char_boundary(preview.len()));
        assert!(preview.contains("diff preview truncated"));
        assert_eq!(truncate_result_diff("small", 24), "small");
        assert!(truncate_result_diff("large", 1).is_empty());
    }

    #[test]
    fn scope_maps_to_existing_squad_permission_contract() {
        assert_eq!(
            permission_class(
                DelegationExecutionScope::Observe,
                "workspace-1",
                "workspace-1"
            )
            .expect("observe"),
            "read-only"
        );
        assert_eq!(
            permission_class(
                DelegationExecutionScope::SharedWorkspace,
                "workspace-1",
                "workspace-1"
            )
            .expect("shared"),
            "current-workspace"
        );
        assert_eq!(
            permission_class(
                DelegationExecutionScope::IsolatedWorktree,
                "workspace-1",
                "workspace-isolated"
            )
            .expect("isolated provisioned"),
            "current-workspace"
        );
        assert!(permission_class(
            DelegationExecutionScope::IsolatedWorktree,
            "workspace-1",
            "workspace-1"
        )
        .is_err());
    }

    #[test]
    fn continuation_lane_reuses_original_backing_and_binding_owner() {
        let registry = DelegationRunRegistry::new(Default::default());
        let root = registry.create(request()).expect("create root");
        registry.claim_dispatch(&root.id).expect("claim root");
        registry
            .set_dispatch_binding(
                &root.id,
                DelegationDispatchBinding {
                    backing_thread_id: "shared:backing".to_string(),
                    attempt_id: "attempt-1".to_string(),
                    logical_turn_id: "turn-1".to_string(),
                    binding_key: format!("squad:{}:delegate:codex:default", root.id),
                    runtime_workspace_id: Some("workspace-1".to_string()),
                    native_session_id: Some("native-1".to_string()),
                    runtime_turn_id: Some("runtime-1".to_string()),
                    context_transfer: None,
                },
            )
            .expect("bind root");
        registry
            .settle_completed(
                &root.id,
                DelegationResult {
                    summary: Some("done".to_string()),
                    changed_files: Vec::new(),
                    branch: None,
                    diff: None,
                    artifact_path: None,
                },
            )
            .expect("complete root");
        let continuation = registry
            .create_continuation(&root.id, "follow up".to_string())
            .expect("continue");
        let service = AgentBridgeService::new(registry);

        let lane = resolve_continuation_lane(&service, &continuation).expect("resolve lane");

        assert_eq!(lane.backing_thread_id, "shared:backing");
        assert_eq!(lane.binding_owner_run_id, root.id);
    }

    #[tokio::test]
    async fn reattributes_engine_event_to_delegated_run_without_looping() {
        let bus = AgentEventBus::new();
        let mut sink = bus.subscribe(8);
        let source_event = EngineEvent::TextDelta {
            workspace_id: "workspace-1".to_string(),
            text: "hello".to_string(),
        };
        let source = MossxAgentEvent {
            schema_version: "1.0".to_string(),
            event_id: "source-1".to_string(),
            sequence: 1,
            timestamp_ms: 1,
            engine: EngineType::Codex,
            workspace_id: "workspace-1".to_string(),
            logical_session_id: "shared:backing".to_string(),
            native_session_id: Some("native-1".to_string()),
            run_id: "native-turn-1".to_string(),
            turn_id: Some("native-turn-1".to_string()),
            item_id: None,
            kind: "message.delta".to_string(),
            lane: crate::engine::agent_event_bus::AgentEventLane::Delta,
            payload: serde_json::to_value(source_event).expect("serialize event"),
            provenance: crate::engine::agent_event_bus::AgentEventProvenance {
                source: "test".to_string(),
                raw_event_type: "message.delta".to_string(),
            },
        };

        reattribute_bridge_event(
            &bus,
            &source,
            "shared:backing",
            "delegation-1",
            EngineType::Codex,
        )
        .expect("reattribute");

        let attributed = sink.recv().await.expect("attributed event");
        assert_eq!(attributed.run_id, "delegation-1");
        assert_eq!(attributed.logical_session_id, "shared:backing");
    }
}
