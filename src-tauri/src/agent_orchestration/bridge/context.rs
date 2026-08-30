use std::collections::HashSet;
use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::native_history::{NativeHistoryEngine, NativeHistorySource};
use crate::shared_context::{
    compile_context_including_squad_attempts, compile_native_context,
    compile_portable_context, read_artifact, ArtifactReadRequest, CompileContextRequest,
    CompileNativeContextRequest, CompilePortableContextRequest, ContextPackage,
    ContextPackageSource, PortableContextEntry, ProjectionOmission,
};
use crate::shared_session_v2::{
    context_capabilities, require_shared_session_workspace_owner, ExecutionTargetInput,
};
use crate::shared_sessions::parse_shared_session_id;
use crate::state::AppState;

use super::models::{DelegationContextPolicy, DelegationRun};
use super::service::AgentBridgeService;

pub(crate) async fn compile_delegation_context(
    service: &AgentBridgeService,
    run: &DelegationRun,
    binding_key: &str,
    backing_thread_id: &str,
    attempt_id: &str,
    app: &AppHandle,
) -> Result<Option<ContextPackage>, String> {
    if run.context_policy == DelegationContextPolicy::Explicit
        || run.continuation_of_run_id.is_some()
    {
        return Ok(None);
    }

    let immediate = compile_immediate_source(service, run, binding_key, app).await?;
    if immediate.delta.is_empty() {
        let categories = immediate
            .manifest
            .omitted
            .iter()
            .map(|omission| omission.category.as_str())
            .collect::<Vec<_>>()
            .join(",");
        return Err(format!(
            "delegated context source has no transferable entries (packageId={}, omissions={})",
            immediate.package_id, categories
        ));
    }
    let mut packages = Vec::new();
    let mut inherited_package_ids = Vec::new();
    if run.context_policy == DelegationContextPolicy::Inherited {
        if let Some(parent_run_id) = run.parent_run_id.as_deref() {
            let parent = service
                .get_run(parent_run_id)?
                .ok_or_else(|| format!("delegated context parent not found: {parent_run_id}"))?;
            if let Some(package) = read_parent_context_package(service, run, &parent, app)? {
                inherited_package_ids.push(package.package_id.clone());
                packages.push((format!("parent:{parent_run_id}"), package));
            }
        }
    }
    packages.push((format!("source:{}", run.id), immediate));

    let mut entries = Vec::new();
    let mut omissions = Vec::new();
    let mut source_session_ids = Vec::new();
    for (namespace, package) in packages {
        source_session_ids.push(package.session_id.clone());
        append_namespaced_package(
            &namespace,
            package.delta,
            package.manifest.omitted,
            &mut entries,
            &mut omissions,
        );
    }
    source_session_ids.sort();
    source_session_ids.dedup();

    let destination = target_destination(&run.target_execution)?;
    let (delivery_session_id, delivery_cursor) =
        delivery_cursor(backing_thread_id, attempt_id, app)?;
    let package = compile_portable_context(&CompilePortableContextRequest {
        session_id: delivery_session_id,
        binding_key: binding_key.to_string(),
        destination,
        source: ContextPackageSource::DelegationPortable {
            run_id: run.id.clone(),
            context_policy: context_policy_name(run.context_policy).to_string(),
            source_session_ids,
            inherited_package_ids,
        },
        entries,
        omissions,
        capabilities: context_capabilities(&run.target_execution),
        budget_estimated_tokens: None,
        scope: Some(json!({
            "kind": "agent-bridge-context",
            "runId": run.id.clone(),
            "rootRunId": run.root_run_id.clone(),
            "parentRunId": run.parent_run_id.clone(),
            "policy": context_policy_name(run.context_policy),
        })),
        through_sequence_inclusive: delivery_cursor,
    })?;
    ensure_context_needs_no_confirmation(&package)?;
    Ok(Some(package))
}

