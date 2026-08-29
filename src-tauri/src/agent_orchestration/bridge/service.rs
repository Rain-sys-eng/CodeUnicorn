use crate::engine::adapter_registry::engine_id;
use crate::engine::{
    engine_enabled_in_settings, EngineManager, EngineStatus, EngineType,
};
use crate::shared_event_log::canonical::types::CanonicalProviderProfileSource;
use crate::shared_session_v2::{validate_resolved_execution_target, ExecutionTargetInput};
use crate::types::AppSettings;

use super::models::{
    CreateDelegationRun, DelegationDispatchBinding, DelegationResult, DelegationRun,
    DelegationRunStatus,
};
use super::run_registry::DelegationRunRegistry;

const BUILTIN_ENGINES: [EngineType; 9] = [
    EngineType::Claude,
    EngineType::Codex,
    EngineType::Gemini,
    EngineType::Grok,
    EngineType::OpenCode,
    EngineType::Kimi,
    EngineType::Pi,
    EngineType::Dsh,
    EngineType::Qoder,
];

/// Logical Agent-to-Agent delegation control plane.
///
/// The service owns delegated run facts only. Native process/session ownership stays
/// in the existing engine/runtime layer.
pub struct AgentBridgeService {
    runs: DelegationRunRegistry,
}

impl AgentBridgeService {
    pub fn new(runs: DelegationRunRegistry) -> Self {
        Self { runs }
    }

    pub async fn create_run(
        &self,
        mut request: CreateDelegationRun,
        engine_manager: &EngineManager,
        settings: &AppSettings,
    ) -> Result<DelegationRun, String> {
        request.validate()?;

        let source_engine = resolve_builtin_engine(&request.source.engine_id).ok_or_else(|| {
            format!(
                "source engine is not registered for Agent Bridge: {}",
                request.source.engine_id
            )
        })?;
        let target_engine = resolve_builtin_engine(&request.target.engine_id).ok_or_else(|| {
            format!(
                "target engine is not registered for Agent Bridge: {}",
                request.target.engine_id
            )
        })?;

        ensure_engine_enabled(settings, source_engine, "source")?;
        ensure_engine_enabled(settings, target_engine, "target")?;
        ensure_delegated_dispatch_supported(target_engine)?;
        let target_status = ensure_target_available(engine_manager, settings, target_engine).await?;

        // Persist only canonical registry ids so lineage comparisons are deterministic.
        request.source.engine_id = engine_id(source_engine).to_string();
        request.target.engine_id = engine_id(target_engine).to_string();
        request.target_execution = Some(resolve_target_execution(
            request.target_execution.take(),
            target_engine,
            &target_status,
        )?);
        self.validate_parent_lineage(&request)?;
        self.runs.create(request)
    }

    pub fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
        self.runs.get(run_id)
    }

    pub fn list_runs(&self) -> Result<Vec<DelegationRun>, String> {
        self.runs.list()
    }

    pub(crate) fn claim_dispatch(&self, run_id: &str) -> Result<DelegationRun, String> {
        self.runs.claim_dispatch(run_id)
    }

    pub(crate) fn set_dispatch_binding(
        &self,
        run_id: &str,
        binding: DelegationDispatchBinding,
    ) -> Result<DelegationRun, String> {
        self.runs.set_dispatch_binding(run_id, binding)
    }

    pub(crate) fn record_runtime_ack(
        &self,
        run_id: &str,
        attempt_id: &str,
        native_session_id: &str,
        runtime_turn_id: &str,
    ) -> Result<DelegationRun, String> {
        self.runs.record_runtime_ack(
            run_id,
            attempt_id,
            native_session_id,
            runtime_turn_id,
        )
    }

    pub fn transition(
        &self,
        run_id: &str,
        next_status: DelegationRunStatus,
    ) -> Result<DelegationRun, String> {
        self.runs.transition(run_id, next_status)
    }

    pub fn settle_completed(
        &self,
        run_id: &str,
        result: DelegationResult,
    ) -> Result<DelegationRun, String> {
        self.runs.settle_completed(run_id, result)
    }

    pub fn settle_failed(&self, run_id: &str, error: String) -> Result<DelegationRun, String> {
        self.runs.settle_failed(run_id, error)
    }

    pub fn cancel(&self, run_id: &str) -> Result<DelegationRun, String> {
        self.runs.cancel(run_id)
    }

    fn validate_parent_lineage(&self, request: &CreateDelegationRun) -> Result<(), String> {
        let Some(parent_run_id) = request.parent_run_id.as_deref() else {
            return Ok(());
        };
        let parent = self
            .runs
            .get(parent_run_id)?
            .ok_or_else(|| format!("parent delegated run not found: {parent_run_id}"))?;
        if parent.workspace_id != request.workspace_id {
            return Err(format!(
                "delegated child workspace does not match parent {parent_run_id}"
            ));
        }
        if parent.target.engine_id != request.source.engine_id {
            return Err(format!(
                "delegated child source must match parent target for {parent_run_id}: expected {}, got {}",
                parent.target.engine_id, request.source.engine_id
            ));
        }
        Ok(())
    }
}

