use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::engine::adapter_registry::engine_id;
use crate::engine::{engine_enabled_in_settings, EngineType};
use crate::state::AppState;

use super::models::{
    AgentEndpoint, CreateDelegationRun, DelegationContextPolicy, DelegationExecutionScope,
    DelegationRun,
};

pub const AGENT_LIST_TOOL: &str = "agent_list";
pub const AGENT_DELEGATE_TOOL: &str = "agent_delegate";
pub const AGENT_STATUS_TOOL: &str = "agent_status";
pub const AGENT_WAIT_TOOL: &str = "agent_wait";
pub const AGENT_RESULT_TOOL: &str = "agent_result";
pub const AGENT_SEND_TOOL: &str = "agent_send";
pub const AGENT_CANCEL_TOOL: &str = "agent_cancel";

const WAIT_DEFAULT_MS: u64 = 15_000;
const WAIT_MAX_MS: u64 = 30_000;
const WAIT_POLL_MS: u64 = 100;

const BUILTIN_ENGINES: [EngineType; 9] = [
    EngineType::Claude,
    EngineType::Codex,
    EngineType::Gemini,
    EngineType::Grok,
    EngineType::Kimi,
    EngineType::OpenCode,
    EngineType::Pi,
    EngineType::Dsh,
    EngineType::Qoder,
];

/// Engines that currently have an actual-send path through Shared V2. Keep this list aligned with
/// `AgentBridgeService::ensure_delegated_dispatch_supported`; unsupported engines are still
/// returned by `agent_list` with `delegationSupported=false` rather than silently disappearing.
fn delegated_dispatch_supported(engine: EngineType) -> bool {
    matches!(
        engine,
        EngineType::Claude
            | EngineType::Codex
            | EngineType::Kimi
            | EngineType::Grok
            | EngineType::OpenCode
            | EngineType::Pi
            | EngineType::Qoder
    )
}

/// MCP tool definitions exposed by the CodeUnicorn-managed server.
///
/// Source identity is deliberately absent from every input schema. The transport must resolve it
/// from its authenticated runtime binding and pass it separately to `call_tool`.
pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": AGENT_LIST_TOOL,
            "description": "List CodeUnicorn-managed agent engines and whether they can currently receive delegated tasks.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": AGENT_DELEGATE_TOOL,
            "description": "Delegate a task to another CodeUnicorn-managed agent. Returns after runtime dispatch is acknowledged; use agent_wait or agent_result for settlement.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "targetEngine": { "type": "string", "description": "Target engine id such as codex, claude, kimi, grok, opencode, pi, or qoder." },
                    "task": { "type": "string" },
                    "fileRefs": { "type": "array", "items": { "type": "string" } },
                    "contextPolicy": { "type": "string", "enum": ["explicit"] },
                    "executionScope": { "type": "string", "enum": ["observe", "sharedWorkspace"] }
                },
                "required": ["targetEngine", "task"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": AGENT_STATUS_TOOL,
            "description": "Read the durable status and ownership metadata for one delegated run.",
            "inputSchema": run_id_schema()
        }),
        json!({
            "name": AGENT_WAIT_TOOL,
            "description": "Wait for a delegated run to settle, bounded to at most 30 seconds per call.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": { "type": "string" },
                    "timeoutMs": { "type": "integer", "minimum": 0, "maximum": WAIT_MAX_MS }
                },
                "required": ["runId"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": AGENT_RESULT_TOOL,
            "description": "Read the normalized result/error for one delegated run without waiting.",
            "inputSchema": run_id_schema()
        }),
        json!({
            "name": AGENT_SEND_TOOL,
            "description": "Continue a completed delegated conversation on the same backing/native agent session using a new immutable run id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": { "type": "string", "description": "Completed delegated run to continue." },
                    "task": { "type": "string" }
                },
                "required": ["runId", "task"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": AGENT_CANCEL_TOOL,
            "description": "Cancel one delegated run using its exact durable runtime owner; never performs workspace-wide interruption.",
            "inputSchema": run_id_schema()
        }),
    ]
}

