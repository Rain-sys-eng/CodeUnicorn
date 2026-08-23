//! PI RPC resident session client (`pi --mode rpc`).
//!
//! One native PI thread = one resident RPC process. Commands are JSON lines on
//! stdin; responses carry the caller-supplied `id` for correlation; agent
//! events stream on stdout interleaved with responses.
//!
//! Contract notes (pi `docs/rpc.md` + `dist/modes/rpc/rpc-types.d.ts`):
//! - Strict JSONL: LF (`\n`) is the only record delimiter; strip a trailing
//!   `\r`. U+2028/U+2029 inside strings are NOT delimiters (tokio
//!   `BufReader::lines` splits on `\n` only, so this holds by construction).
//! - `response.success == true` means accepted/queued — never a turn terminal.
//!   Turn settlement is the typed `agent_settled` event.
//! - Extension UI requests are auto-cancelled: mossx is a headless host and
//!   MUST NOT surface vendor extension dialogs (v1 boundary).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};

pub const PI_RPC_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const PI_RPC_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// One line decoded from the RPC stdout pump.
#[derive(Debug, Clone)]
pub enum PiRpcPumpEvent {
    /// A streaming agent event (`agent_start`, `message_update`, `tool_execution_*`,
    /// `agent_end`, `agent_settled`, `compaction_*`, ...): the raw JSON value.
    Agent(Value),
    /// stdout EOF / child exit observed by the pump; carries the exit code when known.
    Exited(Option<i32>),
}

struct PiRpcShared {
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    streaming: AtomicBool,
}

pub struct PiRpcClient {
    shared: Arc<PiRpcShared>,
    child: Mutex<Child>,
    pump_sender: broadcast::Sender<PiRpcPumpEvent>,
    state: RwLock<Value>,
}

