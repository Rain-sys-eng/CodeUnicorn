//! DSH history list / load / archive.

use super::host::DshHostClient;
use super::session::{self, session_id_from_thread};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshSessionSummary {
    pub session_id: String,
    pub first_message: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshSessionMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DshSessionStats {
    pub turns: i64,
    pub steps: i64,
    pub llm_ms: i64,
    pub tool_ms: i64,
    pub ttft_ms: i64,
    pub ttft_steps: i64,
    pub decode_ms: i64,
    pub decode_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DshContextCategoryUsage {
    pub name: String,
    pub tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DshSessionCurrentModel {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DshSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_stats: Option<DshSessionStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_used_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_used_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_category_usages: Option<Vec<DshContextCategoryUsage>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshSessionLoadResult {
    pub messages: Vec<DshSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<DshSessionUsage>,
    /// Host `todos` snapshot when present, including an explicit empty list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<Value>,
    /// Last-wins `{provider, model}` from already-loaded history events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_model: Option<DshSessionCurrentModel>,
    #[serde(default)]
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

pub async fn list_dsh_sessions(
    client: &DshHostClient,
    workspace_path: &Path,
    limit: Option<usize>,
) -> Result<Vec<DshSessionSummary>, String> {
    let workspace = session::create_workspace(client, workspace_path).await?;
    let membership = workspace_membership(&workspace);
    let wanted = normalize_path(workspace_path);
    let items = session::list_sessions(client).await?;
    let mut sessions = items
        .into_iter()
        .filter(|item| {
            let session_id = item.get("sessionId").and_then(Value::as_str).unwrap_or("");
            if session_id.is_empty() {
                return false;
            }
            if let Some((allowed, archived)) = &membership {
                return session_visible(session_id, allowed, archived);
            }
            let cwd = item.get("cwd").and_then(Value::as_str).unwrap_or("");
            !cwd.is_empty() && paths_equal_exact(cwd, &wanted)
        })
        .filter(|item| item.get("blank").and_then(Value::as_bool) != Some(true))
        .filter_map(|item| summary_from_list_item(&item))
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    if let Some(limit) = limit {
        sessions.truncate(limit);
    }
    Ok(sessions)
}

pub const HISTORY_PAGE_SIZE: u32 = 200;
pub const HISTORY_MAX_PAGES: usize = 40;
/// UI / silent default: one host page (200 messages). Escape hatch is
/// `limit = HISTORY_PAGE_SIZE * HISTORY_MAX_PAGES`.
pub const DSH_UI_HISTORY_LIMIT: u32 = HISTORY_PAGE_SIZE;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DshHistoryLoadWindow {
    pub max_pages: usize,
    pub before_seq: Option<i64>,
}

pub fn resolve_dsh_history_load_window(
    limit: Option<u32>,
    before: Option<&str>,
) -> DshHistoryLoadWindow {
    let requested = limit.unwrap_or(DSH_UI_HISTORY_LIMIT);
    let page_size = HISTORY_PAGE_SIZE.max(1) as usize;
    let raw_pages = if requested == 0 {
        1
    } else {
        (requested as usize + page_size - 1) / page_size
    };
    let max_pages = raw_pages.clamp(1, HISTORY_MAX_PAGES);
    let before_seq = before
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<i64>().ok());
    DshHistoryLoadWindow {
        max_pages,
        before_seq,
    }
}

fn first_history_event_seq(events: &[Value]) -> Option<i64> {
    events.first().and_then(|entry| {
        entry
            .get("seq")
            .or_else(|| entry.pointer("/event/seq"))
            .and_then(Value::as_i64)
    })
}

fn next_cursor_from_events(events: &[Value], has_more: bool) -> Option<String> {
    if !has_more {
        return None;
    }
    first_history_event_seq(events).map(|seq| seq.to_string())
}

fn folded_history_progress_count(events: &[Value]) -> u32 {
    fold_history_events(events).len() as u32
}

struct LoadedHistoryPages {
    events: Vec<Value>,
    last_page: Value,
    has_more: bool,
}

pub const DSH_HISTORY_LOAD_PROGRESS_EVENT: &str = "dsh-history-load-progress";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshHistoryLoadProgress {
    pub session_id: String,
    pub page_index: u32,
    pub max_pages: u32,
    pub page_event_count: u32,
    pub total_event_count: u32,
    pub has_more: bool,
}

pub async fn load_dsh_session(
    client: &DshHostClient,
    session_id: &str,
) -> Result<DshSessionLoadResult, String> {
    load_dsh_session_with_options(
        client,
        session_id,
        None,
        None,
        None::<fn(&DshHistoryLoadProgress)>,
    )
    .await
}

pub async fn load_dsh_session_with_options<F>(
    client: &DshHostClient,
    session_id: &str,
    limit: Option<u32>,
    before: Option<&str>,
    mut on_progress: Option<F>,
) -> Result<DshSessionLoadResult, String>
where
    F: FnMut(&DshHistoryLoadProgress),
{
    let session_id = session_id_from_thread(session_id);
    let window = resolve_dsh_history_load_window(limit, before);
    let loaded = load_history_pages(client, &session_id, window, on_progress.as_mut()).await?;
    let messages = fold_history_events(&loaded.events);
    let (usage, todos) = snapshots_from_history_page(&loaded.last_page);
    Ok(DshSessionLoadResult {
        messages,
        usage,
        todos,
        current_model: current_model_from_history_events(&loaded.events),
        has_more: loaded.has_more,
        next_cursor: next_cursor_from_events(&loaded.events, loaded.has_more),
    })
}

fn emit_history_load_progress<F>(
    on_progress: &mut Option<&mut F>,
    progress: DshHistoryLoadProgress,
) where
    F: FnMut(&DshHistoryLoadProgress),
{
    if let Some(callback) = on_progress.as_mut() {
        callback(&progress);
    }
}

async fn load_history_pages<F>(
    client: &DshHostClient,
    session_id: &str,
    window: DshHistoryLoadWindow,
    mut on_progress: Option<&mut F>,
) -> Result<LoadedHistoryPages, String>
where
    F: FnMut(&DshHistoryLoadProgress),
{
    let mut collected = Vec::new();
    let mut before_seq = window.before_seq;
    let mut last_page = Value::Null;
    let mut result_has_more = false;
    let mut folded_total = 0u32;
    let max_pages = window.max_pages.max(1);
    emit_history_load_progress(
        &mut on_progress,
        DshHistoryLoadProgress {
            session_id: session_id.to_string(),
            page_index: 0,
            max_pages: max_pages as u32,
            page_event_count: 0,
            total_event_count: 0,
            has_more: true,
        },
    );
    for page_index in 0..max_pages {
        let page = session::history(client, session_id, Some(HISTORY_PAGE_SIZE), before_seq).await?;
        // Projections (usage etc.) only exist on the newest page of a tail fetch.
        if page_index == 0 {
            last_page = page.clone();
        }
        let events = page
            .get("events")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let next_before = first_history_event_seq(&events);
        let folded_page_count = folded_history_progress_count(&events);
        if events.is_empty() {
            emit_history_load_progress(
                &mut on_progress,
                DshHistoryLoadProgress {
                    session_id: session_id.to_string(),
                    page_index: (page_index as u32) + 1,
                    max_pages: max_pages as u32,
                    page_event_count: 0,
                    total_event_count: folded_total,
                    has_more: false,
                },
            );
            result_has_more = false;
            break;
        }
        collected.splice(0..0, events);
        folded_total = folded_total.saturating_add(folded_page_count);
        let host_has_more = page
            .get("hasMore")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        emit_history_load_progress(
            &mut on_progress,
            DshHistoryLoadProgress {
                session_id: session_id.to_string(),
                page_index: (page_index as u32) + 1,
                max_pages: max_pages as u32,
                page_event_count: folded_page_count,
                total_event_count: folded_total,
                has_more: host_has_more,
            },
        );
        if !host_has_more {
            result_has_more = false;
            break;
        }
        match next_before {
            Some(seq) if before_seq != Some(seq) => {
                before_seq = Some(seq);
                result_has_more = true;
            }
            _ => {
                result_has_more = false;
                break;
            }
        }
    }
    Ok(LoadedHistoryPages {
        events: collected,
        last_page,
        has_more: result_has_more,
    })
}

pub async fn archive_dsh_session(client: &DshHostClient, session_id: &str) -> Result<(), String> {
    let session_id = session_id_from_thread(session_id);
    session::archive_session(client, &session_id).await?;
    super::events::unbind_session(&session_id).await;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DshLatestUserPeek {
    HasRealUser,
    Empty,
    Unknown,
}

pub(crate) fn dsh_latest_page_verdict(events: &[Value], has_more: bool) -> DshLatestUserPeek {
    let messages = fold_history_events(events);
    if messages.iter().any(|message| message.role == "user") {
        return DshLatestUserPeek::HasRealUser;
    }
    if has_more {
        return DshLatestUserPeek::Unknown;
    }
    DshLatestUserPeek::Empty
}

/// One latest history page only. `hasMore` without a user message stays Unknown
/// so a long assistant tail cannot be mistaken for an empty session.
pub async fn peek_dsh_latest_page_user(
    client: &DshHostClient,
    session_id: &str,
) -> Result<DshLatestUserPeek, String> {
    let session_id = session_id_from_thread(session_id);
    let page = session::history(client, &session_id, Some(HISTORY_PAGE_SIZE), None).await?;
    let events = page
        .get("events")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let has_more = page
        .get("hasMore")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(dsh_latest_page_verdict(&events, has_more))
}

fn summary_from_list_item(item: &Value) -> Option<DshSessionSummary> {
    let session_id = item.get("sessionId").and_then(Value::as_str)?.to_string();
    if session_id.is_empty() {
        return None;
    }
    let updated_at = item.get("updatedAt").and_then(Value::as_i64).unwrap_or(0);
    let created_at = item
        .get("createdAt")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .unwrap_or(updated_at);
    let title = item
        .pointer("/projections/values/title")
        .and_then(Value::as_str)
        .unwrap_or("");
    Some(DshSessionSummary {
        first_message: sanitize_dsh_sidebar_title(title),
        updated_at,
        created_at,
        message_count: 0,
        engine: Some("dsh".to_string()),
        canonical_session_id: Some(session_id.clone()),
        agent_preset: item
            .get("agentPreset")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        session_id,
    })
}

pub fn fold_history_events(entries: &[Value]) -> Vec<DshSessionMessage> {
    let mut messages = Vec::new();
    let mut assistant_buf = String::new();
    let mut reasoning_buf = String::new();
    let mut index = 0usize;
    for entry in entries {
        let event = entry.get("event").unwrap_or(entry);
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        let data = event.get("data").cloned().unwrap_or(Value::Null);
        match event_type {
            "user/message" => {
                flush_assistant(&mut messages, &mut assistant_buf, &mut reasoning_buf, &mut index);
                let text = data
                    .get("text")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        data.get("content")
                            .and_then(Value::as_array)
                            .and_then(|blocks| {
                                blocks.iter().find_map(|block| {
                                    block.get("text").and_then(Value::as_str)
                                })
                            })
                    })
                    .unwrap_or("")
                    .to_string();
                if !text.is_empty() && !is_dsh_injected_user_message(&data, &text) {
                    index += 1;
                    messages.push(DshSessionMessage {
                        id: format!("dsh-user-{index}"),
                        role: "user".to_string(),
                        text,
                        timestamp: None,
                        kind: "message".to_string(),
                        tool_type: None,
                        title: None,
                        tool_input: None,
                        tool_output: None,
                        source_kind: dsh_source_kind(&data).map(str::to_string),
                    });
                }
            }
            "assistant/chunk" => {
                let chunk = data.get("chunk").unwrap_or(&data);
                match chunk.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text-delta" => {
                        if let Some(text) = chunk.get("text").and_then(Value::as_str) {
                            assistant_buf.push_str(text);
                        }
                    }
                    "reasoning-delta" => {
                        if let Some(text) = chunk.get("text").and_then(Value::as_str) {
                            reasoning_buf.push_str(text);
                        }
                    }
                    _ => {}
                }
            }
            "assistant/message" => {
                if assistant_buf.is_empty() {
                    if let Some(text) = data.get("text").and_then(Value::as_str) {
                        assistant_buf.push_str(text);
                    }
                }
                flush_assistant(&mut messages, &mut assistant_buf, &mut reasoning_buf, &mut index);
            }
            "tool/call" => {
                index += 1;
                // Prefer durable callId so later tool/result can pair by id.
                let call_id = data
                    .get("callId")
                    .or_else(|| data.get("id"))
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("dsh-tool-{index}"));
                messages.push(DshSessionMessage {
                    id: call_id,
                    role: "assistant".to_string(),
                    text: String::new(),
                    timestamp: None,
                    kind: "tool".to_string(),
                    tool_type: data
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    title: data
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    // DSH `arguments` is a raw JSON string; parse when possible so FE
                    // path extractors receive a normal object (and still accept strings).
                    tool_input: normalize_dsh_tool_arguments(
                        data.get("arguments").or_else(|| data.get("args")),
                    ),
                    tool_output: None,
                    source_kind: None,
                });
            }
            "tool/result" => {
                let call_id = data
                    .get("callId")
                    .or_else(|| data.get("id"))
                    .or_else(|| data.get("toolCallId"))
                    .or_else(|| data.pointer("/message/source/callId"))
                    .or_else(|| data.pointer("/message/content/0/toolCallId"))
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty());
                let output = data
                    .get("result")
                    .cloned()
                    .or_else(|| data.get("output").cloned())
                    .or_else(|| extract_dsh_history_tool_output(&data));
                if let Some(call_id) = call_id {
                    if let Some(target) = messages
                        .iter_mut()
                        .rev()
                        .find(|row| row.kind == "tool" && row.id == call_id)
                    {
                        target.tool_output = output;
                        continue;
                    }
                }
                if let Some(last) = messages
                    .iter_mut()
                    .rev()
                    .find(|row| row.kind == "tool" && row.tool_output.is_none())
                {
                    last.tool_output = output;
                }
            }
            "turn/end" => {
                flush_assistant(&mut messages, &mut assistant_buf, &mut reasoning_buf, &mut index);
            }
            _ => {}
        }
    }
    flush_assistant(&mut messages, &mut assistant_buf, &mut reasoning_buf, &mut index);
    messages
}