impl Default for AgentBridgeService {
    fn default() -> Self {
        Self::new(DelegationRunRegistry::default())
    }
}

fn resolve_builtin_engine(value: &str) -> Option<EngineType> {
    let normalized = value.trim().to_ascii_lowercase();
    BUILTIN_ENGINES
        .into_iter()
        .find(|engine| engine_id(*engine) == normalized)
}

fn ensure_engine_enabled(
    settings: &AppSettings,
    engine: EngineType,
    role: &str,
) -> Result<(), String> {
    if engine_enabled_in_settings(settings, engine) {
        return Ok(());
    }
    Err(format!(
        "{role} engine is disabled for Agent Bridge: {}",
        engine_id(engine)
    ))
}

fn ensure_delegated_dispatch_supported(engine: EngineType) -> Result<(), String> {
    if matches!(
        engine,
        EngineType::Claude
            | EngineType::Codex
            | EngineType::Kimi
            | EngineType::Grok
            | EngineType::OpenCode
            | EngineType::Pi
            | EngineType::Qoder
    ) {
        return Ok(());
    }
    Err(format!(
        "target engine is not supported by the current delegated Shared V2 dispatcher: {}",
        engine_id(engine)
    ))
}

async fn ensure_target_available(
    engine_manager: &EngineManager,
    settings: &AppSettings,
    target_engine: EngineType,
) -> Result<EngineStatus, String> {
    if let Some(status) = engine_manager.get_engine_status(target_engine).await {
        if status.installed {
            return Ok(status);
        }
    }

    let gemini_enabled = engine_enabled_in_settings(settings, EngineType::Gemini);
    let status = engine_manager
        .refresh_engine_status_with_gates(target_engine, gemini_enabled)
        .await;
    if status.installed {
        return Ok(status);
    }

    let detail = status
        .error
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("CLI is not installed or not reachable");
    Err(format!(
        "target engine is unavailable for Agent Bridge ({}): {detail}",
        engine_id(target_engine)
    ))
}

fn resolve_target_execution(
    requested: Option<ExecutionTargetInput>,
    target_engine: EngineType,
    status: &EngineStatus,
) -> Result<ExecutionTargetInput, String> {
    let target = match requested {
        Some(target) => {
            if target.engine != target_engine {
                return Err(format!(
                    "delegated target execution engine mismatch: endpoint={}, execution={}",
                    engine_id(target_engine),
                    engine_id(target.engine)
                ));
            }
            target
        }
        None => default_local_execution_target(target_engine, status)?,
    };
    validate_resolved_execution_target(&target)
        .map_err(|error| format!("delegated target is not executable: {error}"))?;
    Ok(target)
}