impl PiRpcClient {
    /// Spawn `pi --mode rpc` and verify the handshake with `get_state`.
    pub async fn spawn(
        bin: &str,
        workspace_path: &Path,
        session_id: Option<&str>,
        model: Option<&str>,
        home_dir: Option<&str>,
        custom_args: Option<&str>,
    ) -> Result<Arc<Self>, String> {
        let mut cmd = crate::backend::app_server::build_command_for_binary(bin);
        cmd.current_dir(workspace_path);
        // Custom args first so protocol flags always win (last-wins parsing).
        if let Some(args) = custom_args {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }
        cmd.arg("--mode");
        cmd.arg("rpc");
        if let Some(model) = model {
            cmd.arg("--model");
            cmd.arg(model);
        }
        if let Some(session_id) = session_id {
            cmd.arg("--session-id");
            cmd.arg(session_id);
        }
        if let Some(home) = home_dir {
            cmd.env("PI_CODING_AGENT_DIR", home);
            cmd.env("HOME", home);
        }
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|error| format!("Failed to spawn pi rpc: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture pi rpc stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture pi rpc stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture pi rpc stderr".to_string())?;

        let shared = Arc::new(PiRpcShared {
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            streaming: AtomicBool::new(false),
        });
        let (pump_sender, _) = broadcast::channel(1024);

        // stderr drain (diagnostics only).
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    log::warn!("[pi/rpc][stderr] {trimmed}");
                }
            }
        });

        // stdout pump: strict JSONL, three-way split.
        {
            let shared = Arc::clone(&shared);
            let pump_sender = pump_sender.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                let exit_code: Option<i32> = loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            let line = line.strip_suffix('\r').unwrap_or(&line);
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            let value = match serde_json::from_str::<Value>(trimmed) {
                                Ok(value) => value,
                                Err(error) => {
                                    log::warn!("[pi/rpc] dropping unparseable line: {error}");
                                    continue;
                                }
                            };
                            let kind = value
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or("");
                            match kind {
                                "response" => {
                                    let id = value
                                        .get("id")
                                        .and_then(Value::as_str)
                                        .map(str::to_string);
                                    if let Some(id) = id {
                                        let success = value
                                            .get("success")
                                            .and_then(Value::as_bool)
                                            .unwrap_or(false);
                                        let result = if success {
                                            Ok(value.get("data").cloned().unwrap_or(Value::Null))
                                        } else {
                                            Err(value
                                                .get("error")
                                                .and_then(Value::as_str)
                                                .unwrap_or("pi rpc command failed")
                                                .to_string())
                                        };
                                        let sender = {
                                            let mut pending = shared.pending.lock().await;
                                            pending.remove(&id)
                                        };
                                        if let Some(sender) = sender {
                                            let _ = sender.send(result);
                                        } else {
                                            log::warn!(
                                                "[pi/rpc] late/unknown response id={id} dropped"
                                            );
                                        }
                                    }
                                }
                                "extension_ui_request" => {
                                    if let Some(id) =
                                        value.get("id").and_then(Value::as_str).map(str::to_string)
                                    {
                                        let cancel =
                                            json!({"type":"extension_ui_response","id":id,"cancelled":true});
                                        let mut stdin = shared.stdin.lock().await;
                                        if let Err(error) =
                                            write_json_line(&mut stdin, &cancel).await
                                        {
                                            log::warn!(
                                                "[pi/rpc] failed to cancel extension ui request: {error}"
                                            );
                                        }
                                    }
                                }
                                "agent_start" => {
                                    shared.streaming.store(true, Ordering::SeqCst);
                                    let _ = pump_sender.send(PiRpcPumpEvent::Agent(value));
                                }
                                "agent_settled" => {
                                    shared.streaming.store(false, Ordering::SeqCst);
                                    let _ = pump_sender.send(PiRpcPumpEvent::Agent(value));
                                }
                                _ => {
                                    let _ = pump_sender.send(PiRpcPumpEvent::Agent(value));
                                }
                            }
                        }
                        Ok(None) => break None,
                        Err(error) => {
                            log::warn!("[pi/rpc] stdout read error: {error}");
                            break None;
                        }
                    }
                };
                // EOF: fail every pending request so callers never hang.
                let mut pending = shared.pending.lock().await;
                for (id, sender) in pending.drain() {
                    log::warn!("[pi/rpc] failing pending request id={id} on process exit");
                    let _ = sender.send(Err("pi rpc process exited".to_string()));
                }
                drop(pending);
                shared.streaming.store(false, Ordering::SeqCst);
                let _ = pump_sender.send(PiRpcPumpEvent::Exited(exit_code));
            });
        }

        let client = Arc::new(Self {
            shared,
            child: Mutex::new(child),
            pump_sender,
            state: RwLock::new(Value::Null),
        });

        // Handshake: proves the binary actually speaks RPC (older pi without
        // `--mode rpc` exits or prints text; both surface as handshake errors).
        let state = client.request_with_timeout(
            json!({"type":"get_state"}),
            PI_RPC_HANDSHAKE_TIMEOUT,
        );
        let state = state.await.map_err(|error| {
            format!("pi rpc handshake failed (get_state): {error}")
        })?;
        *client.state.write().await = state;
        Ok(client)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PiRpcPumpEvent> {
        self.pump_sender.subscribe()
    }

    pub fn is_streaming(&self) -> bool {
        self.shared.streaming.load(Ordering::SeqCst)
    }

    pub async fn is_alive(&self) -> bool {
        matches!(self.child.lock().await.try_wait(), Ok(None))
    }

    pub async fn session_id(&self) -> Option<String> {
        self.state
            .read()
            .await
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    /// Current model identity from the cached state: `(provider, modelId)`.
    /// None when the state predates a refresh or carries `model: null`.
    pub async fn current_model_identity(&self) -> Option<(String, String)> {
        let state = self.state.read().await;
        let model = state.get("model")?;
        let provider = model.get("provider")?.as_str()?.to_string();
        let id = model.get("id")?.as_str()?.to_string();
        Some((provider, id))
    }

    pub async fn kill(&self) {
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
    }

    pub async fn request(&self, cmd: Value) -> Result<Value, String> {
        self.request_with_timeout(cmd, PI_RPC_REQUEST_TIMEOUT).await
    }

    async fn request_with_timeout(
        &self,
        mut cmd: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = format!(
            "mossx-{}",
            self.shared.next_id.fetch_add(1, Ordering::SeqCst)
        );
        cmd["id"] = Value::String(id.clone());
        let (tx, rx) = oneshot::channel();
        // pending 必须先于写注册：response 走独立的 stdout pump task，可能
        // 在「写完成 → 注册」的窗口内到达——未注册会被当 late/unknown 丢弃，
        // 调用方干等到超时（get_state 这类本地快命令最容易命中该竞态）。
        {
            let mut pending = self.shared.pending.lock().await;
            pending.insert(id.clone(), tx);
        }
        {
            let mut stdin = self.shared.stdin.lock().await;
            if let Err(error) = write_json_line(&mut stdin, &cmd).await {
                self.shared.pending.lock().await.remove(&id);
                return Err(error);
            }
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_closed)) => {
                self.shared.pending.lock().await.remove(&id);
                Err("pi rpc response channel closed".to_string())
            }
            Err(_elapsed) => {
                self.shared.pending.lock().await.remove(&id);
                Err(format!("pi rpc request {id} timed out"))
            }
        }
    }

    // ===== Command surface =====

    pub async fn prompt(&self, text: &str, images: Vec<Value>) -> Result<(), String> {
        let mut cmd = json!({"type":"prompt","message":text});
        if !images.is_empty() {
            cmd["images"] = Value::Array(images);
        }
        self.request(cmd).await.map(|_| ())
    }

    pub async fn steer(&self, text: &str, images: Vec<Value>) -> Result<(), String> {
        let mut cmd = json!({"type":"steer","message":text});
        if !images.is_empty() {
            cmd["images"] = Value::Array(images);
        }
        self.request(cmd).await.map(|_| ())
    }

    pub async fn abort(&self) -> Result<(), String> {
        self.request(json!({"type":"abort"})).await.map(|_| ())
    }

    pub async fn get_state(&self) -> Result<Value, String> {
        let state = self.request(json!({"type":"get_state"})).await?;
        *self.state.write().await = state.clone();
        Ok(state)
    }

    pub async fn get_session_stats(&self) -> Result<Value, String> {
        self.request(json!({"type":"get_session_stats"})).await
    }

    pub async fn compact(&self, custom_instructions: Option<&str>) -> Result<Value, String> {
        let mut cmd = json!({"type":"compact"});
        if let Some(instructions) = custom_instructions {
            let trimmed = instructions.trim();
            if !trimmed.is_empty() {
                cmd["customInstructions"] = Value::String(trimmed.to_string());
            }
        }
        self.request(cmd).await
    }

    pub async fn fork(&self, entry_id: &str) -> Result<Value, String> {
        let result = self.request(json!({"type":"fork","entryId":entry_id})).await?;
        let _ = self.get_state().await;
        Ok(result)
    }

    pub async fn switch_session(&self, session_path: &str) -> Result<Value, String> {
        let result = self
            .request(json!({"type":"switch_session","sessionPath":session_path}))
            .await?;
        // switch/fork/new_session 后必须刷新缓存：get_state 只更新于响应时，
        // 否则 SessionStarted / align 会拿到切换前的 stale session id
        // （生产事故：新会话文件 id 与缓存 id 不一致 → align 找不到文件）。
        let _ = self.get_state().await;
        Ok(result)
    }

    pub async fn new_session(&self) -> Result<(), String> {
        self.request(json!({"type":"new_session"})).await?;
        let _ = self.get_state().await;
        Ok(())
    }

    pub async fn get_tree(&self) -> Result<Value, String> {
        self.request(json!({"type":"get_tree"})).await
    }

    pub async fn get_fork_messages(&self) -> Result<Value, String> {
        self.request(json!({"type":"get_fork_messages"})).await
    }

    pub async fn set_model(&self, provider: &str, model_id: &str) -> Result<Value, String> {
        let result = self
            .request(json!({"type":"set_model","provider":provider,"modelId":model_id}))
            .await?;
        // 与 fork/switch_session/new_session 同纪律：成功后刷新缓存 state，
        // 否则下一轮模型对账读到切换前的 stale model 会重复 set_model。
        let _ = self.get_state().await;
        Ok(result)
    }

    pub async fn set_thinking_level(&self, level: &str) -> Result<(), String> {
        self.request(json!({"type":"set_thinking_level","level":level}))
            .await
            .map(|_| ())
    }
}