fn dsh_source_kind(data: &Value) -> Option<&str> {
    data.get("source")
        .and_then(|source| source.get("kind"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
}

fn strip_dsh_runtime_xml_block(text: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let lower = text.to_ascii_lowercase();
    let open_lower = open.to_ascii_lowercase();
    let close_lower = close.to_ascii_lowercase();
    let Some(start) = lower.find(&open_lower) else {
        return text.to_string();
    };
    let after_open = &text[start + open.len()..];
    let after_open_lower = after_open.to_ascii_lowercase();
    let Some(tag_end) = after_open_lower.find('>') else {
        return text[..start].to_string();
    };
    let inner_start = start + open.len() + tag_end + 1;
    let Some(rel_end) = text[inner_start..].to_ascii_lowercase().find(&close_lower) else {
        return text[..start].to_string();
    };
    let end = inner_start + rel_end + close.len();
    let mut out = String::with_capacity(text.len().saturating_sub(end - start));
    out.push_str(&text[..start]);
    out.push_str(&text[end..]);
    out
}

fn is_dsh_runtime_context_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("current runtime context.") || lower.starts_with("current runtime context:")
    {
        return true;
    }
    let mut rest = trimmed.to_string();
    for _ in 0..12 {
        let before = rest.clone();
        for tag in ["system-reminder", "available_skills", "agent_skills", "goal_round"] {
            rest = strip_dsh_runtime_xml_block(&rest, tag);
        }
        if rest == before {
            break;
        }
    }
    rest.trim().is_empty()
}

fn is_dsh_injected_user_message(data: &Value, text: &str) -> bool {
    match dsh_source_kind(data) {
        Some(kind) if kind.eq_ignore_ascii_case("user") => false,
        Some(kind) if kind.eq_ignore_ascii_case("goal") => false,
        Some(_) => true,
        None => is_dsh_runtime_context_text(text),
    }
}

fn sanitize_dsh_sidebar_title(title: &str) -> String {
    if is_dsh_runtime_context_text(title) {
        String::new()
    } else {
        title.to_string()
    }
}

/// DSH stores tool arguments as the raw model JSON string. Prefer a parsed
/// object for FE path extractors; fall back to the original value.
fn normalize_dsh_tool_arguments(value: Option<&Value>) -> Option<Value> {
    let value = value?;
    if let Some(raw) = value.as_str() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
            if parsed.is_object() || parsed.is_array() {
                return Some(parsed);
            }
        }
        return Some(Value::String(trimmed.to_string()));
    }
    Some(value.clone())
}

