//! Mux WebSocket → EngineEvent projection.

use super::host::DshHostClient;
use super::session::thread_id_for_session;
use crate::engine::events::{engine_event_to_app_server_event_with_turn_context, EngineEvent};
use crate::engine::EngineType;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// DSH streams token-sized reasoning/text deltas. Coalesce only those two
/// kinds on the mux emit path so a multi-hour k3 goal does not flood the
/// shared app-server-event queue. Other engines are untouched.
const DSH_DELTA_COALESCE_WINDOW: Duration = Duration::from_millis(50);
const DSH_DELTA_COALESCE_MAX_BYTES: usize = 4096;

#[derive(Debug, Clone)]
pub struct DshSessionBinding {
    pub workspace_id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DshGoalPhase {
    Active,
    Paused,
    Blocked,
    Complete,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct DshGoalSessionState {
    phase: Option<DshGoalPhase>,
    awaiting_session_idle: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DshCoalescedDeltaKind {
    Text,
    Reasoning,
}

#[derive(Debug, Clone)]
struct DshPendingDelta {
    kind: DshCoalescedDeltaKind,
    session_id: String,
    workspace_id: String,
    thread_id: String,
    item_id: String,
    turn_id: Option<String>,
    text: String,
    started_at: Instant,
}

impl DshPendingDelta {
    fn key(&self) -> (DshCoalescedDeltaKind, String, String) {
        (self.kind, self.session_id.clone(), self.item_id.clone())
    }

    fn should_flush(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.started_at) >= DSH_DELTA_COALESCE_WINDOW
            || self.text.len() >= DSH_DELTA_COALESCE_MAX_BYTES
    }

    fn remaining_window(&self, now: Instant) -> Duration {
        DSH_DELTA_COALESCE_WINDOW.saturating_sub(now.saturating_duration_since(self.started_at))
    }

    fn into_event(self) -> EngineEvent {
        match self.kind {
            DshCoalescedDeltaKind::Text => EngineEvent::TextDelta {
                workspace_id: self.workspace_id,
                text: self.text,
            },
            DshCoalescedDeltaKind::Reasoning => EngineEvent::ReasoningDelta {
                workspace_id: self.workspace_id,
                text: self.text,
            },
        }
    }
}

#[derive(Debug, Default)]
struct DshDeltaCoalesceBuffer {
    pending: Option<DshPendingDelta>,
}

fn dsh_delta_kind(event: &EngineEvent) -> Option<DshCoalescedDeltaKind> {
    match event {
        EngineEvent::TextDelta { .. } => Some(DshCoalescedDeltaKind::Text),
        EngineEvent::ReasoningDelta { .. } => Some(DshCoalescedDeltaKind::Reasoning),
        _ => None,
    }
}

fn dsh_delta_text(event: &EngineEvent) -> Option<&str> {
    match event {
        EngineEvent::TextDelta { text, .. } | EngineEvent::ReasoningDelta { text, .. } => {
            Some(text.as_str())
        }
        _ => None,
    }
}

type DshEmitReady = (EngineEvent, String, String, Option<String>);

fn pending_to_ready(pending: DshPendingDelta) -> DshEmitReady {
    let thread_id = pending.thread_id.clone();
    let item_id = pending.item_id.clone();
    let turn_id = pending.turn_id.clone();
    (pending.into_event(), thread_id, item_id, turn_id)
}

/// Fold consecutive same-item text/reasoning deltas. Returns events that must
/// emit now (flushed pending + non-delta events). The newest matching delta
/// stays in the buffer until the time/size window expires.
fn push_dsh_coalesced_events(
    buffer: &mut DshDeltaCoalesceBuffer,
    session_id: &str,
    binding: &DshSessionBinding,
    events: Vec<EngineEvent>,
    now: Instant,
) -> Vec<DshEmitReady> {
    let mut ready = Vec::new();
    for event in events {
        let item_id = item_id_for_event(&event, binding, session_id);
        let turn_id = binding.turn_id.clone();
        let Some(kind) = dsh_delta_kind(&event) else {
            if let Some(pending) = buffer.pending.take() {
                ready.push(pending_to_ready(pending));
            }
            ready.push((event, binding.thread_id.clone(), item_id, turn_id));
            continue;
        };
        let Some(text) = dsh_delta_text(&event).filter(|value| !value.is_empty()) else {
            continue;
        };
        let incoming = DshPendingDelta {
            kind,
            session_id: session_id.to_string(),
            workspace_id: binding.workspace_id.clone(),
            thread_id: binding.thread_id.clone(),
            item_id,
            turn_id,
            text: text.to_string(),
            started_at: now,
        };
        match buffer.pending.as_mut() {
            Some(pending) if pending.key() == incoming.key() => {
                pending.text.push_str(&incoming.text);
                if pending.should_flush(now) {
                    let flushed = buffer.pending.take().expect("pending just matched");
                    ready.push(pending_to_ready(flushed));
                }
            }
            Some(_) => {
                let flushed = buffer.pending.take().expect("pending exists");
                ready.push(pending_to_ready(flushed));
                buffer.pending = Some(incoming);
            }
            None => {
                buffer.pending = Some(incoming);
            }
        }
    }
    ready
}

fn take_expired_dsh_delta(
    buffer: &mut DshDeltaCoalesceBuffer,
    now: Instant,
) -> Option<DshEmitReady> {
    let should_flush = buffer
        .pending
        .as_ref()
        .is_some_and(|pending| pending.should_flush(now));
    if !should_flush {
        return None;
    }
    buffer.pending.take().map(pending_to_ready)
}

fn next_dsh_delta_flush_delay(buffer: &DshDeltaCoalesceBuffer, now: Instant) -> Option<Duration> {
    buffer
        .pending
        .as_ref()
        .map(|pending| pending.remaining_window(now))
}

struct MuxHub {
    bindings: HashMap<String, DshSessionBinding>,
    goal_states: HashMap<String, DshGoalSessionState>,
    turn_waiters: HashMap<String, Vec<oneshot::Sender<String>>>,
    open_turns: HashMap<String, bool>,
    pending_questions: HashMap<String, Value>,
    pending_deltas: DshDeltaCoalesceBuffer,
    app: Option<AppHandle>,
    stop: Option<oneshot::Sender<()>>,
    url: Option<String>,
}

static MUX: OnceLock<Mutex<MuxHub>> = OnceLock::new();

fn mux() -> &'static Mutex<MuxHub> {
    MUX.get_or_init(|| {
        Mutex::new(MuxHub {
            bindings: HashMap::new(),
            goal_states: HashMap::new(),
            turn_waiters: HashMap::new(),
            open_turns: HashMap::new(),
            pending_questions: HashMap::new(),
            pending_deltas: DshDeltaCoalesceBuffer::default(),
            app: None,
            stop: None,
            url: None,
        })
    })
}

pub async fn bind_session(session_id: &str, binding: DshSessionBinding) {
    let mut hub = mux().lock().await;
    hub.bindings.insert(session_id.to_string(), binding);
}

pub async fn unbind_session(session_id: &str) {
    let (app, flushed) = {
        let mut hub = mux().lock().await;
        let flushed = take_pending_delta_for_session(&mut hub, session_id);
        hub.bindings.remove(session_id);
        hub.goal_states.remove(session_id);
        hub.open_turns.remove(session_id);
        (hub.app.clone(), flushed)
    };
    if let (Some(app), Some((event, thread_id, item_id, turn_id))) = (app, flushed) {
        emit_dsh_engine_event(&app, event, &thread_id, item_id, turn_id);
    }
}

pub async fn session_has_open_turn(session_id: &str) -> bool {
    mux()
        .lock()
        .await
        .open_turns
        .get(session_id)
        .copied()
        .unwrap_or(false)
}

pub async fn session_ids_for_workspace(workspace_id: &str) -> Vec<String> {
    mux()
        .lock()
        .await
        .bindings
        .iter()
        .filter(|(_, binding)| binding.workspace_id == workspace_id)
        .map(|(session_id, _)| session_id.clone())
        .collect()
}

pub async fn pending_questions(rpc_id: &str) -> Option<Value> {
    mux().lock().await.pending_questions.get(rpc_id).cloned()
}

pub async fn forget_pending_questions(rpc_id: &str) {
    mux().lock().await.pending_questions.remove(rpc_id);
}

pub async fn session_id_for_turn(turn_id: &str) -> Option<String> {
    mux()
        .lock()
        .await
        .bindings
        .iter()
        .find(|(_, binding)| binding.turn_id.as_deref() == Some(turn_id))
        .map(|(session_id, _)| session_id.clone())
}

pub struct DshTurnWaiter {
    session_id: String,
    rx: oneshot::Receiver<String>,
}

pub async fn subscribe_turn_end(session_id: &str) -> DshTurnWaiter {
    let (tx, rx) = oneshot::channel();
    {
        let mut hub = mux().lock().await;
        hub.turn_waiters
            .entry(session_id.to_string())
            .or_default()
            .push(tx);
    }
    DshTurnWaiter {
        session_id: session_id.to_string(),
        rx,
    }
}

impl DshTurnWaiter {
    pub async fn await_end(self, timeout: Duration) -> Result<String, String> {
        let session_id = self.session_id;
        match tokio::time::timeout(timeout, self.rx).await {
            Ok(Ok(kind)) => Ok(kind),
            Ok(Err(_)) => Err("DSH turn waiter closed".to_string()),
            Err(_) => {
                let mut hub = mux().lock().await;
                if let Some(waiters) = hub.turn_waiters.get_mut(&session_id) {
                    waiters.retain(|waiter| !waiter.is_closed());
                    if waiters.is_empty() {
                        hub.turn_waiters.remove(&session_id);
                    }
                }
                Err("DSH turn timed out".to_string())
            }
        }
    }
}

fn notify_turn_end(session_id: &str, kind: &str, hub: &mut MuxHub) {
    hub.open_turns.insert(session_id.to_string(), false);
    if let Some(waiters) = hub.turn_waiters.remove(session_id) {
        for waiter in waiters {
            let _ = waiter.send(kind.to_string());
        }
    }
}

pub async fn set_app_handle(app: AppHandle) {
    mux().lock().await.app = Some(app);
}

pub async fn ensure_mux(client: &DshHostClient) {
    let url = client.mux_url();
    let mut hub = mux().lock().await;
    if hub.stop.is_some() && hub.url.as_deref() == Some(url.as_str()) {
        return;
    }
    if let Some(stop) = hub.stop.take() {
        let _ = stop.send(());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    hub.stop = Some(tx);
    hub.url = Some(url.clone());
    tokio::spawn(async move {
        run_mux_loop(url, rx).await;
        let mut hub = mux().lock().await;
        hub.stop = None;
        hub.url = None;
    });
}

async fn run_mux_loop(url: String, mut stop: tokio::sync::oneshot::Receiver<()>) {
    loop {
        if stop.try_recv().is_ok() {
            flush_all_pending_dsh_deltas().await;
            return;
        }
        match tokio_tungstenite::connect_async(&url).await {
            Ok((stream, _)) => {
                log::info!("[dsh] mux connected {url}");
                let (mut sink, mut stream) = stream.split();
                loop {
                    let flush_delay = {
                        let hub = mux().lock().await;
                        next_dsh_delta_flush_delay(&hub.pending_deltas, Instant::now())
                    };
                    tokio::select! {
                        _ = &mut stop => {
                            flush_all_pending_dsh_deltas().await;
                            let _ = sink.close().await;
                            return;
                        }
                        _ = async {
                            if let Some(delay) = flush_delay {
                                tokio::time::sleep(delay).await;
                            } else {
                                std::future::pending::<()>().await;
                            }
                        } => {
                            flush_expired_dsh_deltas().await;
                        }
                        next = stream.next() => {
                            match next {
                                Some(Ok(Message::Text(text))) => {
                                    dispatch_mux_text(&text).await;
                                }
                                Some(Ok(Message::Binary(bytes))) => {
                                    if let Ok(text) = String::from_utf8(bytes) {
                                        dispatch_mux_text(&text).await;
                                    }
                                }
                                Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
                                Some(Ok(Message::Close(_))) | None => {
                                    flush_all_pending_dsh_deltas().await;
                                    break;
                                }
                                Some(Err(error)) => {
                                    log::warn!("[dsh] mux read error: {error}");
                                    flush_all_pending_dsh_deltas().await;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            Err(error) => {
                log::warn!("[dsh] mux connect failed: {error}");
            }
        }
        tokio::select! {
            _ = &mut stop => {
                flush_all_pending_dsh_deltas().await;
                return;
            }
            _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {}
        }
    }
}

fn peek_mux_session_id(raw: &Value) -> Option<String> {
    raw.get("sessionId")
        .or_else(|| {
            raw.get("payload")
                .and_then(|payload| payload.get("sessionId"))
        })
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn turn_end_kind(event: &EngineEvent) -> Option<&str> {
    match event {
        EngineEvent::TurnCompleted { .. } => Some("completed"),
        EngineEvent::TurnError { error, .. } => Some(error.as_str()),
        _ => None,
    }
}

fn parse_dsh_goal_phase(raw: &str) -> Option<DshGoalPhase> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "active" => Some(DshGoalPhase::Active),
        "paused" => Some(DshGoalPhase::Paused),
        "blocked" => Some(DshGoalPhase::Blocked),
        "complete" | "completed" => Some(DshGoalPhase::Complete),
        _ => None,
    }
}

fn dsh_goal_change_operation(data: &Value) -> Option<&str> {
    data.get("operation")
        .or_else(|| data.pointer("/goal/operation"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn apply_dsh_goal_change(state: &mut DshGoalSessionState, data: &Value) {
    let operation = dsh_goal_change_operation(data).map(|value| value.to_ascii_lowercase());
    if matches!(operation.as_deref(), Some("clear")) {
        state.phase = None;
        return;
    }
    if data.get("goal").map(Value::is_null).unwrap_or(false) {
        state.phase = None;
        return;
    }
    let phase = data
        .pointer("/goal/phase")
        .or_else(|| data.get("phase"))
        .and_then(Value::as_str)
        .and_then(parse_dsh_goal_phase);
    if let Some(phase) = phase {
        state.phase = Some(phase);
    }
}

fn is_dsh_failure_turn_end(kind: &str) -> bool {
    matches!(kind, "cancelled" | "aborted" | "error" | "failed")
}

fn turn_end_reason_kind(data: &Value) -> &str {
    data.pointer("/reason/kind")
        .and_then(Value::as_str)
        .unwrap_or("completed")
}

fn session_event_parts<'a>(frame_type: &str, frame: &'a Value) -> Option<(&'a str, &'a Value)> {
    if frame_type != "session/event" {
        return None;
    }
    let event = frame.get("event").unwrap_or(frame);
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    let data = event.get("data").unwrap_or(&Value::Null);
    Some((event_type, data))
}

fn apply_dsh_goal_settlement(
    state: &mut DshGoalSessionState,
    event_type: &str,
    event_data: &Value,
    mut events: Vec<EngineEvent>,
    workspace_id: &str,
) -> (Vec<EngineEvent>, bool) {
    if event_type == "goal/change" {
        apply_dsh_goal_change(state, event_data);
        if state.awaiting_session_idle && state.phase != Some(DshGoalPhase::Active) {
            events.push(EngineEvent::TurnCompleted {
                workspace_id: workspace_id.to_string(),
                result: Some(event_data.clone()),
            });
            state.awaiting_session_idle = false;
        }
        return (events, false);
    }

    if event_type == "turn/start" {
        state.awaiting_session_idle = false;
        return (events, false);
    }

    if event_type != "turn/end" {
        return (events, false);
    }

    let kind = turn_end_reason_kind(event_data);
    if is_dsh_failure_turn_end(kind) {
        return (events, true);
    }

    if state.phase == Some(DshGoalPhase::Active) {
        events.retain(|event| !matches!(event, EngineEvent::TurnCompleted { .. }));
        state.awaiting_session_idle = true;
    }
    (events, false)
}

fn dsh_user_message_text(data: &Value) -> String {
    data.get("text")
        .and_then(Value::as_str)
        .or_else(|| {
            data.get("content")
                .and_then(Value::as_array)
                .and_then(|blocks| {
                    blocks
                        .iter()
                        .find_map(|block| block.get("text").and_then(Value::as_str))
                })
        })
        .unwrap_or("")
        .to_string()
}

fn is_dsh_goal_source(data: &Value) -> bool {
    data.pointer("/source/kind")
        .and_then(Value::as_str)
        .map(|kind| kind.eq_ignore_ascii_case("goal"))
        .unwrap_or(false)
}

fn project_dsh_goal_injection(
    workspace_id: &str,
    thread_id: &str,
    data: &Value,
) -> Vec<EngineEvent> {
    if !is_dsh_goal_source(data) {
        return Vec::new();
    }
    let text = dsh_user_message_text(data);
    if text.trim().is_empty() {
        return Vec::new();
    }
    vec![EngineEvent::Raw {
        workspace_id: workspace_id.to_string(),
        engine: EngineType::Dsh,
        data: serde_json::json!({
            "kind": "dsh-goal-injection",
            "threadId": thread_id,
            "text": text,
            "source": data.get("source").cloned().unwrap_or(Value::Null),
            "id": data.get("id").cloned().unwrap_or(Value::Null),
        }),
    }]
}

pub(super) fn emit_dsh_engine_event(
    app: &AppHandle,
    event: EngineEvent,
    thread_id: &str,
    item_id: String,
    turn_id: Option<String>,
) {
    if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
        &event,
        thread_id,
        &item_id,
        turn_id.as_deref(),
    ) {
        if let Some(runtime_turn_id) = turn_id.as_deref() {
            let provider_runtime_key = super::super::dsh_provider_profile::dsh_runtime_key(
                event.workspace_id(),
            );
            super::super::commands::fan_out_provider_engine_event(
                app,
                &provider_runtime_key,
                EngineType::Dsh,
                runtime_turn_id,
                Some(thread_id),
                &event,
                vec![payload],
            );
        } else {
            let _ = app.emit("app-server-event", payload);
        }
    }
}

fn take_pending_delta_for_session(hub: &mut MuxHub, session_id: &str) -> Option<DshEmitReady> {
    let matches = hub
        .pending_deltas
        .pending
        .as_ref()
        .is_some_and(|pending| pending.session_id == session_id);
    if !matches {
        return None;
    }
    hub.pending_deltas.pending.take().map(pending_to_ready)
}

async fn flush_expired_dsh_deltas() {
    let (app, flushed) = {
        let mut hub = mux().lock().await;
        (
            hub.app.clone(),
            take_expired_dsh_delta(&mut hub.pending_deltas, Instant::now()),
        )
    };
    if let (Some(app), Some((event, thread_id, item_id, turn_id))) = (app, flushed) {
        emit_dsh_engine_event(&app, event, &thread_id, item_id, turn_id);
    }
}

async fn flush_all_pending_dsh_deltas() {
    let (app, flushed) = {
        let mut hub = mux().lock().await;
        (
            hub.app.clone(),
            hub.pending_deltas.pending.take().map(pending_to_ready),
        )
    };
    if let (Some(app), Some((event, thread_id, item_id, turn_id))) = (app, flushed) {
        emit_dsh_engine_event(&app, event, &thread_id, item_id, turn_id);
    }
}

async fn dispatch_mux_text(text: &str) {
    let Ok(raw) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let session_id = peek_mux_session_id(&raw).unwrap_or_default();
    let (frame, rpc_id) = unwrap_mux_envelope(&raw);
    let frame_type = frame.get("type").and_then(Value::as_str).unwrap_or("");
    let (app, ready) = {
        let mut hub = mux().lock().await;
        if session_id.is_empty() || !hub.bindings.contains_key(&session_id) {
            return;
        }
        let Some(app) = hub.app.clone() else {
            return;
        };
        let Some(binding) = hub.bindings.get(&session_id).cloned() else {
            return;
        };
        if frame_type == "question/requested" {
            if let Some(rpc_id) = rpc_id.as_deref() {
                if let Some(questions) = extract_question_array(&frame) {
                    hub.pending_questions.insert(rpc_id.to_string(), questions);
                }
            }
        }
        let projected =
            project_mux_frame(frame_type, &frame, &binding, &session_id, rpc_id.as_deref());
        if projected
            .iter()
            .any(|event| matches!(event, EngineEvent::TurnStarted { .. }))
        {
            hub.open_turns.insert(session_id.clone(), true);
        }
        if let Some(kind) = projected.iter().find_map(turn_end_kind) {
            notify_turn_end(&session_id, kind, &mut hub);
        }
        let (event_type, event_data) =
            session_event_parts(frame_type, &frame).unwrap_or(("", &Value::Null));
        let goal_state = hub.goal_states.entry(session_id.clone()).or_default();
        let (events, should_unbind) = apply_dsh_goal_settlement(
            goal_state,
            event_type,
            event_data,
            projected,
            &binding.workspace_id,
        );
        let mut ready = push_dsh_coalesced_events(
            &mut hub.pending_deltas,
            &session_id,
            &binding,
            events,
            Instant::now(),
        );
        if should_unbind {
            if let Some(pending) = take_pending_delta_for_session(&mut hub, &session_id) {
                ready.push(pending);
            }
            hub.bindings.remove(&session_id);
            hub.goal_states.remove(&session_id);
            hub.open_turns.remove(&session_id);
        }
        (app, ready)
    };

    for (event, thread_id, item_id, turn_id) in ready {
        emit_dsh_engine_event(&app, event, &thread_id, item_id, turn_id);
    }
}

fn item_id_for_event(event: &EngineEvent, binding: &DshSessionBinding, session_id: &str) -> String {
    match event {
        EngineEvent::ReasoningDelta { .. } => format!(
            "dsh-reasoning-{}",
            binding.turn_id.as_deref().unwrap_or(session_id)
        ),
        EngineEvent::ToolStarted { tool_id, .. }
        | EngineEvent::ToolCompleted { tool_id, .. }
        | EngineEvent::ToolInputUpdated { tool_id, .. }
        | EngineEvent::ToolOutputDelta { tool_id, .. } => tool_id.clone(),
        _ => binding
            .item_id
            .clone()
            .unwrap_or_else(|| format!("dsh-item-{session_id}")),
    }
}

fn extract_question_array(frame: &Value) -> Option<Value> {
    frame
        .get("questions")
        .cloned()
        .filter(|value| value.is_array())
        .or_else(|| {
            frame
                .get("payload")
                .and_then(|payload| payload.get("questions"))
                .cloned()
                .filter(|value| value.is_array())
        })
}

fn unwrap_mux_envelope(raw: &Value) -> (Value, Option<String>) {
    if raw.get("type").and_then(Value::as_str) != Some("server-request") {
        let rpc_id = raw
            .get("rpcId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        return (raw.clone(), rpc_id);
    }
    let payload = raw.get("payload").cloned().unwrap_or(Value::Null);
    let rpc_id = raw
        .get("rpcId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    (payload, rpc_id)
}

pub fn project_mux_frame(
    frame_type: &str,
    frame: &Value,
    binding: &DshSessionBinding,
    session_id: &str,
    rpc_id: Option<&str>,
) -> Vec<EngineEvent> {
    match frame_type {
        "session/event" => {
            let event = frame.get("event").unwrap_or(frame);
            project_session_event(event, binding, session_id)
        }
        "approval/requested" => {
            let Some(rpc_id) = rpc_id.filter(|value| !value.is_empty()) else {
                return Vec::new();
            };
            let approval_id = frame
                .get("approvalId")
                .or_else(|| frame.pointer("/payload/approvalId"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if approval_id.is_empty() {
                return Vec::new();
            }
            vec![EngineEvent::ApprovalRequest {
                workspace_id: binding.workspace_id.clone(),
                request_id: super::encode_approval_request_id(rpc_id, session_id, approval_id),
                tool_name: frame
                    .get("toolName")
                    .or_else(|| frame.get("tool"))
                    .or_else(|| frame.pointer("/payload/toolName"))
                    .or_else(|| frame.pointer("/payload/tool"))
                    .and_then(Value::as_str)
                    .unwrap_or("dsh-tool")
                    .to_string(),
                input: Some(frame.clone()),
                message: frame
                    .get("reason")
                    .or_else(|| frame.pointer("/payload/reason"))
                    .or_else(|| frame.pointer("/payload/message"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
            }]
        }
        "question/requested" => {
            let Some(rpc_id) = rpc_id.filter(|value| !value.is_empty()) else {
                return Vec::new();
            };
            let questions = extract_question_array(frame).unwrap_or_else(|| Value::Array(vec![]));
            vec![EngineEvent::RequestUserInput {
                workspace_id: binding.workspace_id.clone(),
                request_id: super::encode_question_request_id(rpc_id, session_id),
                questions,
                completed: false,
            }]
        }
        "session/projection" => project_session_projection(frame, binding),
        "session/subscribed" | "approval/resolved" | "question/resolved" | "session/queue"
        | "session/jobs" | "stream/error" => Vec::new(),
        _ => Vec::new(),
    }
}

fn project_session_projection(frame: &Value, binding: &DshSessionBinding) -> Vec<EngineEvent> {
    let key = frame.get("key").and_then(Value::as_str).unwrap_or("");
    let value = frame.get("value").cloned().unwrap_or(Value::Null);
    match key {
        "tokenUsage" => vec![EngineEvent::UsageUpdate {
            workspace_id: binding.workspace_id.clone(),
            input_tokens: int_field(&value, &["uncachedInputTokens", "inputTokens", "input"]),
            output_tokens: int_field(&value, &["outputTokens", "output"]),
            cached_tokens: int_field(&value, &["cacheReadTokens", "cachedTokens"]),
            model_context_window: None,
            context_used_tokens: None,
            context_usage_source: Some("live".to_string()),
            context_usage_freshness: Some("live".to_string()),
            context_used_percent: None,
            context_remaining_percent: None,
            context_tool_usages: None,
            context_tool_usages_truncated: None,
            context_category_usages: None,
        }],
        "sessionStats" => vec![EngineEvent::Raw {
            workspace_id: binding.workspace_id.clone(),
            engine: EngineType::Dsh,
            data: serde_json::json!({
                "kind": "dsh-session-stats",
                "threadId": binding.thread_id,
                "sessionStats": value,
            }),
        }],
        "todos" => vec![EngineEvent::Raw {
            workspace_id: binding.workspace_id.clone(),
            engine: EngineType::Dsh,
            data: serde_json::json!({
                "kind": "dsh-todos",
                "threadId": binding.thread_id,
                "todos": if value.is_array() { value } else { Value::Array(vec![]) },
            }),
        }],
        "contextPressure" => vec![EngineEvent::Raw {
            workspace_id: binding.workspace_id.clone(),
            engine: EngineType::Dsh,
            data: serde_json::json!({
                "kind": "dsh-context-usage",
                "threadId": binding.thread_id,
                "contextPressure": value,
            }),
        }],
        "contextBreakdown" => vec![EngineEvent::Raw {
            workspace_id: binding.workspace_id.clone(),
            engine: EngineType::Dsh,
            data: serde_json::json!({
                "kind": "dsh-context-usage",
                "threadId": binding.thread_id,
                "contextBreakdown": value,
            }),
        }],
        _ => Vec::new(),
    }
}

pub fn project_session_event(
    event: &Value,
    binding: &DshSessionBinding,
    session_id: &str,
) -> Vec<EngineEvent> {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    let data = event.get("data").cloned().unwrap_or(Value::Null);
    let workspace_id = binding.workspace_id.clone();
    match event_type {
        "turn/start" => vec![
            EngineEvent::SessionStarted {
                workspace_id: workspace_id.clone(),
                session_id: session_id.to_string(),
                engine: EngineType::Dsh,
                turn_id: binding.turn_id.clone(),
            },
            EngineEvent::TurnStarted {
                workspace_id,
                turn_id: binding
                    .turn_id
                    .clone()
                    .unwrap_or_else(|| format!("dsh-turn-{session_id}")),
            },
        ],
        "turn/end" => {
            let kind = data
                .pointer("/reason/kind")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            if matches!(kind, "cancelled" | "aborted" | "error" | "failed") {
                let (error, code) = turn_end_failure(&data, kind);
                vec![EngineEvent::TurnError {
                    workspace_id,
                    error,
                    code,
                }]
            } else {
                vec![EngineEvent::TurnCompleted {
                    workspace_id,
                    result: Some(data),
                }]
            }
        }
        "assistant/chunk" => project_stream_chunk(&workspace_id, &data),
        // `assistant/message` is the complete snapshot. Live text already
        // arrived as `assistant/chunk` deltas; re-emitting it as TextDelta
        // duplicates the bubble.
        "assistant/message" => Vec::new(),
        "tool/call" => {
            let tool_id = data
                .get("id")
                .or_else(|| data.get("callId"))
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let tool_name = data
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            // DSH stores `arguments` as the raw model JSON string (unparsed).
            // Pass through as-is; FE normalizes string vs object for path display.
            vec![EngineEvent::ToolStarted {
                workspace_id,
                tool_id,
                tool_name,
                input: data
                    .get("arguments")
                    .cloned()
                    .or_else(|| data.get("args").cloned()),
            }]
        }
        "tool/result" => {
            // DSH pairs results via `data.message.source.callId`, not top-level id.
            let tool_id = data
                .get("id")
                .or_else(|| data.get("callId"))
                .or_else(|| data.get("toolCallId"))
                .or_else(|| data.pointer("/message/source/callId"))
                .or_else(|| data.pointer("/message/content/0/toolCallId"))
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let output = data
                .get("result")
                .cloned()
                .or_else(|| data.get("output").cloned())
                .or_else(|| extract_dsh_tool_result_output(&data));
            let error = data
                .get("error")
                .and_then(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .or_else(|| {
                            value
                                .get("message")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .or_else(|| {
                            value
                                .get("code")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                })
                .or_else(|| {
                    data.pointer("/message/content/0").and_then(|block| {
                        if block.get("isError").and_then(Value::as_bool) == Some(true) {
                            extract_dsh_content_text(block)
                        } else {
                            None
                        }
                    })
                });
            vec![EngineEvent::ToolCompleted {
                workspace_id,
                tool_id,
                tool_name: data.get("name").and_then(Value::as_str).map(str::to_string),
                output,
                error,
            }]
        }
        "user/message" => project_dsh_goal_injection(&workspace_id, &binding.thread_id, &data),
        "step/start" | "step/end" | "goal/change" | "llm/retry" | "command/run"
        | "command/done" | "permission/preset" | "sandbox/mode" | "approval/policy" => Vec::new(),
        _ => Vec::new(),
    }
}

fn project_stream_chunk(workspace_id: &str, data: &Value) -> Vec<EngineEvent> {
    let chunk = data.get("chunk").unwrap_or(data);
    let chunk_type = chunk.get("type").and_then(Value::as_str).unwrap_or("");
    match chunk_type {
        "text-delta" => chunk
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|text| {
                vec![EngineEvent::TextDelta {
                    workspace_id: workspace_id.to_string(),
                    text: text.to_string(),
                }]
            })
            .unwrap_or_default(),
        "reasoning-delta" => chunk
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|text| {
                vec![EngineEvent::ReasoningDelta {
                    workspace_id: workspace_id.to_string(),
                    text: text.to_string(),
                }]
            })
            .unwrap_or_default(),
        "tool-call-delta" => {
            // Streaming tool *arguments* (not tool output). DSH emits raw JSON
            // fragments; the durable `tool/call` event already carries the full
            // `arguments` string, so we only project a complete JSON object here
            // (rare single-chunk case). Misrouting to ToolOutputDelta previously
            // polluted tool output and left Read rows as "读取 · ...".
            let tool_id = chunk
                .get("id")
                .or_else(|| chunk.get("callId"))
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let delta = chunk
                .get("argumentsDelta")
                .and_then(Value::as_str)
                .unwrap_or("");
            let tool_name = chunk
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string);
            let input = parse_complete_json_object(delta);
            if input.is_none() && tool_name.is_none() {
                return Vec::new();
            }
            vec![EngineEvent::ToolInputUpdated {
                workspace_id: workspace_id.to_string(),
                tool_id,
                tool_name,
                input,
            }]
        }
        "usage" => {
            let usage = chunk.get("usage").unwrap_or(chunk);
            vec![EngineEvent::UsageUpdate {
                workspace_id: workspace_id.to_string(),
                input_tokens: int_field(usage, &["uncachedInputTokens", "inputTokens", "input"]),
                output_tokens: int_field(usage, &["outputTokens", "output"]),
                cached_tokens: int_field(usage, &["cacheReadTokens", "cachedTokens"]),
                model_context_window: None,
                context_used_tokens: None,
                context_usage_source: Some("live".to_string()),
                context_usage_freshness: None,
                context_used_percent: None,
                context_remaining_percent: None,
                context_tool_usages: None,
                context_tool_usages_truncated: None,
                context_category_usages: None,
            }]
        }
        _ => Vec::new(),
    }
}

fn turn_end_failure(data: &Value, kind: &str) -> (String, Option<String>) {
    let failure = data.pointer("/reason/error");
    let code = failure
        .and_then(|value| value.get("code"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let message = failure
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let error = message.or(code).unwrap_or(kind).to_string();
    let code = code
        .map(str::to_string)
        .or_else(|| Some(kind.to_string()).filter(|value| !value.is_empty()));
    (error, code)
}

fn int_field(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_i64))
}

/// Pull model-facing text out of DSH `tool/result` message content blocks.
fn extract_dsh_content_text(block: &Value) -> Option<String> {
    if let Some(text) = block.get("text").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let content = block.get("content")?;
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    let arr = content.as_array()?;
    let mut parts = Vec::new();
    for entry in arr {
        if let Some(text) = entry.get("text").and_then(Value::as_str) {
            if !text.is_empty() {
                parts.push(text.to_string());
            }
        } else if let Some(text) = entry.as_str() {
            if !text.is_empty() {
                parts.push(text.to_string());
            }
        }
    }
    let joined = parts.join("\n");
    let trimmed = joined.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn extract_dsh_tool_result_output(data: &Value) -> Option<Value> {
    if let Some(block) = data.pointer("/message/content/0") {
        if let Some(text) = extract_dsh_content_text(block) {
            return Some(Value::String(text));
        }
        // Fall back to the whole block so structured meta is not lost.
        return Some(block.clone());
    }
    data.get("message").cloned()
}

fn parse_complete_json_object(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) if value.is_object() || value.is_array() => Some(value),
        _ => None,
    }
}

pub fn default_binding(workspace_id: &str, session_id: &str) -> DshSessionBinding {
    DshSessionBinding {
        workspace_id: workspace_id.to_string(),
        thread_id: thread_id_for_session(session_id),
        turn_id: None,
        item_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn binding() -> DshSessionBinding {
        DshSessionBinding {
            workspace_id: "ws-1".to_string(),
            thread_id: "dsh:session-1".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: Some("item-1".to_string()),
        }
    }

    #[test]
    fn projects_text_delta_chunk() {
        let event = json!({
            "type": "assistant/chunk",
            "data": { "chunk": { "type": "text-delta", "index": 0, "text": "hi" } }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        assert!(matches!(
            events.first(),
            Some(EngineEvent::TextDelta { text, .. }) if text == "hi"
        ));
    }

    #[test]
    fn projects_turn_end_completed() {
        let event = json!({
            "type": "turn/end",
            "data": { "reason": { "kind": "completed" } }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        assert!(matches!(
            events.first(),
            Some(EngineEvent::TurnCompleted { .. })
        ));
    }

    #[test]
    fn projects_turn_end_error_with_llm_failure() {
        let event = json!({
            "type": "turn/end",
            "data": {
                "reason": {
                    "kind": "error",
                    "error": {
                        "message": "unable to get local issuer certificate",
                        "code": "TLS_ERROR",
                        "status": 0
                    }
                }
            }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        match events.first() {
            Some(EngineEvent::TurnError { error, code, .. }) => {
                assert_eq!(error, "unable to get local issuer certificate");
                assert_eq!(code.as_deref(), Some("TLS_ERROR"));
            }
            other => panic!("expected TurnError with LlmFailure, got {other:?}"),
        }
    }

    #[test]
    fn projects_turn_end_error_falls_back_to_kind() {
        let event = json!({
            "type": "turn/end",
            "data": { "reason": { "kind": "error" } }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        match events.first() {
            Some(EngineEvent::TurnError { error, code, .. }) => {
                assert_eq!(error, "error");
                assert_eq!(code.as_deref(), Some("error"));
            }
            other => panic!("expected TurnError fallback, got {other:?}"),
        }
    }

    #[test]
    fn projects_turn_end_error_uses_code_when_message_missing() {
        let event = json!({
            "type": "turn/end",
            "data": {
                "reason": {
                    "kind": "error",
                    "error": { "code": "EMPTY_RESPONSE" }
                }
            }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        match events.first() {
            Some(EngineEvent::TurnError { error, code, .. }) => {
                assert_eq!(error, "EMPTY_RESPONSE");
                assert_eq!(code.as_deref(), Some("EMPTY_RESPONSE"));
            }
            other => panic!("expected TurnError from code, got {other:?}"),
        }
    }

    #[test]
    fn unwraps_server_request_envelope_and_encodes_approval_request() {
        let raw = json!({
            "type": "server-request",
            "rpcId": "rpc-approval-1",
            "method": "events.mux",
            "payload": {
                "type": "approval/requested",
                "sessionId": "session-1",
                "approvalId": "approval-1",
                "toolName": "bash"
            }
        });
        let (frame, rpc_id) = unwrap_mux_envelope(&raw);
        let events = project_mux_frame(
            "approval/requested",
            &frame,
            &binding(),
            "session-1",
            rpc_id.as_deref(),
        );
        match events.first() {
            Some(EngineEvent::ApprovalRequest {
                request_id,
                tool_name,
                ..
            }) => {
                assert_eq!(tool_name, "bash");
                match super::super::parse_control_request(request_id) {
                    Some(super::super::DshControlKind::Approval {
                        rpc_id,
                        session_id,
                        approval_id,
                    }) => {
                        assert_eq!(rpc_id, "rpc-approval-1");
                        assert_eq!(session_id, "session-1");
                        assert_eq!(approval_id, "approval-1");
                    }
                    other => panic!("unexpected control request: {other:?}"),
                }
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn unwraps_server_request_envelope_and_encodes_question_request() {
        let raw = json!({
            "type": "server-request",
            "rpcId": "rpc-question-1",
            "method": "question/requested",
            "payload": {
                "type": "question/requested",
                "sessionId": "session-1",
                "questions": [{
                    "id": "example_type",
                    "header": "示例类型",
                    "question": "你的「写个示例」，具体想做哪一种？",
                    "options": [{ "label": "补齐文档", "description": "只补 README" }]
                }]
            }
        });
        let (frame, rpc_id) = unwrap_mux_envelope(&raw);
        let events = project_mux_frame(
            "question/requested",
            &frame,
            &binding(),
            "session-1",
            rpc_id.as_deref(),
        );
        match events.first() {
            Some(EngineEvent::RequestUserInput {
                request_id,
                questions,
                completed,
                ..
            }) => {
                assert_eq!(*completed, false);
                assert_eq!(
                    questions.pointer("/0/id").and_then(Value::as_str),
                    Some("example_type")
                );
                match super::super::parse_control_request(request_id) {
                    Some(super::super::DshControlKind::Question { rpc_id, session_id }) => {
                        assert_eq!(rpc_id, "rpc-question-1");
                        assert_eq!(session_id, "session-1");
                    }
                    other => panic!("unexpected control request: {other:?}"),
                }
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn skips_unknown_event() {
        let event = json!({ "type": "web/deepseek-search-llm-request", "data": {} });
        assert!(project_session_event(&event, &binding(), "session-1").is_empty());
    }

    #[test]
    fn assistant_message_snapshot_is_not_a_text_delta() {
        let event = json!({
            "type": "assistant/message",
            "data": { "text": "hello already streamed" }
        });
        assert!(project_session_event(&event, &binding(), "session-1").is_empty());
    }

    #[test]
    fn projects_tool_call_with_raw_json_string_arguments() {
        let event = json!({
            "type": "tool/call",
            "data": {
                "callId": "call-read-1",
                "name": "read",
                "arguments": "{\"file_path\":\"src/main.ts\"}"
            }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        match events.first() {
            Some(EngineEvent::ToolStarted {
                tool_id,
                tool_name,
                input,
                ..
            }) => {
                assert_eq!(tool_id, "call-read-1");
                assert_eq!(tool_name, "read");
                assert_eq!(
                    input.as_ref().and_then(Value::as_str),
                    Some(r#"{"file_path":"src/main.ts"}"#)
                );
            }
            other => panic!("expected ToolStarted, got {other:?}"),
        }
    }

    #[test]
    fn projects_tool_result_using_message_source_call_id() {
        let event = json!({
            "type": "tool/result",
            "data": {
                "message": {
                    "source": { "callId": "call-read-1" },
                    "content": [{
                        "type": "tool-result",
                        "toolCallId": "call-read-1",
                        "content": [{ "type": "text", "text": "1\tline" }]
                    }]
                }
            }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        match events.first() {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                output,
                error,
                ..
            }) => {
                assert_eq!(tool_id, "call-read-1");
                assert!(error.is_none());
                assert_eq!(output.as_ref().and_then(Value::as_str), Some("1\tline"));
            }
            other => panic!("expected ToolCompleted, got {other:?}"),
        }
    }

    #[test]
    fn tool_call_delta_projects_complete_json_as_input_not_output() {
        let event = json!({
            "type": "assistant/chunk",
            "data": {
                "chunk": {
                    "type": "tool-call-delta",
                    "id": "call-read-2",
                    "name": "read",
                    "argumentsDelta": "{\"file_path\":\"a.ts\"}"
                }
            }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        match events.first() {
            Some(EngineEvent::ToolInputUpdated {
                tool_id,
                tool_name,
                input,
                ..
            }) => {
                assert_eq!(tool_id, "call-read-2");
                assert_eq!(tool_name.as_deref(), Some("read"));
                assert_eq!(
                    input
                        .as_ref()
                        .and_then(|value| value.get("file_path"))
                        .and_then(Value::as_str),
                    Some("a.ts")
                );
            }
            other => panic!("expected ToolInputUpdated, got {other:?}"),
        }
    }

    #[test]
    fn tool_call_delta_partial_json_is_not_forced_as_output() {
        let event = json!({
            "type": "assistant/chunk",
            "data": {
                "chunk": {
                    "type": "tool-call-delta",
                    "id": "call-read-3",
                    "argumentsDelta": "{\"file_path\":"
                }
            }
        });
        let events = project_session_event(&event, &binding(), "session-1");
        assert!(
            events
                .iter()
                .all(|event| !matches!(event, EngineEvent::ToolOutputDelta { .. })),
            "partial args must not become tool output"
        );
    }

    #[test]
    fn applies_goal_change_phase_and_clear_tombstone() {
        let mut state = DshGoalSessionState::default();
        apply_dsh_goal_change(
            &mut state,
            &json!({ "operation": "create", "goal": { "id": "g1", "phase": "active" } }),
        );
        assert_eq!(state.phase, Some(DshGoalPhase::Active));

        apply_dsh_goal_change(
            &mut state,
            &json!({ "operation": "pause", "goal": { "phase": "paused" } }),
        );
        assert_eq!(state.phase, Some(DshGoalPhase::Paused));

        apply_dsh_goal_change(&mut state, &json!({ "operation": "clear", "goal": null }));
        assert_eq!(state.phase, None);
    }

    #[test]
    fn completed_hop_without_goal_emits_turn_completed_and_stays_bound() {
        let mut state = DshGoalSessionState::default();
        let projected = vec![EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "reason": { "kind": "completed" } })),
        }];
        let (events, unbind) = apply_dsh_goal_settlement(
            &mut state,
            "turn/end",
            &json!({ "reason": { "kind": "completed" } }),
            projected,
            "ws-1",
        );
        assert!(!unbind);
        assert!(matches!(
            events.first(),
            Some(EngineEvent::TurnCompleted { .. })
        ));
        assert!(!state.awaiting_session_idle);
    }

    #[test]
    fn active_goal_suppresses_turn_completed_and_stays_bound() {
        let mut state = DshGoalSessionState {
            phase: Some(DshGoalPhase::Active),
            awaiting_session_idle: false,
        };
        let projected = vec![EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "reason": { "kind": "completed" } })),
        }];
        let (events, unbind) = apply_dsh_goal_settlement(
            &mut state,
            "turn/end",
            &json!({ "reason": { "kind": "completed" } }),
            projected,
            "ws-1",
        );
        assert!(!unbind);
        assert!(events.is_empty());
        assert!(state.awaiting_session_idle);
    }

    #[test]
    fn goal_complete_emits_deferred_turn_completed() {
        let mut state = DshGoalSessionState {
            phase: Some(DshGoalPhase::Active),
            awaiting_session_idle: true,
        };
        let (events, unbind) = apply_dsh_goal_settlement(
            &mut state,
            "goal/change",
            &json!({ "operation": "complete", "goal": { "phase": "complete" } }),
            Vec::new(),
            "ws-1",
        );
        assert!(!unbind);
        assert!(matches!(
            events.first(),
            Some(EngineEvent::TurnCompleted { .. })
        ));
        assert_eq!(state.phase, Some(DshGoalPhase::Complete));
        assert!(!state.awaiting_session_idle);
    }

    #[test]
    fn blocked_goal_settles_but_keeps_binding() {
        let mut state = DshGoalSessionState {
            phase: Some(DshGoalPhase::Active),
            awaiting_session_idle: true,
        };
        let (events, unbind) = apply_dsh_goal_settlement(
            &mut state,
            "goal/change",
            &json!({ "operation": "block", "goal": { "phase": "blocked" } }),
            Vec::new(),
            "ws-1",
        );
        assert!(!unbind);
        assert!(matches!(
            events.first(),
            Some(EngineEvent::TurnCompleted { .. })
        ));
        assert_eq!(state.phase, Some(DshGoalPhase::Blocked));
    }

    #[test]
    fn cancelled_hop_unbinds() {
        let mut state = DshGoalSessionState {
            phase: Some(DshGoalPhase::Active),
            awaiting_session_idle: true,
        };
        let projected = vec![EngineEvent::TurnError {
            workspace_id: "ws-1".to_string(),
            error: "cancelled".to_string(),
            code: Some("cancelled".to_string()),
        }];
        let (_events, unbind) = apply_dsh_goal_settlement(
            &mut state,
            "turn/end",
            &json!({ "reason": { "kind": "cancelled" } }),
            projected,
            "ws-1",
        );
        assert!(unbind);
    }

    #[test]
    fn projects_goal_injection_as_raw_and_skips_other_injections() {
        let goal = json!({
            "type": "user/message",
            "data": {
                "id": "msg-goal-1",
                "text": "<goal_round>\ncontinue\n</goal_round>",
                "source": { "kind": "goal", "goalId": "g1", "round": 2 }
            }
        });
        let events = project_session_event(&goal, &binding(), "session-1");
        match events.first() {
            Some(EngineEvent::Raw { engine, data, .. }) => {
                assert_eq!(*engine, EngineType::Dsh);
                assert_eq!(
                    data.get("kind").and_then(Value::as_str),
                    Some("dsh-goal-injection")
                );
                assert_eq!(
                    data.get("threadId").and_then(Value::as_str),
                    Some("dsh:session-1")
                );
                assert_eq!(
                    data.get("text").and_then(Value::as_str),
                    Some("<goal_round>\ncontinue\n</goal_round>")
                );
            }
            other => panic!("expected Raw goal injection, got {other:?}"),
        }

        let plugin = json!({
            "type": "user/message",
            "data": {
                "text": "Current runtime context.",
                "source": { "kind": "plugin", "plugin": "dsh-system-prompt" }
            }
        });
        assert!(project_session_event(&plugin, &binding(), "session-1").is_empty());
    }

    #[test]
    fn projects_token_usage_projection_as_usage_update() {
        let events = project_mux_frame(
            "session/projection",
            &json!({
                "type": "session/projection",
                "sessionId": "session-1",
                "key": "tokenUsage",
                "value": {
                    "uncachedInputTokens": 100,
                    "outputTokens": 20,
                    "cacheReadTokens": 400
                },
                "seq": 9
            }),
            &binding(),
            "session-1",
            None,
        );
        match events.first() {
            Some(EngineEvent::UsageUpdate {
                input_tokens,
                output_tokens,
                cached_tokens,
                ..
            }) => {
                assert_eq!(*input_tokens, Some(100));
                assert_eq!(*output_tokens, Some(20));
                assert_eq!(*cached_tokens, Some(400));
            }
            other => panic!("expected UsageUpdate, got {other:?}"),
        }
    }

    #[test]
    fn projects_todos_projection_as_raw() {
        let todos = json!([
            { "content": "step", "status": "in_progress" }
        ]);
        let events = project_mux_frame(
            "session/projection",
            &json!({
                "type": "session/projection",
                "sessionId": "session-1",
                "key": "todos",
                "value": todos,
                "seq": 11
            }),
            &binding(),
            "session-1",
            None,
        );
        match events.first() {
            Some(EngineEvent::Raw { engine, data, .. }) => {
                assert_eq!(*engine, EngineType::Dsh);
                assert_eq!(data.get("kind").and_then(Value::as_str), Some("dsh-todos"));
                assert_eq!(data.get("todos"), Some(&todos));
            }
            other => panic!("expected Raw todos, got {other:?}"),
        }
    }

    #[test]
    fn projects_empty_todos_projection_as_cleared_list() {
        let events = project_mux_frame(
            "session/projection",
            &json!({
                "type": "session/projection",
                "sessionId": "session-1",
                "key": "todos",
                "value": [],
                "seq": 12
            }),
            &binding(),
            "session-1",
            None,
        );
        match events.first() {
            Some(EngineEvent::Raw { data, .. }) => {
                assert_eq!(data.get("kind").and_then(Value::as_str), Some("dsh-todos"));
                assert_eq!(data.get("todos"), Some(&json!([])));
            }
            other => panic!("expected Raw empty todos, got {other:?}"),
        }
    }

    #[test]
    fn projects_context_pressure_and_breakdown_as_raw() {
        let pressure = project_mux_frame(
            "session/projection",
            &json!({
                "type": "session/projection",
                "key": "contextPressure",
                "value": { "projectedTokens": 209000, "contextWindow": 262000 }
            }),
            &binding(),
            "session-1",
            None,
        );
        match pressure.first() {
            Some(EngineEvent::Raw { data, .. }) => {
                assert_eq!(
                    data.get("kind").and_then(Value::as_str),
                    Some("dsh-context-usage")
                );
                assert_eq!(
                    data.pointer("/contextPressure/projectedTokens")
                        .and_then(Value::as_i64),
                    Some(209000)
                );
            }
            other => panic!("expected Raw contextPressure, got {other:?}"),
        }

        let breakdown = project_mux_frame(
            "session/projection",
            &json!({
                "type": "session/projection",
                "key": "contextBreakdown",
                "value": {
                    "systemTokens": 1500,
                    "toolsTokens": 6400,
                    "messageTokens": 196000
                }
            }),
            &binding(),
            "session-1",
            None,
        );
        match breakdown.first() {
            Some(EngineEvent::Raw { data, .. }) => {
                assert_eq!(
                    data.get("kind").and_then(Value::as_str),
                    Some("dsh-context-usage")
                );
                assert_eq!(
                    data.pointer("/contextBreakdown/messageTokens")
                        .and_then(Value::as_i64),
                    Some(196000)
                );
            }
            other => panic!("expected Raw contextBreakdown, got {other:?}"),
        }
    }

    #[test]
    fn projects_session_stats_projection_as_raw() {
        let events = project_mux_frame(
            "session/projection",
            &json!({
                "type": "session/projection",
                "sessionId": "session-1",
                "key": "sessionStats",
                "value": {
                    "ttftMs": 8500,
                    "ttftSteps": 1,
                    "decodeMs": 1000,
                    "decodeTokens": 72
                },
                "seq": 10
            }),
            &binding(),
            "session-1",
            None,
        );
        match events.first() {
            Some(EngineEvent::Raw { engine, data, .. }) => {
                assert_eq!(*engine, EngineType::Dsh);
                assert_eq!(
                    data.get("kind").and_then(Value::as_str),
                    Some("dsh-session-stats")
                );
                assert_eq!(
                    data.pointer("/sessionStats/ttftMs").and_then(Value::as_i64),
                    Some(8500)
                );
            }
            other => panic!("expected Raw session stats, got {other:?}"),
        }
    }

    fn text_delta(text: &str) -> EngineEvent {
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: text.to_string(),
        }
    }

    fn reasoning_delta(text: &str) -> EngineEvent {
        EngineEvent::ReasoningDelta {
            workspace_id: "ws-1".to_string(),
            text: text.to_string(),
        }
    }

    fn tool_started() -> EngineEvent {
        EngineEvent::ToolStarted {
            workspace_id: "ws-1".to_string(),
            tool_id: "call-1".to_string(),
            tool_name: "read".to_string(),
            input: None,
        }
    }

    #[test]
    fn coalesces_consecutive_text_deltas_until_window_expires() {
        let mut buffer = DshDeltaCoalesceBuffer::default();
        let now = Instant::now();
        let ready = push_dsh_coalesced_events(
            &mut buffer,
            "session-1",
            &binding(),
            vec![text_delta("Hel"), text_delta("lo")],
            now,
        );
        assert!(ready.is_empty(), "same-window text deltas stay buffered");
        assert_eq!(
            buffer.pending.as_ref().map(|pending| pending.text.as_str()),
            Some("Hello")
        );

        let ready = take_expired_dsh_delta(&mut buffer, now + DSH_DELTA_COALESCE_WINDOW);
        match ready.as_ref() {
            Some((EngineEvent::TextDelta { text, .. }, thread_id, item_id, turn_id)) => {
                assert_eq!(text, "Hello");
                assert_eq!(thread_id, "dsh:session-1");
                assert_eq!(item_id, "item-1");
                assert_eq!(turn_id.as_deref(), Some("turn-1"));
            }
            other => panic!("expected flushed text delta, got {other:?}"),
        }
        assert!(buffer.pending.is_none());
    }

    #[test]
    fn coalesces_reasoning_deltas_on_their_own_item() {
        let mut buffer = DshDeltaCoalesceBuffer::default();
        let now = Instant::now();
        let ready = push_dsh_coalesced_events(
            &mut buffer,
            "session-1",
            &binding(),
            vec![reasoning_delta("think "), reasoning_delta("hard")],
            now,
        );
        assert!(ready.is_empty());
        assert_eq!(
            buffer.pending.as_ref().map(|pending| pending.text.as_str()),
            Some("think hard")
        );
        assert_eq!(
            buffer
                .pending
                .as_ref()
                .map(|pending| pending.item_id.as_str()),
            Some("dsh-reasoning-turn-1")
        );
    }

    #[test]
    fn non_delta_event_flushes_pending_then_emits_itself() {
        let mut buffer = DshDeltaCoalesceBuffer::default();
        let now = Instant::now();
        let ready = push_dsh_coalesced_events(
            &mut buffer,
            "session-1",
            &binding(),
            vec![text_delta("Hi"), tool_started()],
            now,
        );
        assert_eq!(ready.len(), 2);
        assert!(matches!(
            &ready[0],
            (EngineEvent::TextDelta { text, .. }, _, _, _) if text == "Hi"
        ));
        assert!(
            matches!(&ready[1], (EngineEvent::ToolStarted { tool_id, .. }, _, item_id, _) if tool_id == "call-1" && item_id == "call-1")
        );
        assert!(buffer.pending.is_none());
    }

    #[test]
    fn switching_delta_kind_flushes_the_previous_buffer() {
        let mut buffer = DshDeltaCoalesceBuffer::default();
        let now = Instant::now();
        let ready = push_dsh_coalesced_events(
            &mut buffer,
            "session-1",
            &binding(),
            vec![text_delta("out"), reasoning_delta("in")],
            now,
        );
        assert_eq!(ready.len(), 1);
        assert!(matches!(
            &ready[0],
            (EngineEvent::TextDelta { text, .. }, _, _, _) if text == "out"
        ));
        assert_eq!(
            buffer.pending.as_ref().map(|pending| pending.text.as_str()),
            Some("in")
        );
    }

    #[test]
    fn take_pending_delta_for_session_only_flushes_matching_session() {
        let mut hub = MuxHub {
            bindings: HashMap::new(),
            goal_states: HashMap::new(),
            turn_waiters: HashMap::new(),
            open_turns: HashMap::new(),
            pending_questions: HashMap::new(),
            pending_deltas: DshDeltaCoalesceBuffer::default(),
            app: None,
            stop: None,
            url: None,
        };
        let now = Instant::now();
        let _ = push_dsh_coalesced_events(
            &mut hub.pending_deltas,
            "session-keep",
            &binding(),
            vec![text_delta("keep")],
            now,
        );
        assert!(take_pending_delta_for_session(&mut hub, "session-other").is_none());
        let flushed = take_pending_delta_for_session(&mut hub, "session-keep");
        assert!(matches!(
            flushed.as_ref(),
            Some((EngineEvent::TextDelta { text, .. }, _, _, _)) if text == "keep"
        ));
        assert!(hub.pending_deltas.pending.is_none());
    }

    #[test]
    fn size_cap_flushes_without_waiting_for_the_time_window() {
        let mut buffer = DshDeltaCoalesceBuffer::default();
        let now = Instant::now();
        let first = "x".repeat(DSH_DELTA_COALESCE_MAX_BYTES - 1);
        let ready = push_dsh_coalesced_events(
            &mut buffer,
            "session-1",
            &binding(),
            vec![text_delta(&first), text_delta("yz")],
            now,
        );
        assert_eq!(ready.len(), 1);
        match &ready[0] {
            (EngineEvent::TextDelta { text, .. }, _, _, _) => {
                assert_eq!(text.len(), DSH_DELTA_COALESCE_MAX_BYTES + 1);
                assert!(text.ends_with("xyz"));
            }
            other => panic!("expected size-cap flush, got {other:?}"),
        }
        assert!(buffer.pending.is_none());
    }
}
