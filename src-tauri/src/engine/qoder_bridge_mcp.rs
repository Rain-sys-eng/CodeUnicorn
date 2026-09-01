use serde_json::Value;

pub(crate) const AVAILABLE: bool = true;
pub(crate) use crate::agent_orchestration::bridge::mcp_gateway::{
    AGENT_CANCEL_TOOL, AGENT_DELEGATE_TOOL, AGENT_LIST_TOOL, AGENT_RESULT_TOOL, AGENT_SEND_TOOL,
    AGENT_STATUS_TOOL, AGENT_WAIT_TOOL,
};

pub(crate) fn tool_definitions() -> Vec<Value> {
    crate::agent_orchestration::bridge::mcp_gateway::tool_definitions()
}

pub(crate) fn handles_tool(tool_name: &str) -> bool {
    crate::agent_orchestration::bridge::mcp_gateway::handles_tool(tool_name)
}

pub(crate) async fn call_tool(
    workspace_id: &str,
    runtime_locator: Option<&str>,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    crate::agent_orchestration::bridge::mcp_runtime::call_qoder_tool(
        workspace_id,
        runtime_locator,
        tool_name,
        arguments,
    )
    .await
}