async fn compile_immediate_source(
    service: &AgentBridgeService,
    run: &DelegationRun,
    binding_key: &str,
    app: &AppHandle,
) -> Result<ContextPackage, String> {
    if let Some(parent_run_id) = run.parent_run_id.as_deref() {
        let parent = service
            .get_run(parent_run_id)?
            .ok_or_else(|| format!("delegated context parent not found: {parent_run_id}"))?;
        if parent.workspace_id != run.workspace_id
            || parent.target.engine_id != run.source.engine_id
            || parent
                .target
                .native_session_id
                .as_deref()
                .zip(run.source.native_session_id.as_deref())
                .is_some_and(|(parent_native, source_native)| parent_native != source_native)
        {
            return Err(format!(
                "delegated context source does not own parent runtime: {parent_run_id}"
            ));
        }
        let binding = parent.dispatch_binding.as_ref().ok_or_else(|| {
            format!("delegated context parent has no dispatch binding: {parent_run_id}")
        })?;
        let shared_session_id = parse_shared_session_id(&binding.backing_thread_id)?;
        return compile_shared_source(run, binding_key, &shared_session_id, app);
    }
    if let Some(logical_session_id) = run.source.logical_session_id.as_deref() {
        if let Ok(shared_session_id) = parse_shared_session_id(logical_session_id) {
            return compile_shared_source(run, binding_key, &shared_session_id, app);
        }
    }
    compile_native_source(run, binding_key, app).await
}

