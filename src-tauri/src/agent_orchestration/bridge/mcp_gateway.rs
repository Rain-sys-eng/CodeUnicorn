use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::engine::adapter_registry::engine_id;
use crate::engine::{engine_enabled_in_settings, EngineType};
use crate::state::AppState;

use super::mcp_source::ResolvedMcpSource;
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

type McpBackendFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

/// Narrow Agent Bridge application boundary used by the MCP transport adapter.
///
/// The production implementation delegates to the single `AppState` owner and its existing
/// dispatcher/control paths. Keeping the gateway orchestration behind this contract lets focused
/// tests provide deterministic runtime ACK/settlement facts without constructing a second engine
/// runtime or teaching the MCP layer how to spawn/parse any CLI.
trait AgentBridgeMcpBackend {
    fn list_agents(&self) -> McpBackendFuture<'_, Value>;
    fn create_run(
        &self,
        request: CreateDelegationRun,
    ) -> McpBackendFuture<'_, DelegationRun>;
    fn dispatch_run(&self, run_id: String) -> McpBackendFuture<'_, DelegationRun>;
    fn create_continuation(
        &self,
        previous_run_id: String,
        task: String,
    ) -> McpBackendFuture<'_, DelegationRun>;
    fn cancel_run(&self, run_id: String) -> McpBackendFuture<'_, DelegationRun>;
    fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String>;
    fn list_runs(&self) -> Result<Vec<DelegationRun>, String>;
}

struct AppStateMcpBackend<'a> {
    app: &'a AppHandle,
    state: &'a AppState,
}