fn default_local_execution_target(
    engine: EngineType,
    status: &EngineStatus,
) -> Result<ExecutionTargetInput, String> {
    let preferred = status.default_model.as_deref();
    let model = preferred
        .and_then(|preferred| {
            status.models.iter().find(|model| {
                model.id == preferred
                    || (!model.model.trim().is_empty() && model.model == preferred)
            })
        })
        .or_else(|| status.models.iter().find(|model| model.default))
        .or_else(|| status.models.first());

    let (catalog_id, runtime_model, reasoning_effort) = if let Some(model) = model {
        let runtime_model = if model.model.trim().is_empty() {
            model.id.clone()
        } else {
            model.model.clone()
        };
        (
            model.id.clone(),
            runtime_model,
            model.default_reasoning_effort.clone(),
        )
    } else if let Some(preferred) = preferred.map(str::trim).filter(|value| !value.is_empty()) {
        (preferred.to_string(), preferred.to_string(), None)
    } else {
        return Err(format!(
            "target engine has no resolvable default model for Agent Bridge: {}",
            engine_id(engine)
        ));
    };

    Ok(ExecutionTargetInput {
        engine,
        provider_profile_id: None,
        model_catalog_entry_id: Some(catalog_id),
        model: Some(runtime_model),
        reasoning_effort,
        provider_profile_name_snapshot: Some("Local".to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Local),
        runtime_capability_fingerprint: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, DelegationContextPolicy, DelegationExecutionScope,
    };
    use crate::engine::ModelInfo;

    fn request(source_engine_id: &str, target_engine_id: &str) -> CreateDelegationRun {
        CreateDelegationRun {
            source: AgentEndpoint {
                engine_id: source_engine_id.to_string(),
                logical_session_id: Some("source-session".to_string()),
                native_session_id: None,
            },
            target: AgentEndpoint {
                engine_id: target_engine_id.to_string(),
                logical_session_id: None,
                native_session_id: None,
            },
            target_execution: None,
            workspace_id: "workspace-1".to_string(),
            task: "review authentication".to_string(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
            parent_run_id: None,
        }
    }

    async fn cache_installed(manager: &EngineManager, engine: EngineType) {
        let mut status = crate::engine::disabled_engine_status(engine);
        status.installed = true;
        status.error = None;
        if engine == EngineType::Codex {
            status.models = vec![
                ModelInfo::new("gpt-5.3-codex-spark", "gpt-5.3-codex-spark").as_default(),
            ];
            status.default_model = Some("gpt-5.3-codex-spark".to_string());
        }
        manager.cache_engine_status(status).await;
    }

    #[tokio::test]
    async fn create_run_rejects_unknown_target_before_registry_mutation() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        let error = service
            .create_run(
                request("claude", "unknown-engine"),
                &manager,
                &AppSettings::default(),
            )
            .await
            .expect_err("unknown target must fail");

        assert!(error.contains("target engine is not registered"));
        assert!(service.list_runs().expect("list runs").is_empty());
    }

    #[tokio::test]
    async fn create_run_accepts_cached_installed_target_and_freezes_execution_snapshot() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        cache_installed(&manager, EngineType::Codex).await;

        let run = service
            .create_run(
                request("CLAUDE", "CODEX"),
                &manager,
                &AppSettings::default(),
            )
            .await
            .expect("cached installed target should be accepted");

        assert_eq!(run.source.engine_id, "claude");
        assert_eq!(run.target.engine_id, "codex");
        assert_eq!(run.target_execution.engine, EngineType::Codex);
        assert_eq!(
            run.target_execution.model.as_deref(),
            Some("gpt-5.3-codex-spark")
        );
        assert_eq!(run.status, DelegationRunStatus::Queued);
    }

    #[tokio::test]
    async fn child_source_must_match_parent_target() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        cache_installed(&manager, EngineType::Codex).await;

        let parent = service
            .create_run(
                request("claude", "codex"),
                &manager,
                &AppSettings::default(),
            )
            .await
            .expect("create parent");
        let mut child = request("pi", "codex");
        child.parent_run_id = Some(parent.id.clone());
        let error = service
            .create_run(child, &manager, &AppSettings::default())
            .await
            .expect_err("unrelated source must not attach to parent");

        assert!(error.contains("source must match parent target"));
    }

    #[tokio::test]
    async fn disabled_engine_is_rejected_without_creating_a_run() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        let error = service
            .create_run(
                request("claude", "gemini"),
                &manager,
                &AppSettings::default(),
            )
            .await
            .expect_err("disabled engine must fail closed");

        assert!(error.contains("disabled for Agent Bridge"));
        assert!(service.list_runs().expect("list runs").is_empty());
    }

    #[tokio::test]
    async fn unsupported_shared_dispatch_target_fails_before_run_creation() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        let error = service
            .create_run(
                request("claude", "dsh"),
                &manager,
                &AppSettings::default(),
            )
            .await
            .expect_err("DSH is not yet on Shared V2 dispatcher");

        assert!(error.contains("current delegated Shared V2 dispatcher"));
        assert!(service.list_runs().expect("list runs").is_empty());
    }
}
