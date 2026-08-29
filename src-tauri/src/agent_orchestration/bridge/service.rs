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
        self.validate_parent_lineage(&request)?;
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
    async fn create_run_accepts_cached_installed_target_and_canonicalizes_ids() {
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
        assert_eq!(run.status, DelegationRunStatus::Queued);
    }

    #[tokio::test]
    async fn child_source_must_match_parent_target() {
        let service = AgentBridgeService::default();
        let manager = EngineManager::new();
        cache_installed(&manager, EngineType::Codex).await;
        cache_installed(&manager, EngineType::Pi).await;

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
}