impl AgentBridgeMcpBackend for AppStateMcpBackend<'_> {
    fn list_agents(&self) -> McpBackendFuture<'_, Value> {
        Box::pin(async move { agent_list(self.state).await })
    }

    fn create_run(
        &self,
        request: CreateDelegationRun,
    ) -> McpBackendFuture<'_, DelegationRun> {
        Box::pin(async move { self.state.create_delegation_run(request).await })
    }

    fn dispatch_run(&self, run_id: String) -> McpBackendFuture<'_, DelegationRun> {
        Box::pin(async move { self.state.dispatch_delegation_run(&run_id, self.app).await })
    }

    fn create_continuation(
        &self,
        previous_run_id: String,
        task: String,
    ) -> McpBackendFuture<'_, DelegationRun> {
        Box::pin(async move {
            self.state
                .create_delegation_continuation(&previous_run_id, task)
                .await
        })
    }

    fn cancel_run(&self, run_id: String) -> McpBackendFuture<'_, DelegationRun> {
        Box::pin(async move { self.state.cancel_delegation_run(&run_id, self.app).await })
    }

    fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
        self.state.agent_bridge.get_run(run_id)
    }

    fn list_runs(&self) -> Result<Vec<DelegationRun>, String> {
        self.state.agent_bridge.list_runs()
    }
}

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
            | EngineType::Dsh
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
                    "targetEngine": { "type": "string", "description": "Target engine id such as codex, claude, kimi, grok, opencode, pi, dsh, or qoder." },
                    "task": { "type": "string" },
                    "fileRefs": { "type": "array", "items": { "type": "string" } },
                    "contextPolicy": {
                        "type": "string",
                        "enum": ["explicit", "portable", "inherited"]
                    },
                    "executionScope": {
                        "type": "string",
                        "enum": ["observe", "sharedWorkspace", "isolatedWorktree"]
                    }
                },
                "required": ["targetEngine", "task"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": AGENT_STATUS_TOOL,
            "description": "Read the durable status and ownership metadata for one delegated run created by this source agent.",
            "inputSchema": run_id_schema()
        }),
        json!({
            "name": AGENT_WAIT_TOOL,
            "description": "Wait for a delegated run created by this source agent to settle, bounded to at most 30 seconds per call.",
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
            "description": "Read the normalized result/error for one delegated run created by this source agent without waiting.",
            "inputSchema": run_id_schema()
        }),
        json!({
            "name": AGENT_SEND_TOOL,
            "description": "Continue a completed delegated conversation created by this source agent on the same backing/native agent session using a new immutable run id.",
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
            "description": "Cancel one delegated run created by this source agent using its exact durable runtime owner; never performs workspace-wide interruption.",
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
    source: ResolvedMcpSource,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    if workspace_id.trim().is_empty() {
        return Err("Agent Bridge MCP source workspace is required".to_string());
    }
    source.endpoint.validate("source")?;
    let state = app.state::<AppState>();
    let backend = AppStateMcpBackend {
        app,
        state: state.inner(),
    };
    call_tool_with_backend(&backend, workspace_id, source, tool_name, arguments).await
}

async fn call_tool_with_backend<B: AgentBridgeMcpBackend + ?Sized>(
    backend: &B,
    workspace_id: &str,
    source: ResolvedMcpSource,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    if workspace_id.trim().is_empty() {
        return Err("Agent Bridge MCP source workspace is required".to_string());
    }
    source.endpoint.validate("source")?;

    match tool_name {
        AGENT_LIST_TOOL => backend.list_agents().await,
        AGENT_DELEGATE_TOOL => {
            let target_engine = required_string(&arguments, "targetEngine")?;
            let task = required_string(&arguments, "task")?;
            let file_refs = optional_string_array(&arguments, "fileRefs")?;
            let context_policy = parse_context_policy(arguments.get("contextPolicy"))?;
            let execution_scope = parse_execution_scope(arguments.get("executionScope"))?;
            let parent_run_id =
                infer_active_parent_from_runs(backend.list_runs()?, workspace_id, &source)?;
            let request = CreateDelegationRun {
                source: source.endpoint,
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
                parent_run_id,
            };
            let run = backend.create_run(request).await?;
            let dispatch = backend.dispatch_run(run.id.clone()).await;
            let dispatched = preserve_created_run_after_dispatch(backend, &run.id, dispatch)?;
            serde_json::to_value(dispatched).map_err(|error| error.to_string())
        }
        AGENT_STATUS_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let run = require_source_run(backend, workspace_id, &source.endpoint, &run_id)?;
            serde_json::to_value(run).map_err(|error| error.to_string())
        }
        AGENT_WAIT_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let timeout_ms = arguments
                .get("timeoutMs")
                .and_then(Value::as_u64)
                .unwrap_or(WAIT_DEFAULT_MS)
                .min(WAIT_MAX_MS);
            wait_for_run(
                backend,
                workspace_id,
                &source.endpoint,
                &run_id,
                timeout_ms,
            )
            .await
        }
        AGENT_RESULT_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let run = require_source_run(backend, workspace_id, &source.endpoint, &run_id)?;
            Ok(result_view(&run))
        }
        AGENT_SEND_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let task = required_string(&arguments, "task")?;
            let _ = require_source_run(backend, workspace_id, &source.endpoint, &run_id)?;
            let continuation = backend.create_continuation(run_id, task).await?;
            let dispatch = backend.dispatch_run(continuation.id.clone()).await;
            let dispatched =
                preserve_created_run_after_dispatch(backend, &continuation.id, dispatch)?;
            serde_json::to_value(dispatched).map_err(|error| error.to_string())
        }
        AGENT_CANCEL_TOOL => {
            let run_id = required_string(&arguments, "runId")?;
            let _ = require_source_run(backend, workspace_id, &source.endpoint, &run_id)?;
            let run = backend.cancel_run(run_id).await?;
            serde_json::to_value(run).map_err(|error| error.to_string())
        }
        _ => Err(format!("unknown Agent Bridge MCP tool: {tool_name}")),
    }
}

async fn agent_list(state: &AppState) -> Result<Value, String> {
    let settings = state.app_settings.lock().await.clone();
    agent_list_from_runtime(&state.engine_manager, &settings).await
}

