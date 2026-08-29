use crate::engine::adapter_registry::engine_id;
use crate::engine::{engine_enabled_in_settings, EngineManager, EngineType};
use crate::types::AppSettings;

use super::models::{CreateDelegationRun, DelegationResult, DelegationRun, DelegationRunStatus};
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
        ensure_target_available(engine_manager, settings, target_engine).await?;

        // Persist only canonical registry ids so lineage comparisons are deterministic.
        request.source.engine_id = engine_id(source_engine).to_string();
        request.target.engine_id = engine_id(target_engine).to_string();
        self.runs.create(request)
    }

    pub fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
        self.runs.get(run_id)
    }

    pub fn list_runs(&self) -> Result<Vec<DelegationRun>, String> {
        self.runs.list()
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

async fn ensure_target_available(
    engine_manager: &EngineManager,
    settings: &AppSettings,
    target_engine: EngineType,
) -> Result<(), String> {
    if engine_manager
        .get_engine_status(target_engine)
        .await
        .is_some_and(|status| status.installed)
    {
        return Ok(());
    }

    let gemini_enabled = engine_enabled_in_settings(settings, EngineType::Gemini);
    let status = engine_manager
        .refresh_engine_status_with_gates(target_engine, gemini_enabled)
        .await;
    if status.installed {
        return Ok(());
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_orchestration::bridge::{
        AgentEndpoint, DelegationContextPolicy, DelegationExecutionScope,
    };

    fn request(target_engine_id: &str) -> CreateDelegationRun {
        CreateDelegationRun {
            source: AgentEndpoint {
                engine_id: "claude".to_string(),
                logical_session_id: Some("source-session".to_string()),
                native_session_id: None,
            },
            target: AgentEndpoint {
                engine_id: target_engine_id.to_string(),
                logical_session_id: None,
                native_session_id: None,
            },
            workspace_id: "workspace-1".to_string(),
            task: "review authentication".to_string(),
            file_refs: Vec::new(),
            context_policy: DelegationContextPolicy::Explicit,
            execution_scope: DelegationExecutionScope::Observe,
            parent_run_id: None,
        }
    }

    #[tokio::test]
    async fn create_run_rejects_unknown_target_before_registry_mutation() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        let error = service
            .create_run(request("unknown-engine"), &manager, &AppSettings::default())
            .await
            .expect_err("unknown target must fail");

        assert!(error.contains("target engine is not registered"));
        assert!(service.list_runs().expect("list runs").is_empty());
    }

    #[tokio::test]
    async fn create_run_accepts_cached_installed_target_and_canonicalizes_ids() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        let mut status = crate::engine::disabled_engine_status(EngineType::Codex);
        status.installed = true;
        status.error = None;
        manager.cache_engine_status(status).await;

        let run = service
            .create_run(request("CODEX"), &manager, &AppSettings::default())
            .await
            .expect("cached installed target should be accepted");

        assert_eq!(run.source.engine_id, "claude");
        assert_eq!(run.target.engine_id, "codex");
        assert_eq!(run.status, DelegationRunStatus::Queued);
    }

    #[tokio::test]
    async fn disabled_engine_is_rejected_without_creating_a_run() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        let error = service
            .create_run(request("gemini"), &manager, &AppSettings::default())
            .await
            .expect_err("disabled engine must fail closed");

        assert!(error.contains("disabled for Agent Bridge"));
        assert!(service.list_runs().expect("list runs").is_empty());
    }
}