fn compile_shared_source(
    run: &DelegationRun,
    binding_key: &str,
    shared_session_id: &str,
    app: &AppHandle,
) -> Result<ContextPackage, String> {
    require_shared_session_workspace_owner(&run.workspace_id, shared_session_id)?;
    let state = app.state::<AppState>();
    let writer = state
        .shared_event_writer
        .as_ref()
        .ok_or_else(|| "shared event log unavailable for delegated context".to_string())?;
    let events = writer
        .events_for_session(shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|event| {
            if event.fact_type != "conversation.controlFact" {
                return true;
            }
            serde_json::from_str::<Value>(&event.payload_json)
                .ok()
                .and_then(|payload| {
                    payload
                        .get("controlKind")
                        .or_else(|| payload.get("control_kind"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .as_deref()
                != Some(super::presentation::BRIDGE_INTERNAL_BACKING_CONTROL_KIND)
        })
        .collect::<Vec<_>>();
    compile_context_including_squad_attempts(
        &events,
        &CompileContextRequest {
            session_id: shared_session_id.to_string(),
            binding_key: binding_key.to_string(),
            destination: target_destination(&run.target_execution)?,
            destination_native_session_id: None,
            from_sequence_exclusive: None,
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: context_capabilities(&run.target_execution),
            budget_estimated_tokens: None,
        },
    )
}

async fn compile_native_source(
    run: &DelegationRun,
    binding_key: &str,
    app: &AppHandle,
) -> Result<ContextPackage, String> {
    let native_session_id = run
        .source
        .native_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "delegated {:?} context requires a trusted source native session identity",
                run.context_policy
            )
        })?;
    let engine = match run.source.engine_id.as_str() {
        "claude" => NativeHistoryEngine::Claude,
        "codex" => NativeHistoryEngine::Codex,
        "kimi" => NativeHistoryEngine::Kimi,
        engine => {
            return Err(format!(
                "delegated {:?} context has no existing native history reader for source engine {engine}",
                run.context_policy
            ));
        }
    };
    let source_session_id = format!("{}:{native_session_id}", run.source.engine_id);
    let state = app.state::<AppState>();
    let provider_profile_id = if engine == NativeHistoryEngine::Claude {
        None
    } else {
        source_provider_profile_id(&state, run, &source_session_id)?
    };
    if engine == NativeHistoryEngine::Codex && provider_profile_id.is_none() {
        return Err(
            "delegated Codex context requires authoritative source provider identity".to_string(),
        );
    }
    let source = NativeHistorySource {
        session_id: source_session_id.clone(),
        native_session_id: native_session_id.to_string(),
        engine,
        provider_profile_id,
    };
    let history = crate::native_continuation::commands::read_native_history_for_context(
        &state,
        &run.workspace_id,
        &source,
    )
    .await?;
    compile_native_context(&CompileNativeContextRequest {
        session_id: source_session_id,
        binding_key: binding_key.to_string(),
        destination: target_destination(&run.target_execution)?,
        source,
        history,
        capabilities: context_capabilities(&run.target_execution),
        budget_estimated_tokens: None,
    })
}

fn source_provider_profile_id(
    state: &AppState,
    run: &DelegationRun,
    source_session_id: &str,
) -> Result<Option<String>, String> {
    if let Some(parent_run_id) = run.parent_run_id.as_deref() {
        let parent = state
            .agent_bridge
            .get_run(parent_run_id)?
            .ok_or_else(|| format!("delegated context parent not found: {parent_run_id}"))?;
        return Ok(parent.target_execution.normalized_provider());
    }
    crate::session_management::provider_profile_id_for_session_at_path(
        state.storage_path.as_path(),
        &run.workspace_id,
        source_session_id,
        &run.source.engine_id,
    )
}

fn read_parent_context_package(
    service: &AgentBridgeService,
    child: &DelegationRun,
    parent: &DelegationRun,
    app: &AppHandle,
) -> Result<Option<ContextPackage>, String> {
    if parent.workspace_id != child.workspace_id
        || parent.target.engine_id != child.source.engine_id
    {
        return Err(format!(
            "delegated inherited context ownership mismatch: {} -> {}",
            child.id, parent.id
        ));
    }
    let mut owner = parent.clone();
    let mut seen = HashSet::new();
    let (binding, transfer) = loop {
        if !seen.insert(owner.id.clone()) {
            return Err(format!(
                "delegated inherited context continuation cycle: {}",
                parent.id
            ));
        }
        let binding = owner.dispatch_binding.as_ref().ok_or_else(|| {
            format!(
                "delegated inherited context owner has no dispatch binding: {}",
                owner.id
            )
        })?;
        if let Some(transfer) = binding.context_transfer.as_ref() {
            break (binding.clone(), transfer.clone());
        }
        let Some(previous_run_id) = owner.continuation_of_run_id.clone() else {
            return Ok(None);
        };
        owner = service
            .get_run(&previous_run_id)?
            .ok_or_else(|| format!("delegated context continuation missing: {previous_run_id}"))?;
        if owner.workspace_id != child.workspace_id
            || owner.target.engine_id != parent.target.engine_id
        {
            return Err(format!(
                "delegated inherited context continuation ownership mismatch: {}",
                owner.id
            ));
        }
    };
    let shared_session_id = parse_shared_session_id(&binding.backing_thread_id)?;
    require_shared_session_workspace_owner(&child.workspace_id, &shared_session_id)?;
    let state = app.state::<AppState>();
    let package = read_artifact(
        context_artifact_root(&state)?,
        &ArtifactReadRequest {
            workspace_id: child.workspace_id.clone(),
            session_id: shared_session_id,
            artifact_id: transfer.artifact_id.clone(),
            checksum: transfer.artifact_checksum.clone(),
        },
    )
    .map(|record| record.package)
    .map_err(|error| format!("delegated inherited context artifact: {error}"))?;
    if package.package_id != transfer.package_id
        || package.manifest.source_checksum != transfer.source_checksum
    {
        return Err(format!(
            "delegated inherited context evidence mismatch for parent {}",
            parent.id
        ));
    }
    Ok(Some(package))
}

fn append_namespaced_package(
    namespace: &str,
    entries: Vec<PortableContextEntry>,
    omissions: Vec<ProjectionOmission>,
    output_entries: &mut Vec<PortableContextEntry>,
    output_omissions: &mut Vec<ProjectionOmission>,
) {
    let entry_ids = entries
        .iter()
        .map(|entry| entry.entry_id.clone())
        .collect::<HashSet<_>>();
    let sequence_offset = output_entries.len();
    output_entries.extend(entries.into_iter().enumerate().map(|(index, mut entry)| {
        entry.entry_id = format!("{namespace}:{}", entry.entry_id);
        entry.sequence = (sequence_offset + index + 1) as i64;
        entry
    }));
    output_omissions.extend(omissions.into_iter().map(|mut omission| {
        if entry_ids.contains(&omission.entry_id) {
            omission.entry_id = format!("{namespace}:{}", omission.entry_id);
        } else {
            omission.entry_id = format!("{namespace}:omitted:{}", omission.entry_id);
        }
        omission
    }));
}

fn ensure_context_needs_no_confirmation(package: &ContextPackage) -> Result<(), String> {
    let mut categories = package
        .manifest
        .omitted
        .iter()
        .filter(|omission| omission.requires_confirmation())
        .map(|omission| omission.category.clone())
        .collect::<Vec<_>>();
    categories.sort();
    categories.dedup();
    if !categories.is_empty() {
        return Err(format!(
            "delegated context requires explicit confirmation before dispatch (packageId={}, omissions={})",
            package.package_id,
            categories.join(",")
        ));
    }
    if package.prompt_prefix.trim().is_empty() {
        return Err(format!(
            "delegated context package has no user-channel payload: {}",
            package.package_id
        ));
    }
    Ok(())
}

fn target_destination(target: &ExecutionTargetInput) -> Result<Value, String> {
    serde_json::to_value(target.to_snapshot()).map_err(|error| error.to_string())
}

fn context_policy_name(policy: DelegationContextPolicy) -> &'static str {
    match policy {
        DelegationContextPolicy::Explicit => "explicit",
        DelegationContextPolicy::Portable => "portable",
        DelegationContextPolicy::Inherited => "inherited",
    }
}

