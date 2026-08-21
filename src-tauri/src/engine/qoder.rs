//! Qoder CLI engine implementation
//!
//! Headless protocol (spike-verified on qodercli 1.1.27):
//! `qodercli --acp` — NDJSON JSON-RPC 2.0 over stdin/stdout (ACP v1).
//!
//! Spawn-per-turn: initialize → session/resume|session/new → optional
//! set_model / set_config_option → session/set_mode bypassPermissions →
//! session/prompt. The prompt JSON-RPC response is the typed terminal;
//! killing the child is cleanup, not settlement.

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::time::timeout;

use super::events::EngineEvent;
use super::{EngineConfig, EngineType, ModelInfo, SendMessageParams};

const QODER_CLI_NAME: &str = "qodercli";
const QODER_IDE_LAUNCHER_NAME: &str = "qoder";
const ACP_PROTOCOL_VERSION: u32 = 1;
const QODER_POST_TERMINAL_DRAIN: Duration = Duration::from_millis(250);
const QODER_STDERR_JOIN_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const QODER_RPC_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
/// session/new scans the workspace on first contact (measured 30.1s in a large
/// repo, 0.1s in /tmp; see mossx-qoder-capability-spike latency table), so the
/// setup call needs far more headroom than the generic RPC handshake.
const QODER_SESSION_NEW_TIMEOUT: Duration = Duration::from_secs(90);
/// session/resume re-attaches without the workspace scan (measured 0.1s).
const QODER_SESSION_RESUME_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const QODER_LIST_TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const QODER_DELETE_TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const QODER_LOAD_TIMEOUT: Duration = Duration::from_secs(60);
pub(crate) const QODER_DOCTOR_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const JSONRPC_METHOD_NOT_FOUND: i64 = -32601;
const JSONRPC_INVALID_PARAMS: i64 = -32602;
const JSONRPC_INTERNAL_ERROR: i64 = -32603;

pub fn resolve_qoder_session_id_for_engine_send(
    continue_session: bool,
    explicit_session_id: Option<String>,
    tracked_session_id: Option<String>,
) -> Option<String> {
    continue_session
        .then(|| explicit_session_id.or(tracked_session_id))
        .flatten()
}

#[derive(Debug, Clone)]
pub struct QoderTurnEvent {
    pub turn_id: String,
    pub event: EngineEvent,
}

/// Qoder session for a workspace (one ACP process per turn).
pub struct QoderSession {
    pub workspace_id: String,
    pub workspace_path: PathBuf,
    session_id: RwLock<Option<String>>,
    event_sender: broadcast::Sender<QoderTurnEvent>,
    bin_path: Option<String>,
    home_dir: Option<String>,
    custom_args: Option<String>,
    active_processes: Mutex<HashMap<String, ActiveQoderChildProcess>>,
    interrupted_turns: Mutex<HashSet<String>>,
}

#[allow(dead_code)]
pub struct QoderActiveProcessSnapshot {
    pub pid: u32,
    pub registered_age_ms: u64,
}

struct ActiveQoderChildProcess {
    child: Child,
    stdin: std::sync::Arc<Mutex<Option<ChildStdin>>>,
    acp_session_id: Option<String>,
    #[allow(dead_code)]
    started_at_ms: u64,
}

impl ActiveQoderChildProcess {
    fn new(child: Child, stdin: std::sync::Arc<Mutex<Option<ChildStdin>>>) -> Self {
        Self {
            child,
            stdin,
            acp_session_id: None,
            started_at_ms: unix_timestamp_ms_for_process_diagnostics(),
        }
    }

    fn into_child(self) -> Child {
        self.child
    }

    #[allow(dead_code)]
    fn snapshot(&self, sampled_at_ms: u64) -> Option<QoderActiveProcessSnapshot> {
        Some(QoderActiveProcessSnapshot {
            pid: self.child.id()?,
            registered_age_ms: sampled_at_ms.saturating_sub(self.started_at_ms),
        })
    }
}

fn apply_interrupt_result(
    active_processes: &mut HashMap<String, ActiveQoderChildProcess>,
    interrupted_turns: &mut HashSet<String>,
    turn_id: &str,
    kill_result: Result<(), String>,
) -> Result<(), String> {
    kill_result?;
    interrupted_turns.insert(turn_id.to_string());
    active_processes.remove(turn_id);
    Ok(())
}

