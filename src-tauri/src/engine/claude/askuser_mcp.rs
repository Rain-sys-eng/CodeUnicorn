//! In-process HTTP MCP server for CodeUnicorn-managed agent tools.
//!
//! # Why this exists
//! The `claude` CLI only offers the native `AskUserQuestion` tool to the model in
//! **plan mode**. To restore mid-turn structured asks in default/acceptEdits, we
//! register an MCP tool — MCP tools are not plan-gated — and route its call into
//! the existing `RequestUserInput` dialog machinery. The same authenticated,
//! runtime-bound server now also exposes Agent Bridge delegation tools.
//!
//! # Transport
//! Streamable-HTTP: provider-aware sessions use
//! `POST /mcp/:workspace_id/:runtime_locator`; Codex app-server runtimes use the
//! separate `POST /mcp/codex/:workspace_id/:runtime_locator` route. The workspace-only endpoint
//! remains for local Claude AskUserQuestion compatibility. All routes speak JSON-RPC (`initialize`,
//! `tools/list`, `tools/call`) and respond `application/json`. No SSE stream is
//! needed for request/response. Verified against CLI v2.1.201.
//!
//! # Identity boundary
//! Agent Bridge tools are accepted only on the provider-aware route. The bearer
//! token and opaque `runtime_locator` are minted by CodeUnicorn; the model cannot
//! provide or override source engine/workspace/session identity in tool arguments.
//!
//! # Answer path (B2)
//! On `AskUserQuestion`, resolve the runtime's `ClaudeSession` and call
//! `ask_via_mcp`, which emits `RequestUserInput` to the live turn's subscriber
//! and blocks until the user answers. The answer text is returned as the MCP
//! tool_result — the CLI turn continues natively, no kill/`--resume`.

use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::net::TcpListener;

use super::ClaudeSessionManager;

impl super::ClaudeSession {
    /// Snapshot the exact live Claude turn that is issuing an authenticated managed MCP call.
    /// Kept on the MCP child module so ordinary engine consumers do not gain a new control API.
    pub(crate) fn mcp_active_turn_id(&self) -> Option<String> {
        self.active_turn_id
            .lock()
            .ok()
            .and_then(|turn_id| turn_id.clone())
    }

    #[cfg(test)]
    pub(crate) fn set_mcp_active_turn_for_test(&self, turn_id: Option<&str>) {
        if let Ok(mut active_turn_id) = self.active_turn_id.lock() {
            *active_turn_id = turn_id.map(str::to_string);
        }
    }
}

/// The MCP server name used by Claude (`mcp__ccgui__<tool>`).
pub const MCP_SERVER_NAME: &str = "ccgui";
pub const ASK_TOOL_NAME: &str = "AskUserQuestion";
pub const CODEX_BRIDGE_MCP_SERVER_NAME: &str = "codeunicorn_agent_bridge";
pub const CODEX_BRIDGE_MCP_BEARER_TOKEN_ENV: &str = "CODEUNICORN_AGENT_BRIDGE_MCP_TOKEN";

/// Process-global handle to the running server, set once at app startup.
/// The CLI spawn wiring reads this to build the per-workspace `--mcp-config`.
static ASKUSER_MCP_SERVER: OnceLock<AskUserMcpServer> = OnceLock::new();

/// Start the server (idempotent) and store it in the process-global slot.
/// Call once during app setup. No-op if already started.
pub async fn init_global(claude_manager: Arc<ClaudeSessionManager>) -> Result<(), String> {
    if ASKUSER_MCP_SERVER.get().is_some() {
        return Ok(());
    }
    let server = AskUserMcpServer::start(claude_manager).await?;
    // Ignore the race where another caller set it first; either is valid.
    let _ = ASKUSER_MCP_SERVER.set(server);
    Ok(())
}

/// The running server, if it has been started.
pub fn global() -> Option<&'static AskUserMcpServer> {
    ASKUSER_MCP_SERVER.get()
}

#[derive(Clone)]
struct McpServerState {
    claude_manager: Arc<ClaudeSessionManager>,
    /// Random per-process bearer token; every request must present it (set in `start`).
    token: Arc<str>,
}

/// A running in-process CodeUnicorn MCP server. Holds the bound port so the
/// CLI spawn wiring can build the per-workspace `--mcp-config` URL, plus the bearer
/// token injected into that config's headers and required on every request.
pub struct AskUserMcpServer {
    port: u16,
    token: Arc<str>,
}

