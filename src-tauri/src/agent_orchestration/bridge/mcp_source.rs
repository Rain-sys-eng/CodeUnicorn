use crate::engine::claude::ClaudeSessionManager;

use super::models::AgentEndpoint;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedMcpSource {
    pub endpoint: AgentEndpoint,
    pub runtime_turn_id: String,
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
            format!(
                "Agent Bridge MCP source runtime is not active for workspace {workspace_id}"
            )
        })?;
    let runtime_turn_id = session.mcp_active_turn_id().ok_or_else(|| {
        format!(
            "Agent Bridge MCP source runtime has no active turn for workspace {workspace_id}"
        )
    })?;

    Ok(ResolvedMcpSource {
        endpoint: AgentEndpoint {
            engine_id: "claude".to_string(),
            // This opaque locator is process-scoped and was minted by CodeUnicorn, not by the model.
            logical_session_id: Some(runtime_locator.to_string()),
            native_session_id: session.get_session_id().await,
        },
        runtime_turn_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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
        let error = resolve_claude_mcp_source(
            &manager,
            "workspace-1",
            Some("attacker-supplied-locator"),
        )
        .await
        .expect_err("unknown locator must fail closed");
        assert!(error.contains("source runtime is not active"));
    }

    #[tokio::test]
    async fn live_runtime_without_active_turn_is_rejected() {
        let manager = ClaudeSessionManager::new();
        let workspace_path = PathBuf::from("/tmp/agent-bridge-mcp-source-idle");
        let session = manager
            .get_or_create_session("workspace-1", &workspace_path)
            .await;
        let error = resolve_claude_mcp_source(
            &manager,
            "workspace-1",
            Some(session.runtime_locator()),
        )
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

        let source = resolve_claude_mcp_source(
            &manager,
            "workspace-1",
            Some(session.runtime_locator()),
        )
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
}
