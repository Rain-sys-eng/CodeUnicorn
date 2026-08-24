//! PI CLI engine implementation
//!
//! Headless protocol (JetBrains-aligned, spike-verified on pi 0.83):
//! `pi --print --mode json "<prompt>" [--model] [--session-id] [--thinking]`
//!
//! NDJSON event types:
//! - `session` { id }
//! - `message_update` { assistantMessageEvent: { type: text_delta|thinking_delta, delta } }
//! - `tool_execution_start` / `tool_execution_end`
//! - `message_end` (assistant usage / errors)
//! - `agent_end` / `turn_end` with errorMessage (auth failures etc.)

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};

use super::events::EngineEvent;
use super::pi_rpc::{PiRpcClient, PiRpcPumpEvent};
use super::{EngineConfig, EngineType, SendMessageParams};

const THINKING_LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/// RPC resident path: a turn is settled by typed `agent_settled`, not process
/// EOF. 不按墙钟杀 turn（长 agentic 任务合法地跑几十分钟）：看门狗周期性
/// 与 resident 实况对账，只有持续静默才判超时。
const PI_RPC_TURN_WATCHDOG_TICK: Duration = Duration::from_secs(30);
/// 真超时判据：resident 完全静默（无任何 stdout 行）超过该预算才判死。
/// 必须覆盖 PI_RPC_COMPACT_TIMEOUT(500s)——auto-compaction 在 turn 收尾
/// 阶段同样可能长时间无流式事件。
const PI_RPC_TURN_SILENCE_TIMEOUT: Duration = Duration::from_secs(900);
/// After `abort`, give pi this long to settle before killing the resident.
const PI_RPC_ABORT_SETTLE_GRACE: Duration = Duration::from_secs(2);

// ponytail: pi's NDJSON stream has no terminal "result" event, so turn end is
// detected by stdout EOF. A lingering grandchild (e.g. a bash tool daemon)
// that inherited the stdout pipe would keep the write end open and block EOF
// forever — the claude.rs "turn stuck generating" root cause. Poll child exit
// and stop reading after a grace. Ceiling: the orphan itself is not killed
// (pi, like kimi/grok, spawns without setpgid, so there is no process group to
// killpg); upgrade path = pre_exec setpgid + group kill if this ever bites.
const PI_STDOUT_EXIT_POLL: Duration = Duration::from_millis(250);
const PI_POST_EXIT_GRACE: Duration = Duration::from_secs(5);
const PI_STDERR_JOIN_TIMEOUT: Duration = Duration::from_secs(5);

pub fn resolve_pi_session_id_for_engine_send(
    continue_session: bool,
    explicit_session_id: Option<String>,
    tracked_session_id: Option<String>,
) -> Option<String> {
    continue_session
        .then(|| explicit_session_id.or(tracked_session_id))
        .flatten()
}

/// Result of scanning prompt text for `@<path>` file reference tokens.
///
/// Pi CLI parses argv tokens starting with `@` as file arguments
/// (`cli/args.js`), and print mode never expands inline `@path` inside the
/// prompt message (that expansion is TUI-editor-only). mossx passes the whole
/// prompt as ONE positional argv element, so a prompt merely *starting* with
/// `@` makes pi treat the entire message — spaces, second `@`, Chinese text
/// and all — as a single fake file path and exit(1) with "File not found".
/// Extraction therefore (a) upgrades resolvable references to real `@file`
/// argv entries so their content is injected, and (b) strips them from the
/// prompt so the remaining text cannot be misparsed.
struct AtReferenceExtraction {
    text: String,
    file_args: Vec<String>,
}

/// Resolve a `@` reference candidate to an existing regular file.
///
/// Folders, missing paths, and non-path text (e.g. `@teammate`) return None
/// so callers keep the token verbatim in the prompt — pi is a tool-using
/// agent and can explore a directory path given as plain text, while
/// `@file` on a directory would make pi's file-processor exit(1).
fn resolve_at_reference_path(raw: &str, workspace_path: &Path) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return None;
    }
    let path = PathBuf::from(trimmed);
    let absolute = if path.is_absolute() {
        path
    } else {
        workspace_path.join(path)
    };
    match std::fs::metadata(&absolute) {
        Ok(meta) if meta.is_file() => Some(absolute),
        _ => None,
    }
}

/// Scan `text` for `@<path>` tokens at token boundaries (start of text or
/// after whitespace) and extract the ones resolving to existing regular
/// files into pi `@file` argv entries.
///
/// Matching is greedy longest-prefix against the filesystem: candidate
/// substrings end at each following whitespace boundary (and end of text),
/// longest first, so paths containing spaces (`@/abs/shot one.png`) resolve
/// as one token. Unresolvable tokens are preserved verbatim and scanning
/// continues after their `@`.
fn extract_at_file_references(text: &str, workspace_path: &Path) -> AtReferenceExtraction {
    let mut cleaned = String::with_capacity(text.len());
    let mut file_args: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut i = 0usize;
    while i < text.len() {
        let ch = text[i..].chars().next().expect("i is a char boundary");
        let at_token_boundary = ch == '@'
            && (i == 0
                || text[..i]
                    .chars()
                    .last()
                    .map(|prev| prev.is_whitespace())
                    .unwrap_or(false));
        if at_token_boundary {
            // Candidate ends: byte index of each whitespace after the `@`,
            // plus end of text. Try longest first.
            let mut ends: Vec<usize> = Vec::new();
            for (off, c) in text[i + 1..].char_indices() {
                if c.is_whitespace() {
                    ends.push(i + 1 + off);
                }
            }
            ends.push(text.len());
            let mut matched: Option<usize> = None;
            for &end in ends.iter().rev() {
                let candidate = &text[i + 1..end];
                if let Some(path) = resolve_at_reference_path(candidate, workspace_path) {
                    let key = path.to_string_lossy().to_string();
                    if seen.insert(key.clone()) {
                        file_args.push(format!("@{key}"));
                    }
                    matched = Some(end);
                    break;
                }
            }
            if let Some(end) = matched {
                // Drop the token; avoid doubling the boundary whitespace.
                i = end;
                if text[i..]
                    .chars()
                    .next()
                    .map(|next| next.is_whitespace())
                    .unwrap_or(false)
                    && cleaned
                        .chars()
                        .last()
                        .map(|prev| prev.is_whitespace())
                        .unwrap_or(false)
                {
                    i += text[i..].chars().next().expect("i is a char boundary").len_utf8();
                }
                continue;
            }
        }
        cleaned.push(ch);
        i += ch.len_utf8();
    }

    AtReferenceExtraction { text: cleaned, file_args }
}

#[derive(Debug, Clone)]
pub struct PiTurnEvent {
    pub turn_id: String,
    pub event: EngineEvent,
}

pub struct PiSession {
    pub workspace_id: String,
    pub workspace_path: PathBuf,
    session_id: RwLock<Option<String>>,
    event_sender: broadcast::Sender<PiTurnEvent>,
    bin_path: Option<String>,
    home_dir: Option<String>,
    custom_args: Option<String>,
    active_processes: Mutex<HashMap<String, ActivePiChildProcess>>,
    interrupted_turns: Mutex<HashSet<String>>,
    /// RPC resident client (`pi --mode rpc`); None until first use or after exit.
    rpc: Arc<RwLock<Option<Arc<PiRpcClient>>>>,
    /// The currently streaming RPC run (main turn + attached steer turns).
    rpc_run: Arc<RwLock<Option<PiRpcRun>>>,
    /// Sticky flag: once RPC spawn/handshake fails, stay on print-json fallback.
    rpc_disabled: Arc<AtomicBool>,
}

/// State of one streaming RPC agent run. The main turn owns the content
/// stream; steer turns attach and settle together with the run (empty text).
struct PiRpcRun {
    main_turn_id: String,
    attached_turn_ids: Vec<String>,
    waiters: Vec<(String, oneshot::Sender<Result<String, String>>)>,
    response_text: String,
    saw_tool_activity: bool,
    tool_names_by_id: HashMap<String, String>,
    tool_inputs_by_id: HashMap<String, Option<Value>>,
    stream_error: Option<String>,
    abort_requested: bool,
}

impl PiRpcRun {
    fn new(main_turn_id: &str, waiter: oneshot::Sender<Result<String, String>>) -> Self {
        Self {
            main_turn_id: main_turn_id.to_string(),
            attached_turn_ids: Vec::new(),
            waiters: vec![(main_turn_id.to_string(), waiter)],
            response_text: String::new(),
            saw_tool_activity: false,
            tool_names_by_id: HashMap::new(),
            tool_inputs_by_id: HashMap::new(),
            stream_error: None,
            abort_requested: false,
        }
    }
}