fn delivery_cursor(
    backing_thread_id: &str,
    attempt_id: &str,
    app: &AppHandle,
) -> Result<(String, i64), String> {
    let shared_session_id = parse_shared_session_id(backing_thread_id)?;
    let state = app.state::<AppState>();
    let writer = state
        .shared_event_writer
        .as_ref()
        .ok_or_else(|| "shared event log unavailable for delegated context cursor".to_string())?;
    let cursor = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnRequested"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .map(|event| event.sequence.saturating_sub(1))
        .ok_or_else(|| {
            format!("delegated context turnRequested missing for attempt {attempt_id}")
        })?;
    Ok((shared_session_id, cursor))
}

fn context_artifact_root(state: &AppState) -> Result<&Path, String> {
    state
        .storage_path
        .parent()
        .ok_or_else(|| "app data directory unavailable for delegated context".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_context::{OmissionDisposition, RuntimeContextCapabilities};

    fn portable_package() -> ContextPackage {
        compile_portable_context(&CompilePortableContextRequest {
            session_id: "source-session".to_string(),
            binding_key: "binding".to_string(),
            destination: json!({"engine": "codex"}),
            source: ContextPackageSource::DelegationPortable {
                run_id: "run-1".to_string(),
                context_policy: "portable".to_string(),
                source_session_ids: vec!["source-session".to_string()],
                inherited_package_ids: Vec::new(),
            },
            entries: vec![PortableContextEntry {
                entry_id: "entry-1".to_string(),
                sequence: 1,
                role: "user".to_string(),
                blocks: vec![json!({"kind": "text", "text": "source task"})],
                outcome: None,
            }],
            omissions: Vec::new(),
            capabilities: RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: false,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: false,
                image_history: false,
                strong_context_ack: false,
            },
            budget_estimated_tokens: None,
            scope: None,
            through_sequence_inclusive: 0,
        })
        .expect("portable package")
    }

    #[test]
    fn inherited_packages_receive_collision_safe_namespaces() {
        let mut entries = Vec::new();
        let mut omissions = Vec::new();
        append_namespaced_package(
            "parent:run-1",
            vec![PortableContextEntry {
                entry_id: "entry-1".to_string(),
                sequence: 99,
                role: "user".to_string(),
                blocks: vec![json!({"kind": "text", "text": "parent"})],
                outcome: None,
            }],
            vec![ProjectionOmission {
                entry_id: "entry-1".to_string(),
                category: "image".to_string(),
                reason: "unsupported".to_string(),
                disposition: OmissionDisposition::RetrievableOnDemand,
                retrievable_ref: Some("artifact-1".to_string()),
            }],
            &mut entries,
            &mut omissions,
        );

        assert_eq!(entries[0].entry_id, "parent:run-1:entry-1");
        assert_eq!(entries[0].sequence, 1);
        assert_eq!(omissions[0].entry_id, "parent:run-1:entry-1");
    }

    #[test]
    fn delegated_omissions_require_confirmation_before_dispatch() {
        let mut package = portable_package();
        package.manifest.omitted.push(ProjectionOmission {
            entry_id: "entry-1".to_string(),
            category: "provider-private-reasoning".to_string(),
            reason: "not portable".to_string(),
            disposition: OmissionDisposition::NotRetrievable,
            retrievable_ref: None,
        });

        let error = ensure_context_needs_no_confirmation(&package)
            .expect_err("unconfirmed omission must fail closed");
        assert!(error.contains(&package.package_id));
        assert!(error.contains("provider-private-reasoning"));
    }
}