fn extract_dsh_history_tool_output(data: &Value) -> Option<Value> {
    if let Some(block) = data.pointer("/message/content/0") {
        if let Some(text) = block.get("text").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(Value::String(trimmed.to_string()));
            }
        }
        if let Some(content) = block.get("content") {
            if let Some(text) = content.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(Value::String(trimmed.to_string()));
                }
            }
            if let Some(arr) = content.as_array() {
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
                if !trimmed.is_empty() {
                    return Some(Value::String(trimmed.to_string()));
                }
            }
        }
        return Some(block.clone());
    }
    data.get("message").cloned()
}

fn flush_assistant(
    messages: &mut Vec<DshSessionMessage>,
    assistant_buf: &mut String,
    reasoning_buf: &mut String,
    index: &mut usize,
) {
    if !reasoning_buf.is_empty() {
        *index += 1;
        messages.push(DshSessionMessage {
            id: format!("dsh-reasoning-{index}"),
            role: "assistant".to_string(),
            text: std::mem::take(reasoning_buf),
            timestamp: None,
            kind: "reasoning".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
            source_kind: None,
        });
    }
    if !assistant_buf.is_empty() {
        *index += 1;
        messages.push(DshSessionMessage {
            id: format!("dsh-assistant-{index}"),
            role: "assistant".to_string(),
            text: std::mem::take(assistant_buf),
            timestamp: None,
            kind: "message".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
            source_kind: None,
        });
    }
}

