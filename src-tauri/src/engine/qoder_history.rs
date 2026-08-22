//! Qoder session history via official ACP session/list, session/load, session/delete.
//!
//! Never touch ~/.qoder files directly. Empty list is a soft-empty success.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::qoder::{
    extract_content_text, extract_qoder_tool_call_id, extract_qoder_tool_content_text,
    extract_qoder_tool_name, parse_acp_line, run_qoder_acp_initialized, AcpLine,
    QODER_DELETE_TIMEOUT, QODER_LIST_TIMEOUT, QODER_LOAD_TIMEOUT, QODER_RPC_HANDSHAKE_TIMEOUT,
};

const MAX_TITLE_CHARS: usize = 80;

fn normalize_session_id(session_id: &str) -> Result<String, String> {
    let normalized = session_id.trim();
    if normalized.is_empty()
        || normalized == "."
        || normalized.contains('/')
        || normalized.contains('\\')
        || normalized.contains("..")
    {
        return Err("[SESSION_NOT_FOUND] Invalid Qoder session id".to_string());
    }
    Ok(normalized.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QoderSessionSummary {
    pub session_id: String,
    pub first_message: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QoderSessionMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// "message", "reasoning", or "tool"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QoderSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QoderSessionLoadResult {
    pub messages: Vec<QoderSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<QoderSessionUsage>,
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let truncated: String = value.chars().take(max_chars).collect();
    format!("{truncated}…")
}

fn normalize_path_for_comparison(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut value = trimmed.replace('\\', "/");
    while value.ends_with('/') && value.len() > 1 {
        value.pop();
    }
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

pub(crate) fn paths_match(left: &str, right: &str) -> bool {
    normalize_path_for_comparison(left) == normalize_path_for_comparison(right)
}

fn parse_millis(value: Option<&Value>) -> i64 {
    value
        .and_then(|entry| {
            entry
                .as_i64()
                .or_else(|| entry.as_u64().map(|n| n as i64))
                .or_else(|| {
                    entry.as_str().and_then(|text| {
                        chrono::DateTime::parse_from_rfc3339(text)
                            .ok()
                            .map(|dt| dt.timestamp_millis())
                            .or_else(|| text.parse::<i64>().ok())
                    })
                })
        })
        .unwrap_or(0)
}

fn extract_session_id_from_value(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .or_else(|| value.get("session_id"))
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_cwd(value: &Value) -> Option<String> {
    value
        .get("cwd")
        .or_else(|| value.get("workingDirectory"))
        .or_else(|| value.get("workspacePath"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) fn map_session_list_entries(
    result: &Value,
    workspace_path: &Path,
) -> Vec<QoderSessionSummary> {
    let workspace = workspace_path.to_string_lossy();
    let entries = result
        .get("sessions")
        .or_else(|| result.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| result.as_array().cloned())
        .unwrap_or_default();
    let mut sessions = Vec::new();
    for entry in entries {
        let Some(session_id) = extract_session_id_from_value(&entry) else {
            continue;
        };
        if let Some(cwd) = extract_cwd(&entry) {
            if !paths_match(&cwd, &workspace) {
                continue;
            }
        }
        let first_message = entry
            .get("title")
            .or_else(|| entry.get("firstMessage"))
            .or_else(|| entry.get("preview"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let updated_at = parse_millis(
            entry
                .get("updatedAt")
                .or_else(|| entry.get("updated_at"))
                .or_else(|| entry.get("mtime")),
        );
        let created_at = parse_millis(
            entry
                .get("createdAt")
                .or_else(|| entry.get("created_at"))
                .or_else(|| entry.get("ctime")),
        );
        let message_count = entry
            .get("messageCount")
            .or_else(|| entry.get("message_count"))
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        sessions.push(QoderSessionSummary {
            session_id: session_id.clone(),
            first_message: truncate_chars(&first_message, MAX_TITLE_CHARS),
            updated_at,
            created_at,
            message_count,
            file_size_bytes: None,
            engine: Some("qoder".to_string()),
            canonical_session_id: Some(session_id),
            attribution_status: Some("strict-match".to_string()),
        });
    }
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

fn update_message_id(update: &Value) -> Option<String> {
    update
        .get("messageId")
        .or_else(|| update.get("message_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn update_timestamp(update: &Value) -> Option<String> {
    update
        .get("timestamp")
        .or_else(|| update.get("createdAt"))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| value.as_i64().map(|n| n.to_string()))
        })
}

fn build_tool_message(id: String, update: &Value, include_input: bool) -> QoderSessionMessage {
    let tool_name = extract_qoder_tool_name(update).unwrap_or_else(|| "tool".to_string());
    QoderSessionMessage {
        id,
        role: "assistant".to_string(),
        text: extract_qoder_tool_content_text(update),
        images: None,
        timestamp: update_timestamp(update),
        kind: "tool".to_string(),
        tool_type: Some(tool_name.clone()),
        title: Some(tool_name),
        tool_input: if include_input {
            update
                .get("rawInput")
                .cloned()
                .or_else(|| update.get("input").cloned())
        } else {
            None
        },
        tool_output: update
            .get("rawOutput")
            .cloned()
            .or_else(|| update.get("output").cloned())
            .or_else(|| update.get("content").cloned()),
    }
}

pub(crate) fn project_replayed_updates(updates: &[Value]) -> Vec<QoderSessionMessage> {
    let mut messages: Vec<QoderSessionMessage> = Vec::new();
    let mut seen = HashSet::new();
    let mut tool_positions: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut synthetic = 0usize;
    for params in updates {
        let update = params.get("update").unwrap_or(params);
        let kind = update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .unwrap_or("");
        if kind == "available_commands_update" || kind == "config_option_update" || kind == "plan" {
            continue;
        }
        if kind == "tool_call" || kind == "tool_call_update" {
            let tool_call_id = extract_qoder_tool_call_id(update).unwrap_or_else(|| {
                synthetic += 1;
                log::warn!("qoder history replay: {kind} without toolCallId, synthesizing id");
                format!("qoder-synthetic-tool-{synthetic}")
            });
            // Namespaced so tool ids can never collide with message ids.
            let message_id = format!("tool:{tool_call_id}");
            let status = update.get("status").and_then(Value::as_str).unwrap_or("");
            if let Some(&index) = tool_positions.get(&tool_call_id) {
                // Later snapshots (incl. tool_call_update completions) carry the
                // output; merge into the existing entry, preferring richer data.
                let existing = &mut messages[index];
                let content_text = extract_qoder_tool_content_text(update);
                if !content_text.trim().is_empty() {
                    if existing.text.is_empty() {
                        existing.text = content_text;
                    } else if status == "failed" && !existing.text.contains(&content_text) {
                        existing.text.push('\n');
                        existing.text.push_str(&content_text);
                    }
                }
                if existing.tool_output.is_none() {
                    existing.tool_output = update
                        .get("rawOutput")
                        .cloned()
                        .or_else(|| update.get("output").cloned())
                        .or_else(|| update.get("content").cloned());
                }
                if existing.tool_input.is_none() {
                    existing.tool_input = update
                        .get("rawInput")
                        .cloned()
                        .or_else(|| update.get("input").cloned());
                }
                if existing.tool_type.as_deref() == Some("tool") {
                    if let Some(name) = extract_qoder_tool_name(update) {
                        existing.tool_type = Some(name.clone());
                        existing.title = Some(name);
                    }
                }
                continue;
            }
            tool_positions.insert(tool_call_id, messages.len());
            seen.insert(message_id.clone());
            messages.push(build_tool_message(message_id, update, true));
            continue;
        }
        let (role, text, message_kind) = match kind {
            "user_message_chunk" => (
                "user",
                extract_content_text(update.get("content")),
                "message",
            ),
            "agent_message_chunk" => (
                "assistant",
                extract_content_text(update.get("content")),
                "message",
            ),
            "agent_thought_chunk" => (
                "assistant",
                extract_content_text(update.get("content")),
                "reasoning",
            ),
            _ => continue,
        };
        if text.trim().is_empty() {
            continue;
        }
        // Key dedup by (kind, id): a thought and a message sharing a messageId
        // must not merge into each other.
        let dedup_key = update_message_id(update)
            .map(|id| format!("{message_kind}:{id}"))
            .unwrap_or_else(|| {
                synthetic += 1;
                format!("qoder-synthetic-{synthetic}")
            });
        if !seen.insert(dedup_key.clone()) {
            if let Some(existing) = messages.iter_mut().find(|msg| msg.id == dedup_key) {
                existing.text.push_str(&text);
            }
            continue;
        }
        messages.push(QoderSessionMessage {
            id: dedup_key,
            role: role.to_string(),
            text,
            images: None,
            timestamp: update_timestamp(update),
            kind: message_kind.to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        });
    }
    messages
}

fn collect_session_updates_from_ndjson(lines: &str) -> Vec<Value> {
    let mut updates = Vec::new();
    for line in lines.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let AcpLine::Notification { method, params } = parse_acp_line(&value) {
            if method == "session/update" {
                updates.push(params);
            }
        }
    }
    updates
}

async fn with_initialized_acp<T, F>(
    workspace_path: &Path,
    home_dir: Option<&str>,
    timeout_dur: Duration,
    body: F,
) -> Result<T, String>
where
    F: for<'a> FnOnce(
        &'a mut super::qoder::QoderAcpProcess,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<T, String>> + Send + 'a>,
    >,
{
    run_qoder_acp_initialized(None, workspace_path, home_dir, timeout_dur, body).await
}

pub async fn list_qoder_sessions(
    workspace_path: &Path,
    limit: Option<usize>,
    home_dir: Option<&str>,
) -> Result<Vec<QoderSessionSummary>, String> {
    match with_initialized_acp(
        workspace_path,
        home_dir,
        QODER_LIST_TIMEOUT,
        |acp| -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Value, String>> + Send + '_>,
        > {
            Box::pin(async move {
                acp.request("session/list", json!({}), QODER_RPC_HANDSHAKE_TIMEOUT)
                    .await
            })
        },
    )
    .await
    {
        Ok(result) => {
            let mut sessions = map_session_list_entries(&result, workspace_path);
            if let Some(limit) = limit {
                sessions.truncate(limit);
            }
            Ok(sessions)
        }
        Err(error) => {
            // Soft-empty stays, but keep the cause visible: auth / handshake /
            // CLI-version failures previously surfaced as an "empty history" UI.
            log::warn!("list_qoder_sessions failed, returning empty list: {error}");
            Ok(Vec::new())
        }
    }
}

pub async fn load_qoder_session(
    workspace_path: &Path,
    session_id: &str,
    home_dir: Option<&str>,
) -> Result<QoderSessionLoadResult, String> {
    let session_id = normalize_session_id(session_id)?;
    let workspace_owned = workspace_path.to_path_buf();
    let session_owned = session_id.clone();
    let result = with_initialized_acp(
        workspace_path,
        home_dir,
        QODER_LOAD_TIMEOUT,
        move |acp| -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<Value>, String>> + Send + '_>,
        > {
            let workspace_owned = workspace_owned.clone();
            let session_owned = session_owned.clone();
            Box::pin(async move {
                acp.request(
                    "session/load",
                    json!({
                        "sessionId": session_owned,
                        "cwd": workspace_owned.to_string_lossy(),
                        // qoder ACP requires mcpServers (validated array); omitting
                        // it fails with -32602 and history renders empty.
                        "mcpServers": [],
                    }),
                    QODER_LOAD_TIMEOUT,
                )
                .await?;
                Ok(acp.collected_updates.clone())
            })
        },
    )
    .await?;
    Ok(QoderSessionLoadResult {
        messages: project_replayed_updates(&result),
        usage: None,
    })
}

pub async fn delete_qoder_session(
    workspace_path: &Path,
    session_id: &str,
    home_dir: Option<&str>,
) -> Result<(), String> {
    let session_id = normalize_session_id(session_id)?;
    with_initialized_acp(
        workspace_path,
        home_dir,
        QODER_DELETE_TIMEOUT,
        |acp| -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<(), String>> + Send + '_>,
        > {
            Box::pin(async move {
                acp.request(
                    "session/delete",
                    json!({ "sessionId": session_id }),
                    QODER_RPC_HANDSHAKE_TIMEOUT,
                )
                .await?;
                Ok(())
            })
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_session_list_and_filters_cwd() {
        let workspace = PathBuf::from("/tmp/ws");
        let result = json!({
            "sessions": [
                {"sessionId":"keep","cwd":"/tmp/ws","title":"hello","updatedAt":10},
                {"sessionId":"drop","cwd":"/tmp/other","title":"nope","updatedAt":20}
            ]
        });
        let sessions = map_session_list_entries(&result, &workspace);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "keep");
        assert_eq!(sessions[0].first_message, "hello");
    }

    #[test]
    fn replay_dedupes_message_id_and_skips_available_commands() {
        let ndjson = r#"
{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"available_commands_update","availableCommands":[]}}}
{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","messageId":"u1","content":{"text":"hi"},"timestamp":"t1"}}}
{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","messageId":"u1","content":{"text":" there"}}}}
{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","messageId":"a1","content":{"text":"yo"}}}}
{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"plan"}}}
"#;
        let updates = collect_session_updates_from_ndjson(ndjson);
        let messages = project_replayed_updates(&updates);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].text, "hi there");
        assert_eq!(messages[0].timestamp.as_deref(), Some("t1"));
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].text, "yo");
    }

    #[test]
    fn replay_maps_thought_chunks_to_reasoning() {
        let updates = vec![
            json!({"update":{"sessionUpdate":"agent_thought_chunk","messageId":"t1","content":{"text":"thinking"}}}),
            json!({"update":{"sessionUpdate":"agent_message_chunk","messageId":"a1","content":{"text":"answer"}}}),
        ];
        let messages = project_replayed_updates(&updates);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].kind, "reasoning");
        assert_eq!(messages[0].text, "thinking");
        assert_eq!(messages[1].kind, "message");
        assert_eq!(messages[1].text, "answer");
    }

    #[test]
    fn replay_maps_tool_call_and_dedupes_by_tool_call_id() {
        let updates = vec![
            json!({"update":{"sessionUpdate":"tool_call","toolCallId":"call_1","title":"Skill","rawInput":{"skill":"quest"},"rawOutput":{"success":true},"content":[{"type":"content","content":{"type":"text","text":"done"}}],"_meta":{"qoder":{"toolName":"Skill"}}}}),
            json!({"update":{"sessionUpdate":"tool_call","toolCallId":"call_1","title":"Skill"}}),
        ];
        let messages = project_replayed_updates(&updates);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].kind, "tool");
        assert_eq!(messages[0].tool_type.as_deref(), Some("Skill"));
        assert_eq!(messages[0].text, "done");
        assert_eq!(messages[0].tool_input, Some(json!({"skill":"quest"})));
        assert_eq!(messages[0].tool_output, Some(json!({"success":true})));
    }

    #[test]
    fn replay_tool_call_update_merges_completion_output() {
        // Live stream shape: tool_call (pending, carries input) first,
        // tool_call_update (completed, carries output) later.
        let updates = vec![
            json!({"update":{"sessionUpdate":"tool_call","toolCallId":"call_1","status":"pending","title":"Shell","rawInput":{"cmd":"ls"}}}),
            json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"call_1","status":"completed","rawOutput":{"exit":0},"content":[{"type":"content","content":{"type":"text","text":"file.txt"}}]}}),
        ];
        let messages = project_replayed_updates(&updates);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, "tool:call_1");
        assert_eq!(messages[0].tool_input, Some(json!({"cmd":"ls"})));
        assert_eq!(messages[0].tool_output, Some(json!({"exit":0})));
        assert_eq!(messages[0].text, "file.txt");
    }

    #[test]
    fn replay_tool_call_update_without_prior_call_inserts_in_place() {
        let updates = vec![
            json!({"update":{"sessionUpdate":"user_message_chunk","messageId":"u1","content":{"text":"hi"}}}),
            json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"call_9","status":"failed","content":[{"type":"content","content":{"type":"text","text":"boom"}}]}}),
        ];
        let messages = project_replayed_updates(&updates);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].kind, "tool");
        assert_eq!(messages[1].text, "boom");
        assert_eq!(
            messages[1].tool_output,
            Some(json!([{"type":"content","content":{"type":"text","text":"boom"}}]))
        );
    }

    #[test]
    fn replay_projects_captured_qoder_1_1_28_load_stream() {
        // Captured from qodercli 1.1.28 session/load of a real /quest turn.
        // The JSON-RPC result arrived after the first user chunk; these eight
        // updates are the full replay once trailing drain is applied.
        let updates = vec![
            json!({"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"你好"},"messageId":"e706f26d-5f2f-463b-94d5-5b5259a807ff"}}),
            json!({"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking greeting"},"messageId":"d8da4116-b2ea-41e0-8d5a-19d62e6e871a"}}),
            json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"你好！有什么可以帮你的吗？"},"messageId":"4d1ed6d4-8801-487d-bd54-4bb47adf6222"}}),
            json!({"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"<command-name>/quest</command-name>"},"messageId":"76399fc7-8113-42fd-bb95-e9cf11b91b2c"}}),
            json!({"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking quest"},"messageId":"f0defbd4-ad83-4117-acb9-5dc7de2aad37"}}),
            json!({"update":{"sessionUpdate":"tool_call","toolCallId":"call_01a024d1af117dd1b4ea5705","status":"completed","title":"Skill","content":[{"type":"content","content":{"type":"text","text":"{\"success\":true}"}}],"kind":"other","rawInput":{"skill":"quest"},"rawOutput":{"success":true,"commandName":"quest","status":"inline"},"_meta":{"qoder":{"toolName":"Skill"}}}}),
            json!({"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking after skill"},"messageId":"6285ae60-d3a6-4763-b881-118935c13c44"}}),
            json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"你好！我是 Quest Task Handler"},"messageId":"f62dba7a-7bc9-416f-b49b-290f9720c3e9"}}),
        ];
        let messages = project_replayed_updates(&updates);
        assert_eq!(messages.len(), 8);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].text, "你好");
        assert_eq!(messages[1].kind, "reasoning");
        assert_eq!(messages[2].text, "你好！有什么可以帮你的吗？");
        assert_eq!(messages[3].role, "user");
        assert_eq!(messages[4].kind, "reasoning");
        assert_eq!(messages[5].kind, "tool");
        assert_eq!(messages[5].id, "tool:call_01a024d1af117dd1b4ea5705");
        assert_eq!(messages[5].tool_type.as_deref(), Some("Skill"));
        assert_eq!(messages[5].tool_input, Some(json!({"skill":"quest"})));
        assert_eq!(messages[6].kind, "reasoning");
        assert_eq!(messages[7].text, "你好！我是 Quest Task Handler");
    }

    #[test]
    fn replay_namespaces_ids_and_separates_kinds() {
        // A thought and a message sharing a messageId must not merge.
        let updates = vec![
            json!({"update":{"sessionUpdate":"agent_thought_chunk","messageId":"same","content":{"text":"thinking"}}}),
            json!({"update":{"sessionUpdate":"agent_message_chunk","messageId":"same","content":{"text":"answer"}}}),
            json!({"update":{"sessionUpdate":"tool_call","toolCallId":"message:same","title":"t"}}),
        ];
        let messages = project_replayed_updates(&updates);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].id, "reasoning:same");
        assert_eq!(messages[1].id, "message:same");
        // toolCallId "message:same" must not collide with chunk ids.
        assert_eq!(messages[2].id, "tool:message:same");
    }

    #[test]
    fn empty_list_is_soft_empty() {
        let sessions = map_session_list_entries(&json!({}), Path::new("/tmp/ws"));
        assert!(sessions.is_empty());
    }
}