fn unix_timestamp_ms_for_process_diagnostics() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Parsed representation of one ACP NDJSON line.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AcpLine {
    Response {
        id: Value,
        result: Option<Value>,
        error: Option<AcpRpcError>,
    },
    Notification {
        method: String,
        params: Value,
    },
    AgentRequest {
        id: Value,
        method: String,
        params: Value,
    },
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AcpRpcError {
    pub code: i64,
    pub message: String,
}

fn jsonrpc_id_key(id: &Value) -> Option<String> {
    match id {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

pub(crate) fn parse_acp_line(value: &Value) -> AcpLine {
    if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        && value.get("method").is_none()
        && value.get("id").is_none()
    {
        return AcpLine::Other;
    }
    let method = value.get("method").and_then(Value::as_str);
    let id = value.get("id").cloned().filter(|id| !id.is_null());
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    if let Some(method) = method {
        if let Some(id) = id {
            return AcpLine::AgentRequest {
                id,
                method: method.to_string(),
                params,
            };
        }
        return AcpLine::Notification {
            method: method.to_string(),
            params,
        };
    }
    if let Some(id) = id {
        let error = value.get("error").and_then(|err| {
            let code = err
                .get("code")
                .and_then(Value::as_i64)
                .unwrap_or(JSONRPC_INTERNAL_ERROR);
            let message = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("JSON-RPC error")
                .to_string();
            Some(AcpRpcError { code, message })
        });
        return AcpLine::Response {
            id,
            result: value.get("result").cloned(),
            error,
        };
    }
    AcpLine::Other
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum QoderSessionUpdate {
    AgentMessageChunk {
        text: String,
    },
    AgentThoughtChunk {
        text: String,
    },
    ToolStarted {
        tool_id: String,
        tool_name: String,
        input: Option<Value>,
    },
    ToolCompleted {
        tool_id: String,
        tool_name: Option<String>,
        output: Option<Value>,
        error: Option<String>,
    },
    Ignore,
}

pub(crate) fn extract_content_text(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(text) = content.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(parts) = content.as_array() {
        return parts
            .iter()
            .filter_map(|part| {
                part.as_str()
                    .map(str::to_string)
                    .or_else(|| part.get("text").and_then(Value::as_str).map(str::to_string))
            })
            .collect::<Vec<_>>()
            .join("");
    }
    String::new()
}

pub(crate) fn is_error_prefixed_text(text: &str) -> bool {
    text.trim_start().starts_with("[Error]")
}

pub(crate) fn map_session_update(update: &Value) -> QoderSessionUpdate {
    let kind = update
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .unwrap_or("");
    match kind {
        "agent_message_chunk" => {
            let text = extract_content_text(update.get("content"));
            if text.is_empty() {
                QoderSessionUpdate::Ignore
            } else {
                QoderSessionUpdate::AgentMessageChunk { text }
            }
        }
        "agent_thought_chunk" => {
            let text = extract_content_text(update.get("content"));
            if text.is_empty() {
                QoderSessionUpdate::Ignore
            } else {
                QoderSessionUpdate::AgentThoughtChunk { text }
            }
        }
        "tool_call" => {
            let status = update
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            if status != "pending" && status != "in_progress" {
                return QoderSessionUpdate::Ignore;
            }
            let tool_id = update
                .get("toolCallId")
                .or_else(|| update.get("toolCallID"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if tool_id.is_empty() {
                return QoderSessionUpdate::Ignore;
            }
            let tool_name = update
                .get("title")
                .or_else(|| update.get("kind"))
                .or_else(|| update.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let input = update
                .get("rawInput")
                .cloned()
                .or_else(|| update.get("input").cloned());
            QoderSessionUpdate::ToolStarted {
                tool_id,
                tool_name,
                input,
            }
        }
        "tool_call_update" => {
            let status = update.get("status").and_then(Value::as_str).unwrap_or("");
            if status != "completed" && status != "failed" {
                return QoderSessionUpdate::Ignore;
            }
            let tool_id = update
                .get("toolCallId")
                .or_else(|| update.get("toolCallID"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if tool_id.is_empty() {
                return QoderSessionUpdate::Ignore;
            }
            let tool_name = update
                .get("title")
                .or_else(|| update.get("kind"))
                .or_else(|| update.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let output = update
                .get("content")
                .cloned()
                .or_else(|| update.get("rawOutput").cloned());
            let error = if status == "failed" {
                Some(
                    extract_content_text(update.get("content"))
                        .trim()
                        .to_string(),
                )
                .filter(|value| !value.is_empty())
            } else {
                None
            };
            QoderSessionUpdate::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
            }
        }
        "plan" | "available_commands_update" | "config_option_update" | "user_message_chunk" => {
            QoderSessionUpdate::Ignore
        }
        _ => QoderSessionUpdate::Ignore,
    }
}

pub(crate) fn session_update_from_notification(params: &Value) -> QoderSessionUpdate {
    let update = params.get("update").unwrap_or(params);
    map_session_update(update)
}

pub(crate) fn permission_auto_answer(params: &Value) -> Result<Value, String> {
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .ok_or_else(|| "session/request_permission missing options".to_string())?;
    let option = options.iter().find(|option| {
        option
            .get("kind")
            .and_then(Value::as_str)
            .map(|kind| kind.to_ascii_lowercase().starts_with("allow"))
            .unwrap_or(false)
    });
    let option_id = option
        .and_then(|option| {
            option
                .get("optionId")
                .or_else(|| option.get("option_id"))
                .or_else(|| option.get("id"))
                .and_then(Value::as_str)
        })
        .ok_or_else(|| "session/request_permission has no allow* option".to_string())?;
    Ok(json!({
        "outcome": {
            "outcome": "selected",
            "optionId": option_id,
        }
    }))
}

fn jsonrpc_error_response(id: &Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    })
}

fn jsonrpc_result_response(id: &Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

pub(crate) fn confine_path_to_workspace(
    workspace_root: &Path,
    requested: &str,
    for_write: bool,
) -> Result<PathBuf, String> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err("empty path".to_string());
    }
    let candidate = PathBuf::from(requested);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        workspace_root.join(candidate)
    };
    let root = std::fs::canonicalize(workspace_root).unwrap_or_else(|_| {
        if workspace_root.is_absolute() {
            workspace_root.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(workspace_root)
        }
    });
    let resolved = if for_write && !absolute.exists() {
        let parent = absolute.parent().unwrap_or(workspace_root);
        let file_name = absolute
            .file_name()
            .ok_or_else(|| "invalid path".to_string())?;
        let parent_real = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
        parent_real.join(file_name)
    } else {
        std::fs::canonicalize(&absolute).unwrap_or(absolute.clone())
    };
    if resolved == root || resolved.starts_with(&root) {
        Ok(resolved)
    } else {
        Err(format!(
            "path '{}' escapes workspace root '{}'",
            requested,
            root.display()
        ))
    }
}

fn handle_fs_read(workspace_root: &Path, params: &Value) -> Result<Value, String> {
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "fs/read_text_file missing path".to_string())?;
    let confined = confine_path_to_workspace(workspace_root, path, false)?;
    let content = std::fs::read_to_string(&confined).map_err(|error| error.to_string())?;
    Ok(json!({ "content": content }))
}

fn handle_fs_write(workspace_root: &Path, params: &Value) -> Result<Value, String> {
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "fs/write_text_file missing path".to_string())?;
    let content = params
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| "fs/write_text_file missing content".to_string())?;
    let confined = confine_path_to_workspace(workspace_root, path, true)?;
    if let Some(parent) = confined.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&confined, content).map_err(|error| error.to_string())?;
    Ok(json!({}))
}

pub(crate) fn answer_agent_request(
    workspace_root: &Path,
    id: &Value,
    method: &str,
    params: &Value,
) -> Value {
    match method {
        "session/request_permission" => match permission_auto_answer(params) {
            Ok(result) => jsonrpc_result_response(id, result),
            Err(message) => jsonrpc_error_response(id, JSONRPC_INVALID_PARAMS, &message),
        },
        "fs/read_text_file" => match handle_fs_read(workspace_root, params) {
            Ok(result) => jsonrpc_result_response(id, result),
            Err(message) => jsonrpc_error_response(id, JSONRPC_INVALID_PARAMS, &message),
        },
        "fs/write_text_file" => match handle_fs_write(workspace_root, params) {
            Ok(result) => jsonrpc_result_response(id, result),
            Err(message) => jsonrpc_error_response(id, JSONRPC_INVALID_PARAMS, &message),
        },
        _ => jsonrpc_error_response(id, JSONRPC_METHOD_NOT_FOUND, "Method not found"),
    }
}

fn mime_type_for_image_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

pub(crate) fn assemble_prompt_blocks(
    text: &str,
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Vec<Value>, String> {
    let mut blocks = Vec::new();
    blocks.push(json!({
        "type": "text",
        "text": text,
    }));
    let image_files =
        crate::engine::cli_image_input::resolve_existing_image_files(images, workspace_path)?;
    for path in image_files {
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("failed to read image {}: {error}", path.display()))?;
        let mime = mime_type_for_image_path(&path).unwrap_or("image/png");
        blocks.push(json!({
            "type": "image",
            "data": BASE64_STANDARD.encode(bytes),
            "mimeType": mime,
        }));
    }
    Ok(blocks)
}

pub(crate) fn binary_file_stem(bin: &str) -> String {
    Path::new(bin.trim())
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(bin.trim())
        .to_ascii_lowercase()
}

pub(crate) fn is_qoder_ide_launcher_bin(bin: &str) -> bool {
    binary_file_stem(bin) == QODER_IDE_LAUNCHER_NAME
}

pub(crate) fn resolve_qodercli_bin(custom_bin: Option<&str>) -> Result<String, String> {
    if let Some(custom) = custom_bin.map(str::trim).filter(|value| !value.is_empty()) {
        if is_qoder_ide_launcher_bin(custom) {
            return Err(
                "qoderBin must point to qodercli, not the Qoder IDE launcher (`qoder`)".to_string(),
            );
        }
        return Ok(custom.to_string());
    }
    Ok(
        crate::backend::app_server::find_cli_binary(QODER_CLI_NAME, None)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| QODER_CLI_NAME.to_string()),
    )
}