fn current_model_from_history_events(events: &[Value]) -> Option<DshSessionCurrentModel> {
    let mut current: Option<DshSessionCurrentModel> = None;
    for entry in events {
        let event = entry.get("event").unwrap_or(entry);
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        let data = event.get("data").unwrap_or(&Value::Null);
        match event_type {
            "request/context" => {
                if let Some(next) = selection_from_provider_model(
                    data.get("provider"),
                    data.get("model"),
                    None,
                ) {
                    current = Some(next);
                }
            }
            "request/header" => {
                let config = data
                    .pointer("/header/config")
                    .or_else(|| data.get("config"))
                    .unwrap_or(&Value::Null);
                if let Some(next) = selection_from_provider_model(
                    config.get("provider"),
                    config.get("model"),
                    config
                        .get("reasoningEffort")
                        .or_else(|| config.get("reasoning_effort")),
                ) {
                    current = Some(next);
                }
            }
            _ => {}
        }
    }
    current
}

fn selection_from_provider_model(
    provider: Option<&Value>,
    model: Option<&Value>,
    reasoning_effort: Option<&Value>,
) -> Option<DshSessionCurrentModel> {
    let provider = provider
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let model = model
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let reasoning_effort = reasoning_effort
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some(DshSessionCurrentModel {
        provider,
        model,
        reasoning_effort,
    })
}

fn snapshots_from_history_page(page: &Value) -> (Option<DshSessionUsage>, Option<Value>) {
    let Some(values) = page.pointer("/projections/values") else {
        return (None, None);
    };
    let todos = values.get("todos").filter(|value| value.is_array()).cloned();
    (usage_from_history_values(values), todos)
}