impl AskUserMcpServer {
    /// Bind an ephemeral localhost port and start serving. Returns once the
    /// listener is bound (so `port()` is immediately usable); the accept loop
    /// runs on a detached task for the process lifetime.
    pub async fn start(claude_manager: Arc<ClaudeSessionManager>) -> Result<Self, String> {
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .map_err(|err| format!("failed to bind CodeUnicorn MCP server: {err}"))?;
        let port = listener
            .local_addr()
            .map_err(|err| format!("failed to read MCP server addr: {err}"))?
            .port();

        // Unguessable per-process token: our CLI spawn carries it via the injected
        // `--mcp-config` Authorization header; any other local process that finds the
        // loopback port cannot forge it.
        let token: Arc<str> = Arc::from(uuid::Uuid::new_v4().simple().to_string());
        let state = McpServerState {
            claude_manager,
            token: Arc::clone(&token),
        };
        let router = Router::new()
            .route(
                "/mcp/codex/:workspace_id/:runtime_locator",
                post(handle_codex_runtime_mcp),
            )
            .route(
                "/mcp/:workspace_id/:runtime_locator",
                post(handle_runtime_mcp),
            )
            .route("/mcp/:workspace_id", post(handle_legacy_mcp))
            .with_state(state);

        tokio::spawn(async move {
            if let Err(err) = axum::serve(listener, router).await {
                log::error!("CodeUnicorn MCP server stopped: {err}");
            }
        });

        log::info!("CodeUnicorn MCP server listening on 127.0.0.1:{port}");
        Ok(Self { port, token })
    }

    /// The `--mcp-config` inline JSON registering this server for a given
    /// workspace. Uses http transport so no subprocess is spawned.
    pub fn mcp_config_json(&self, workspace_id: &str, runtime_locator: &str) -> String {
        json!({
            "mcpServers": {
                MCP_SERVER_NAME: {
                    "type": "http",
                    "url": format!(
                        "http://127.0.0.1:{}/mcp/{}/{}",
                        self.port,
                        workspace_id,
                        runtime_locator
                    ),
                    "headers": { "Authorization": format!("Bearer {}", self.token) },
                }
            }
        })
        .to_string()
    }

    /// Allow all tools on this private, bearer-authenticated CodeUnicorn MCP server.
    /// The Bridge itself still enforces workspace/source identity, target availability,
    /// execution scope and target runtime permission/approval contracts.
    pub fn allowed_tool_name() -> String {
        format!("mcp__{MCP_SERVER_NAME}__*")
    }

    /// Runtime-only Codex config overrides for the managed Agent Bridge server.
    ///
    /// These values are appended as `-c` CLI overrides immediately before `app-server`; they do
    /// not mutate the user's `config.toml` and affect only CodeUnicorn's managed process. The
    /// bearer secret itself stays in the child environment rather than the process argument list.
    pub fn codex_bridge_config_overrides(
        &self,
        workspace_id: &str,
        runtime_locator: &str,
    ) -> Vec<String> {
        let url = format!(
            "http://127.0.0.1:{}/mcp/codex/{}/{}",
            self.port, workspace_id, runtime_locator
        );
        vec![
            format!(
                "mcp_servers.{CODEX_BRIDGE_MCP_SERVER_NAME}.url={}",
                serde_json::to_string(&url).expect("managed MCP URL must serialize")
            ),
            format!(
                "mcp_servers.{CODEX_BRIDGE_MCP_SERVER_NAME}.bearer_token_env_var={}",
                serde_json::to_string(CODEX_BRIDGE_MCP_BEARER_TOKEN_ENV)
                    .expect("managed MCP env key must serialize")
            ),
        ]
    }

    pub fn apply_codex_bridge_bearer_token(&self, command: &mut tokio::process::Command) {
        command.env(CODEX_BRIDGE_MCP_BEARER_TOKEN_ENV, self.token.as_ref());
    }
}