/// RPC send outcome: `Fallback` means "use the print-json path instead".
/// `Failed` = terminal error NOT yet emitted（send_message 统一发一次）；
/// `Settled` = 错误已随 run 结算发过一次（turn timeout 时全 waiter 一起
/// 结算），send_message 直接返回、禁止二次发 TurnError。
enum PiRpcSendError {
    Fallback(String),
    Failed(String),
    Settled(String),
}

#[allow(dead_code)]
pub struct PiActiveProcessSnapshot {
    pub pid: u32,
    pub registered_age_ms: u64,
}

struct ActivePiChildProcess {
    child: Child,
    #[allow(dead_code)]
    started_at_ms: u64,
}

impl ActivePiChildProcess {
    fn new(child: Child) -> Self {
        Self {
            child,
            started_at_ms: unix_timestamp_ms_for_process_diagnostics(),
        }
    }

    fn into_child(self) -> Child {
        self.child
    }

    #[allow(dead_code)]
    fn snapshot(&self, sampled_at_ms: u64) -> Option<PiActiveProcessSnapshot> {
        Some(PiActiveProcessSnapshot {
            pid: self.child.id()?,
            registered_age_ms: sampled_at_ms.saturating_sub(self.started_at_ms),
        })
    }
}

fn apply_interrupt_result(
    active_processes: &mut HashMap<String, ActivePiChildProcess>,
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

/// Settle an RPC run: main turn gets the accumulated text, attached steer
/// turns settle with empty text (their content is part of the same run's
/// stream). Failures settle every waiting turn with the same error.
fn settle_rpc_run(
    workspace_id: &str,
    run: PiRpcRun,
    fatal: Option<String>,
    emit: &dyn Fn(&str, EngineEvent),
) {
    let failure = fatal
        .or_else(|| {
            if run.abort_requested {
                Some("Session stopped.".to_string())
            } else if run.stream_error.is_some()
                && run.response_text.trim().is_empty()
                && !run.saw_tool_activity
            {
                run.stream_error.clone()
            } else {
                None
            }
        })
        .or_else(|| {
            if run.response_text.trim().is_empty() && !run.saw_tool_activity {
                Some("PI exited without assistant output.".to_string())
            } else {
                None
            }
        });
    for (index, (turn_id, waiter)) in run.waiters.into_iter().enumerate() {
        let is_main = index == 0;
        match &failure {
            Some(error) => {
                emit(
                    &turn_id,
                    EngineEvent::TurnError {
                        workspace_id: workspace_id.to_string(),
                        error: error.clone(),
                        code: None,
                    },
                );
                let _ = waiter.send(Err(error.clone()));
            }
            None => {
                let text = if is_main {
                    run.response_text.clone()
                } else {
                    String::new()
                };
                emit(
                    &turn_id,
                    EngineEvent::TurnCompleted {
                        workspace_id: workspace_id.to_string(),
                        result: Some(json!({ "text": text })),
                    },
                );
                let _ = waiter.send(Ok(text));
            }
        }
    }
}

/// RPC transport carries images inline as base64 ImageContent blocks (the
/// print-json `@file` argv transport does not exist in RPC mode).
fn encode_images_for_rpc(
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Vec<Value>, String> {
    use base64::Engine as _;
    let files = crate::engine::cli_image_input::resolve_existing_image_files(
        images,
        workspace_path,
    )?;
    let mut out = Vec::new();
    for file in files {
        let bytes = std::fs::read(&file).map_err(|error| {
            format!("failed to read image {}: {error}", file.display())
        })?;
        let ext = file
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/png",
        };
        out.push(json!({
            "type": "image",
            "data": base64::engine::general_purpose::STANDARD.encode(bytes),
            "mimeType": mime,
        }));
    }
    Ok(out)
}

enum PiStreamLine {
    SessionId(String),
    TextDelta(String),
    ThinkingDelta(String),
    ToolStart {
        tool_id: String,
        tool_name: String,
        args: Option<Value>,
    },
    ToolEnd {
        tool_id: String,
        content: String,
        is_error: bool,
    },
    AssistantError(String),
    Usage(Value),
    Other,
}

fn resolve_model_flag(model: Option<&str>) -> Option<String> {
    let trimmed = model.map(str::trim).filter(|v| !v.is_empty())?;
    let lower = trimmed.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "__config_default__"
            | "auto"
            | "default"
            | "(default)"
            | "config-default"
            | "config_default"
            | "pi-default"
            | "pi default"
    ) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Split a `provider/modelId` catalog id. Model ids may themselves contain
/// slashes (e.g. openrouter `openai/gpt-4o` → `openrouter/openai/gpt-4o`),
/// so only the FIRST segment is the provider.
fn split_provider_model(value: &str) -> Option<(String, String)> {
    let (provider, model_id) = value.split_once('/')?;
    let provider = provider.trim();
    let model_id = model_id.trim();
    if provider.is_empty() || model_id.is_empty() {
        return None;
    }
    Some((provider.to_string(), model_id.to_string()))
}

/// Reconcile plan for the resident's model vs the requested model.
#[derive(Debug, Clone, PartialEq, Eq)]
enum RpcModelReconcile {
    /// No explicit model requested (auto/default): resident keeps whatever
    /// the pi config default resolved to.
    Skip,
    /// Resident already runs the requested model.
    Match,
    /// Resident runs a different model: `set_model` before prompting.
    Set { provider: String, model_id: String },
    /// Bare model id (no provider prefix) that does not match the resident:
    /// `set_model` needs an explicit provider, so we cannot reconcile
    /// precisely — warn and keep the resident model.
    BareMismatch(String),
}

fn plan_rpc_model_reconcile(
    desired: Option<&str>,
    current: Option<(&str, &str)>,
) -> RpcModelReconcile {
    let Some(desired) = desired else {
        return RpcModelReconcile::Skip;
    };
    match split_provider_model(desired) {
        Some((provider, model_id)) => {
            if current == Some((provider.as_str(), model_id.as_str())) {
                RpcModelReconcile::Match
            } else {
                RpcModelReconcile::Set { provider, model_id }
            }
        }
        None => match current {
            Some((_, model_id)) if model_id == desired => RpcModelReconcile::Match,
            _ => RpcModelReconcile::BareMismatch(desired.to_string()),
        },
    }
}

// Session ids are passed as a CLI flag value; restrict to a conservative
// charset so a hostile or corrupted id (e.g. "-x") is never parsed as a flag.
fn is_valid_pi_session_id_arg(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn resolve_thinking_flag(effort: Option<&str>) -> Option<String> {
    let normalized = effort?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    THINKING_LEVELS
        .iter()
        .find(|level| **level == normalized)
        .map(|level| (*level).to_string())
}

fn extract_tool_result_text(result: Option<&Value>) -> String {
    let Some(result) = result else {
        return String::new();
    };
    if let Some(text) = result.as_str() {
        return text.to_string();
    }
    if let Some(content) = result.get("content") {
        if let Some(text) = content.as_str() {
            return text.to_string();
        }
        if let Some(parts) = content.as_array() {
            let text = parts
                .iter()
                .filter_map(|part| {
                    if let Some(text) = part.as_str() {
                        Some(text.to_string())
                    } else {
                        part.get("text")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                return text;
            }
        }
    }
    result.to_string()
}

fn extract_error_message(value: &Value) -> Option<String> {
    value
        .get("errorMessage")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .get("message")
                .and_then(|message| message.get("errorMessage"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        })
}

/// Parse one NDJSON line from `pi --print --mode json`.
fn parse_pi_stream_line(value: &Value) -> PiStreamLine {
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "session" => {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string);
            match id {
                Some(session_id) => PiStreamLine::SessionId(session_id),
                None => PiStreamLine::Other,
            }
        }
        "message_update" => {
            let update = value.get("assistantMessageEvent");
            let update_type = update
                .and_then(|u| u.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let delta = update
                .and_then(|u| u.get("delta"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if delta.is_empty() {
                return PiStreamLine::Other;
            }
            match update_type {
                "text_delta" => PiStreamLine::TextDelta(delta.to_string()),
                "thinking_delta" => PiStreamLine::ThinkingDelta(delta.to_string()),
                _ => PiStreamLine::Other,
            }
        }
        "tool_execution_start" => {
            let tool_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let tool_name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let args = value.get("args").cloned();
            if tool_id.is_empty() {
                PiStreamLine::Other
            } else {
                PiStreamLine::ToolStart {
                    tool_id,
                    tool_name,
                    args,
                }
            }
        }
        "tool_execution_end" => {
            let tool_id = value
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if tool_id.is_empty() {
                return PiStreamLine::Other;
            }
            let content = extract_tool_result_text(value.get("result"));
            let is_error = value
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            PiStreamLine::ToolEnd {
                tool_id,
                content,
                is_error,
            }
        }
        "message_end" | "message_start" => {
            if let Some(error) = extract_error_message(value) {
                return PiStreamLine::AssistantError(error);
            }
            let message = value.get("message");
            let role = message
                .and_then(|m| m.get("role"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if role == "assistant" {
                if let Some(usage) = message.and_then(|m| m.get("usage")) {
                    return PiStreamLine::Usage(usage.clone());
                }
            }
            PiStreamLine::Other
        }
        "agent_end" | "turn_end" => {
            if let Some(error) = extract_error_message(value) {
                PiStreamLine::AssistantError(error)
            } else {
                PiStreamLine::Other
            }
        }
        _ => PiStreamLine::Other,
    }
}

impl PiSession {
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
            rpc: Arc::new(RwLock::new(None)),
            rpc_run: Arc::new(RwLock::new(None)),
            rpc_disabled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PiTurnEvent> {
        self.event_sender.subscribe()
    }

    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
        let _ = self.event_sender.send(PiTurnEvent {
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

    fn resolve_bin_path(&self) -> String {
        if let Some(ref custom) = self.bin_path {
            custom.clone()
        } else {
            crate::backend::app_server::find_cli_binary("pi", None)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "pi".to_string())
        }
    }

    // ===== RPC resident path (`pi --mode rpc`) =====

    /// Ensure a live RPC client. On spawn/handshake failure the sticky
    /// `rpc_disabled` flag flips so subsequent sends go straight to fallback.
    ///
    /// `model` only applies at SPAWN time: a reused resident ignores it.
    /// Sends MUST reconcile the resident model afterwards via
    /// `reconcile_rpc_model` (tree/stats commands spawn model-less residents
    /// pinned to the pi config default — 2026-08-23 model drift incident).
    async fn ensure_rpc(
        &self,
        session_id_hint: Option<&str>,
        model: Option<&str>,
    ) -> Result<Arc<PiRpcClient>, String> {
        if self.rpc_disabled.load(Ordering::SeqCst) {
            return Err("pi rpc disabled after previous failure".to_string());
        }
        {
            let guard = self.rpc.read().await;
            if let Some(client) = guard.as_ref() {
                if client.is_alive().await {
                    return Ok(client.clone());
                }
            }
        }
        let mut guard = self.rpc.write().await;
        if let Some(client) = guard.as_ref() {
            if client.is_alive().await {
                return Ok(client.clone());
            }
        }
        let tracked = self.get_session_id().await;
        let session_id = session_id_hint
            .map(str::to_string)
            .or(tracked)
            .filter(|value| is_valid_pi_session_id_arg(value));
        let spawn_result = PiRpcClient::spawn(
            &self.resolve_bin_path(),
            &self.workspace_path,
            session_id.as_deref(),
            model,
            self.home_dir.as_deref(),
            self.custom_args.as_deref(),
        )
        .await;
        match spawn_result {
            Ok(client) => {
                if let Some(id) = client.session_id().await {
                    self.set_session_id(Some(id)).await;
                }
                self.spawn_rpc_projection(client.clone());
                *guard = Some(client.clone());
                log::info!(
                    "[pi/rpc] resident spawned workspace={} session={:?}",
                    self.workspace_id,
                    session_id
                );
                Ok(client)
            }
            Err(error) => {
                self.rpc_disabled.store(true, Ordering::SeqCst);
                Err(error)
            }
        }
    }

    /// Project raw RPC agent events onto EngineEvents routed to the active run.
    fn spawn_rpc_projection(&self, client: Arc<PiRpcClient>) {
        let mut receiver = client.subscribe();
        let event_sender = self.event_sender.clone();
        let rpc_run = self.rpc_run.clone();
        let rpc_slot = self.rpc.clone();
        let workspace_id = self.workspace_id.clone();
        tokio::spawn(async move {
            let emit = |turn_id: &str, event: EngineEvent| {
                let _ = event_sender.send(PiTurnEvent {
                    turn_id: turn_id.to_string(),
                    event,
                });
            };
            loop {
                let pump_event = match receiver.recv().await {
                    Ok(event) => event,
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("[pi/rpc] projection lagged; skipped {skipped} events");
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                match pump_event {
                    PiRpcPumpEvent::Agent(value) => {
                        let event_type = value
                            .get("type")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        if event_type == "agent_settled" {
                            let run = rpc_run.write().await.take();
                            if let Some(run) = run {
                                settle_rpc_run(&workspace_id, run, None, &emit);
                            }
                            continue;
                        }
                        if event_type == "compaction_start" || event_type == "compaction_end" {
                            let turn_id = {
                                let guard = rpc_run.read().await;
                                guard.as_ref().map(|run| run.main_turn_id.clone())
                            };
                            if let Some(turn_id) = turn_id {
                                let kind = if event_type == "compaction_start" {
                                    "compaction_start"
                                } else {
                                    "compaction_end"
                                };
                                emit(
                                    &turn_id,
                                    EngineEvent::Raw {
                                        workspace_id: workspace_id.clone(),
                                        engine: EngineType::Pi,
                                        data: json!({
                                            "source": "pi_rpc",
                                            "kind": kind,
                                            "payload": value,
                                        }),
                                    },
                                );
                            }
                            continue;
                        }
                        let mut guard = rpc_run.write().await;
                        let Some(run) = guard.as_mut() else {
                            continue;
                        };
                        let turn_id = run.main_turn_id.clone();
                        match parse_pi_stream_line(&value) {
                            PiStreamLine::TextDelta(delta) => {
                                run.response_text.push_str(&delta);
                                emit(
                                    &turn_id,
                                    EngineEvent::TextDelta {
                                        workspace_id: workspace_id.clone(),
                                        text: delta,
                                    },
                                );
                            }
                            PiStreamLine::ThinkingDelta(delta) => {
                                emit(
                                    &turn_id,
                                    EngineEvent::ReasoningDelta {
                                        workspace_id: workspace_id.clone(),
                                        text: delta,
                                    },
                                );
                            }
                            PiStreamLine::ToolStart {
                                tool_id,
                                tool_name,
                                args,
                            } => {
                                run.saw_tool_activity = true;
                                run.tool_names_by_id
                                    .insert(tool_id.clone(), tool_name.clone());
                                run.tool_inputs_by_id.insert(tool_id.clone(), args.clone());
                                emit(
                                    &turn_id,
                                    EngineEvent::ToolStarted {
                                        workspace_id: workspace_id.clone(),
                                        tool_id,
                                        tool_name,
                                        input: args,
                                    },
                                );
                            }
                            PiStreamLine::ToolEnd {
                                tool_id,
                                content,
                                is_error,
                            } => {
                                run.saw_tool_activity = true;
                                let tool_name = run.tool_names_by_id.get(&tool_id).cloned();
                                let wrapped_output = match run
                                    .tool_inputs_by_id
                                    .get(&tool_id)
                                    .cloned()
                                {
                                    Some(Some(input_value)) => Some(json!({
                                        "_input": input_value,
                                        "_output": content,
                                    })),
                                    _ => Some(Value::String(content.clone())),
                                };
                                emit(
                                    &turn_id,
                                    EngineEvent::ToolCompleted {
                                        workspace_id: workspace_id.clone(),
                                        tool_id,
                                        tool_name,
                                        output: wrapped_output,
                                        error: is_error.then_some(content),
                                    },
                                );
                            }
                            PiStreamLine::AssistantError(error) => {
                                run.stream_error = Some(error);
                            }
                            PiStreamLine::Usage(_) | PiStreamLine::SessionId(_) | PiStreamLine::Other => {}
                        }
                    }
                    PiRpcPumpEvent::Exited(code) => {
                        log::warn!(
                            "[pi/rpc] resident exited workspace={} code={:?}",
                            workspace_id,
                            code
                        );
                        let run = rpc_run.write().await.take();
                        if let Some(run) = run {
                            settle_rpc_run(
                                &workspace_id,
                                run,
                                Some("pi rpc process exited".to_string()),
                                &emit,
                            );
                        }
                        // Drop the dead handle so the next send respawns.
                        let mut slot = rpc_slot.write().await;
                        if slot
                            .as_ref()
                            .is_some_and(|current| Arc::ptr_eq(current, &client))
                        {
                            *slot = None;
                        }
                        break;
                    }
                }
            }
        });
    }

    /// RPC main path: idle -> `prompt` (new run), streaming -> `steer`
    /// (attach to the active run; settles with it, empty text).
    async fn try_send_message_rpc(
        &self,
        params: &SendMessageParams,
        turn_id: &str,
    ) -> Result<String, PiRpcSendError> {
        let client = self
            .ensure_rpc(
                params.session_id.as_deref(),
                resolve_model_flag(params.model.as_deref()).as_deref(),
            )
            .await
            .map_err(PiRpcSendError::Fallback)?;
        // Resident 对齐（仅在新 run 启动前）：发送必须落到调用方 thread 的
        // 会话文件。活跃 run 期间 skip 对齐——run 的会话是权威；此时若目标
        // 不同（另一 thread 发送/新会话），诚实拒绝，不跨会话 steer。
        self.settle_stale_rpc_run_if_idle(&client).await;
        if self.rpc_run.read().await.is_some() {
            let target = params.session_id.as_deref().and_then(|value| {
                is_valid_pi_session_id_arg(value).then_some(value)
            });
            let current = client.session_id().await;
            let mismatched = match target {
                Some(target) => current.as_deref() != Some(target),
                // 新会话不能 steer 进既有 run（属于别的会话）。
                None => true,
            };
            if mismatched {
                // TurnError 由 send_message 的 Failed 臂统一发（禁止双发）。
                let error =
                    "另一 PI 会话的 turn 仍在进行中；请等待完成或先停止。".to_string();
                return Err(PiRpcSendError::Failed(error));
            }
            // steer 附加不中途换模型：run 的模型在启动时确定。漂移只记日志，
            // 下一个新 run 启动前由 reconcile_rpc_model 修正。
            if let Some(desired) = resolve_model_flag(params.model.as_deref()) {
                let current = client.current_model_identity().await;
                let current_ref = current.as_ref().map(|(p, m)| (p.as_str(), m.as_str()));
                if plan_rpc_model_reconcile(Some(desired.as_str()), current_ref)
                    != RpcModelReconcile::Match
                {
                    log::warn!(
                        "[pi/rpc] steer attach keeps active run model; requested {} differs (workspace={})",
                        desired,
                        self.workspace_id
                    );
                }
            }
        } else {
            if let Err(error) = self
                .align_rpc_session(&client, params.session_id.as_deref())
                .await
            {
                return Err(PiRpcSendError::Failed(error));
            }
            // Resident 复用 / 裸 spawn（tree/stats 命令经 ensure_rpc(None, None)
            // 拉起，钉死 pi 本地配置默认模型）时模型可能漂移；新 run 启动前
            // MUST 与本次请求的 model 对账（2026-08-23「选 kimi-coding/k3 实际
            // 回 MiniMax-M3」根因）。
            self.reconcile_rpc_model(&client, params.model.as_deref())
                .await?;
        }
        let images = encode_images_for_rpc(params.images.as_deref(), &self.workspace_path)
            .map_err(PiRpcSendError::Failed)?;
        if let Some(thinking) = resolve_thinking_flag(params.effort.as_deref()) {
            // Best effort: level support is model-dependent; failure must not
            // block the prompt itself.
            if let Err(error) = client.set_thinking_level(&thinking).await {
                log::warn!("[pi/rpc] set_thinking_level({thinking}) failed: {error}");
            }
        }

        let (tx, rx) = oneshot::channel();
        {
            let mut guard = self.rpc_run.write().await;
            if let Some(run) = guard.as_mut() {
                if let Err(error) = client.steer(&params.text, images).await {
                    return Err(PiRpcSendError::Failed(format!(
                        "pi rpc steer failed: {error}"
                    )));
                }
                run.attached_turn_ids.push(turn_id.to_string());
                run.waiters.push((turn_id.to_string(), tx));
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnStarted {
                        workspace_id: self.workspace_id.clone(),
                        turn_id: turn_id.to_string(),
                    },
                );
            } else {
                if let Err(error) = client.prompt(&params.text, images).await {
                    return Err(PiRpcSendError::Failed(format!(
                        "pi rpc prompt failed: {error}"
                    )));
                }
                *guard = Some(PiRpcRun::new(turn_id, tx));
                let session_id = client
                    .session_id()
                    .await
                    .unwrap_or_else(|| "pending".to_string());
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::SessionStarted {
                        workspace_id: self.workspace_id.clone(),
                        session_id,
                        engine: EngineType::Pi,
                        turn_id: Some(turn_id.to_string()),
                    },
                );
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnStarted {
                        workspace_id: self.workspace_id.clone(),
                        turn_id: turn_id.to_string(),
                    },
                );
            }
        }

        // Turn 结算看门狗：不按墙钟杀 turn，每个 tick 与 resident 实况对账——
        //   streaming + 事件新鲜  → 长任务正常运行，继续等；
        //   !streaming + run 有产出 → agent_settled 丢失（broadcast lag /
        //     树切换 rebind 空窗），按完成结算，rx 随 settle 解决；
        //   resident 持续静默超预算 → 真超时，报错并 abort。
        let turn_started_at = Instant::now();
        let mut missing_run_ticks = 0u8;
        let mut rx = rx;
        loop {
            match tokio::time::timeout(PI_RPC_TURN_WATCHDOG_TICK, &mut rx).await {
                Ok(Ok(Ok(text))) => return Ok(text),
                Ok(Ok(Err(error))) => return Err(PiRpcSendError::Failed(error)),
                Ok(Err(_closed)) => {
                    return Err(PiRpcSendError::Failed(
                        "pi rpc run waiter dropped".to_string(),
                    ));
                }
                Err(_elapsed) => {}
            }

            let has_output = {
                let guard = self.rpc_run.read().await;
                guard.as_ref().map(|run| {
                    !run.response_text.trim().is_empty()
                        || run.saw_tool_activity
                        || run.stream_error.is_some()
                })
            };
            let Some(has_output) = has_output else {
                // run 已被投影侧结算（agent_settled 抢先）：rx 下一 tick 内
                // 必定就绪；连续多 tick 不就绪才按终态纪律补发错误。
                missing_run_ticks += 1;
                if missing_run_ticks >= 3 {
                    let error = "pi rpc turn timed out".to_string();
                    self.emit_error(turn_id, error.clone());
                    return Err(PiRpcSendError::Settled(error));
                }
                continue;
            };
            missing_run_ticks = 0;

            if !client.is_streaming() {
                if has_output {
                    log::warn!(
                        "[pi/rpc] turn={} settlement event missed; settling from resident ground truth",
                        turn_id
                    );
                    let run = self.rpc_run.write().await.take();
                    if let Some(run) = run {
                        let workspace_id = self.workspace_id.clone();
                        let sender = self.event_sender.clone();
                        settle_rpc_run(&workspace_id, run, None, &|turn_id, event| {
                            let _ = sender.send(PiTurnEvent {
                                turn_id: turn_id.to_string(),
                                event,
                            });
                        });
                    }
                    continue;
                }
                // 无产出且未 streaming：prompt 可能尚未 agent_start，给足静默预算。
                if turn_started_at.elapsed() < PI_RPC_TURN_SILENCE_TIMEOUT {
                    continue;
                }
            } else if client
                .last_event_age()
                .is_some_and(|age| age < PI_RPC_TURN_SILENCE_TIMEOUT)
            {
                continue;
            }

            // 真超时（后端流停滞 / 从未启动）= 整个 run 失联：必须把 run 摘下、
            // 全部 waiter（main + attached steer）以同一错误结算——否则
            // agent_settled 迟到或 stale-settle 自愈时同一 turn 会收到第二次
            // 终态（TurnError 后又 TurnCompleted，双结算违反 terminal 纪律）。
            let error = "pi rpc turn timed out".to_string();
            let run = self.rpc_run.write().await.take();
            if let Some(run) = run {
                let workspace_id = self.workspace_id.clone();
                let sender = self.event_sender.clone();
                settle_rpc_run(
                    &workspace_id,
                    run,
                    Some(error.clone()),
                    &|turn_id, event| {
                        let _ = sender.send(PiTurnEvent {
                            turn_id: turn_id.to_string(),
                            event,
                        });
                    },
                );
            } else {
                self.emit_error(turn_id, error.clone());
            }
            let _ = client.abort().await;
            return Err(PiRpcSendError::Settled(error));
        }
    }

    /// Public RPC accessors for Tauri commands. These never fall back: the
    /// caller needs RPC-only state (stats / tree / fork), so failure is
    /// surfaced as a command error.
    pub async fn rpc_client_for_commands(&self) -> Result<Arc<PiRpcClient>, String> {
        self.rpc_disabled.store(false, Ordering::SeqCst);
        self.ensure_rpc(None, None).await
    }

    /// Whether an RPC agent run is currently streaming. Fork / session-file
    /// switches MUST be rejected while this is true (the run's events and the
    /// file switch would corrupt each other).
    pub async fn rpc_has_active_run(&self) -> bool {
        self.rpc_run.read().await.is_some()
    }

    /// Self-heal: `agent_settled` travels the broadcast channel; if it is ever
    /// lost (lag/edge), the run entry would stay forever and every subsequent
    /// fork/align/cross-session send would be rejected as "turn in progress".
    /// The client is the ground truth: run entry present but RPC NOT
    /// streaming = settlement was missed → settle as error and clear.
    async fn settle_stale_rpc_run_if_idle(&self, client: &Arc<PiRpcClient>) {
        {
            let guard = self.rpc_run.read().await;
            if guard.is_none() || client.is_streaming() {
                return;
            }
        }
        let run = self.rpc_run.write().await.take();
        if let Some(run) = run {
            log::warn!(
                "[pi/rpc] settling stale run turn={} (settlement event missed)",
                run.main_turn_id
            );
            let workspace_id = self.workspace_id.clone();
            let sender = self.event_sender.clone();
            settle_rpc_run(
                &workspace_id,
                run,
                Some("PI turn lost its settlement event; settled defensively.".to_string()),
                &|turn_id, event| {
                    let _ = sender.send(PiTurnEvent {
                        turn_id: turn_id.to_string(),
                        event,
                    });
                },
            );
        }
    }

    /// Align the resident to the session the CALLER is looking at. A
    /// workspace has one resident per runtime key but many pi threads; the
    /// resident follows the last fork/switch, so every send / tree / stats /
    /// fork command MUST align first, otherwise content lands in the wrong
    /// session file (2026-08-23「会话树结构不对 / 幕布错乱」根因)。
    ///
    /// `target_session_id = None` means "fresh session": if the resident is
    /// currently bound to an existing file, start a new one.
    pub async fn align_rpc_session(
        &self,
        client: &Arc<PiRpcClient>,
        target_session_id: Option<&str>,
    ) -> Result<(), String> {
        self.settle_stale_rpc_run_if_idle(client).await;
        let target = target_session_id
            .map(str::trim)
            .filter(|value| is_valid_pi_session_id_arg(value));
        let current = client.session_id().await;
        match target {
            Some(target) if current.as_deref() == Some(target) => Ok(()),
            Some(target) => {
                if self.rpc_has_active_run().await {
                    return Err(
                        "另一 PI 会话的 turn 仍在进行中；请等待完成或先停止。".to_string(),
                    );
                }
                let file = match crate::engine::pi_history::resolve_pi_session_file_by_id(
                    self.home_dir.as_deref(),
                    target,
                    &self.workspace_path,
                )
                .await?
                {
                    Some(file) => file,
                    None => {
                        // 目标 session 文件不存在（stale 绑定 / 文件被清理）：
                        // 不硬失败（避免触发 recovery 卡片），降级为新会话。
                        // 文件既然不存在，本来就没有可「继续」的历史。
                        log::warn!(
                            "[pi/rpc] session file not found for {}, starting fresh session (workspace={})",
                            target,
                            self.workspace_id
                        );
                        client.new_session().await?;
                        if let Some(id) = client.session_id().await {
                            self.set_session_id(Some(id)).await;
                        }
                        return Ok(());
                    }
                };
                client.switch_session(&file.to_string_lossy()).await?;
                self.set_session_id(Some(target.to_string())).await;
                log::info!(
                    "[pi/rpc] aligned resident to session {} workspace={}",
                    target,
                    self.workspace_id
                );
                Ok(())
            }
            None => {
                // Fresh conversation requested while the resident is bound to
                // an existing file: start a new session instead of appending
                // to the old one.
                if current.is_some() {
                    if self.rpc_has_active_run().await {
                        return Err(
                            "另一 PI 会话的 turn 仍在进行中；请等待完成或先停止。".to_string(),
                        );
                    }
                    client.new_session().await?;
                    if let Some(id) = client.session_id().await {
                        self.set_session_id(Some(id)).await;
                    }
                }
                Ok(())
            }
        }
    }

    /// Reconcile the resident's model with the requested model before a new
    /// run starts. `set_model` failure degrades to the print-json fallback
    /// (which honors `--model` per send) instead of failing the turn.
    async fn reconcile_rpc_model(
        &self,
        client: &Arc<PiRpcClient>,
        requested_model: Option<&str>,
    ) -> Result<(), PiRpcSendError> {
        let desired = resolve_model_flag(requested_model);
        let current = client.current_model_identity().await;
        let current_ref = current.as_ref().map(|(p, m)| (p.as_str(), m.as_str()));
        match plan_rpc_model_reconcile(desired.as_deref(), current_ref) {
            RpcModelReconcile::Skip | RpcModelReconcile::Match => Ok(()),
            RpcModelReconcile::Set { provider, model_id } => {
                log::info!(
                    "[pi/rpc] reconciling resident model {:?} -> {provider}/{model_id} (workspace={})",
                    current,
                    self.workspace_id
                );
                client
                    .set_model(&provider, &model_id)
                    .await
                    .map(|_| ())
                    .map_err(|error| {
                        PiRpcSendError::Fallback(format!(
                            "pi rpc set_model({provider}/{model_id}) failed: {error}"
                        ))
                    })
            }
            RpcModelReconcile::BareMismatch(bare) => {
                log::warn!(
                    "[pi/rpc] bare model id {bare:?} cannot be reconciled (no provider prefix); resident stays on {:?} (workspace={})",
                    current,
                    self.workspace_id
                );
                Ok(())
            }
        }
    }

    /// After a fork the resident is bound to a NEW session file; refresh the
    /// tracked session id so the next send/resume follows it.
    pub async fn rpc_resync_session_id(&self, client: &Arc<PiRpcClient>) -> Option<String> {
        match client.get_state().await {
            Ok(state) => {
                let id = state
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let Some(ref id) = id {
                    self.set_session_id(Some(id.clone())).await;
                }
                id
            }
            Err(error) => {
                log::warn!("[pi/rpc] get_state after fork failed: {error}");
                None
            }
        }
    }

    fn build_command(&self, params: &SendMessageParams) -> Result<Command, String> {
        let bin = self.resolve_bin_path();

        let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
        cmd.current_dir(&self.workspace_path);
        // Custom args go first so the protocol flags below (--print/--mode/--session-id)
        // always win over user configuration in last-wins CLI parsing.
        if let Some(args) = self.custom_args.as_ref() {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }
        cmd.arg("--print");
        cmd.arg("--mode");
        cmd.arg("json");

        if let Some(model) = resolve_model_flag(params.model.as_deref()) {
            cmd.arg("--model");
            cmd.arg(model);
        }

        if params.continue_session {
            if let Some(session_id) = params
                .session_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .filter(|value| is_valid_pi_session_id_arg(value))
            {
                cmd.arg("--session-id");
                cmd.arg(session_id);
            }
        }

        if let Some(thinking) = resolve_thinking_flag(params.effort.as_deref()) {
            cmd.arg("--thinking");
            cmd.arg(thinking);
        }

        let image_files = crate::engine::cli_image_input::resolve_existing_image_files(
            params.images.as_deref(),
            &self.workspace_path,
        )?;
        // Pi print mode natively attaches `@file` arguments as image content
        // blocks (deterministic, processed by pi's file processor); keep the
        // prompt itself free of any injected marker or read-tool instruction.
        // `@<path>` reference tokens embedded in the prompt text get the same
        // transport: pi's argv parser treats ANY arg starting with `@` as a
        // file arg, and the whole prompt is one argv element, so a prompt
        // starting with `@` would otherwise turn the entire message into one
        // fake file path and exit(1) with "File not found".
        let mut at_args = crate::engine::cli_image_input::pi_image_file_args(&image_files);
        let extraction = extract_at_file_references(&params.text, &self.workspace_path);
        for reference_arg in extraction.file_args {
            if !at_args.contains(&reference_arg) {
                at_args.push(reference_arg);
            }
        }
        for at_arg in at_args {
            cmd.arg(at_arg);
        }
        let prompt_text = extraction.text;
        // Positional prompt; avoid a leading '-' being parsed as a flag and a
        // leading '@' (unresolvable reference token) being parsed as a file arg.
        let safe_text = if prompt_text.starts_with('-') || prompt_text.starts_with('@') {
            format!(" {prompt_text}")
        } else {
            prompt_text
        };
        cmd.arg(&safe_text);

        if let Some(home) = self.home_dir.as_ref() {
            cmd.env("PI_CODING_AGENT_DIR", home);
            // Sessions default under agent_dir/sessions; keep home aligned.
            cmd.env("HOME", home);
        }

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        Ok(cmd)
    }

    pub async fn send_message(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        match self.try_send_message_rpc(&params, turn_id).await {
            Ok(text) => return Ok(text),
            Err(PiRpcSendError::Fallback(reason)) => {
                log::warn!(
                    "[pi/send] turn={} rpc unavailable, falling back to print-json: {}",
                    turn_id,
                    reason
                );
            }
            Err(PiRpcSendError::Failed(error)) => {
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
            Err(PiRpcSendError::Settled(error)) => {
                // 终态已随 run 结算发出（turn timeout 路径），禁止重发。
                return Err(error);
            }
        }
        // print-json fallback 是 spawn-per-turn：同会话并发进程会交叉写同一
        // session JSONL。融合（fusion）在矩阵升 supported 后可能打到这条
        // 路径——此时必须拒绝而不是假装 steer，让消息留在队列里。
        {
            let active = self.active_processes.lock().await;
            if !active.is_empty() {
                let error = "PI session is busy (rpc unavailable, print-json fallback cannot steer); the message stays queued.".to_string();
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
        }
        self.send_message_print_json(params, turn_id).await
    }

    async fn send_message_print_json(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        let turn_started_at = std::time::Instant::now();
        let requested_model = params
            .model
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("<auto>");
        log::info!(
            "[pi/send] turn={} workspace={} model={} continue_session={}",
            turn_id,
            self.workspace_id,
            requested_model,
            params.continue_session,
        );

        let mut command = match self.build_command(&params) {
            Ok(command) => command,
            Err(error) => {
                let error_msg = format!("Failed to build pi command: {error}");
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let error_msg = format!("Failed to spawn pi: {error}");
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let spawn_ms = turn_started_at.elapsed().as_millis();

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let error_msg = "Failed to capture stdout".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let error_msg = "Failed to capture stderr".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };

        {
            let mut active = self.active_processes.lock().await;
            active.insert(turn_id.to_string(), ActivePiChildProcess::new(child));
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id: "pending".to_string(),
                engine: EngineType::Pi,
                turn_id: Some(turn_id.to_string()),
            },
        );
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnStarted {
                workspace_id: self.workspace_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        let stderr_reader = BufReader::new(stderr);
        let stderr_task = tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            let mut text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                text.push_str(&line);
                text.push('\n');
            }
            text
        });

        let mut response_text = String::new();
        let mut saw_tool_activity = false;
        let mut tool_names_by_id: HashMap<String, String> = HashMap::new();
        let mut tool_inputs_by_id: HashMap<String, Option<Value>> = HashMap::new();
        let mut error_output = String::new();
        let mut session_started_emitted = false;
        let mut new_session_id: Option<String> = None;
        let mut stream_error: Option<String> = None;
        let mut first_stdout_line_ms: Option<u128> = None;
        let mut stdout_line_count: usize = 0;

        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut child_exited_at: Option<std::time::Instant> = None;

        loop {
            let line = tokio::select! {
                line = lines.next_line() => match line {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(error) => {
                        // A read error is not EOF: keep the diagnostic so the
                        // turn settles as failed instead of silently succeeding.
                        if !error_output.is_empty() {
                            error_output.push('\n');
                        }
                        error_output.push_str(&format!("[pi stdout read error] {error}"));
                        break;
                    }
                },
                _ = tokio::time::sleep(PI_STDOUT_EXIT_POLL) => {
                    if child_exited_at.is_none() {
                        let mut active = self.active_processes.lock().await;
                        match active.get_mut(turn_id) {
                            Some(process) => {
                                if matches!(process.child.try_wait(), Ok(Some(_))) {
                                    child_exited_at = Some(std::time::Instant::now());
                                }
                            }
                            // Removed externally (interrupt): stop reading; the
                            // killer owns the child handle from here.
                            None => break,
                        }
                    }
                    if child_exited_at.is_some_and(|at| at.elapsed() >= PI_POST_EXIT_GRACE) {
                        log::warn!(
                            "[pi/send] turn={} stdout EOF grace elapsed after child exit; stop reading",
                            turn_id
                        );
                        break;
                    }
                    continue;
                }
            };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            stdout_line_count += 1;
            if first_stdout_line_ms.is_none() {
                first_stdout_line_ms = Some(turn_started_at.elapsed().as_millis());
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(event) => match parse_pi_stream_line(&event) {
                    PiStreamLine::SessionId(session_id) => {
                        if !session_started_emitted {
                            session_started_emitted = true;
                            new_session_id = Some(session_id.clone());
                            self.set_session_id(Some(session_id.clone())).await;
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::SessionStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    session_id,
                                    engine: EngineType::Pi,
                                    turn_id: Some(turn_id.to_string()),
                                },
                            );
                        }
                    }
                    PiStreamLine::TextDelta(delta) => {
                        response_text.push_str(&delta);
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::TextDelta {
                                workspace_id: self.workspace_id.clone(),
                                text: delta,
                            },
                        );
                    }
                    PiStreamLine::ThinkingDelta(delta) => {
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ReasoningDelta {
                                workspace_id: self.workspace_id.clone(),
                                text: delta,
                            },
                        );
                    }
                    PiStreamLine::ToolStart {
                        tool_id,
                        tool_name,
                        args,
                    } => {
                        saw_tool_activity = true;
                        tool_names_by_id.insert(tool_id.clone(), tool_name.clone());
                        tool_inputs_by_id.insert(tool_id.clone(), args.clone());
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ToolStarted {
                                workspace_id: self.workspace_id.clone(),
                                tool_id,
                                tool_name,
                                input: args,
                            },
                        );
                    }
                    PiStreamLine::ToolEnd {
                        tool_id,
                        content,
                        is_error,
                    } => {
                        saw_tool_activity = true;
                        let tool_name = tool_names_by_id.get(&tool_id).cloned();
                        let wrapped_output = match tool_inputs_by_id.get(&tool_id).cloned() {
                            Some(Some(input_value)) => Some(json!({
                                "_input": input_value,
                                "_output": content,
                            })),
                            _ => Some(Value::String(content.clone())),
                        };
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ToolCompleted {
                                workspace_id: self.workspace_id.clone(),
                                tool_id,
                                tool_name,
                                output: wrapped_output,
                                error: is_error.then_some(content),
                            },
                        );
                    }
                    PiStreamLine::AssistantError(error) => {
                        stream_error = Some(error);
                    }
                    PiStreamLine::Usage(_) | PiStreamLine::Other => {}
                },
                Err(_) => {
                    error_output.push_str(&line);
                    error_output.push('\n');
                }
            }
        }

        let stdout_eof_ms = turn_started_at.elapsed().as_millis();
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active
                .remove(turn_id)
                .map(ActivePiChildProcess::into_child)
        };
        let status = if let Some(mut process) = child.take() {
            match tokio::time::timeout(PI_POST_EXIT_GRACE, process.wait()).await {
                Ok(result) => result.ok(),
                Err(_) => {
                    log::warn!(
                        "[pi/send] turn={} child wait timed out; killing",
                        turn_id
                    );
                    let _ = process.start_kill();
                    None
                }
            }
        } else {
            None
        };
        let stderr_text = match tokio::time::timeout(PI_STDERR_JOIN_TIMEOUT, stderr_task).await {
            Ok(joined) => joined.unwrap_or_default(),
            Err(_) => {
                log::warn!(
                    "[pi/send] turn={} stderr reader did not finish within timeout; abandoning",
                    turn_id
                );
                String::new()
            }
        };
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }
        let completed_ms = turn_started_at.elapsed().as_millis();
        let status_success = status.as_ref().is_some_and(|value| value.success());
        log::info!(
            "[pi/send][timing] turn={} spawn_ms={} first_stdout_line_ms={:?} stdout_eof_ms={} completed_ms={} stdout_lines={} status_success={} response_chars={}",
            turn_id,
            spawn_ms,
            first_stdout_line_ms,
            stdout_eof_ms,
            completed_ms,
            stdout_line_count,
            status_success,
            response_text.chars().count(),
        );

        let was_interrupted = self.interrupted_turns.lock().await.remove(turn_id);
        if let Some(error) = stream_error {
            if response_text.trim().is_empty() && !saw_tool_activity {
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
        }
        if let Some(status) = status {
            if !status.success() {
                let error_msg = if was_interrupted {
                    "Session stopped.".to_string()
                } else if !error_output.trim().is_empty() {
                    error_output.trim().to_string()
                } else {
                    format!("PI exited with status: {status}")
                };
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        } else if was_interrupted {
            let error_msg = "Session stopped.".to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !error_output.trim().is_empty() && !saw_tool_activity
        {
            let error_msg = error_output.trim().to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !saw_tool_activity {
            let diagnostic = "PI exited without assistant output.".to_string();
            self.emit_error(turn_id, diagnostic.clone());
            return Err(diagnostic);
        }

        if let Some(session_id) = new_session_id {
            self.set_session_id(Some(session_id)).await;
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(json!({
                    "text": response_text,
                })),
            },
        );

        Ok(response_text)
    }

    pub async fn interrupt(&self) -> Result<(), String> {
        // RPC resident: typed abort first, kill only as the settle fallback.
        // 仅在确有活跃 run 时才 abort + grace sleep——空闲时 Esc/stop 会走
        // 到这里，无 run 还 abort 并睡 2s 是纯延迟（interrupt_turn 已有同款
        // 守卫，这里对齐）。
        let rpc_client = self.rpc.read().await.clone();
        if let Some(client) = rpc_client {
            if client.is_alive().await && self.rpc_run.read().await.is_some() {
                if let Some(run) = self.rpc_run.write().await.as_mut() {
                    run.abort_requested = true;
                }
                if let Err(error) = client.abort().await {
                    log::warn!("[pi/rpc] abort command failed: {error}");
                }
                tokio::time::sleep(PI_RPC_ABORT_SETTLE_GRACE).await;
                if self.rpc_run.read().await.is_some() {
                    log::warn!("[pi/rpc] abort did not settle within grace; killing resident");
                    client.kill().await;
                }
            }
        }
        let mut active = self.active_processes.lock().await;
        let mut interrupted = self.interrupted_turns.lock().await;
        let mut killed_turn_ids = Vec::new();
        let mut errors = Vec::new();
        for (turn_id, process) in active.iter_mut() {
            match process.child.kill().await {
                Ok(()) => {
                    interrupted.insert(turn_id.clone());
                    killed_turn_ids.push(turn_id.clone());
                }
                // Keep the failed entry in the map so Drop can retry the kill.
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
                "failed to interrupt {} pi turn(s): {}",
                errors.len(),
                errors.join("; ")
            ))
        }
    }

    pub async fn interrupt_turn(&self, turn_id: &str) -> Result<(), String> {
        // RPC resident: a turn interrupt = abort the shared run (the run owns
        // the turn). Kill only when abort does not settle in time.
        let rpc_client = self.rpc.read().await.clone();
        if let Some(client) = rpc_client {
            if client.is_alive().await && self.rpc_run.read().await.is_some() {
                if let Some(run) = self.rpc_run.write().await.as_mut() {
                    run.abort_requested = true;
                }
                if let Err(error) = client.abort().await {
                    log::warn!("[pi/rpc] abort command failed: {error}");
                }
                tokio::time::sleep(PI_RPC_ABORT_SETTLE_GRACE).await;
                if self.rpc_run.read().await.is_some() {
                    client.kill().await;
                }
                self.interrupted_turns.lock().await.insert(turn_id.to_string());
                return Ok(());
            }
        }
        let mut active = self.active_processes.lock().await;
        let Some(process) = active.get_mut(turn_id) else {
            return Ok(());
        };
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
    ) -> Vec<PiActiveProcessSnapshot> {
        let active = self.active_processes.lock().await;
        active
            .values()
            .filter_map(|process| process.snapshot(sampled_at_ms))
            .collect()
    }
}