async fn write_json_line(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let mut line = serde_json::to_string(value)
        .map_err(|error| format!("failed to serialize pi rpc command: {error}"))?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| format!("failed to write pi rpc command: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("failed to flush pi rpc command: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_prompt_with_images() {
        let mut cmd = json!({"type":"prompt","message":"hi"});
        cmd["images"] = json!([{"type":"image","data":"AAAA","mimeType":"image/png"}]);
        let line = serde_json::to_string(&cmd).unwrap();
        assert!(line.contains("\"type\":\"prompt\""));
        assert!(line.contains("\"mimeType\":\"image/png\""));
        assert!(!line.contains('\u{2028}'));
    }

    #[test]
    fn extension_ui_cancel_shape() {
        let cancel = json!({"type":"extension_ui_response","id":"uuid-1","cancelled":true});
        assert_eq!(cancel["type"], "extension_ui_response");
        assert_eq!(cancel["cancelled"], true);
    }

    #[test]
    fn response_success_means_acceptance_not_terminal() {
        // 纪律测试：success=true 只是 accepted/queued，不允许映射成 turn 终态。
        let response = json!({"id":"mossx-1","type":"response","command":"prompt","success":true});
        assert_eq!(response["success"], true);
        assert_ne!(response["type"], "agent_settled");
    }

    #[tokio::test]
    async fn strict_jsonl_split_only_on_lf() {
        // U+2028 / U+2029 不得作为记录分隔：tokio lines() 只按 \n 切。
        let payload = "{\"type\":\"agent_start\",\"note\":\"a\u{2028}b\u{2029}c\"}\n{\"type\":\"agent_settled\"}\n";
        let cursor = std::io::Cursor::new(payload.as_bytes().to_vec());
        let mut lines = BufReader::new(cursor).lines();
        let first = lines.next_line().await.unwrap().unwrap();
        assert!(first.contains('a'));
        let second = lines.next_line().await.unwrap().unwrap();
        assert_eq!(second, "{\"type\":\"agent_settled\"}");
        assert!(lines.next_line().await.unwrap().is_none());
    }
}