fn ask_tool_definition() -> Value {
    json!({
        "name": ASK_TOOL_NAME,
        "description": "Ask the user a structured multiple-choice question and get their selection back. \
            Use mid-turn when you need the user to pick between options before continuing. \
            Provide 2-4 options per question; put the recommended default first.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "description": "One or more questions to ask the user.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string", "description": "The question text." },
                            "header": { "type": "string", "description": "A short label for the question." },
                            "multiSelect": { "type": "boolean", "description": "Allow selecting multiple options." },
                            "options": {
                                "type": "array",
                                "description": "The options to choose from. First option is the recommended default.",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": { "type": "string" },
                                        "description": { "type": "string" }
                                    },
                                    "required": ["label"]
                                }
                            }
                        },
                        "required": ["question", "options"]
                    }
                }
            },
            "required": ["questions"]
        }
    })
}

fn all_tool_definitions() -> Vec<Value> {
    let mut tools = vec![ask_tool_definition()];
    tools.extend(crate::engine::claude_bridge_mcp::tool_definitions());
    tools
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum McpIngress {
    Claude,
    Codex,
}

fn tool_definitions_for_ingress(ingress: McpIngress) -> Vec<Value> {
    match ingress {
        McpIngress::Claude => all_tool_definitions(),
        McpIngress::Codex => crate::engine::codex_bridge_mcp::tool_definitions(),
    }
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn text_tool_result(id: Value, text: String) -> McpResponse {
    McpResponse::Json(rpc_result(
        id,
        json!({ "content": [{ "type": "text", "text": text }] }),
    ))
}

fn error_tool_result(id: Value, label: &str, error: impl std::fmt::Display) -> McpResponse {
    McpResponse::Json(rpc_result(
        id,
        json!({
            "content": [{ "type": "text", "text": format!("{label} failed: {error}") }],
            "isError": true
        }),
    ))
}

/// A JSON-RPC response, or 202-with-no-body for notifications.
enum McpResponse {
    Json(Value),
    Accepted,
    Unauthorized,
}

impl IntoResponse for McpResponse {
    fn into_response(self) -> axum::response::Response {
        match self {
            McpResponse::Json(value) => (StatusCode::OK, Json(value)).into_response(),
            McpResponse::Accepted => StatusCode::ACCEPTED.into_response(),
            McpResponse::Unauthorized => StatusCode::UNAUTHORIZED.into_response(),
        }
    }
}

/// Whether the request carries the injected `Authorization: Bearer <token>`.
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|presented| presented == token)
        .unwrap_or(false)
}

async fn handle_runtime_mcp(
    Path((workspace_id, runtime_locator)): Path<(String, String)>,
    State(state): State<McpServerState>,
    headers: HeaderMap,
    Json(msg): Json<Value>,
) -> McpResponse {
    handle_mcp_request(workspace_id, Some(runtime_locator), state, headers, msg).await
}

async fn handle_codex_runtime_mcp(
    Path((workspace_id, runtime_locator)): Path<(String, String)>,
    State(state): State<McpServerState>,
    headers: HeaderMap,
    Json(msg): Json<Value>,
) -> McpResponse {
    handle_mcp_request_for_ingress(
        workspace_id,
        Some(runtime_locator),
        McpIngress::Codex,
        state,
        headers,
        msg,
    )
    .await
}

async fn handle_legacy_mcp(
    Path(workspace_id): Path<String>,
    State(state): State<McpServerState>,
    headers: HeaderMap,
    Json(msg): Json<Value>,
) -> McpResponse {
    handle_mcp_request(workspace_id, None, state, headers, msg).await
}

async fn handle_mcp_request(
    workspace_id: String,
    runtime_locator: Option<String>,
    state: McpServerState,
    headers: HeaderMap,
    msg: Value,
) -> McpResponse {
    handle_mcp_request_for_ingress(
        workspace_id,
        runtime_locator,
        McpIngress::Claude,
        state,
        headers,
        msg,
    )
    .await
}