fn run_id_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "runId": { "type": "string" } },
        "required": ["runId"],
        "additionalProperties": false
    })
}

pub fn handles_tool(name: &str) -> bool {
    matches!(
        name,
        AGENT_LIST_TOOL
            | AGENT_DELEGATE_TOOL
            | AGENT_STATUS_TOOL
            | AGENT_WAIT_TOOL
            | AGENT_RESULT_TOOL
            | AGENT_SEND_TOOL
            | AGENT_CANCEL_TOOL
    )
}

/// Execute a Bridge MCP tool using a source identity that has already been authenticated and
/// resolved by the transport. Callers must never construct `source` from tool arguments.
pub async fn call_tool(
    app: &AppHandle,
    workspace_id: &str,
    source: AgentEndpoint,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    if workspace_id.trim().is_empty() {
        return Err("Agent Bridge MCP source workspace is required".to_string());
    }
    source.validate("source")?;
    let state = app.state::<AppState>();

    match tool_name {
        AGENT_LIST_TOOL => agent_list(state.inner()).await,
        AGENT_DELEGATE_TOOL => {
            let target_engine = required_string(&arguments, "targetEngine")?;
            let task = required_string(&arguments, "task")?;
            let file_refs = optional_string_array(&arguments, "fileRefs")?;
            let context_policy = parse_context_policy(arguments.get("contextPolicy"))?;
            let execution_scope = parse_execution_scope(arguments.get("executionScope"))?;
            let request = CreateDelegationRun {
                source,
                target: AgentEndpoint {
                    engine_id: target_engine,
                    logical_session_id: None,
                    native_session_id: None,
                },
                target_execution: None,
                workspace_id: workspace_id.to_string(),
                task,
                file_refs,
                context_policy,
                execution_scope,
                parent_run_id: None,
            };
            let run = state.create_delegation_run(request).await?;
            let dispatched = state.dispatch_delegation_run(&run.id, app).await?;
            serde_json::to_value(dispatched).map_err(|error| error.to_string())
        }
        AGENT_STATUS_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let run = require_workspace_run(state.inner(), workspace_id, &run_id)?;
            serde_json::to_value(run).map_err(|error| error.to_string())
        }
        AGENT_WAIT_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let timeout_ms = arguments
                .get("timeoutMs")
                .and_then(Value::as_u64)
                .unwrap_or(WAIT_DEFAULT_MS)
                .min(WAIT_MAX_MS);
            wait_for_run(state.inner(), workspace_id, &run_id, timeout_ms).await
        }
        AGENT_RESULT_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let run = require_workspace_run(state.inner(), workspace_id, &run_id)?;
            Ok(result_view(&run))
        }
        AGENT_SEND_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let task = required_string(&arguments, "task")?;
            let _ = require_workspace_run(state.inner(), workspace_id, &run_id)?;
            let run = state.continue_delegation_run(&run_id, task, app).await?;
            serde_json::to_value(run).map_err(|error| error.to_string())
        }
        AGENT_CANCEL_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let _ = require_workspace_run(state.inner(), workspace_id, &run_id)?;
            let run = state.cancel_delegation_run(&run_id, app).await?;
            serde_json::to_value(run).map_err(|error| error.to_string())
        }
        _ => Err(format!("unknown Agent Bridge MCP tool: {tool_name}")),
    }
}

async fn agent_list(state: &AppState) -> Result<Value, String> {
    let settings = state.app_settings.lock().await.clone();
    let mut agents = Vec::with_capacity(BUILTIN_ENGINES.len());
    for engine in BUILTIN_ENGINES {
        let status = state.engine_manager.get_engine_status(engine).await;
        agents.push(json!({
            "engineId": engine_id(engine),
            "displayName": engine.display_name(),
            "enabled": engine_enabled_in_settings(&settings, engine),
            "installed": status.as_ref().map(|value| value.installed).unwrap_or(false),
            "delegationSupported": delegated_dispatch_supported(engine),
            "defaultModel": status.and_then(|value| value.default_model),
        }));
    }
    Ok(json!({ "agents": agents }))
}

