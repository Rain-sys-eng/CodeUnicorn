use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::engine::claude::ClaudeSessionManager;
use crate::engine::EngineManager;

use super::models::AgentEndpoint;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedMcpSource {
    pub endpoint: AgentEndpoint,
    pub runtime_turn_id: String,
}

/// Transport-neutral, already-authenticated runtime identity supplied by a CodeUnicorn-managed
/// MCP ingress. Individual engine transports must prove these values from their live runtime;
/// the model/tool arguments must never be allowed to populate this structure directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrustedMcpRuntimeBinding {
    pub engine_id: String,
    pub logical_session_id: String,
    pub native_session_id: Option<String>,
    pub runtime_turn_id: String,
}

/// Convert one ingress-authenticated runtime binding into the source identity consumed by the
/// engine-agnostic Bridge MCP gateway.
///
/// Keeping this validation separate from engine-specific lookup logic means Claude, Codex, Kimi,
/// OpenCode and future managed callers can share the exact same fail-closed source contract while
/// retaining their native runtime/session implementations.
pub(crate) fn resolve_trusted_runtime_binding(
    binding: TrustedMcpRuntimeBinding,
) -> Result<ResolvedMcpSource, String> {
    let engine_id = required_identity(binding.engine_id, "engine id")?;
    let logical_session_id = required_identity(binding.logical_session_id, "logical session id")?;
    let runtime_turn_id = required_identity(binding.runtime_turn_id, "runtime turn id")?;
    let native_session_id = binding
        .native_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let endpoint = AgentEndpoint {
        engine_id,
        logical_session_id: Some(logical_session_id),
        native_session_id,
    };
    endpoint.validate("source")?;

    Ok(ResolvedMcpSource {
        endpoint,
        runtime_turn_id,
    })
}

fn required_identity(value: String, label: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(format!("Agent Bridge MCP trusted {label} is required"));
    }
    Ok(value)
}

/// Resolve the trusted source identity for a Bridge call arriving through CodeUnicorn's managed
/// Claude MCP transport.
///
/// `workspace_id` and `runtime_locator` must come from the authenticated MCP route, never from the
/// model's tool arguments. The opaque locator is checked against the live `ClaudeSessionManager`
/// before any Bridge mutation is allowed. Bridge calls additionally require a live Claude turn;
/// this exact runtime turn id is later matched against a delegated run's durable dispatch binding
/// to recover nested parent lineage. The legacy workspace-only MCP route is intentionally rejected
/// because it cannot distinguish provider-scoped runtimes.
pub async fn resolve_claude_mcp_source(
    manager: &ClaudeSessionManager,
    workspace_id: &str,
    runtime_locator: Option<&str>,
) -> Result<ResolvedMcpSource, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("Agent Bridge MCP source workspace is required".to_string());
    }
    let runtime_locator = runtime_locator
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Agent Bridge tools require the runtime-bound MCP endpoint; legacy workspace-only MCP is not authorized"
                .to_string()
        })?;

    let session = manager
        .get_session_by_locator(workspace_id, runtime_locator)
        .await
        .ok_or_else(|| {
            format!("Agent Bridge MCP source runtime is not active for workspace {workspace_id}")
        })?;
    let runtime_turn_id = session.mcp_active_turn_id().ok_or_else(|| {
        format!("Agent Bridge MCP source runtime has no active turn for workspace {workspace_id}")
    })?;

    resolve_trusted_runtime_binding(TrustedMcpRuntimeBinding {
        engine_id: "claude".to_string(),
        // This opaque locator is process-scoped and was minted by CodeUnicorn, not by the model.
        logical_session_id: runtime_locator.to_string(),
        native_session_id: session.get_session_id().await,
        runtime_turn_id,
    })
}

/// Resolve a Codex caller from CodeUnicorn's process-scoped runtime locator and the runtime's
/// authoritative live active-turn table.
///
/// Codex app-server can host multiple threads in one provider-scoped process. Because its MCP HTTP
/// request does not carry a trustworthy thread id, exactly one active `threadId + turnId` owner is
/// required. Zero active turns and concurrent active turns both fail closed; the Bridge never
/// guesses source ownership from workspace, model output or tool arguments.
pub async fn resolve_codex_mcp_source(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: &str,
    runtime_locator: Option<&str>,
) -> Result<ResolvedMcpSource, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("Agent Bridge MCP source workspace is required".to_string());
    }
    let runtime_locator = runtime_locator
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Agent Bridge tools require the Codex runtime-bound MCP endpoint".to_string()
        })?;

    let session = {
        let sessions = sessions.lock().await;
        let mut matches = Vec::<Arc<WorkspaceSession>>::new();
        for session in sessions.values() {
            if session.entry.id == workspace_id
                && session.mcp_runtime_locator() == runtime_locator
                && !matches
                    .iter()
                    .any(|existing| Arc::ptr_eq(existing, session))
            {
                matches.push(Arc::clone(session));
            }
        }
        match matches.as_slice() {
            [] => None,
            [session] => Some(Arc::clone(session)),
            _ => return Err(format!(
                "Agent Bridge MCP Codex runtime locator is ambiguous for workspace {workspace_id}"
            )),
        }
    }
    .ok_or_else(|| {
        format!("Agent Bridge MCP Codex source runtime is not active for workspace {workspace_id}")
    })?;

    let (thread_id, runtime_turn_id) = session.mcp_active_turn_owner().await?.ok_or_else(|| {
        format!(
            "Agent Bridge MCP Codex source runtime has no active turn for workspace {workspace_id}"
        )
    })?;

    resolve_trusted_runtime_binding(TrustedMcpRuntimeBinding {
        engine_id: "codex".to_string(),
        logical_session_id: thread_id.clone(),
        native_session_id: Some(thread_id),
        runtime_turn_id,
    })
}