impl Drop for PiSession {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.rpc.try_write() {
            if let Some(client) = slot.take() {
                let client = client.clone();
                tokio::spawn(async move {
                    client.kill().await;
                });
            }
        }
        let Ok(mut active) = self.active_processes.try_lock() else {
            log::warn!(
                "[pi] dropping session workspace={} while active_processes is locked",
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
                        "[pi] drop fallback kill workspace={} turn={} pid={:?}",
                        self.workspace_id,
                        turn_id,
                        pid
                    );
                }
                Err(error) => {
                    log::warn!(
                        "[pi] drop fallback failed workspace={} turn={} pid={:?}: {}",
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
    fn turn_watchdog_silence_budget_covers_compact_and_tick() {
        // auto-compaction 在 turn 收尾可能长时无流式事件：静默预算必须
        // 覆盖 compact 预算，否则 compact 中的 turn 会被误判超时。
        assert!(PI_RPC_TURN_SILENCE_TIMEOUT > crate::engine::pi_rpc::PI_RPC_COMPACT_TIMEOUT);
        assert!(PI_RPC_TURN_WATCHDOG_TICK < PI_RPC_TURN_SILENCE_TIMEOUT);
    }

    #[test]
    fn parses_session_id() {
        let line = json!({"type":"session","id":"abc-123","cwd":"/tmp"});
        match parse_pi_stream_line(&line) {
            PiStreamLine::SessionId(id) => assert_eq!(id, "abc-123"),
            _ => panic!("expected SessionId"),
        }
    }

    #[test]
    fn parses_text_and_thinking_deltas() {
        let text = json!({
            "type":"message_update",
            "assistantMessageEvent":{"type":"text_delta","delta":"hi"}
        });
        match parse_pi_stream_line(&text) {
            PiStreamLine::TextDelta(d) => assert_eq!(d, "hi"),
            _ => panic!("expected TextDelta"),
        }
        let think = json!({
            "type":"message_update",
            "assistantMessageEvent":{"type":"thinking_delta","delta":"plan"}
        });
        match parse_pi_stream_line(&think) {
            PiStreamLine::ThinkingDelta(d) => assert_eq!(d, "plan"),
            _ => panic!("expected ThinkingDelta"),
        }
    }

    #[test]
    fn parses_tool_events() {
        let start = json!({
            "type":"tool_execution_start",
            "toolCallId":"t1",
            "toolName":"bash",
            "args":{"command":"ls"}
        });
        match parse_pi_stream_line(&start) {
            PiStreamLine::ToolStart {
                tool_id,
                tool_name,
                args,
            } => {
                assert_eq!(tool_id, "t1");
                assert_eq!(tool_name, "bash");
                assert_eq!(args, Some(json!({"command":"ls"})));
            }
            _ => panic!("expected ToolStart"),
        }
        let end = json!({
            "type":"tool_execution_end",
            "toolCallId":"t1",
            "isError":false,
            "result":{"content":[{"type":"text","text":"ok"}]}
        });
        match parse_pi_stream_line(&end) {
            PiStreamLine::ToolEnd {
                tool_id,
                content,
                is_error,
            } => {
                assert_eq!(tool_id, "t1");
                assert_eq!(content, "ok");
                assert!(!is_error);
            }
            _ => panic!("expected ToolEnd"),
        }
    }

    #[test]
    fn parses_auth_error_on_message_start() {
        let line = json!({
            "type":"message_start",
            "message":{
                "role":"assistant",
                "errorMessage":"401 Invalid bearer token"
            }
        });
        match parse_pi_stream_line(&line) {
            PiStreamLine::AssistantError(err) => assert!(err.contains("401")),
            _ => panic!("expected AssistantError"),
        }
    }

    #[test]
    fn parses_live_print_json_turn_without_dropping_text() {
        // Captured from `pi --print --mode json` 0.84.1 on this machine:
        // session → thinking deltas → one text_delta "pong" → turn_end.
        let events = [
            json!({"type":"session","id":"01a0073b-b1da-77a1-a9e3-390cf2c88680"}),
            json!({
                "type":"message_update",
                "assistantMessageEvent":{"type":"thinking_delta","delta":"The user wants "}
            }),
            json!({
                "type":"message_update",
                "assistantMessageEvent":{"type":"text_delta","delta":"pong"}
            }),
            json!({"type":"turn_end"}),
            json!({"type":"agent_end"}),
            json!({"type":"agent_settled"}),
        ];

        let parsed: Vec<PiStreamLine> = events.iter().map(parse_pi_stream_line).collect();
        assert!(matches!(
            &parsed[0],
            PiStreamLine::SessionId(id) if id == "01a0073b-b1da-77a1-a9e3-390cf2c88680"
        ));
        assert!(matches!(
            &parsed[1],
            PiStreamLine::ThinkingDelta(delta) if delta == "The user wants "
        ));
        assert!(matches!(
            &parsed[2],
            PiStreamLine::TextDelta(delta) if delta == "pong"
        ));
        assert!(matches!(parsed[3], PiStreamLine::Other));
        assert!(matches!(parsed[4], PiStreamLine::Other));
        assert!(matches!(parsed[5], PiStreamLine::Other));
    }

    #[test]
    fn model_and_thinking_flags_filter_defaults() {
        assert_eq!(resolve_model_flag(Some("auto")), None);
        assert_eq!(
            resolve_model_flag(Some("anthropic/claude-sonnet-5")),
            Some("anthropic/claude-sonnet-5".to_string())
        );
        assert_eq!(
            resolve_thinking_flag(Some("high")),
            Some("high".to_string())
        );
        assert_eq!(resolve_thinking_flag(Some("nope")), None);
    }

    #[test]
    fn split_provider_model_only_first_segment_is_provider() {
        assert_eq!(
            split_provider_model("kimi-coding/k3"),
            Some(("kimi-coding".to_string(), "k3".to_string()))
        );
        // openrouter 等模型 id 自带斜杠：只有首段是 provider。
        assert_eq!(
            split_provider_model("openrouter/openai/gpt-4o"),
            Some(("openrouter".to_string(), "openai/gpt-4o".to_string()))
        );
        assert_eq!(split_provider_model("k3"), None);
        assert_eq!(split_provider_model("/k3"), None);
        assert_eq!(split_provider_model("kimi-coding/"), None);
    }

    #[test]
    fn model_reconcile_plan_matrix() {
        // 未显式指定（auto/default）：不动 resident。
        assert_eq!(plan_rpc_model_reconcile(None, None), RpcModelReconcile::Skip);
        assert_eq!(
            plan_rpc_model_reconcile(None, Some(("minimax-cn", "MiniMax-M3"))),
            RpcModelReconcile::Skip
        );
        // resident 已是目标模型：no-op。
        assert_eq!(
            plan_rpc_model_reconcile(
                Some("kimi-coding/k3"),
                Some(("kimi-coding", "k3"))
            ),
            RpcModelReconcile::Match
        );
        // 漂移（裸 spawn 钉死 config 默认模型 / 用户切模型）：set_model。
        assert_eq!(
            plan_rpc_model_reconcile(
                Some("kimi-coding/k3"),
                Some(("minimax-cn", "MiniMax-M3"))
            ),
            RpcModelReconcile::Set {
                provider: "kimi-coding".to_string(),
                model_id: "k3".to_string()
            }
        );
        // resident state 缺 model（未刷新）：也要 set_model 纠正。
        assert_eq!(
            plan_rpc_model_reconcile(Some("deepseek/deepseek-v4-flash"), None),
            RpcModelReconcile::Set {
                provider: "deepseek".to_string(),
                model_id: "deepseek-v4-flash".to_string()
            }
        );
        // 裸 id：与 resident 同 id 即匹配；不同则无法精确对账，仅 warn。
        assert_eq!(
            plan_rpc_model_reconcile(Some("k3"), Some(("kimi-coding", "k3"))),
            RpcModelReconcile::Match
        );
        assert_eq!(
            plan_rpc_model_reconcile(Some("k3"), Some(("minimax-cn", "MiniMax-M3"))),
            RpcModelReconcile::BareMismatch("k3".to_string())
        );
        assert_eq!(
            plan_rpc_model_reconcile(Some("k3"), None),
            RpcModelReconcile::BareMismatch("k3".to_string())
        );
    }

    fn command_args(cmd: &Command) -> Vec<String> {
        cmd.as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn build_command_attaches_images_as_at_file_args_before_prompt() {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let image = dir.join("shot one.png");
        std::fs::write(&image, b"fake-png").unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "look at this".to_string(),
            images: Some(vec![image.to_string_lossy().to_string()]),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", image.display());
        let at_pos = args
            .iter()
            .position(|arg| arg == &at_arg)
            .expect("missing @file arg");
        let prompt_pos = args
            .iter()
            .rposition(|arg| arg.contains("look at this"))
            .expect("missing prompt arg");
        assert!(at_pos < prompt_pos, "@file arg must precede the prompt");
        let prompt = &args[prompt_pos];
        assert!(!prompt.contains("mossx:pi-image-attachments"));
        assert!(!prompt.contains("read tool"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_without_images_has_no_at_file_args() {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "plain".to_string(),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);
        assert!(!args.iter().any(|arg| arg.starts_with('@')));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_fails_when_all_images_unresolvable() {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "look".to_string(),
            images: Some(vec![dir.join("missing.png").to_string_lossy().to_string()]),
            ..Default::default()
        };

        let error = session
            .build_command(&params)
            .expect_err("unresolvable images must fail before spawn");
        assert!(error.contains("none of the attached images"));

        let _ = std::fs::remove_dir_all(dir);
    }

    fn make_workspace_with_files(files: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
        for relative in files {
            let path = dir.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, b"payload").unwrap();
        }
        dir
    }

    #[test]
    fn build_command_extracts_leading_at_file_reference_to_argv() {
        let dir = make_workspace_with_files(&["design.md"]);
        let file = dir.join("design.md");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@{} 总结一下", file.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", file.display());
        let at_pos = args.iter().position(|arg| arg == &at_arg).expect("missing @file arg");
        let prompt_pos = args
            .iter()
            .rposition(|arg| arg.contains("总结一下"))
            .expect("missing prompt arg");
        assert!(at_pos < prompt_pos, "@file arg must precede the prompt");
        let prompt = &args[prompt_pos];
        assert!(!prompt.contains("design.md"), "extracted token must leave the prompt");
        assert!(!prompt.starts_with('@'), "prompt must not start with '@'");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_resolves_at_reference_with_spaces_greedily() {
        let dir = make_workspace_with_files(&["shot one.png"]);
        let file = dir.join("shot one.png");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("看下 @{} 这张图", file.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", file.display());
        assert!(
            args.iter().any(|arg| arg == &at_arg),
            "spaced path must resolve as one @file arg: {args:?}"
        );
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.contains("看下"), "prompt keeps surrounding text");
        assert!(prompt.contains("这张图"), "prompt keeps trailing text");
        assert!(!prompt.contains("shot one.png"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_resolves_relative_at_reference_against_workspace() {
        let dir = make_workspace_with_files(&["docs/a.md"]);
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: "@docs/a.md 读一下".to_string(),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", dir.join("docs/a.md").display());
        assert!(args.iter().any(|arg| arg == &at_arg), "args: {args:?}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_keeps_folder_reference_as_plain_text() {
        let dir = make_workspace_with_files(&["sub/placeholder.txt"]);
        let folder = dir.join("sub");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@{} 这两个设计移到 docs", folder.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let folder_at = format!("@{}", folder.display());
        assert!(
            !args.iter().any(|arg| arg == &folder_at),
            "folder must not become an @file arg"
        );
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.contains(&folder.display().to_string()));
        assert!(
            !prompt.starts_with('@'),
            "leading unresolvable @ token must be space-guarded: {prompt:?}"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_keeps_missing_path_and_mention_as_plain_text() {
        let dir = make_workspace_with_files(&[]);
        let missing = dir.join("missing.md");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@teammate 帮忙看下 @{}", missing.display()),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        assert!(
            !args.iter().any(|arg| arg.starts_with('@')),
            "unresolvable tokens must not produce @file args: {args:?}"
        );
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.contains("@teammate"));
        assert!(prompt.contains("missing.md"));
        assert!(!prompt.starts_with('@'));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_dedupes_reference_against_image_attachment() {
        let dir = make_workspace_with_files(&["a.png"]);
        let file = dir.join("a.png");
        let session = PiSession::new("ws".to_string(), dir.clone(), None);
        let params = SendMessageParams {
            text: format!("@{} 看看", file.display()),
            images: Some(vec![file.to_string_lossy().to_string()]),
            ..Default::default()
        };

        let cmd = session.build_command(&params).expect("build_command");
        let args = command_args(&cmd);

        let at_arg = format!("@{}", file.display());
        let count = args.iter().filter(|arg| *arg == &at_arg).count();
        assert_eq!(count, 1, "same path must appear exactly once: {args:?}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn interrupt_unknown_turn_is_idempotent() {
        let session = PiSession::new("ws".to_string(), std::env::temp_dir(), None);
        session
            .interrupt_turn("missing")
            .await
            .expect("idempotent");
        assert!(session.interrupted_turns.lock().await.is_empty());
    }
}