fn usage_from_history_page(page: &Value) -> Option<DshSessionUsage> {
    snapshots_from_history_page(page).0
}

fn usage_from_history_values(values: &Value) -> Option<DshSessionUsage> {
    let token_usage = values.get("tokenUsage").and_then(usage_from_projection);
    let session_stats = values.get("sessionStats").and_then(session_stats_from_projection);
    let occupancy = occupancy_from_projections(values);
    match (token_usage, session_stats, occupancy) {
        (None, None, None) => None,
        (token_usage, session_stats, occupancy) => {
            let mut usage = token_usage.unwrap_or_default();
            if session_stats.is_some() {
                usage.session_stats = session_stats;
            }
            if let Some(occupancy) = occupancy {
                usage.context_used_tokens = occupancy.context_used_tokens;
                usage.model_context_window = occupancy.model_context_window;
                usage.context_used_percent = occupancy.context_used_percent;
                usage.context_category_usages = occupancy.context_category_usages;
            }
            Some(usage)
        }
    }
}

fn occupancy_from_projections(values: &Value) -> Option<DshSessionUsage> {
    let pressure = values.get("contextPressure");
    let breakdown = values.get("contextBreakdown");
    if pressure.is_none() && breakdown.is_none() {
        return None;
    }
    let numerator = pressure.and_then(|value| {
        value
            .get("projectedTokens")
            .or_else(|| value.get("pressureTokens"))
            .and_then(Value::as_i64)
    });
    let window = pressure.and_then(|value| value.get("contextWindow").and_then(Value::as_i64));
    let percent = match (numerator, window) {
        (Some(used), Some(total)) if total > 0 => Some((used as f64 / total as f64) * 100.0),
        _ => None,
    };
    let categories = breakdown.and_then(categories_from_breakdown);
    if numerator.is_none() && window.is_none() && categories.is_none() {
        return None;
    }
    Some(DshSessionUsage {
        context_used_tokens: numerator,
        model_context_window: window,
        context_used_percent: percent,
        context_category_usages: categories,
        ..DshSessionUsage::default()
    })
}

fn categories_from_breakdown(value: &Value) -> Option<Vec<DshContextCategoryUsage>> {
    let rows = [
        ("system", value.get("systemTokens").and_then(Value::as_i64)),
        ("tools", value.get("toolsTokens").and_then(Value::as_i64)),
        ("messages", value.get("messageTokens").and_then(Value::as_i64)),
    ];
    let categories = rows
        .into_iter()
        .filter_map(|(name, tokens)| {
            tokens.map(|tokens| DshContextCategoryUsage {
                name: name.to_string(),
                tokens,
            })
        })
        .collect::<Vec<_>>();
    (!categories.is_empty()).then_some(categories)
}

fn usage_from_projection(value: &Value) -> Option<DshSessionUsage> {
    let usage = DshSessionUsage {
        input_tokens: value
            .get("uncachedInputTokens")
            .or_else(|| value.get("inputTokens"))
            .and_then(Value::as_i64),
        output_tokens: value.get("outputTokens").and_then(Value::as_i64),
        cache_read_input_tokens: value
            .get("cacheReadTokens")
            .or_else(|| value.get("cachedTokens"))
            .and_then(Value::as_i64),
        cache_write_input_tokens: value.get("cacheWriteTokens").and_then(Value::as_i64),
        session_stats: None,
        context_used_tokens: None,
        model_context_window: None,
        context_used_percent: None,
        context_category_usages: None,
    };
    if usage.input_tokens.is_none()
        && usage.output_tokens.is_none()
        && usage.cache_read_input_tokens.is_none()
        && usage.cache_write_input_tokens.is_none()
    {
        None
    } else {
        Some(usage)
    }
}

fn session_stats_from_projection(value: &Value) -> Option<DshSessionStats> {
    let stats = DshSessionStats {
        turns: value.get("turns").and_then(Value::as_i64).unwrap_or(0),
        steps: value.get("steps").and_then(Value::as_i64).unwrap_or(0),
        llm_ms: value.get("llmMs").and_then(Value::as_i64).unwrap_or(0),
        tool_ms: value.get("toolMs").and_then(Value::as_i64).unwrap_or(0),
        ttft_ms: value.get("ttftMs").and_then(Value::as_i64).unwrap_or(0),
        ttft_steps: value.get("ttftSteps").and_then(Value::as_i64).unwrap_or(0),
        decode_ms: value.get("decodeMs").and_then(Value::as_i64).unwrap_or(0),
        decode_tokens: value.get("decodeTokens").and_then(Value::as_i64).unwrap_or(0),
    };
    if stats.turns == 0
        && stats.steps == 0
        && stats.llm_ms == 0
        && stats.tool_ms == 0
        && stats.ttft_ms == 0
        && stats.ttft_steps == 0
        && stats.decode_ms == 0
        && stats.decode_tokens == 0
    {
        None
    } else {
        Some(stats)
    }
}