fn require_workspace_run(
    state: &AppState,
    workspace_id: &str,
    run_id: &str,
) -> Result<DelegationRun, String> {
    let run = state
        .agent_bridge
        .get_run(run_id)?
        .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
    if run.workspace_id != workspace_id {
        return Err(format!(
            "delegated run workspace mismatch for {run_id}: source workspace cannot access another workspace"
        ));
    }
    Ok(run)
}

async fn wait_for_run(
    state: &AppState,
    workspace_id: &str,
    run_id: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let run = require_workspace_run(state, workspace_id, run_id)?;
        if run.status.is_terminal() || tokio::time::Instant::now() >= deadline {
            return Ok(json!({
                "settled": run.status.is_terminal(),
                "run": run,
            }));
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Ok(json!({ "settled": false, "run": run }));
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(WAIT_POLL_MS))).await;
    }
}

fn result_view(run: &DelegationRun) -> Value {
    json!({
        "runId": run.id,
        "status": run.status,
        "settled": run.status.is_terminal(),
        "result": run.result,
        "error": run.error,
        "completedAtMs": run.completed_at_ms,
    })
}

fn required_string(arguments: &Value, key: &str) -> Result<String, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{key} is required"))
}

fn optional_string_array(arguments: &Value, key: &str) -> Result<Vec<String>, String> {
    let Some(value) = arguments.get(key) else {
        return Ok(Vec::new());
    };
    let values = value
        .as_array()
        .ok_or_else(|| format!("{key} must be an array of strings"))?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| format!("{key} contains an empty or non-string value"))
        })
        .collect()
}

fn parse_context_policy(value: Option<&Value>) -> Result<DelegationContextPolicy, String> {
    match value.and_then(Value::as_str).unwrap_or("explicit") {
        "explicit" => Ok(DelegationContextPolicy::Explicit),
        other => Err(format!(
            "contextPolicy is not supported by the current Agent Bridge MCP gateway: {other}"
        )),
    }
}

fn parse_execution_scope(value: Option<&Value>) -> Result<DelegationExecutionScope, String> {
    match value.and_then(Value::as_str).unwrap_or("observe") {
        "observe" => Ok(DelegationExecutionScope::Observe),
        "sharedWorkspace" => Ok(DelegationExecutionScope::SharedWorkspace),
        other => Err(format!(
            "executionScope is not supported by the current Agent Bridge MCP gateway: {other}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_schemas_never_accept_source_identity() {
        let definitions = tool_definitions();
        assert_eq!(definitions.len(), 7);
        for definition in definitions {
            let properties = &definition["inputSchema"]["properties"];
            assert!(properties.get("sourceEngine").is_none());
            assert!(properties.get("sourceSessionId").is_none());
            assert!(properties.get("workspaceId").is_none());
        }
    }

    #[test]
    fn unsupported_context_and_scope_fail_closed() {
        assert!(parse_context_policy(Some(&json!("portable"))).is_err());
        assert!(parse_context_policy(Some(&json!("inherited"))).is_err());
        assert!(parse_execution_scope(Some(&json!("isolatedWorktree"))).is_err());
    }

    #[test]
    fn agent_wait_is_bounded_to_thirty_seconds() {
        let definition = tool_definitions()
            .into_iter()
            .find(|definition| definition["name"] == AGENT_WAIT_TOOL)
            .expect("agent_wait definition");
        assert_eq!(
            definition["inputSchema"]["properties"]["timeoutMs"]["maximum"],
            WAIT_MAX_MS
        );
    }
}