fn initialize_params() -> Value {
    json!({
        "protocolVersion": ACP_PROTOCOL_VERSION,
        "clientInfo": {
            "name": "mossx",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "clientCapabilities": {
            "fs": {
                "readTextFile": true,
                "writeTextFile": true,
            }
        }
    })
}

fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .or_else(|| value.get("session_id"))
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn parse_qoder_models_from_session_new(result: &Value) -> Vec<ModelInfo> {
    let models_node = result.get("models").unwrap_or(result);
    let current = models_node
        .get("currentModelId")
        .or_else(|| models_node.get("current_model_id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut reasoning_efforts = Vec::new();
    let mut default_effort = None;
    if let Some(options) = result.get("configOptions").and_then(Value::as_array) {
        for option in options {
            let id = option
                .get("configId")
                .or_else(|| option.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if id != "reasoning_effort" {
                continue;
            }
            default_effort = option
                .get("value")
                .or_else(|| option.get("currentValue"))
                .and_then(Value::as_str)
                .map(str::to_string);
            if let Some(choices) = option.get("options").and_then(Value::as_array) {
                for choice in choices {
                    let value = choice
                        .get("value")
                        .or_else(|| choice.get("id"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !value.is_empty() && !reasoning_efforts.contains(&value) {
                        reasoning_efforts.push(value);
                    }
                }
            }
        }
    }
    let available = models_node
        .get("availableModels")
        .or_else(|| models_node.get("available_models"))
        .and_then(Value::as_array);
    let mut models = Vec::new();
    if let Some(available) = available {
        for entry in available {
            let id = entry
                .get("modelId")
                .or_else(|| entry.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            if id.is_empty() {
                continue;
            }
            let name = entry
                .get("name")
                .or_else(|| entry.get("displayName"))
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .to_string();
            let mut info = ModelInfo::new(id.clone(), name)
                .with_provider("qoder")
                .with_protocol("acp")
                .with_provenance("cli:qoder-acp")
                .with_source("detected");
            if !reasoning_efforts.is_empty() || default_effort.is_some() {
                info = info.with_reasoning(reasoning_efforts.clone(), default_effort.clone());
            }
            if current.as_deref() == Some(id.as_str()) {
                info = info.as_default();
            }
            models.push(info);
        }
    }
    if let Some(first) = models.first_mut() {
        if current.is_none() {
            first.default = true;
        }
    }
    models
}

pub(crate) fn jsonrpc_request(id: u64, method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
}

pub(crate) fn jsonrpc_notification(method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
}

pub(crate) fn encode_ndjson(value: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub(crate) fn spawn_qoder_command(
    custom_bin: Option<&str>,
    workspace_path: &Path,
    home_dir: Option<&str>,
    custom_args: Option<&str>,
) -> Result<Command, String> {
    let bin = resolve_qodercli_bin(custom_bin)?;
    if is_qoder_ide_launcher_bin(&bin) {
        return Err(
            "qoderBin must point to qodercli, not the Qoder IDE launcher (`qoder`)".to_string(),
        );
    }
    let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
    cmd.current_dir(workspace_path);
    if let Some(args) = custom_args {
        for arg in args.split_whitespace() {
            if arg == "--acp" {
                continue;
            }
            cmd.arg(arg);
        }
    }
    cmd.arg("--acp");
    if let Some(home) = home_dir.map(str::trim).filter(|value| !value.is_empty()) {
        cmd.env("QODER_HOME", home);
        cmd.arg("--config-dir");
        cmd.arg(home);
    }
    crate::engine::qoder_auth::apply_qoder_pat_env(&mut cmd);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    Ok(cmd)
}

pub(crate) struct QoderAcpProcess {
    stdin: std::sync::Arc<Mutex<Option<ChildStdin>>>,
    stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    next_id: u64,
    workspace_root: PathBuf,
    pub collected_updates: Vec<Value>,
}

impl QoderAcpProcess {
    fn new(
        stdin: std::sync::Arc<Mutex<Option<ChildStdin>>>,
        stdout: tokio::process::ChildStdout,
        workspace_root: PathBuf,
    ) -> Self {
        Self {
            stdin,
            stdout: BufReader::new(stdout).lines(),
            next_id: 1,
            workspace_root,
            collected_updates: Vec::new(),
        }
    }

    async fn write_line(&self, value: &Value) -> Result<(), String> {
        let bytes = encode_ndjson(value)?;
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "Qoder ACP stdin is closed".to_string())?;
        stdin
            .write_all(&bytes)
            .await
            .map_err(|error| format!("failed to write ACP request: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("failed to flush ACP request: {error}"))?;
        Ok(())
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write_line(&jsonrpc_notification(method, params)).await
    }

    pub async fn initialize(&mut self) -> Result<Value, String> {
        self.request(
            "initialize",
            initialize_params(),
            QODER_RPC_HANDSHAKE_TIMEOUT,
        )
        .await
    }

    pub async fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout_dur: Duration,
    ) -> Result<Value, String> {
        self.request_with_updates(method, params, timeout_dur, |_| {})
            .await
    }

    pub async fn request_with_updates<F>(
        &mut self,
        method: &str,
        params: Value,
        timeout_dur: Duration,
        mut on_update: F,
    ) -> Result<Value, String>
    where
        F: FnMut(Value),
    {
        let id = self.next_id;
        self.next_id += 1;
        let expected_key = id.to_string();
        self.write_line(&jsonrpc_request(id, method, params))
            .await?;
        let deadline = tokio::time::Instant::now() + timeout_dur;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err(format!("{method} timed out"));
            }
            let line = match timeout(remaining, self.stdout.next_line()).await {
                Ok(Ok(Some(line))) => line,
                Ok(Ok(None)) => return Err(format!("{method} ended: ACP stdout closed")),
                Ok(Err(error)) => return Err(format!("{method} stdout error: {error}")),
                Err(_) => return Err(format!("{method} timed out")),
            };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            let value = match serde_json::from_str::<Value>(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            match parse_acp_line(&value) {
                AcpLine::Response {
                    id: response_id,
                    result,
                    error,
                } => {
                    if jsonrpc_id_key(&response_id).as_deref() != Some(expected_key.as_str()) {
                        continue;
                    }
                    if let Some(error) = error {
                        return Err(format!(
                            "rpc:{code}:{message}",
                            code = error.code,
                            message = error.message
                        ));
                    }
                    return Ok(result.unwrap_or(Value::Null));
                }
                AcpLine::Notification {
                    method: notif_method,
                    params,
                } => {
                    if notif_method == "session/update" {
                        self.collected_updates.push(params.clone());
                        on_update(params);
                    }
                }
                AcpLine::AgentRequest {
                    id: request_id,
                    method: request_method,
                    params,
                } => {
                    let response = answer_agent_request(
                        &self.workspace_root,
                        &request_id,
                        &request_method,
                        &params,
                    );
                    self.write_line(&response).await?;
                }
                AcpLine::Other => {}
            }
        }
    }
}

fn spawn_stderr_collector(stderr: tokio::process::ChildStderr) -> tokio::task::JoinHandle<String> {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut text = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            text.push_str(&line);
            text.push('\n');
        }
        text
    })
}

pub(crate) async fn spawn_qoder_acp_process(
    custom_bin: Option<&str>,
    workspace_path: &Path,
    home_dir: Option<&str>,
    custom_args: Option<&str>,
) -> Result<
    (
        Child,
        QoderAcpProcess,
        tokio::task::JoinHandle<String>,
        std::sync::Arc<Mutex<Option<ChildStdin>>>,
    ),
    String,
> {
    let mut command = spawn_qoder_command(custom_bin, workspace_path, home_dir, custom_args)?;
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn qodercli: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture stdin".to_string())?;
    let stdin = std::sync::Arc::new(Mutex::new(Some(stdin)));
    let process = QoderAcpProcess::new(stdin.clone(), stdout, workspace_path.to_path_buf());
    Ok((child, process, spawn_stderr_collector(stderr), stdin))
}

pub(crate) async fn run_qoder_acp_initialized<T, F>(
    custom_bin: Option<&str>,
    workspace_path: &Path,
    home_dir: Option<&str>,
    timeout_dur: Duration,
    body: F,
) -> Result<T, String>
where
    F: for<'a> FnOnce(
        &'a mut QoderAcpProcess,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<T, String>> + Send + 'a>,
    >,
{
    let (mut child, mut acp, stderr_task, _stdin) =
        spawn_qoder_acp_process(custom_bin, workspace_path, home_dir, None).await?;
    let outcome = async {
        acp.initialize().await?;
        body(&mut acp).await
    };
    let result = timeout(timeout_dur, outcome).await;
    let _ = child.kill().await;
    let _ = timeout(QODER_POST_TERMINAL_DRAIN, child.wait()).await;
    let _ = timeout(QODER_STDERR_JOIN_TIMEOUT, stderr_task).await;
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error),
        Err(_) => Err("Qoder ACP call timed out".to_string()),
    }
}

fn parse_rpc_error_code(message: &str) -> Option<String> {
    let rest = message.strip_prefix("rpc:")?;
    let code = rest.split(':').next()?;
    (!code.is_empty()).then(|| code.to_string())
}

fn parse_rpc_error_message(message: &str) -> String {
    if let Some(rest) = message.strip_prefix("rpc:") {
        if let Some((_, text)) = rest.split_once(':') {
            return text.to_string();
        }
    }
    message.to_string()
}

impl QoderSession {
    pub fn new(
        workspace_id: String,
        workspace_path: PathBuf,
        config: Option<EngineConfig>,
    ) -> Self {
        let (event_sender, _) = broadcast::channel(1024);
        let config = config.unwrap_or_default();
        Self {
            workspace_id,
            workspace_path,
            session_id: RwLock::new(None),
            event_sender,
            bin_path: config.bin_path,
            home_dir: config.home_dir,
            custom_args: config.custom_args,
            active_processes: Mutex::new(HashMap::new()),
            interrupted_turns: Mutex::new(HashSet::new()),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<QoderTurnEvent> {
        self.event_sender.subscribe()
    }

    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
        let _ = self.event_sender.send(QoderTurnEvent {
            turn_id: turn_id.to_string(),
            event,
        });
    }

    pub fn emit_error(&self, turn_id: &str, error: String) {
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error,
                code: None,
            },
        );
    }

    fn emit_error_with_code(&self, turn_id: &str, error: String, code: Option<String>) {
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error,
                code,
            },
        );
    }

    pub(crate) fn build_command(&self) -> Result<Command, String> {
        spawn_qoder_command(
            self.bin_path.as_deref(),
            &self.workspace_path,
            self.home_dir.as_deref(),
            self.custom_args.as_deref(),
        )
    }

    pub async fn send_message(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        let prompt_blocks = match assemble_prompt_blocks(
            &params.text,
            params.images.as_deref(),
            &self.workspace_path,
        ) {
            Ok(blocks) => blocks,
            Err(error) => {
                let error_msg = format!("Failed to assemble Qoder prompt: {error}");
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };

        let (child, mut acp, mut stderr_task, stdin) = match spawn_qoder_acp_process(
            self.bin_path.as_deref(),
            &self.workspace_path,
            self.home_dir.as_deref(),
            self.custom_args.as_deref(),
        )
        .await
        {
            Ok(spawned) => spawned,
            Err(error) => {
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
        };

        {
            let mut active = self.active_processes.lock().await;
            active.insert(
                turn_id.to_string(),
                ActiveQoderChildProcess::new(child, stdin),
            );
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnStarted {
                workspace_id: self.workspace_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        let mut response_text = String::new();
        let mut pending_error_chunks: Vec<String> = Vec::new();
        let mut terminal_error: Option<(String, Option<String>)> = None;
        let mut prompt_result: Option<Value> = None;
        let mut handshake_failed = false;

        let result = async {
            acp.initialize().await?;
            let cwd = self.workspace_path.to_string_lossy().to_string();
            let resume_id = params
                .session_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .filter(|_| params.continue_session)
                .map(str::to_string);
            let session_result = if let Some(session_id) = resume_id.as_ref() {
                acp.request(
                    "session/resume",
                    json!({
                        "cwd": cwd,
                        "mcpServers": [],
                        "sessionId": session_id,
                    }),
                    QODER_SESSION_RESUME_TIMEOUT,
                )
                .await?
            } else {
                acp.request(
                    "session/new",
                    json!({
                        "cwd": cwd,
                        "mcpServers": [],
                    }),
                    QODER_SESSION_NEW_TIMEOUT,
                )
                .await?
            };
            let session_id = extract_session_id(&session_result)
                .or_else(|| resume_id.clone())
                .ok_or_else(|| "Qoder session handshake returned no sessionId".to_string())?;
            self.set_session_id(Some(session_id.clone())).await;
            {
                let mut active = self.active_processes.lock().await;
                if let Some(process) = active.get_mut(turn_id) {
                    process.acp_session_id = Some(session_id.clone());
                }
            }
            self.emit_turn_event(
                turn_id,
                EngineEvent::SessionStarted {
                    workspace_id: self.workspace_id.clone(),
                    session_id: session_id.clone(),
                    engine: EngineType::Qoder,
                    turn_id: Some(turn_id.to_string()),
                },
            );
            if let Some(model) = params
                .model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                let _ = acp
                    .request(
                        "session/set_model",
                        json!({
                            "sessionId": session_id,
                            "modelId": model,
                        }),
                        QODER_RPC_HANDSHAKE_TIMEOUT,
                    )
                    .await;
            }
            if let Some(effort) = params
                .effort
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                let _ = acp
                    .request(
                        "session/set_config_option",
                        json!({
                            "sessionId": session_id,
                            "configId": "reasoning_effort",
                            "value": effort,
                        }),
                        QODER_RPC_HANDSHAKE_TIMEOUT,
                    )
                    .await;
            }
            acp.request(
                "session/set_mode",
                json!({
                    "sessionId": session_id,
                    "modeId": "bypassPermissions",
                }),
                QODER_RPC_HANDSHAKE_TIMEOUT,
            )
            .await?;

            let workspace_id = self.workspace_id.clone();
            let event_sender = self.event_sender.clone();
            let turn_id_owned = turn_id.to_string();
            let result = acp
                .request_with_updates(
                    "session/prompt",
                    json!({
                        "sessionId": session_id,
                        "prompt": prompt_blocks,
                    }),
                    Duration::from_secs(60 * 30),
                    |params| {
                        if prompt_result.is_some() || terminal_error.is_some() {
                            return;
                        }
                        match session_update_from_notification(&params) {
                            QoderSessionUpdate::AgentMessageChunk { text } => {
                                if is_error_prefixed_text(&text) {
                                    pending_error_chunks.push(text);
                                    return;
                                }
                                response_text.push_str(&text);
                                let _ = event_sender.send(QoderTurnEvent {
                                    turn_id: turn_id_owned.clone(),
                                    event: EngineEvent::TextDelta {
                                        workspace_id: workspace_id.clone(),
                                        text,
                                    },
                                });
                            }
                            QoderSessionUpdate::AgentThoughtChunk { text } => {
                                let _ = event_sender.send(QoderTurnEvent {
                                    turn_id: turn_id_owned.clone(),
                                    event: EngineEvent::ReasoningDelta {
                                        workspace_id: workspace_id.clone(),
                                        text,
                                    },
                                });
                            }
                            QoderSessionUpdate::ToolStarted {
                                tool_id,
                                tool_name,
                                input,
                            } => {
                                let _ = event_sender.send(QoderTurnEvent {
                                    turn_id: turn_id_owned.clone(),
                                    event: EngineEvent::ToolStarted {
                                        workspace_id: workspace_id.clone(),
                                        tool_id,
                                        tool_name,
                                        input,
                                    },
                                });
                            }
                            QoderSessionUpdate::ToolCompleted {
                                tool_id,
                                tool_name,
                                output,
                                error,
                            } => {
                                let _ = event_sender.send(QoderTurnEvent {
                                    turn_id: turn_id_owned.clone(),
                                    event: EngineEvent::ToolCompleted {
                                        workspace_id: workspace_id.clone(),
                                        tool_id,
                                        tool_name,
                                        output,
                                        error,
                                    },
                                });
                            }
                            QoderSessionUpdate::Ignore => {}
                        }
                    },
                )
                .await;
            result
        }
        .await;

        match result {
            Ok(value) => prompt_result = Some(value),
            Err(error) => {
                handshake_failed = error.contains("initialize")
                    || error.contains("session/new")
                    || error.contains("session/resume")
                    || error.contains("session/set_mode")
                    || error.contains("session handshake");
                terminal_error = Some((error.clone(), parse_rpc_error_code(&error)));
            }
        }

        tokio::time::sleep(QODER_POST_TERMINAL_DRAIN).await;
        let stderr_text = self.cleanup_child(turn_id, &mut stderr_task).await;
        let was_interrupted = self.interrupted_turns.lock().await.remove(turn_id);

        if was_interrupted {
            let error_msg = "Session stopped.".to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }
        if let Some(mut result) = prompt_result {
            if result.get("text").is_none() {
                result["text"] = json!(response_text.clone());
            }
            if result.get("stopReason").is_none() {
                result["stopReason"] = json!("end_turn");
            }
            self.emit_turn_event(
                turn_id,
                EngineEvent::TurnCompleted {
                    workspace_id: self.workspace_id.clone(),
                    result: Some(result),
                },
            );
            return Ok(response_text);
        }

        let (raw_error, code) = terminal_error.unwrap_or_else(|| {
            (
                if !stderr_text.trim().is_empty() {
                    stderr_text.trim().to_string()
                } else {
                    "Qoder exited without a prompt response".to_string()
                },
                None,
            )
        });
        let message = if !pending_error_chunks.is_empty() {
            pending_error_chunks.join("\n")
        } else {
            let parsed = parse_rpc_error_message(&raw_error);
            if parsed.trim().is_empty() && !stderr_text.trim().is_empty() {
                stderr_text.trim().to_string()
            } else {
                parsed
            }
        };
        let _ = handshake_failed;
        self.emit_error_with_code(turn_id, message.clone(), code);
        Err(message)
    }

    async fn cleanup_child(
        &self,
        turn_id: &str,
        stderr_task: &mut tokio::task::JoinHandle<String>,
    ) -> String {
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active
                .remove(turn_id)
                .map(ActiveQoderChildProcess::into_child)
        };
        if let Some(mut process) = child.take() {
            let _ = process.kill().await;
            let _ = timeout(QODER_POST_TERMINAL_DRAIN, process.wait()).await;
        }
        match timeout(QODER_STDERR_JOIN_TIMEOUT, stderr_task).await {
            Ok(Ok(text)) => text,
            _ => String::new(),
        }
    }

    pub async fn interrupt(&self) -> Result<(), String> {
        let mut active = self.active_processes.lock().await;
        let mut interrupted = self.interrupted_turns.lock().await;
        let mut killed_turn_ids = Vec::new();
        let mut errors = Vec::new();
        for (turn_id, process) in active.iter_mut() {
            if let Some(session_id) = process.acp_session_id.clone() {
                if let Some(stdin) = process.stdin.lock().await.as_mut() {
                    let payload =
                        jsonrpc_notification("session/cancel", json!({ "sessionId": session_id }));
                    if let Ok(bytes) = encode_ndjson(&payload) {
                        let _ = stdin.write_all(&bytes).await;
                        let _ = stdin.flush().await;
                    }
                }
            }
            match process.child.kill().await {
                Ok(()) => {
                    interrupted.insert(turn_id.clone());
                    killed_turn_ids.push(turn_id.clone());
                }
                Err(error) => errors.push(format!("{turn_id}: {error}")),
            }
        }
        for turn_id in &killed_turn_ids {
            active.remove(turn_id);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "failed to interrupt {} qoder turn(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    pub async fn interrupt_turn(&self, turn_id: &str) -> Result<(), String> {
        let mut active = self.active_processes.lock().await;
        let Some(process) = active.get_mut(turn_id) else {
            return Ok(());
        };
        if let Some(session_id) = process.acp_session_id.clone() {
            if let Some(stdin) = process.stdin.lock().await.as_mut() {
                let payload =
                    jsonrpc_notification("session/cancel", json!({ "sessionId": session_id }));
                if let Ok(bytes) = encode_ndjson(&payload) {
                    let _ = stdin.write_all(&bytes).await;
                    let _ = stdin.flush().await;
                }
            }
        }
        let kill_result = process
            .child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill process: {e}"));
        let mut interrupted_turns = self.interrupted_turns.lock().await;
        apply_interrupt_result(&mut active, &mut interrupted_turns, turn_id, kill_result)
    }

    #[allow(dead_code)]
    pub async fn active_process_snapshots(
        &self,
        sampled_at_ms: u64,
    ) -> Vec<QoderActiveProcessSnapshot> {
        let active = self.active_processes.lock().await;
        active
            .values()
            .filter_map(|process| process.snapshot(sampled_at_ms))
            .collect()
    }
}

impl Drop for QoderSession {
    fn drop(&mut self) {
        let Ok(mut active) = self.active_processes.try_lock() else {
            log::warn!(
                "[qoder] dropping session workspace={} while active_processes is locked",
                self.workspace_id
            );
            return;
        };
        if active.is_empty() {
            return;
        }
        for (turn_id, process) in active.drain() {
            let mut child = process.into_child();
            let pid = child.id();
            match child.start_kill() {
                Ok(()) => {
                    log::info!(
                        "[qoder] drop fallback kill workspace={} turn={} pid={:?}",
                        self.workspace_id,
                        turn_id,
                        pid
                    );
                }
                Err(error) => {
                    log::warn!(
                        "[qoder] drop fallback failed workspace={} turn={} pid={:?}: {}",
                        self.workspace_id,
                        turn_id,
                        pid,
                        error
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_response_notification_and_agent_request() {
        let response = json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}});
        match parse_acp_line(&response) {
            AcpLine::Response { id, result, error } => {
                assert_eq!(id, json!(1));
                assert_eq!(result, Some(json!({"ok":true})));
                assert!(error.is_none());
            }
            other => panic!("expected response, got {other:?}"),
        }
        let notification = json!({
            "jsonrpc":"2.0",
            "method":"session/update",
            "params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}}}
        });
        match parse_acp_line(&notification) {
            AcpLine::Notification { method, .. } => assert_eq!(method, "session/update"),
            other => panic!("expected notification, got {other:?}"),
        }
        let request = json!({
            "jsonrpc":"2.0",
            "id":7,
            "method":"session/request_permission",
            "params":{"options":[]}
        });
        match parse_acp_line(&request) {
            AcpLine::AgentRequest { id, method, .. } => {
                assert_eq!(id, json!(7));
                assert_eq!(method, "session/request_permission");
            }
            other => panic!("expected agent request, got {other:?}"),
        }
    }

    #[test]
    fn maps_session_update_kinds() {
        let text =
            json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}});
        assert_eq!(
            map_session_update(&text),
            QoderSessionUpdate::AgentMessageChunk {
                text: "hello".into()
            }
        );
        let think = json!({"sessionUpdate":"agent_thought_chunk","content":{"text":"plan"}});
        assert_eq!(
            map_session_update(&think),
            QoderSessionUpdate::AgentThoughtChunk {
                text: "plan".into()
            }
        );
        let tool = json!({
            "sessionUpdate":"tool_call",
            "status":"pending",
            "toolCallId":"t1",
            "title":"bash",
            "rawInput":{"command":"ls"}
        });
        match map_session_update(&tool) {
            QoderSessionUpdate::ToolStarted {
                tool_id,
                tool_name,
                input,
            } => {
                assert_eq!(tool_id, "t1");
                assert_eq!(tool_name, "bash");
                assert_eq!(input, Some(json!({"command":"ls"})));
            }
            other => panic!("expected ToolStarted, got {other:?}"),
        }
        let tool_done = json!({
            "sessionUpdate":"tool_call_update",
            "status":"completed",
            "toolCallId":"t1",
            "content":{"text":"ok"}
        });
        match map_session_update(&tool_done) {
            QoderSessionUpdate::ToolCompleted { tool_id, error, .. } => {
                assert_eq!(tool_id, "t1");
                assert!(error.is_none());
            }
            other => panic!("expected ToolCompleted, got {other:?}"),
        }
        let ignore = json!({"sessionUpdate":"available_commands_update","availableCommands":[]});
        assert_eq!(map_session_update(&ignore), QoderSessionUpdate::Ignore);
        let unknown = json!({"sessionUpdate":"totally_new"});
        assert_eq!(map_session_update(&unknown), QoderSessionUpdate::Ignore);
        let in_progress_update = json!({
            "sessionUpdate":"tool_call_update",
            "status":"in_progress",
            "toolCallId":"t1"
        });
        assert_eq!(
            map_session_update(&in_progress_update),
            QoderSessionUpdate::Ignore
        );
        let plan = json!({"sessionUpdate":"plan"});
        assert_eq!(map_session_update(&plan), QoderSessionUpdate::Ignore);
        let user = json!({"sessionUpdate":"user_message_chunk","content":{"text":"hi"}});
        assert_eq!(map_session_update(&user), QoderSessionUpdate::Ignore);
        let config = json!({"sessionUpdate":"config_option_update"});
        assert_eq!(map_session_update(&config), QoderSessionUpdate::Ignore);
    }

    #[test]
    fn error_prefixed_chunks_are_detected_for_dedupe() {
        assert!(is_error_prefixed_text("[Error] Network attempt failed"));
        assert!(is_error_prefixed_text("  [Error] boom"));
        assert!(!is_error_prefixed_text("hello [Error] later"));
    }

    #[test]
    fn permission_auto_answer_selects_first_allow_kind() {
        let params = json!({
            "options": [
                {"kind":"reject_once","optionId":"no"},
                {"kind":"allowAlways","optionId":"yes-always"},
                {"kind":"allowOnce","optionId":"yes"}
            ]
        });
        let result = permission_auto_answer(&params).expect("answer");
        assert_eq!(result["outcome"]["optionId"], "yes-always");
        assert_eq!(result["outcome"]["outcome"], "selected");
    }

    #[test]
    fn fs_sandbox_rejects_escape() {
        let root = std::env::temp_dir().join(format!("qoder-fs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let err = confine_path_to_workspace(&root, "/etc/passwd", false).expect_err("escape");
        assert!(err.contains("escapes workspace root"), "{err}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn assemble_prompt_blocks_preserves_text_and_encodes_image() {
        let dir = std::env::temp_dir().join(format!("qoder-img-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let image = dir.join("shot.png");
        std::fs::write(&image, b"fake-png").unwrap();
        let blocks =
            assemble_prompt_blocks("look", Some(&[image.to_string_lossy().to_string()]), &dir)
                .expect("blocks");
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "look");
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
        assert!(!blocks[1]["data"].as_str().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn assemble_prompt_blocks_fails_on_missing_image() {
        let dir = std::env::temp_dir().join(format!("qoder-img-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let err = assemble_prompt_blocks(
            "look",
            Some(&[dir.join("missing.png").to_string_lossy().to_string()]),
            &dir,
        )
        .expect_err("missing image");
        assert!(err.contains("none of the attached images"), "{err}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_session_id_requires_continue() {
        assert_eq!(
            resolve_qoder_session_id_for_engine_send(
                false,
                Some("abc".into()),
                Some("tracked".into())
            ),
            None
        );
        assert_eq!(
            resolve_qoder_session_id_for_engine_send(
                true,
                Some("abc".into()),
                Some("tracked".into())
            ),
            Some("abc".into())
        );
        assert_eq!(
            resolve_qoder_session_id_for_engine_send(true, None, Some("tracked".into())),
            Some("tracked".into())
        );
    }

    #[test]
    fn build_command_rejects_ide_launcher_named_qoder() {
        let session = QoderSession::new(
            "ws".into(),
            std::env::temp_dir(),
            Some(EngineConfig {
                bin_path: Some("qoder".into()),
                ..Default::default()
            }),
        );
        let err = session.build_command().expect_err("launcher rejected");
        assert!(err.contains("qodercli"), "{err}");
        assert!(err.contains("IDE launcher"), "{err}");
    }

    #[test]
    fn unknown_agent_request_returns_method_not_found() {
        let root = std::env::temp_dir();
        let response = answer_agent_request(&root, &json!(3), "totally/unknown", &json!({}));
        assert_eq!(response["error"]["code"], JSONRPC_METHOD_NOT_FOUND);
    }

    #[tokio::test]
    async fn interrupt_unknown_turn_is_idempotent() {
        let session = QoderSession::new("ws".into(), std::env::temp_dir(), None);
        session.interrupt_turn("missing").await.expect("idempotent");
        assert!(session.interrupted_turns.lock().await.is_empty());
    }
}