async fn agent_list_from_runtime(
    engine_manager: &crate::engine::EngineManager,
    settings: &crate::types::AppSettings,
) -> Result<Value, String> {
    let mut agents = Vec::with_capacity(BUILTIN_ENGINES.len());
    for engine in BUILTIN_ENGINES {
        let status = engine_manager.get_engine_status(engine).await;
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

/// A delegated target that calls the managed MCP server must become the parent of its own child
/// delegation. Runtime turn identity is the strongest available owner proof: it is emitted by the
/// actual target runtime, persisted in `dispatch_binding`, and cannot be supplied by the model.
fn infer_active_parent_from_runs(
    runs: Vec<DelegationRun>,
    workspace_id: &str,
    source: &ResolvedMcpSource,
) -> Result<Option<String>, String> {
    let mut owners = runs
        .into_iter()
        .filter(|run| {
            run.dispatch_binding
                .as_ref()
                .and_then(|binding| binding.runtime_workspace_id.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(run.workspace_id.as_str())
                == workspace_id
        })
        .filter(|run| !run.status.is_terminal())
        .filter(|run| run.target.engine_id == source.endpoint.engine_id)
        .filter(|run| {
            run.dispatch_binding
                .as_ref()
                .and_then(|binding| binding.runtime_turn_id.as_deref())
                == Some(source.runtime_turn_id.as_str())
        })
        .filter(|run| {
            match (
                source.endpoint.native_session_id.as_deref(),
                run.target.native_session_id.as_deref(),
            ) {
                (Some(source_native), Some(target_native)) => source_native == target_native,
                _ => true,
            }
        })
        .map(|run| run.id)
        .collect::<Vec<_>>();
    owners.sort();
    owners.dedup();
    match owners.as_slice() {
        [] => Ok(None),
        [run_id] => Ok(Some(run_id.clone())),
        _ => Err(format!(
            "Agent Bridge MCP source turn has ambiguous delegated parent ownership: {} active runs",
            owners.len()
        )),
    }
}

fn require_source_run<B: AgentBridgeMcpBackend + ?Sized>(
    backend: &B,
    workspace_id: &str,
    source: &AgentEndpoint,
    run_id: &str,
) -> Result<DelegationRun, String> {
    let run = backend
        .get_run(run_id)?
        .ok_or_else(|| format!("delegated run not found: {run_id}"))?;
    if run.workspace_id != workspace_id {
        return Err(format!(
            "delegated run workspace mismatch for {run_id}: source workspace cannot access another workspace"
        ));
    }
    if !source_owns_run(source, &run.source) {
        return Err(format!(
            "delegated run source mismatch for {run_id}: this MCP runtime does not own the run"
        ));
    }
    Ok(run)
}

fn source_owns_run(caller: &AgentEndpoint, owner: &AgentEndpoint) -> bool {
    if caller.engine_id != owner.engine_id {
        return false;
    }
    let logical_match = caller
        .logical_session_id
        .as_deref()
        .zip(owner.logical_session_id.as_deref())
        .is_some_and(|(caller_id, owner_id)| caller_id == owner_id);
    let native_match = caller
        .native_session_id
        .as_deref()
        .zip(owner.native_session_id.as_deref())
        .is_some_and(|(caller_id, owner_id)| caller_id == owner_id);
    logical_match || native_match
}

async fn wait_for_run<B: AgentBridgeMcpBackend + ?Sized>(
    backend: &B,
    workspace_id: &str,
    source: &AgentEndpoint,
    run_id: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let run = require_source_run(backend, workspace_id, source, run_id)?;
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

fn preserve_created_run_after_dispatch<B: AgentBridgeMcpBackend + ?Sized>(
    backend: &B,
    run_id: &str,
    dispatch: Result<DelegationRun, String>,
) -> Result<DelegationRun, String> {
    match dispatch {
        Ok(run) => Ok(run),
        Err(dispatch_error) => match backend.get_run(run_id)? {
            Some(run) if run.status.is_terminal() => Ok(run),
            Some(run) => Err(format!(
                "Agent Bridge dispatch failed after creating runId={run_id}; durable status={:?}; {dispatch_error}",
                run.status
            )),
            None => Err(format!(
                "Agent Bridge dispatch failed after creating runId={run_id}, but the durable run disappeared; {dispatch_error}"
            )),
        },
    }
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
        "portable" => Ok(DelegationContextPolicy::Portable),
        "inherited" => Ok(DelegationContextPolicy::Inherited),
        other => Err(format!(
            "contextPolicy is not supported by the current Agent Bridge MCP gateway: {other}"
        )),
    }
}

fn parse_execution_scope(value: Option<&Value>) -> Result<DelegationExecutionScope, String> {
    match value.and_then(Value::as_str).unwrap_or("observe") {
        "observe" => Ok(DelegationExecutionScope::Observe),
        "sharedWorkspace" => Ok(DelegationExecutionScope::SharedWorkspace),
        "isolatedWorktree" => Ok(DelegationExecutionScope::IsolatedWorktree),
        other => Err(format!(
            "executionScope is not supported by the current Agent Bridge MCP gateway: {other}"
        )),
    }
}

#[cfg(test)]
#[path = "mcp_gateway_integration_tests.rs"]
mod integration_tests;

#[cfg(test)]
mod tests {
    use super::*;

    use crate::agent_orchestration::bridge::{
        AgentBridgeService, DelegationRunRegistry,
    };
    use crate::shared_event_log::canonical::types::CanonicalProviderProfileSource;
    use crate::shared_session_v2::ExecutionTargetInput;

    fn endpoint(engine: &str, logical: Option<&str>, native: Option<&str>) -> AgentEndpoint {
        AgentEndpoint {
            engine_id: engine.to_string(),
            logical_session_id: logical.map(str::to_string),
            native_session_id: native.map(str::to_string),
        }
    }

    fn created_service() -> (crate::agent_orchestration::bridge::AgentBridgeService, String) {
        let registry = DelegationRunRegistry::new(Default::default());
        let run = registry
            .create(CreateDelegationRun {
                source: endpoint("claude", Some("runtime-a"), Some("native-a")),
                target: endpoint("codex", None, None),
                target_execution: Some(ExecutionTargetInput {
                    engine: EngineType::Codex,
                    provider_profile_id: None,
                    model_catalog_entry_id: Some("gpt-5.6-sol".to_string()),
                    model: Some("gpt-5.6-sol".to_string()),
                    reasoning_effort: Some("low".to_string()),
                    provider_profile_name_snapshot: Some("Local".to_string()),
                    provider_profile_source: Some(CanonicalProviderProfileSource::Local),
                    runtime_capability_fingerprint: None,
                }),
                workspace_id: "workspace-1".to_string(),
                task: "review".to_string(),
                file_refs: Vec::new(),
                context_policy: DelegationContextPolicy::Explicit,
                execution_scope: DelegationExecutionScope::Observe,
                parent_run_id: None,
            })
            .expect("create run");
        (
            crate::agent_orchestration::bridge::AgentBridgeService::new(registry),
            run.id,
        )
    }

    impl AgentBridgeMcpBackend for AgentBridgeService {
        fn list_agents(&self) -> McpBackendFuture<'_, Value> {
            Box::pin(async { Err("not used by this focused backend".to_string()) })
        }

        fn create_run(
            &self,
            _request: CreateDelegationRun,
        ) -> McpBackendFuture<'_, DelegationRun> {
            Box::pin(async { Err("not used by this focused backend".to_string()) })
        }

        fn dispatch_run(&self, _run_id: String) -> McpBackendFuture<'_, DelegationRun> {
            Box::pin(async { Err("not used by this focused backend".to_string()) })
        }

        fn create_continuation(
            &self,
            _previous_run_id: String,
            _task: String,
        ) -> McpBackendFuture<'_, DelegationRun> {
            Box::pin(async { Err("not used by this focused backend".to_string()) })
        }

        fn cancel_run(&self, _run_id: String) -> McpBackendFuture<'_, DelegationRun> {
            Box::pin(async { Err("not used by this focused backend".to_string()) })
        }

        fn get_run(&self, run_id: &str) -> Result<Option<DelegationRun>, String> {
            AgentBridgeService::get_run(self, run_id)
        }

        fn list_runs(&self) -> Result<Vec<DelegationRun>, String> {
            AgentBridgeService::list_runs(self)
        }
    }

    #[test]
    fn tool_schemas_never_accept_source_identity() {
        let definitions = tool_definitions();
        assert_eq!(definitions.len(), 7);
        for definition in &definitions {
            let properties = &definition["inputSchema"]["properties"];
            assert!(properties.get("sourceEngine").is_none());
            assert!(properties.get("sourceSessionId").is_none());
            assert!(properties.get("workspaceId").is_none());
        }
        let delegate = definitions
            .iter()
            .find(|definition| definition["name"].as_str() == Some(AGENT_DELEGATE_TOOL))
            .expect("agent_delegate definition");
        assert_eq!(
            delegate["inputSchema"]["properties"]["contextPolicy"]["enum"],
            json!(["explicit", "portable", "inherited"])
        );
    }

    #[test]
    fn engine_listing_marks_dsh_worker_dispatch_supported() {
        assert!(delegated_dispatch_supported(EngineType::Dsh));
        assert!(!delegated_dispatch_supported(EngineType::Gemini));
    }

    #[test]
    fn portable_context_and_isolated_scope_are_accepted() {
        assert_eq!(
            parse_context_policy(Some(&json!("portable"))).expect("portable"),
            DelegationContextPolicy::Portable
        );
        assert_eq!(
            parse_context_policy(Some(&json!("inherited"))).expect("inherited"),
            DelegationContextPolicy::Inherited
        );
        assert_eq!(
            parse_execution_scope(Some(&json!("isolatedWorktree"))).expect("isolated"),
            DelegationExecutionScope::IsolatedWorktree
        );
        let delegate = tool_definitions()
            .into_iter()
            .find(|definition| definition["name"] == AGENT_DELEGATE_TOOL)
            .expect("agent_delegate definition");
        assert_eq!(
            delegate["inputSchema"]["properties"]["executionScope"]["enum"],
            json!(["observe", "sharedWorkspace", "isolatedWorktree"])
        );
    }

    #[test]
    fn agent_wait_is_bounded_to_thirty_seconds() {
        let definition = tool_definitions()
            .into_iter()
            .find(|definition| definition["name"] == AGENT_WAIT_TOOL)
            .expect("agent_wait definition");
        assert_eq!(
            definition["inputSchema"]["properties"]["timeoutMs"]["maximum"]
                .as_u64(),
            Some(WAIT_MAX_MS)
        );
    }

    #[test]
    fn run_control_requires_same_source_runtime_or_native_session() {
        let owner = endpoint("claude", Some("runtime-a"), Some("native-a"));
        assert!(source_owns_run(
            &endpoint("claude", Some("runtime-a"), None),
            &owner
        ));
        assert!(source_owns_run(
            &endpoint("claude", Some("runtime-b"), Some("native-a")),
            &owner
        ));
        assert!(!source_owns_run(
            &endpoint("claude", Some("runtime-b"), Some("native-b")),
            &owner
        ));
        assert!(!source_owns_run(
            &endpoint("codex", Some("runtime-a"), Some("native-a")),
            &owner
        ));
    }

    #[test]
    fn dispatch_error_returns_the_durable_failed_run_identity() {
        let (service, run_id) = created_service();
        service
            .settle_failed(&run_id, "dispatch failed".to_string())
            .expect("settle failure");

        let run = preserve_created_run_after_dispatch(
            &service,
            &run_id,
            Err("runtime unavailable".to_string()),
        )
        .expect("durable terminal run");

        assert_eq!(run.id, run_id);
        assert_eq!(
            run.status,
            crate::agent_orchestration::bridge::DelegationRunStatus::Failed
        );
    }

    #[test]
    fn dispatch_error_always_reports_created_run_id_when_settlement_is_missing() {
        let (service, run_id) = created_service();
        let error = preserve_created_run_after_dispatch(
            &service,
            &run_id,
            Err("runtime unavailable".to_string()),
        )
        .expect_err("non-terminal dispatch failure must remain an MCP error");

        assert!(error.contains(&format!("runId={run_id}")));
    }

    #[test]
    fn nested_parent_is_inferred_from_exact_runtime_turn_and_runtime_workspace() {
        let (service, run_id) = created_service();
        service.claim_dispatch(&run_id).expect("claim");
        service
            .set_dispatch_binding(
                &run_id,
                crate::agent_orchestration::bridge::DelegationDispatchBinding {
                    backing_thread_id: "shared:parent".to_string(),
                    attempt_id: "attempt-parent".to_string(),
                    logical_turn_id: "logical-parent".to_string(),
                    binding_key: "squad:parent:delegate:codex:default".to_string(),
                    runtime_workspace_id: Some("workspace-1".to_string()),
                    native_session_id: Some("codex-native".to_string()),
                    runtime_turn_id: Some("codex-turn".to_string()),
                    context_transfer: None,
                },
            )
            .expect("binding");
        service
            .record_runtime_ack(&run_id, "attempt-parent", "codex-native", "codex-turn")
            .expect("ack");
        let source = ResolvedMcpSource {
            endpoint: endpoint("codex", Some("runtime-codex"), Some("codex-native")),
            runtime_turn_id: "codex-turn".to_string(),
        };

        assert_eq!(
            infer_active_parent_from_runs(
                service.list_runs().expect("runs"),
                "workspace-1",
                &source,
            )
            .expect("parent"),
            Some(run_id)
        );
        assert_eq!(
            infer_active_parent_from_runs(
                service.list_runs().expect("runs"),
                "another-workspace",
                &source,
            )
            .expect("no cross-workspace parent"),
            None
        );
    }
}