/// Resolve a Qoder caller from its per-turn ACP MCP descriptor.
///
/// CodeUnicorn creates a fresh opaque locator before spawning each Qoder ACP turn and records it
/// beside the managed child process. The MCP descriptor is delivered in `session/new|resume|fork`
/// over that child's stdin. A caller is authorized only after the same live process has acquired an
/// exact native ACP session id; workspace-only, stale and ambiguous locators all fail closed.
pub async fn resolve_qoder_mcp_source(
    engine_manager: &EngineManager,
    workspace_id: &str,
    runtime_locator: Option<&str>,
) -> Result<ResolvedMcpSource, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("Agent Bridge MCP source workspace is required".to_string());
    }
    let runtime_locator = runtime_locator
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Agent Bridge tools require the Qoder runtime-bound MCP endpoint".to_string()
        })?;

    let mut owners = Vec::new();
    for session in engine_manager.get_qoder_sessions(workspace_id).await {
        if let Some((runtime_turn_id, raw_session_id)) =
            session.mcp_active_turn_owner(runtime_locator).await?
        {
            owners.push((
                session.provider_profile_id(),
                runtime_turn_id,
                raw_session_id,
            ));
        }
    }
    let (provider_profile_id, runtime_turn_id, raw_session_id) = match owners.len() {
        0 => {
            return Err(format!(
                "Agent Bridge MCP Qoder source runtime is not active for workspace {workspace_id}"
            ))
        }
        1 => owners.pop().expect("one Qoder MCP owner"),
        _ => {
            return Err(format!(
                "Agent Bridge MCP Qoder runtime locator is ambiguous for workspace {workspace_id}"
            ))
        }
    };
    let logical_session_id =
        crate::engine::qoder_provider_profile::canonical_qoder_native_session_id(
            &raw_session_id,
            Some(provider_profile_id),
        )?;

    resolve_trusted_runtime_binding(TrustedMcpRuntimeBinding {
        engine_id: "qoder".to_string(),
        logical_session_id,
        native_session_id: Some(raw_session_id),
        runtime_turn_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn trusted_runtime_binding_is_engine_neutral() {
        let source = resolve_trusted_runtime_binding(TrustedMcpRuntimeBinding {
            engine_id: " codex ".to_string(),
            logical_session_id: " runtime:codex:workspace-1 ".to_string(),
            native_session_id: Some(" thread-1 ".to_string()),
            runtime_turn_id: " turn-1 ".to_string(),
        })
        .expect("trusted codex binding");

        assert_eq!(source.endpoint.engine_id, "codex");
        assert_eq!(
            source.endpoint.logical_session_id.as_deref(),
            Some("runtime:codex:workspace-1")
        );
        assert_eq!(
            source.endpoint.native_session_id.as_deref(),
            Some("thread-1")
        );
        assert_eq!(source.runtime_turn_id, "turn-1");
    }

    #[test]
    fn trusted_runtime_binding_rejects_incomplete_identity() {
        let error = resolve_trusted_runtime_binding(TrustedMcpRuntimeBinding {
            engine_id: "codex".to_string(),
            logical_session_id: "runtime-1".to_string(),
            native_session_id: None,
            runtime_turn_id: "   ".to_string(),
        })
        .expect_err("missing live turn must fail closed");
        assert!(error.contains("runtime turn id"));
    }

    #[tokio::test]
    async fn legacy_workspace_only_source_is_rejected() {
        let manager = ClaudeSessionManager::new();
        let error = resolve_claude_mcp_source(&manager, "workspace-1", None)
            .await
            .expect_err("legacy endpoint must not authorize Bridge tools");
        assert!(error.contains("runtime-bound MCP endpoint"));
    }

    #[tokio::test]
    async fn opaque_runtime_locator_must_resolve_to_live_session() {
        let manager = ClaudeSessionManager::new();
        let error =
            resolve_claude_mcp_source(&manager, "workspace-1", Some("attacker-supplied-locator"))
                .await
                .expect_err("unknown locator must fail closed");
        assert!(error.contains("source runtime is not active"));
    }

    #[tokio::test]
    async fn unknown_qoder_runtime_locator_is_rejected() {
        let manager = EngineManager::new();
        let error =
            resolve_qoder_mcp_source(&manager, "workspace-1", Some("attacker-supplied-locator"))
                .await
                .expect_err("unknown Qoder locator must fail closed");
        assert!(error.contains("Qoder source runtime is not active"));
    }

    #[tokio::test]
    async fn live_runtime_without_active_turn_is_rejected() {
        let manager = ClaudeSessionManager::new();
        let workspace_path = PathBuf::from("/tmp/agent-bridge-mcp-source-idle");
        let session = manager
            .get_or_create_session("workspace-1", &workspace_path)
            .await;
        let error =
            resolve_claude_mcp_source(&manager, "workspace-1", Some(session.runtime_locator()))
                .await
                .expect_err("idle runtime must not mint a Bridge source");
        assert!(error.contains("no active turn"));
    }

    #[tokio::test]
    async fn live_runtime_locator_mints_source_identity_native_session_and_turn() {
        let manager = ClaudeSessionManager::new();
        let workspace_path = PathBuf::from("/tmp/agent-bridge-mcp-source");
        let session = manager
            .get_or_create_session("workspace-1", &workspace_path)
            .await;
        session
            .set_session_id(Some("claude-native-session-1".to_string()))
            .await;
        session.set_mcp_active_turn_for_test(Some("runtime-turn-1"));

        let source =
            resolve_claude_mcp_source(&manager, "workspace-1", Some(session.runtime_locator()))
                .await
                .expect("live source");

        assert_eq!(source.endpoint.engine_id, "claude");
        assert_eq!(
            source.endpoint.logical_session_id.as_deref(),
            Some(session.runtime_locator())
        );
        assert_eq!(
            source.endpoint.native_session_id.as_deref(),
            Some("claude-native-session-1")
        );
        assert_eq!(source.runtime_turn_id, "runtime-turn-1");
    }

    #[tokio::test]
    async fn codex_runtime_locator_requires_one_exact_live_turn() {
        let sessions = Mutex::new(HashMap::new());
        let session = crate::backend::app_server::make_test_workspace_session("workspace-1").await;
        let locator = session.mcp_runtime_locator().to_string();
        sessions.lock().await.insert(
            "codex::workspace-1::__disk__".to_string(),
            Arc::clone(&session),
        );

        let idle_error = resolve_codex_mcp_source(&sessions, "workspace-1", Some(&locator))
            .await
            .expect_err("idle Codex runtime must fail closed");
        assert!(idle_error.contains("no active turn"));

        session
            .set_mcp_active_turn_for_test("thread-1", Some("turn-1"))
            .await;
        let source = resolve_codex_mcp_source(&sessions, "workspace-1", Some(&locator))
            .await
            .expect("unique live Codex turn");
        assert_eq!(source.endpoint.engine_id, "codex");
        assert_eq!(
            source.endpoint.logical_session_id.as_deref(),
            Some("thread-1")
        );
        assert_eq!(
            source.endpoint.native_session_id.as_deref(),
            Some("thread-1")
        );
        assert_eq!(source.runtime_turn_id, "turn-1");

        session
            .set_mcp_active_turn_for_test("thread-2", Some("turn-2"))
            .await;
        let ambiguous_error = resolve_codex_mcp_source(&sessions, "workspace-1", Some(&locator))
            .await
            .expect_err("concurrent Codex turns must not guess the caller");
        assert!(ambiguous_error.contains("ambiguous active turn ownership"));

        crate::backend::app_server::dispose_test_workspace_session(&session).await;
    }

    #[tokio::test]
    async fn codex_runtime_locator_is_workspace_bound_and_unforgeable() {
        let sessions = Mutex::new(HashMap::new());
        let session = crate::backend::app_server::make_test_workspace_session("workspace-1").await;
        session
            .set_mcp_active_turn_for_test("thread-1", Some("turn-1"))
            .await;
        sessions.lock().await.insert(
            "codex::workspace-1::__disk__".to_string(),
            Arc::clone(&session),
        );

        let error = resolve_codex_mcp_source(
            &sessions,
            "workspace-2",
            Some(session.mcp_runtime_locator()),
        )
        .await
        .expect_err("another workspace must not reuse the locator");
        assert!(error.contains("source runtime is not active"));

        let forged = resolve_codex_mcp_source(
            &sessions,
            "workspace-1",
            Some("attacker-controlled-locator"),
        )
        .await
        .expect_err("unknown locator must fail closed");
        assert!(forged.contains("source runtime is not active"));

        crate::backend::app_server::dispose_test_workspace_session(&session).await;
    }
}
