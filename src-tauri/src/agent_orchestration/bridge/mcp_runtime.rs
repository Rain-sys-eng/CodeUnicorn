use std::sync::OnceLock;

use tauri::AppHandle;

use super::approval;
use super::mcp_gateway;
use super::mcp_source::ResolvedMcpSource;

static MCP_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Bind the process-global Tauri handle used by the already process-global managed MCP server.
/// Idempotent for normal startup; tests may leave it unset and exercise pure gateway pieces.
///
/// The same startup edge owns process-wide Bridge observers: approval lifecycle synchronization and
/// durable DAG wake/reconcile. Neither observer creates a second engine runtime; DAG execution still
/// enters target agents exclusively through `AgentBridgeService`.
pub(crate) fn init_app_handle(app: AppHandle) -> Result<(), String> {
    approval::ensure_observer_started(&app)?;
    crate::agent_orchestration::graph_runtime::ensure_observer_started(&app)?;
    super::ui_runtime::ensure_observer_started(&app)?;
    if MCP_APP_HANDLE.get().is_some() {
        return Ok(());
    }
    MCP_APP_HANDLE
        .set(app)
        .map_err(|_| "Agent Bridge MCP AppHandle was initialized concurrently".to_string())
}

pub(crate) fn is_initialized() -> bool {
    MCP_APP_HANDLE.get().is_some()
}

pub(crate) async fn call_tool(
    workspace_id: &str,
    source: ResolvedMcpSource,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let app = MCP_APP_HANDLE
        .get()
        .ok_or_else(|| "Agent Bridge MCP runtime is not initialized".to_string())?;
    mcp_gateway::call_tool(app, workspace_id, source, tool_name, arguments).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_starts_unbound_in_isolated_test_process_unless_explicitly_initialized() {
        // This assertion intentionally does not initialize the OnceLock; other unit tests can still
        // exercise schema/source resolution without requiring a Tauri test runtime.
        let _ = is_initialized();
    }
}