async fn handle_mcp_request_for_ingress(
    workspace_id: String,
    runtime_locator: Option<String>,
    ingress: McpIngress,
    state: McpServerState,
    headers: HeaderMap,
    msg: Value,
) -> McpResponse {
    // The loopback port is reachable by any local process; only our CLI spawn carries
    // the injected bearer token, so reject everything else before touching a session.
    if !authorized(&headers, &state.token) {
        return McpResponse::Unauthorized;
    }
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");

    match method {
        "initialize" => {
            let protocol_version = msg
                .get("params")
                .and_then(|p| p.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or("2024-11-05")
                .to_string();
            McpResponse::Json(rpc_result(
                id,
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": MCP_SERVER_NAME, "version": env!("CARGO_PKG_VERSION") }
                }),
            ))
        }
        // Notifications (no `id`) get no response body.
        "notifications/initialized" | "notifications/cancelled" => McpResponse::Accepted,
        "tools/list" => McpResponse::Json(rpc_result(
            id,
            json!({ "tools": tool_definitions_for_ingress(ingress) }),
        )),
        "tools/call" => {
            let tool_name = msg
                .get("params")
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let arguments = msg
                .get("params")
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));

            if ingress == McpIngress::Claude && tool_name == ASK_TOOL_NAME {
                let session = match runtime_locator.as_deref() {
                    Some(locator) => {
                        state
                            .claude_manager
                            .get_session_by_locator(&workspace_id, locator)
                            .await
                    }
                    None => state.claude_manager.get_session(&workspace_id).await,
                };
                let Some(session) = session else {
                    return McpResponse::Json(rpc_error(
                        id,
                        -32000,
                        "no active Claude session for this workspace",
                    ));
                };

                return match session.ask_via_mcp(&arguments).await {
                    Ok(answer_text) => text_tool_result(id, answer_text),
                    Err(error) => error_tool_result(id, ASK_TOOL_NAME, error),
                };
            }

            if crate::agent_orchestration::bridge::mcp_gateway::handles_tool(tool_name) {
                let result = match ingress {
                    McpIngress::Claude => {
                        crate::engine::claude_bridge_mcp::call_tool(
                            &state.claude_manager,
                            &workspace_id,
                            runtime_locator.as_deref(),
                            tool_name,
                            arguments,
                        )
                        .await
                    }
                    McpIngress::Codex => {
                        crate::engine::codex_bridge_mcp::call_tool(
                            &workspace_id,
                            runtime_locator.as_deref(),
                            tool_name,
                            arguments,
                        )
                        .await
                    }
                };
                return match result {
                    Ok(result) => match serde_json::to_string(&result) {
                        Ok(text) => text_tool_result(id, text),
                        Err(error) => error_tool_result(id, tool_name, error),
                    },
                    Err(error) => error_tool_result(id, tool_name, error),
                };
            }

            McpResponse::Json(rpc_error(
                id,
                -32602,
                &format!("unknown tool: {tool_name}"),
            ))
        }
        other => McpResponse::Json(rpc_error(id, -32601, &format!("method not found: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state(manager: Arc<ClaudeSessionManager>) -> McpServerState {
        McpServerState {
            claude_manager: manager,
            token: Arc::from("test-token"),
        }
    }

    fn authorized_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer test-token".parse().expect("authorization header"),
        );
        headers
    }

    fn json_response(response: McpResponse) -> Value {
        match response {
            McpResponse::Json(value) => value,
            McpResponse::Accepted => panic!("expected JSON response, got accepted"),
            McpResponse::Unauthorized => panic!("expected JSON response, got unauthorized"),
        }
    }

    fn server_at(port: u16) -> AskUserMcpServer {
        AskUserMcpServer {
            port,
            token: Arc::from("test-token"),
        }
    }

    #[test]
    fn mcp_config_json_uses_http_transport_and_workspace_url() {
        let config: Value =
            serde_json::from_str(&server_at(4899).mcp_config_json("ws-42", "runtime-a")).unwrap();
        let server = &config["mcpServers"][MCP_SERVER_NAME];
        assert_eq!(server["type"], "http");
        assert_eq!(server["url"], "http://127.0.0.1:4899/mcp/ws-42/runtime-a");
        assert_eq!(server["headers"]["Authorization"], "Bearer test-token");
        // Must NOT request strict mode — that would drop the user's own servers.
        assert!(config.get("strict").is_none());
    }

    #[test]
    fn allowed_tool_name_covers_private_ccgui_server_tools() {
        assert_eq!(AskUserMcpServer::allowed_tool_name(), "mcp__ccgui__*");
    }

    #[test]
    fn codex_bridge_registration_is_runtime_only_and_keeps_token_out_of_argv() {
        let overrides =
            server_at(4899).codex_bridge_config_overrides("ws-42", "codex-runtime-a");
        assert_eq!(overrides.len(), 2);
        assert!(overrides.iter().any(|value| {
            value
                == "mcp_servers.codeunicorn_agent_bridge.url=\"http://127.0.0.1:4899/mcp/codex/ws-42/codex-runtime-a\""
        }));
        assert!(overrides.iter().any(|value| {
            value
                == "mcp_servers.codeunicorn_agent_bridge.bearer_token_env_var=\"CODEUNICORN_AGENT_BRIDGE_MCP_TOKEN\""
        }));
        assert!(overrides.iter().all(|value| !value.contains("test-token")));
    }

    #[test]
    fn tool_definition_schema_matches_native_questions_shape() {
        let def = ask_tool_definition();
        assert_eq!(def["name"], ASK_TOOL_NAME);
        // The engine's convert_ask_user_question_to_request parses these exact keys.
        let props = &def["inputSchema"]["properties"]["questions"]["items"]["properties"];
        assert!(props.get("question").is_some());
        assert!(props.get("header").is_some());
        assert!(props.get("options").is_some());
        assert!(props.get("multiSelect").is_some());
        let opt = &props["options"]["items"]["properties"];
        assert!(opt.get("label").is_some());
        assert!(opt.get("description").is_some());
    }

    #[test]
    fn managed_server_lists_ask_and_all_bridge_tools() {
        if !crate::engine::claude_bridge_mcp::AVAILABLE {
            return;
        }
        let tools = all_tool_definitions();
        assert_eq!(tools.len(), 8);
        assert!(tools.iter().any(|tool| tool["name"] == ASK_TOOL_NAME));
        for expected in [
            crate::engine::claude_bridge_mcp::AGENT_LIST_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_DELEGATE_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_STATUS_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_WAIT_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_RESULT_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_SEND_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_CANCEL_TOOL,
        ] {
            assert!(tools.iter().any(|tool| tool["name"] == expected));
        }
    }

    #[tokio::test]
    async fn authenticated_tools_list_exposes_the_exact_bridge_contract() {
        if !crate::engine::claude_bridge_mcp::AVAILABLE {
            return;
        }
        let response = handle_mcp_request(
            "workspace-1".to_string(),
            Some("runtime-1".to_string()),
            test_state(Arc::new(ClaudeSessionManager::new())),
            authorized_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            }),
        )
        .await;
        let payload = json_response(response);
        let tools = payload["result"]["tools"]
            .as_array()
            .expect("tools/list result");
        let bridge_names = tools
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .filter(|name| {
                crate::engine::claude_bridge_mcp::handles_tool(name)
            })
            .collect::<std::collections::HashSet<_>>();

        assert_eq!(bridge_names.len(), 7);
        for expected in [
            crate::engine::claude_bridge_mcp::AGENT_LIST_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_DELEGATE_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_STATUS_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_WAIT_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_RESULT_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_SEND_TOOL,
            crate::engine::claude_bridge_mcp::AGENT_CANCEL_TOOL,
        ] {
            assert!(bridge_names.contains(expected));
        }
    }

    #[tokio::test]
    async fn codex_tools_list_exposes_only_the_seven_bridge_tools() {
        if !crate::engine::codex_bridge_mcp::AVAILABLE {
            return;
        }
        let response = handle_mcp_request_for_ingress(
            "workspace-1".to_string(),
            Some("runtime-1".to_string()),
            McpIngress::Codex,
            test_state(Arc::new(ClaudeSessionManager::new())),
            authorized_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 11,
                "method": "tools/list",
                "params": {}
            }),
        )
        .await;
        let payload = json_response(response);
        let tools = payload["result"]["tools"]
            .as_array()
            .expect("Codex tools/list result");
        assert_eq!(tools.len(), 7);
        assert!(!tools.iter().any(|tool| tool["name"] == ASK_TOOL_NAME));
        for expected in [
            crate::engine::codex_bridge_mcp::AGENT_LIST_TOOL,
            crate::engine::codex_bridge_mcp::AGENT_DELEGATE_TOOL,
            crate::engine::codex_bridge_mcp::AGENT_STATUS_TOOL,
            crate::engine::codex_bridge_mcp::AGENT_WAIT_TOOL,
            crate::engine::codex_bridge_mcp::AGENT_RESULT_TOOL,
            crate::engine::codex_bridge_mcp::AGENT_SEND_TOOL,
            crate::engine::codex_bridge_mcp::AGENT_CANCEL_TOOL,
        ] {
            assert!(tools.iter().any(|tool| tool["name"] == expected));
        }
    }

    #[tokio::test]
    async fn codex_route_does_not_expose_claude_ask_tool() {
        let response = handle_mcp_request_for_ingress(
            "workspace-1".to_string(),
            Some("runtime-1".to_string()),
            McpIngress::Codex,
            test_state(Arc::new(ClaudeSessionManager::new())),
            authorized_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 12,
                "method": "tools/call",
                "params": { "name": ASK_TOOL_NAME, "arguments": { "questions": [] } }
            }),
        )
        .await;
        let payload = json_response(response);
        assert_eq!(payload["error"]["code"], -32602);
        assert!(payload["error"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("unknown tool")));
    }

    #[tokio::test]
    async fn legacy_route_cannot_call_an_advertised_bridge_tool() {
        if !crate::engine::claude_bridge_mcp::AVAILABLE {
            return;
        }
        let response = handle_mcp_request(
            "workspace-1".to_string(),
            None,
            test_state(Arc::new(ClaudeSessionManager::new())),
            authorized_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": crate::engine::claude_bridge_mcp::AGENT_STATUS_TOOL,
                    "arguments": { "runId": "run-1" }
                }
            }),
        )
        .await;
        let payload = json_response(response);

        assert_eq!(payload["result"]["isError"], true);
        assert!(payload["result"]["content"][0]["text"]
            .as_str()
            .is_some_and(|text| text.contains("runtime-bound MCP endpoint")));
    }

    #[tokio::test]
    async fn runtime_route_requires_a_live_locator_before_bridge_dispatch() {
        if !crate::engine::claude_bridge_mcp::AVAILABLE {
            return;
        }
        let response = handle_mcp_request(
            "workspace-1".to_string(),
            Some("unknown-runtime".to_string()),
            test_state(Arc::new(ClaudeSessionManager::new())),
            authorized_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": crate::engine::claude_bridge_mcp::AGENT_LIST_TOOL,
                    "arguments": {}
                }
            }),
        )
        .await;
        let payload = json_response(response);

        assert_eq!(payload["result"]["isError"], true);
        assert!(payload["result"]["content"][0]["text"]
            .as_str()
            .is_some_and(|text| text.contains("source runtime is not active")));
    }

    #[tokio::test]
    async fn live_runtime_route_reaches_the_bridge_runtime_boundary() {
        if !crate::engine::claude_bridge_mcp::AVAILABLE {
            return;
        }
        let manager = Arc::new(ClaudeSessionManager::new());
        let session = manager
            .get_or_create_session(
                "workspace-1",
                &std::path::PathBuf::from("/tmp/agent-bridge-mcp-contract"),
            )
            .await;
        session.set_mcp_active_turn_for_test(Some("runtime-turn-1"));
        let locator = session.runtime_locator().to_string();

        let response = handle_mcp_request(
            "workspace-1".to_string(),
            Some(locator),
            test_state(manager),
            authorized_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 31,
                "method": "tools/call",
                "params": {
                    "name": crate::engine::claude_bridge_mcp::AGENT_LIST_TOOL,
                    "arguments": {}
                }
            }),
        )
        .await;
        let payload = json_response(response);

        assert_eq!(payload["result"]["isError"], true);
        assert!(payload["result"]["content"][0]["text"]
            .as_str()
            .is_some_and(|text| text.contains("MCP runtime is not initialized")));
    }

    #[tokio::test]
    async fn bridge_transport_rejects_missing_bearer_before_tool_resolution() {
        let response = handle_mcp_request(
            "workspace-1".to_string(),
            Some("runtime-1".to_string()),
            test_state(Arc::new(ClaudeSessionManager::new())),
            HeaderMap::new(),
            json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/list",
                "params": {}
            }),
        )
        .await;

        assert!(matches!(response, McpResponse::Unauthorized));
    }

    #[tokio::test]
    async fn unknown_tool_uses_json_rpc_invalid_params_error() {
        let response = handle_mcp_request(
            "workspace-1".to_string(),
            Some("runtime-1".to_string()),
            test_state(Arc::new(ClaudeSessionManager::new())),
            authorized_headers(),
            json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": { "name": "agent_unknown", "arguments": {} }
            }),
        )
        .await;
        let payload = json_response(response);

        assert_eq!(payload["error"]["code"], -32602);
        assert!(payload["error"]["message"]
            .as_str()
            .is_some_and(|text| text.contains("unknown tool")));
    }
}