fn normalize_path(path: &Path) -> String {
    session::canonicalize_host_path(path)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn workspace_membership(workspace: &Value) -> Option<(HashSet<String>, HashSet<String>)> {
    let ws = workspace.get("workspace")?;
    let allowed = string_id_set(ws.get("sessionIds"))?;
    let archived = string_id_set(ws.get("archivedSessionIds")).unwrap_or_default();
    Some((allowed, archived))
}

fn string_id_set(value: Option<&Value>) -> Option<HashSet<String>> {
    let items = value?.as_array()?;
    Some(
        items
            .iter()
            .filter_map(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

fn session_visible(
    session_id: &str,
    allowed: &HashSet<String>,
    archived: &HashSet<String>,
) -> bool {
    allowed.contains(session_id) && !archived.contains(session_id)
}

fn paths_equal_exact(left: &str, right: &str) -> bool {
    normalize_path_text(left) == normalize_path_text(right)
}

fn normalize_path_text(value: &str) -> String {
    session::strip_windows_verbatim_prefix(value)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn folds_user_and_assistant() {
        let entries = vec![
            json!({ "event": { "type": "user/message", "data": { "text": "hi" } } }),
            json!({ "event": { "type": "assistant/chunk", "data": { "chunk": { "type": "text-delta", "text": "hello" } } } }),
            json!({ "event": { "type": "turn/end", "data": { "reason": { "kind": "completed" } } } }),
        ];
        let messages = fold_history_events(&entries);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].text, "hello");
    }

    #[test]
    fn membership_keeps_workspace_sessions_and_drops_archived() {
        let workspace = json!({
            "workspace": {
                "workspaceId": "ws-1",
                "sessionIds": ["sess-a", "sess-b", "sess-c"],
                "archivedSessionIds": ["sess-b"]
            }
        });
        let (allowed, archived) = workspace_membership(&workspace).expect("membership");
        assert!(session_visible("sess-a", &allowed, &archived));
        assert!(!session_visible("sess-b", &allowed, &archived));
        assert!(!session_visible("sess-other", &allowed, &archived));
    }

    #[test]
    fn exact_path_match_does_not_use_suffix() {
        assert!(paths_equal_exact("/Users/foo/app", "/Users/foo/app"));
        assert!(!paths_equal_exact("/Users/foo/app", "/app"));
        assert!(!paths_equal_exact("", "/Users/foo/app"));
    }

    #[test]
    fn exact_path_match_strips_windows_verbatim_prefix() {
        assert!(paths_equal_exact(
            r"\\?\C:\Users\foo\app",
            r"C:\Users\foo\app"
        ));
        assert!(paths_equal_exact(
            r"\\?\UNC\server\share\app",
            r"\\server\share\app"
        ));
    }

    #[test]
    fn skips_injected_instruction_snapshot_and_skill_catalog() {
        let entries = vec![
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "你好",
                        "source": { "kind": "user" }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "<system-reminder>\nInstructions from: AGENTS.md\n</system-reminder>",
                        "source": { "kind": "agent-instructions", "form": "instructions" }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: workspace-write.",
                        "source": { "kind": "plugin", "plugin": "dsh-system-prompt", "form": "snapshot" }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "content": [{
                            "type": "text",
                            "text": "<system-reminder>\n<available_skills>\n- deploy-to-vercel\n</available_skills>\n</system-reminder>"
                        }],
                        "source": { "kind": "plugin", "plugin": "dsh-tool-skill", "form": "catalog" }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "assistant/chunk",
                    "data": { "chunk": { "type": "text-delta", "text": "你好" } }
                }
            }),
            json!({ "event": { "type": "turn/end", "data": { "reason": { "kind": "completed" } } } }),
        ];
        let messages = fold_history_events(&entries);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].text, "你好");
        assert_eq!(messages[0].source_kind.as_deref(), Some("user"));
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].text, "你好");
        assert_eq!(messages[1].source_kind, None);
        assert_eq!(
            dsh_latest_page_verdict(&entries, true),
            DshLatestUserPeek::HasRealUser
        );
    }

    #[test]
    fn keeps_real_user_prompt_that_mentions_system_reminder() {
        let entries = vec![json!({
            "event": {
                "type": "user/message",
                "data": {
                    "text": "what is a <system-reminder>?",
                    "source": { "kind": "user" }
                }
            }
        })];
        let messages = fold_history_events(&entries);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].text, "what is a <system-reminder>?");
    }

    #[test]
    fn skips_sourceless_runtime_context_text() {
        let entries = vec![
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nApproval policy: ask."
                    }
                }
            }),
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "<system-reminder>\nInstructions from: AGENTS.md\n</system-reminder>"
                    }
                }
            }),
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "<system-reminder>\n<available_skills>\n- deploy-to-vercel\n</available_skills>\n</system-reminder>"
                    }
                }
            }),
        ];
        let messages = fold_history_events(&entries);
        assert!(messages.is_empty());
        assert_eq!(
            dsh_latest_page_verdict(&entries, false),
            DshLatestUserPeek::Empty
        );
        assert_eq!(
            dsh_latest_page_verdict(&entries, true),
            DshLatestUserPeek::Unknown
        );
    }

    #[test]
    fn sidebar_title_drops_injected_runtime_context() {
        assert_eq!(
            sanitize_dsh_sidebar_title(
                "<system-reminder>\nInstructions from: AGENTS.md\n</system-reminder>"
            ),
            ""
        );
        assert_eq!(
            sanitize_dsh_sidebar_title(
                "Current runtime context. This snapshot supersedes earlier runtime-context snapshots."
            ),
            ""
        );
        assert_eq!(
            sanitize_dsh_sidebar_title(
                "<system-reminder>\n<available_skills>\n- deploy-to-vercel\n</available_skills>\n</system-reminder>"
            ),
            ""
        );
        assert_eq!(sanitize_dsh_sidebar_title("你好"), "你好");
        assert_eq!(
            sanitize_dsh_sidebar_title("<goal_round>\nContinue the active goal.\n</goal_round>"),
            ""
        );
    }

    #[test]
    fn keeps_goal_injection_and_still_skips_plugin() {
        let entries = vec![
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "写一个 todo",
                        "source": { "kind": "user" }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "<goal_round>\nContinue the active goal.\n</goal_round>",
                        "source": { "kind": "goal", "goalId": "g1", "round": 2 }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "user/message",
                    "data": {
                        "text": "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.",
                        "source": { "kind": "plugin", "plugin": "dsh-system-prompt" }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "assistant/chunk",
                    "data": { "chunk": { "type": "text-delta", "text": "好的" } }
                }
            }),
            json!({ "event": { "type": "turn/end", "data": { "reason": { "kind": "completed" } } } }),
        ];
        let messages = fold_history_events(&entries);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].source_kind.as_deref(), Some("user"));
        assert_eq!(messages[0].text, "写一个 todo");
        assert_eq!(messages[1].source_kind.as_deref(), Some("goal"));
        assert!(messages[1].text.contains("<goal_round>"));
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages[2].text, "好的");
    }

    #[test]
    fn folds_tool_call_raw_arguments_and_pairs_result_by_call_id() {
        let entries = vec![
            json!({
                "event": {
                    "type": "tool/call",
                    "data": {
                        "callId": "call-read-1",
                        "name": "read",
                        "arguments": "{\"file_path\":\"src/main.ts\"}"
                    }
                }
            }),
            json!({
                "event": {
                    "type": "tool/result",
                    "data": {
                        "message": {
                            "source": { "callId": "call-read-1" },
                            "content": [{
                                "type": "tool-result",
                                "toolCallId": "call-read-1",
                                "content": [{ "type": "text", "text": "1\tok" }]
                            }]
                        }
                    }
                }
            }),
        ];
        let messages = fold_history_events(&entries);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, "call-read-1");
        assert_eq!(messages[0].title.as_deref(), Some("read"));
        assert_eq!(
            messages[0]
                .tool_input
                .as_ref()
                .and_then(|value| value.get("file_path"))
                .and_then(Value::as_str),
            Some("src/main.ts")
        );
        assert_eq!(
            messages[0]
                .tool_output
                .as_ref()
                .and_then(Value::as_str),
            Some("1\tok")
        );
    }

    #[test]
    fn history_page_maps_token_usage_and_session_stats() {
        let page = json!({
            "projections": {
                "values": {
                    "tokenUsage": {
                        "uncachedInputTokens": 744288,
                        "outputTokens": 34735,
                        "cacheReadTokens": 4017920,
                        "cacheWriteTokens": 12
                    },
                    "sessionStats": {
                        "turns": 3,
                        "steps": 8,
                        "llmMs": 12000,
                        "toolMs": 400,
                        "ttftMs": 25500,
                        "ttftSteps": 3,
                        "decodeMs": 3000,
                        "decodeTokens": 216
                    }
                }
            }
        });
        let (usage, todos) = snapshots_from_history_page(&page);
        let usage = usage.expect("usage");
        assert_eq!(usage.input_tokens, Some(744288));
        assert_eq!(usage.output_tokens, Some(34735));
        assert_eq!(usage.cache_read_input_tokens, Some(4017920));
        assert_eq!(usage.cache_write_input_tokens, Some(12));
        let stats = usage.session_stats.expect("session stats");
        assert_eq!(stats.ttft_ms, 25500);
        assert_eq!(stats.ttft_steps, 3);
        assert_eq!(stats.decode_ms, 3000);
        assert_eq!(stats.decode_tokens, 216);
        assert!(todos.is_none());
    }

    #[test]
    fn history_page_maps_todos_and_context_occupancy() {
        let page = json!({
            "projections": {
                "values": {
                    "todos": [
                        { "content": "step", "status": "completed" }
                    ],
                    "contextPressure": {
                        "projectedTokens": 209000,
                        "pressureTokens": 180000,
                        "contextWindow": 262000
                    },
                    "contextBreakdown": {
                        "systemTokens": 1500,
                        "toolsTokens": 6400,
                        "messageTokens": 196000
                    }
                }
            }
        });
        let (usage, todos) = snapshots_from_history_page(&page);
        let usage = usage.expect("usage");
        assert_eq!(usage.context_used_tokens, Some(209000));
        assert_eq!(usage.model_context_window, Some(262000));
        assert!(usage.context_used_percent.expect("percent") > 79.0);
        assert_eq!(
            usage
                .context_category_usages
                .as_ref()
                .map(|rows| rows
                    .iter()
                    .map(|row| (row.name.as_str(), row.tokens))
                    .collect::<Vec<_>>()),
            Some(vec![("system", 1500), ("tools", 6400), ("messages", 196000)])
        );
        assert_eq!(
            todos,
            Some(json!([{ "content": "step", "status": "completed" }]))
        );
    }

    #[test]
    fn history_page_empty_todos_is_explicit_clear() {
        let page = json!({
            "projections": { "values": { "todos": [] } }
        });
        let (usage, todos) = snapshots_from_history_page(&page);
        assert!(usage.is_none());
        assert_eq!(todos, Some(json!([])));
    }

    #[test]
    fn history_page_without_projections_is_none() {
        assert!(usage_from_history_page(&json!({ "events": [] })).is_none());
    }

    #[test]
    fn history_events_fold_current_model_last_wins() {
        let events = vec![
            json!({
                "event": {
                    "type": "request/header",
                    "data": {
                        "header": {
                            "config": {
                                "provider": "deepseek-official",
                                "model": "deepseek-v4-flash",
                                "reasoningEffort": "high"
                            }
                        }
                    }
                }
            }),
            json!({
                "event": {
                    "type": "request/context",
                    "data": {
                        "provider": "gork-zhu",
                        "model": "grok-4.6"
                    }
                }
            }),
        ];
        let current = current_model_from_history_events(&events).expect("current");
        assert_eq!(current.provider, "gork-zhu");
        assert_eq!(current.model, "grok-4.6");
        assert_eq!(current.reasoning_effort, None);
    }

    #[test]
    fn history_header_keeps_reasoning_when_it_is_last() {
        let events = vec![
            json!({
                "event": {
                    "type": "request/context",
                    "data": { "provider": "gork-zhu", "model": "grok-4.6" }
                }
            }),
            json!({
                "event": {
                    "type": "request/header",
                    "data": {
                        "header": {
                            "config": {
                                "provider": "gork-zhu",
                                "model": "grok-4.6",
                                "reasoningEffort": "low"
                            }
                        }
                    }
                }
            }),
        ];
        let current = current_model_from_history_events(&events).expect("current");
        assert_eq!(current.provider, "gork-zhu");
        assert_eq!(current.model, "grok-4.6");
        assert_eq!(current.reasoning_effort.as_deref(), Some("low"));
    }

    #[test]
    fn default_limit_is_one_host_page() {
        let window = resolve_dsh_history_load_window(None, None);
        assert_eq!(window.max_pages, 1);
        assert_eq!(window.before_seq, None);
    }

    #[test]
    fn limit_maps_to_host_pages_and_clamps() {
        assert_eq!(
            resolve_dsh_history_load_window(Some(200), None).max_pages,
            1
        );
        assert_eq!(
            resolve_dsh_history_load_window(Some(201), None).max_pages,
            2
        );
        assert_eq!(resolve_dsh_history_load_window(Some(0), None).max_pages, 1);
        assert_eq!(
            resolve_dsh_history_load_window(Some(8000), None).max_pages,
            HISTORY_MAX_PAGES
        );
    }

    #[test]
    fn before_parses_seq_and_rejects_garbage() {
        assert_eq!(
            resolve_dsh_history_load_window(Some(200), Some("161882")).before_seq,
            Some(161882)
        );
        assert_eq!(
            resolve_dsh_history_load_window(None, Some("  ")).before_seq,
            None
        );
        assert_eq!(
            resolve_dsh_history_load_window(None, Some("abc")).before_seq,
            None
        );
    }

    #[test]
    fn next_cursor_is_oldest_seq_only_when_has_more() {
        let events = vec![json!({ "seq": 10 }), json!({ "seq": 20 })];
        assert_eq!(
            next_cursor_from_events(&events, true).as_deref(),
            Some("10")
        );
        assert_eq!(next_cursor_from_events(&events, false), None);
        assert_eq!(
            next_cursor_from_events(&[json!({ "event": { "seq": 7 } })], true).as_deref(),
            Some("7")
        );
    }

    #[test]
    fn progress_count_uses_folded_messages_not_raw_events() {
        let events = vec![
            json!({ "event": { "type": "user/message", "data": { "text": "hi" } } }),
            json!({
                "event": {
                    "type": "assistant/chunk",
                    "data": { "chunk": { "type": "text-delta", "text": "a" } }
                }
            }),
            json!({
                "event": {
                    "type": "assistant/chunk",
                    "data": { "chunk": { "type": "text-delta", "text": "b" } }
                }
            }),
            json!({
                "event": {
                    "type": "turn/end",
                    "data": { "reason": { "kind": "completed" } }
                }
            }),
        ];
        assert_eq!(events.len(), 4);
        assert_eq!(folded_history_progress_count(&events), 2);
    }
}
