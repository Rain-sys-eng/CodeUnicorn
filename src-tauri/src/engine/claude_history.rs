//! Read Claude Code session history from the effective Claude home projects directory.
//!
//! Claude Code stores session data as JSONL files in:
//! `<claude-home>/projects/{encoded-path}/{session-id}.jsonl`
//!
//! Path encoding: all non-alphanumeric characters are replaced with hyphens.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::SystemTime;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::sync::Semaphore;
use tokio::time::timeout;

use super::claude_history_entries::{
    classify_claude_history_entry, extract_command_prompt_text, extract_text_from_content,
    ClaudeHistoryEntryClassification, ClaudeHistoryHiddenReason, ClaudeLocalControlEvent,
    CLAUDE_CONTROL_EVENT_TOOL_TYPE,
};
use super::claude_history_large_payload::{
    estimate_base64_decoded_bytes, extract_images_and_deferred_from_content,
    is_supported_image_media_type, parse_claude_summary_entry, ClaudeDeferredImage,
    ClaudeDeferredImageLocator, ClaudeHydratedImage, CLAUDE_HYDRATED_IMAGE_BASE64_BYTE_BUDGET,
};
use super::claude_history_subagents::{
    normalize_claude_session_id, read_subagent_meta, ClaudeSubagentSessionId,
};
use super::EngineConfig;

const LOCAL_SESSION_SCAN_TIMEOUT: Duration = Duration::from_secs(60);
/// Sidebar list scan: stop after this many content bytes (align Index peek).
pub(crate) const CLAUDE_LIST_SCAN_MAX_BYTES: u64 = 64 * 1024;
/// Sidebar list scan: stop after this many non-empty lines.
pub(crate) const CLAUDE_LIST_SCAN_MAX_LINES: usize = 40;
const CLAUDE_LIST_PREVIEW_MAX_LINES: usize = CLAUDE_LIST_SCAN_MAX_LINES;
/// Skip a single JSONL line larger than this once a title already exists.
const CLAUDE_LIST_SKIP_LINE_BYTES: usize = 200_000;
const CLAUDE_LIST_DEFAULT_LIMIT: usize = 200;

#[derive(Default)]
struct ClaudeScanIoLog {
    /// (absolute path, opens, bytes)
    entries: Vec<(String, u64, u64)>,
}

static CLAUDE_SCAN_IO: Mutex<ClaudeScanIoLog> = Mutex::new(ClaudeScanIoLog {
    entries: Vec::new(),
});

#[allow(dead_code)]
pub(crate) fn reset_claude_list_io_stats() {
    if let Ok(mut guard) = CLAUDE_SCAN_IO.lock() {
        guard.entries.clear();
    }
}

pub(crate) fn claude_list_io_stats_for_prefix(prefix: &Path) -> (u64, u64) {
    let prefix = prefix.to_string_lossy();
    let Ok(guard) = CLAUDE_SCAN_IO.lock() else {
        return (0, 0);
    };
    let mut opens = 0;
    let mut bytes = 0;
    for (path, open_count, read_bytes) in &guard.entries {
        if path.starts_with(prefix.as_ref()) {
            opens += *open_count;
            bytes += *read_bytes;
        }
    }
    (opens, bytes)
}

fn record_claude_scan_open(path: &Path) {
    let key = path.to_string_lossy().into_owned();
    if let Ok(mut guard) = CLAUDE_SCAN_IO.lock() {
        guard.entries.push((key, 1, 0));
    }
}

fn record_claude_scan_read_bytes(path: &Path, bytes: u64) {
    let key = path.to_string_lossy().into_owned();
    if let Ok(mut guard) = CLAUDE_SCAN_IO.lock() {
        if let Some(entry) = guard.entries.iter_mut().rev().find(|(p, _, _)| p == &key) {
            entry.2 += bytes;
        } else {
            guard.entries.push((key, 0, bytes));
        }
    }
}
const CLAUDE_ATTRIBUTION_STRICT_MATCH: &str = "strict-match";
pub(crate) const CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY: &str = "claude-project-directory";
const CLAUDE_ATTRIBUTION_REASON_TRANSCRIPT_CWD: &str = "claude-transcript-cwd";
const CLAUDE_ATTRIBUTION_REASON_GIT_ROOT: &str = "claude-git-root";
const CLAUDE_SOURCE_FACT_CACHE_SCHEMA_VERSION: u32 = 1;
// v5: explicit transcript cwd outside attribution scope is always rejected (no project-dir
// fallback override). Invalidates caches that previously leaked foreign history via
// non-ASCII path collisions (e.g. 新的空文件夹 vs 个人财务管理).
// v6: sidebar/catalog list peeks a bounded head and uses file mtime for
// updated_at instead of scanning every jsonl to EOF.
const CLAUDE_SOURCE_FACT_SCANNER_VERSION: u32 = 6;
const CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS: usize = 60;
fn normalize_session_id(session_id: &str) -> Result<String, String> {
    normalize_claude_session_id(session_id)
}

/// Summary of a Claude Code session for sidebar display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSummary {
    pub session_id: String,
    pub first_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_title: Option<String>,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSourceFact {
    pub canonical_session_id: String,
    pub display_session_id: String,
    pub physical_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_project_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_real_user_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_title: Option<String>,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_mtime_ms: Option<i64>,
    pub source_health: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ClaudeSessionScanDiagnosticCode {
    UnreadableFile,
    EmptyTranscript,
    MissingSessionId,
    CwdOutsideAttributionScope,
    MissingCwdWithoutFallback,
    MalformedTranscript,
}

impl ClaudeSessionScanDiagnosticCode {
    fn as_str(&self) -> &'static str {
        match self {
            Self::UnreadableFile => "unreadable-file",
            Self::EmptyTranscript => "empty-transcript",
            Self::MissingSessionId => "missing-session-id",
            Self::CwdOutsideAttributionScope => "cwd-outside-attribution-scope",
            Self::MissingCwdWithoutFallback => "missing-cwd-without-fallback",
            Self::MalformedTranscript => "malformed-transcript",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionScanDiagnostic {
    pub code: ClaudeSessionScanDiagnosticCode,
    pub reason: String,
    pub physical_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionScanOutcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fact: Option<ClaudeSessionSourceFact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ClaudeSessionScanDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSourceFactCacheMetrics {
    pub hits: usize,
    pub misses: usize,
    pub stale: usize,
    pub rebuilds: usize,
    pub failures: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSourceFactList {
    pub facts: Vec<ClaudeSessionSourceFact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ClaudeSessionScanDiagnostic>,
    pub scanned_candidates: usize,
    pub skipped_candidates: usize,
    pub scan_cap_reached: bool,
    pub cache_metrics: ClaudeSessionSourceFactCacheMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionSourceFactCacheEntry {
    schema_version: u32,
    scanner_version: u32,
    cache_namespace: String,
    physical_path: String,
    file_mtime_ms: Option<i64>,
    file_size_bytes: Option<u64>,
    fact: Option<ClaudeSessionSourceFact>,
    #[serde(default)]
    diagnostics: Vec<ClaudeSessionScanDiagnostic>,
}

impl ClaudeSessionSourceFact {
    fn to_summary(&self) -> ClaudeSessionSummary {
        let first_message = self.first_real_user_message.clone().unwrap_or_else(|| {
            format!(
                "Session {}",
                &self.canonical_session_id[..8.min(self.canonical_session_id.len())]
            )
        });
        ClaudeSessionSummary {
            session_id: self.canonical_session_id.clone(),
            first_message,
            native_title: self.native_title.clone(),
            updated_at: self.updated_at,
            created_at: self.created_at,
            message_count: self.message_count,
            file_size_bytes: self.file_size_bytes,
            cwd: self.cwd.clone(),
            attribution_status: self.attribution_status.clone(),
            attribution_reason: self.attribution_reason.clone(),
            parent_session_id: self.parent_session_id.clone(),
            subagent_type: self.subagent_type.clone(),
        }
    }
}

impl ClaudeSessionScanOutcome {
    fn into_summary(self) -> Option<ClaudeSessionSummary> {
        self.fact.map(|fact| fact.to_summary())
    }
}

#[derive(Debug, Clone)]
pub struct ClaudeSessionAttributionScope {
    pub path: PathBuf,
    pub reason: String,
}

impl ClaudeSessionAttributionScope {
    pub fn workspace_path(path: PathBuf) -> Self {
        Self {
            path,
            reason: CLAUDE_ATTRIBUTION_REASON_TRANSCRIPT_CWD.to_string(),
        }
    }

    pub fn git_root(path: PathBuf) -> Self {
        Self {
            path,
            reason: CLAUDE_ATTRIBUTION_REASON_GIT_ROOT.to_string(),
        }
    }
}

/// Encode a filesystem path to Claude's project directory name.
/// All non-alphanumeric characters (except hyphens) become hyphens.
pub(crate) fn encode_project_path(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Get the Claude projects base directory (`<effective-claude-home>/projects`).
fn claude_projects_dir(config: Option<&EngineConfig>) -> Option<PathBuf> {
    crate::claude_home::resolve_claude_projects_dir(config)
}

fn candidate_workspace_paths(workspace_path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    let raw = workspace_path.to_path_buf();
    let raw_str = raw.to_string_lossy().to_string();
    if !raw_str.is_empty() && seen.insert(raw_str.clone()) {
        candidates.push(raw);
    }

    let trimmed = raw_str.trim_end_matches(['/', '\\']);
    if trimmed != raw_str && seen.insert(trimmed.to_string()) {
        candidates.push(PathBuf::from(trimmed.to_string()));
    }

    if let Ok(canonical) = std::fs::canonicalize(workspace_path) {
        let canonical_str = canonical.to_string_lossy().to_string();
        if !canonical_str.is_empty() && seen.insert(canonical_str) {
            candidates.push(canonical);
        }
    }

    if trimmed != raw_str {
        if let Ok(canonical_trimmed) = std::fs::canonicalize(trimmed) {
            let canonical_trimmed_str = canonical_trimmed.to_string_lossy().to_string();
            if !canonical_trimmed_str.is_empty() && seen.insert(canonical_trimmed_str) {
                candidates.push(canonical_trimmed);
            }
        }
    }

    candidates
}

/// True when `candidate` is the workspace project dir or a nested subdir of it.
///
/// Claude encodes every non-ASCII character to `-`, so two Chinese sibling
/// folders of different lengths become pure-hyphen suffixes of each other
/// (e.g. `Desktop-------` vs `Desktop-------------`). Treating that as a
/// nested project dir incorrectly merges unrelated history. Require at least
/// one ASCII alphanumeric in the remainder so real ASCII nests
/// (`…-repo-packages-foo`) still match while pure-hyphen collisions do not.
fn is_encoded_workspace_prefix_match(candidate: &str, encoded_workspace: &str) -> bool {
    if candidate == encoded_workspace {
        return true;
    }
    if !candidate.starts_with(encoded_workspace) {
        return false;
    }
    let rest = &candidate[encoded_workspace.len()..];
    if !rest.starts_with('-') {
        return false;
    }
    rest.chars().any(|c| c.is_ascii_alphanumeric())
}

fn claude_project_dirs_for_path(base_dir: &Path, workspace_path: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    let mut encoded_workspace_paths = Vec::new();
    for path in candidate_workspace_paths(workspace_path) {
        let encoded = encode_project_path(&path.to_string_lossy());
        if !encoded.is_empty() {
            encoded_workspace_paths.push(encoded.clone());
        }
        let dir = base_dir.join(&encoded);
        if seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }
    encoded_workspace_paths.sort();
    encoded_workspace_paths.dedup();

    if let Ok(entries) = std::fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let file_name = entry.file_name();
            let Some(dir_name) = file_name.to_str() else {
                continue;
            };
            if !encoded_workspace_paths.iter().any(|encoded_workspace| {
                is_encoded_workspace_prefix_match(dir_name, encoded_workspace)
            }) {
                continue;
            }
            let dir = entry.path();
            if seen.insert(dir.clone()) {
                dirs.push(dir);
            }
        }
    }

    dirs
}

fn all_claude_project_dirs(base_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(entries) = std::fs::read_dir(base_dir) else {
        return dirs;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            dirs.push(entry.path());
        }
    }
    dirs.sort();
    dirs.dedup();
    dirs
}

/// Parse an ISO 8601 timestamp string to epoch milliseconds
fn parse_timestamp(ts: &str) -> Option<i64> {
    // Parse ISO 8601 format: "2026-02-02T06:36:06.284Z"
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn claude_control_event_message(
    event: ClaudeLocalControlEvent,
    id: String,
    timestamp: Option<String>,
) -> ClaudeSessionMessage {
    ClaudeSessionMessage {
        id,
        role: "system".to_string(),
        text: event.detail.clone(),
        images: None,
        deferred_images: None,
        timestamp,
        kind: "tool".to_string(),
        tool_type: Some(CLAUDE_CONTROL_EVENT_TOOL_TYPE.to_string()),
        title: Some(event.event_type.title().to_string()),
        tool_input: Some(serde_json::json!({
            "eventType": event.event_type.as_str(),
            "source": "claude-history",
        })),
        tool_output: Some(serde_json::json!({
            "detail": event.detail,
            "eventType": event.event_type.as_str(),
            "source": "claude-history",
        })),
        status: Some(event.event_type.status().to_string()),
    }
}

/// Truncate a string to max_chars, adding ellipsis if truncated
fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{}…", truncated)
    }
}

pub(crate) fn first_non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn extract_claude_entry_cwd(entry: &Value) -> Option<String> {
    first_non_empty_string(entry.get("cwd"))
        .or_else(|| first_non_empty_string(entry.get("currentWorkingDirectory")))
        .or_else(|| first_non_empty_string(entry.get("workspacePath")))
        .or_else(|| first_non_empty_string(entry.get("workspace_path")))
        .or_else(|| {
            entry.get("payload").and_then(|payload| {
                first_non_empty_string(payload.get("cwd"))
                    .or_else(|| first_non_empty_string(payload.get("currentWorkingDirectory")))
                    .or_else(|| {
                        payload
                            .get("sessionMeta")
                            .and_then(|meta| first_non_empty_string(meta.get("cwd")))
                    })
                    .or_else(|| {
                        payload
                            .get("session_meta")
                            .and_then(|meta| first_non_empty_string(meta.get("cwd")))
                    })
            })
        })
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| first_non_empty_string(message.get("cwd")))
        })
}

fn build_scan_diagnostic(
    code: ClaudeSessionScanDiagnosticCode,
    path: &Path,
    session_id: Option<String>,
    cwd: Option<String>,
) -> ClaudeSessionScanDiagnostic {
    ClaudeSessionScanDiagnostic {
        reason: code.as_str().to_string(),
        code,
        physical_path: path.to_string_lossy().to_string(),
        session_id,
        cwd,
    }
}

fn file_mtime_millis_sync(path: &Path) -> i64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_epoch_millis)
        .unwrap_or(0)
}

fn cap_claude_scan_paths_by_mtime(
    jsonl_paths: &mut Vec<(PathBuf, bool)>,
    subagent_jsonl_paths: &mut Vec<(PathBuf, String, bool)>,
    limit: usize,
) {
    if jsonl_paths.len() <= limit {
        return;
    }
    jsonl_paths.sort_by(|left, right| {
        file_mtime_millis_sync(&right.0)
            .cmp(&file_mtime_millis_sync(&left.0))
            .then_with(|| left.0.cmp(&right.0))
    });
    jsonl_paths.truncate(limit);
    let selected_parents: HashSet<String> = jsonl_paths
        .iter()
        .filter_map(|(path, _)| {
            path.file_stem()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .collect();
    subagent_jsonl_paths
        .retain(|(_, parent_session_id, _)| selected_parents.contains(parent_session_id));
}

fn system_time_to_epoch_millis(value: SystemTime) -> Option<i64> {
    value
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

async fn source_fact_file_fingerprint(path: &Path) -> (Option<u64>, Option<i64>) {
    match fs::metadata(path).await {
        Ok(metadata) => (
            Some(metadata.len()),
            metadata
                .modified()
                .ok()
                .and_then(system_time_to_epoch_millis),
        ),
        Err(_) => (None, None),
    }
}

fn source_fact_cache_namespace(
    base_dir: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(base_dir.to_string_lossy().as_bytes());
    for scope in attribution_scopes {
        hasher.update(b"\0scope\0");
        hasher.update(scope.reason.as_bytes());
        hasher.update(b"\0path\0");
        hasher.update(scope.path.to_string_lossy().as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn workspace_only_source_fact_cache_namespace(
    base_dir: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"workspace-only\0");
    hasher.update(base_dir.to_string_lossy().as_bytes());
    for scope in attribution_scopes {
        hasher.update(b"\0scope\0");
        hasher.update(scope.reason.as_bytes());
        hasher.update(b"\0path\0");
        hasher.update(scope.path.to_string_lossy().as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn source_fact_cache_path(
    cache_dir: &Path,
    namespace: &str,
    path: &Path,
    allow_project_directory_fallback: bool,
) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(namespace.as_bytes());
    hasher.update(b"\0");
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(b"\0fallback\0");
    hasher.update(if allow_project_directory_fallback {
        "true"
    } else {
        "false"
    });
    cache_dir.join(format!("{:x}.json", hasher.finalize()))
}

async fn read_cached_source_fact_outcome(
    cache_path: &Path,
    namespace: &str,
    path: &Path,
    file_size_bytes: Option<u64>,
    file_mtime_ms: Option<i64>,
    metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) -> Option<ClaudeSessionScanOutcome> {
    let payload = match fs::read_to_string(cache_path).await {
        Ok(payload) => payload,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            metrics.misses += 1;
            return None;
        }
        Err(_) => {
            metrics.failures += 1;
            return None;
        }
    };

    let entry = match serde_json::from_str::<ClaudeSessionSourceFactCacheEntry>(&payload) {
        Ok(entry) => entry,
        Err(_) => {
            metrics.failures += 1;
            return None;
        }
    };

    let physical_path = path.to_string_lossy();
    let is_current = entry.schema_version == CLAUDE_SOURCE_FACT_CACHE_SCHEMA_VERSION
        && entry.scanner_version == CLAUDE_SOURCE_FACT_SCANNER_VERSION
        && entry.cache_namespace == namespace
        && entry.physical_path == physical_path
        && entry.file_size_bytes == file_size_bytes
        && entry.file_mtime_ms == file_mtime_ms;

    if !is_current {
        metrics.stale += 1;
        return None;
    }

    metrics.hits += 1;
    Some(ClaudeSessionScanOutcome {
        fact: entry.fact,
        diagnostics: entry.diagnostics,
    })
}

async fn write_cached_source_fact_outcome(
    cache_path: &Path,
    namespace: &str,
    path: &Path,
    file_size_bytes: Option<u64>,
    file_mtime_ms: Option<i64>,
    outcome: &ClaudeSessionScanOutcome,
    metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) {
    let Some(parent) = cache_path.parent() else {
        metrics.failures += 1;
        return;
    };
    if fs::create_dir_all(parent).await.is_err() {
        metrics.failures += 1;
        return;
    }
    let entry = ClaudeSessionSourceFactCacheEntry {
        schema_version: CLAUDE_SOURCE_FACT_CACHE_SCHEMA_VERSION,
        scanner_version: CLAUDE_SOURCE_FACT_SCANNER_VERSION,
        cache_namespace: namespace.to_string(),
        physical_path: path.to_string_lossy().to_string(),
        file_mtime_ms,
        file_size_bytes,
        fact: outcome.fact.clone(),
        diagnostics: outcome.diagnostics.clone(),
    };
    let Ok(payload) = serde_json::to_string(&entry) else {
        metrics.failures += 1;
        return;
    };
    if fs::write(cache_path, payload).await.is_err() {
        metrics.failures += 1;
        return;
    }
    metrics.rebuilds += 1;
}

async fn scan_session_source_file_with_cache(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
    cache_dir: Option<&Path>,
    cache_namespace: Option<&str>,
    metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) -> ClaudeSessionScanOutcome {
    let (file_size_bytes, file_mtime_ms) = source_fact_file_fingerprint(path).await;
    let cache_path = if file_size_bytes.is_some() && file_mtime_ms.is_some() {
        cache_dir.zip(cache_namespace).map(|(dir, namespace)| {
            source_fact_cache_path(dir, namespace, path, allow_project_directory_fallback)
        })
    } else {
        None
    };

    if let (Some(cache_path), Some(namespace)) = (cache_path.as_ref(), cache_namespace) {
        if let Some(outcome) = read_cached_source_fact_outcome(
            cache_path,
            namespace,
            path,
            file_size_bytes,
            file_mtime_ms,
            metrics,
        )
        .await
        {
            return outcome;
        }
    }

    let outcome = scan_session_source_file_preview(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
    )
    .await;

    if let (Some(cache_path), Some(namespace)) = (cache_path.as_ref(), cache_namespace) {
        write_cached_source_fact_outcome(
            cache_path,
            namespace,
            path,
            file_size_bytes,
            file_mtime_ms,
            &outcome,
            metrics,
        )
        .await;
    }

    outcome
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaudeSessionScanDepth {
    /// Sidebar / catalog list: stop after a bounded head peek.
    Preview,
    /// Cache rebuild / diagnostic path: read to EOF for counts and last title.
    Full,
}

/// Scan a single JSONL file and extract session summary metadata.
/// Preview stops after a bounded head peek; Full reads to EOF.
async fn scan_session_source_file(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> ClaudeSessionScanOutcome {
    scan_session_source_file_with_depth(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
        ClaudeSessionScanDepth::Full,
    )
    .await
}

async fn scan_session_source_file_preview(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> ClaudeSessionScanOutcome {
    scan_session_source_file_with_depth(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
        ClaudeSessionScanDepth::Preview,
    )
    .await
}

async fn scan_session_source_file_with_depth(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
    depth: ClaudeSessionScanDepth,
) -> ClaudeSessionScanOutcome {
    let mut diagnostics = Vec::new();
    let file = match fs::File::open(path).await {
        Ok(file) => {
            record_claude_scan_open(path);
            file
        }
        Err(_) => {
            diagnostics.push(build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::UnreadableFile,
                path,
                path.file_stem()
                    .and_then(|value| value.to_str())
                    .map(ToString::to_string),
                None,
            ));
            return ClaudeSessionScanOutcome {
                fact: None,
                diagnostics,
            };
        }
    };
    let file_metadata = file.metadata().await.ok();
    let file_size_bytes = file_metadata.as_ref().map(|metadata| metadata.len());
    let file_mtime_ms = file_metadata
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_epoch_millis);
    // Do not `take(64KiB)` on the reader: a first-line custom-title / first-user
    // payload can be larger (redacted image) and must still parse. Preview stops
    // after the budget in the line loop, so sparse tails are never consumed.
    let mut lines = BufReader::new(file).lines();
    let mut preview_lines_seen = 0usize;
    let mut preview_bytes_seen: u64 = 0;

    let mut first_user_message: Option<String> = None;
    let mut latest_native_title: Option<String> = None;
    let mut first_timestamp: Option<i64> = None;
    let mut last_timestamp: Option<i64> = None;
    let mut message_count: usize = 0;
    let mut transcript_cwd: Option<String> = None;
    let mut malformed_line_count: usize = 0;
    let mut read_error_count: usize = 0;
    let mut suppress_polluted_assistant_until_next_user = false;

    loop {
        let Some(line) = (match lines.next_line().await {
            Ok(line) => line,
            Err(_) => {
                read_error_count += 1;
                break;
            }
        }) else {
            break;
        };
        let line_bytes = line.len() as u64 + 1;
        if depth == ClaudeSessionScanDepth::Preview {
            record_claude_scan_read_bytes(path, line_bytes);
            preview_bytes_seen = preview_bytes_seen.saturating_add(line_bytes);
        }
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        if depth == ClaudeSessionScanDepth::Preview {
            preview_lines_seen += 1;
            if preview_lines_seen > CLAUDE_LIST_PREVIEW_MAX_LINES {
                break;
            }
            if line.len() > CLAUDE_LIST_SKIP_LINE_BYTES
                && (first_user_message.is_some() || latest_native_title.is_some())
            {
                break;
            }
        }

        let entry: Value = match parse_claude_summary_entry(&line) {
            Ok(v) => v,
            Err(_) => {
                malformed_line_count += 1;
                continue;
            }
        };

        if entry.get("type").and_then(Value::as_str) == Some("custom-title") {
            if let Some(title) = first_non_empty_string(entry.get("customTitle")) {
                latest_native_title = Some(title);
            }
        }

        let classification = classify_claude_history_entry(&entry);
        if matches!(
            classification,
            ClaudeHistoryEntryClassification::Hidden(
                ClaudeHistoryHiddenReason::StreamJsonStdinPayload
            )
        ) {
            suppress_polluted_assistant_until_next_user = true;
            continue;
        }
        if matches!(classification, ClaudeHistoryEntryClassification::Hidden(_)) {
            continue;
        }

        if transcript_cwd.is_none() {
            transcript_cwd = extract_claude_entry_cwd(&entry);
        }

        // Track timestamps from any entry that has one
        if let Some(ts_str) = entry.get("timestamp").and_then(|v| v.as_str()) {
            if let Some(ts) = parse_timestamp(ts_str) {
                if first_timestamp.is_none() {
                    first_timestamp = Some(ts);
                }
                last_timestamp = Some(ts);
            }
        }

        // Count message entries (user or assistant)
        let msg = entry.get("message");
        let role = msg
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            .unwrap_or("");
        let is_meta = is_claude_meta_entry(&entry, msg);

        if suppress_polluted_assistant_until_next_user && role == "assistant" {
            continue;
        }
        if suppress_polluted_assistant_until_next_user
            && role == "user"
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
        {
            suppress_polluted_assistant_until_next_user = false;
        }

        if (role == "user" || role == "assistant")
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
            && !is_meta
        {
            message_count += 1;
        }

        // Extract first user message (non-meta, non-filtered)
        if first_user_message.is_none()
            && role == "user"
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
        {
            if is_meta {
                continue;
            }

            if let Some(content) = msg.and_then(|m| m.get("content")) {
                if let Some(text) = extract_text_from_content(content) {
                    first_user_message = Some(truncate(
                        &extract_command_prompt_text(&text),
                        CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS,
                    ));
                }
            }
        }

        if depth == ClaudeSessionScanDepth::Preview {
            let has_title = first_user_message.is_some() || latest_native_title.is_some();
            if has_title && first_timestamp.is_some() {
                break;
            }
            if preview_lines_seen >= CLAUDE_LIST_PREVIEW_MAX_LINES {
                break;
            }
            if preview_bytes_seen >= CLAUDE_LIST_SCAN_MAX_BYTES {
                break;
            }
        }
    }

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let diagnostic_session_id = if session_id.is_empty() {
        None
    } else {
        Some(session_id.clone())
    };

    if malformed_line_count > 0 {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::MalformedTranscript,
            path,
            diagnostic_session_id.clone(),
            transcript_cwd.clone(),
        ));
    }
    if read_error_count > 0 {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::UnreadableFile,
            path,
            diagnostic_session_id.clone(),
            transcript_cwd.clone(),
        ));
    }

    if message_count < 1 {
        diagnostics.push(build_scan_diagnostic(
            if read_error_count > 0 {
                ClaudeSessionScanDiagnosticCode::UnreadableFile
            } else if malformed_line_count > 0 {
                ClaudeSessionScanDiagnosticCode::MalformedTranscript
            } else {
                ClaudeSessionScanDiagnosticCode::EmptyTranscript
            },
            path,
            diagnostic_session_id,
            transcript_cwd,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }

    if session_id.is_empty() {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::MissingSessionId,
            path,
            None,
            transcript_cwd,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let matched_scope_reason = transcript_cwd.as_deref().and_then(|cwd| {
        attribution_scopes
            .iter()
            .find(|scope| crate::local_usage::path_matches_workspace(cwd, &scope.path))
            .map(|scope| scope.reason.clone())
    });
    // Explicit transcript cwd always wins over project-directory placement.
    // Claude's encode_project_path maps distinct non-ASCII paths onto the same
    // bucket (e.g. 新的空文件夹 vs 个人财务管理), so trusting the project dir
    // when cwd points elsewhere leaks foreign history into empty/new folders.
    // Project-directory fallback remains only for missing-cwd transcripts.
    if transcript_cwd.is_some() && matched_scope_reason.is_none() {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::CwdOutsideAttributionScope,
            path,
            Some(session_id),
            transcript_cwd,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }
    if transcript_cwd.is_none() && !allow_project_directory_fallback {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::MissingCwdWithoutFallback,
            path,
            Some(session_id),
            None,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }
    let attribution_reason = Some(
        matched_scope_reason
            .unwrap_or_else(|| CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY.to_string()),
    );
    ClaudeSessionScanOutcome {
        fact: Some(ClaudeSessionSourceFact {
            canonical_session_id: session_id.clone(),
            display_session_id: session_id,
            physical_path: path.to_string_lossy().to_string(),
            claude_project_dir: path
                .parent()
                .map(|parent| parent.to_string_lossy().to_string()),
            cwd: transcript_cwd,
            parent_session_id: None,
            first_real_user_message: first_user_message,
            native_title: latest_native_title,
            source_health: if malformed_line_count > 0 || read_error_count > 0 {
                "partial".to_string()
            } else {
                "complete".to_string()
            },
            updated_at: match depth {
                ClaudeSessionScanDepth::Preview => {
                    file_mtime_ms.or(last_timestamp).unwrap_or(now_ms)
                }
                ClaudeSessionScanDepth::Full => last_timestamp.unwrap_or(now_ms),
            },
            created_at: first_timestamp.or(file_mtime_ms).unwrap_or(now_ms),
            message_count,
            file_size_bytes,
            file_mtime_ms,
            attribution_status: Some(CLAUDE_ATTRIBUTION_STRICT_MATCH.to_string()),
            attribution_reason,
            subagent_type: None,
        }),
        diagnostics,
    }
}

fn is_claude_meta_entry(entry: &Value, msg: Option<&Value>) -> bool {
    entry
        .get("isMeta")
        .or_else(|| msg.and_then(|message| message.get("isMeta")))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

async fn scan_session_file(
    path: &Path,
    _workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> Option<ClaudeSessionSummary> {
    scan_session_source_file_preview(path, attribution_scopes, allow_project_directory_fallback)
        .await
        .into_summary()
}

async fn scan_subagent_session_file(
    path: &Path,
    parent_session_id: &str,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> Option<ClaudeSessionSummary> {
    let agent_file_stem = path.file_stem().and_then(|s| s.to_str())?;
    let agent_id = agent_file_stem.strip_prefix("agent-")?;
    let subagent_session_id =
        ClaudeSubagentSessionId::from_path_segments(parent_session_id, agent_id)?;
    let (description, subagent_type) = read_subagent_meta(&path.with_extension("meta.json")).await;
    let mut summary = scan_session_file(
        path,
        Path::new(""),
        attribution_scopes,
        allow_project_directory_fallback,
    )
    .await?;
    summary.session_id = subagent_session_id.to_session_id();
    if let Some(description) = description {
        summary.first_message = truncate(&description, CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS);
    }
    summary.parent_session_id = Some(parent_session_id.to_string());
    summary.subagent_type = subagent_type;
    Some(summary)
}

async fn scan_subagent_source_file(
    path: &Path,
    parent_session_id: &str,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
    cache_dir: Option<&Path>,
    cache_namespace: Option<&str>,
    cache_metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) -> ClaudeSessionScanOutcome {
    let Some(agent_file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics: vec![build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::MissingSessionId,
                path,
                None,
                None,
            )],
        };
    };
    let Some(agent_id) = agent_file_stem.strip_prefix("agent-") else {
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics: vec![build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::MissingSessionId,
                path,
                None,
                None,
            )],
        };
    };
    let Some(subagent_session_id) =
        ClaudeSubagentSessionId::from_path_segments(parent_session_id, agent_id)
    else {
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics: vec![build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::MissingSessionId,
                path,
                None,
                None,
            )],
        };
    };
    let mut outcome = scan_session_source_file_with_cache(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
        cache_dir,
        cache_namespace,
        cache_metrics,
    )
    .await;
    if let Some(fact) = outcome.fact.as_mut() {
        let (description, subagent_type) =
            read_subagent_meta(&path.with_extension("meta.json")).await;
        fact.canonical_session_id = subagent_session_id.to_session_id();
        fact.display_session_id = fact.canonical_session_id.clone();
        fact.parent_session_id = Some(parent_session_id.to_string());
        if let Some(description) = description {
            fact.first_real_user_message = Some(truncate(
                &description,
                CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS,
            ));
        }
        fact.subagent_type = subagent_type;
    }
    outcome
}

pub async fn list_claude_sessions_with_config(
    workspace_path: &Path,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.to_path_buf(),
    )];
    list_claude_sessions_from_base_dir(&base_dir, workspace_path, &attribution_scopes, limit).await
}

pub async fn list_claude_sessions_for_attribution_scopes_with_config(
    workspace_path: &Path,
    attribution_scopes: Vec<ClaudeSessionAttributionScope>,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    list_claude_sessions_from_base_dir(&base_dir, workspace_path, &attribution_scopes, limit).await
}

pub(crate) async fn list_claude_session_source_facts_for_attribution_scopes_with_config(
    workspace_path: &Path,
    attribution_scopes: Vec<ClaudeSessionAttributionScope>,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    list_claude_session_source_facts_from_base_dir(
        &base_dir,
        workspace_path,
        &attribution_scopes,
        limit,
        cache_dir,
    )
    .await
}

pub(crate) async fn list_workspace_only_claude_session_source_facts_for_attribution_scopes_with_config(
    workspace_path: &Path,
    attribution_scopes: Vec<ClaudeSessionAttributionScope>,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    list_workspace_only_claude_session_source_facts_from_base_dir(
        &base_dir,
        workspace_path,
        &attribution_scopes,
        limit,
        cache_dir,
    )
    .await
}

pub(crate) async fn list_workspace_only_claude_session_source_facts_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    limit: Option<usize>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let cache_namespace =
            workspace_only_source_fact_cache_namespace(base_dir, attribution_scopes);
        let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
        let mut jsonl_paths: Vec<(PathBuf, bool)> = Vec::new();
        let mut subagent_jsonl_paths: Vec<(PathBuf, String, bool)> = Vec::new();
        let mut seen_paths = HashSet::new();
        let mut diagnostics = Vec::new();
        let mut found_dir = false;

        for project_dir in project_dirs {
            if !project_dir.exists() {
                continue;
            }
            found_dir = true;
            let mut entries = match fs::read_dir(&project_dir).await {
                Ok(entries) => entries,
                Err(_) => {
                    diagnostics.push(build_scan_diagnostic(
                        ClaudeSessionScanDiagnosticCode::UnreadableFile,
                        &project_dir,
                        None,
                        None,
                    ));
                    continue;
                }
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    if seen_paths.insert(path.clone()) {
                        jsonl_paths.push((path.clone(), true));
                    }
                    let parent_session_id = name.trim_end_matches(".jsonl").to_string();
                    let subagents_dir = path.with_extension("").join("subagents");
                    if subagents_dir.exists() {
                        let mut subagent_entries = match fs::read_dir(&subagents_dir).await {
                            Ok(entries) => entries,
                            Err(_) => {
                                diagnostics.push(build_scan_diagnostic(
                                    ClaudeSessionScanDiagnosticCode::UnreadableFile,
                                    &subagents_dir,
                                    Some(parent_session_id.clone()),
                                    None,
                                ));
                                continue;
                            }
                        };
                        while let Ok(Some(subagent_entry)) = subagent_entries.next_entry().await {
                            let subagent_path = subagent_entry.path();
                            let Some(subagent_name) =
                                subagent_path.file_name().and_then(|n| n.to_str())
                            else {
                                continue;
                            };
                            if subagent_name.starts_with("agent-")
                                && subagent_name.ends_with(".jsonl")
                                && seen_paths.insert(subagent_path.clone())
                            {
                                subagent_jsonl_paths.push((
                                    subagent_path,
                                    parent_session_id.clone(),
                                    true,
                                ));
                            }
                        }
                    }
                }
            }
        }

        if !found_dir {
            return Ok(ClaudeSessionSourceFactList {
                facts: Vec::new(),
                diagnostics: Vec::new(),
                scanned_candidates: 0,
                skipped_candidates: 0,
                scan_cap_reached: false,
                cache_metrics: ClaudeSessionSourceFactCacheMetrics::default(),
            });
        }

        let discovered_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        cap_claude_scan_paths_by_mtime(
            &mut jsonl_paths,
            &mut subagent_jsonl_paths,
            limit.unwrap_or(200),
        );
        jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        subagent_jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        let scanned_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        let scan_cap_reached = discovered_candidates > limit.unwrap_or(200);
        let mut facts = Vec::new();
        let mut cache_metrics = ClaudeSessionSourceFactCacheMetrics::default();

        for (path, allow_fallback) in jsonl_paths {
            let outcome = scan_session_source_file_with_cache(
                &path,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }
        for (path, parent_session_id, allow_fallback) in subagent_jsonl_paths {
            let outcome = scan_subagent_source_file(
                &path,
                &parent_session_id,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }

        facts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let limited_facts =
            limit_claude_source_facts_preserving_relationships(facts, limit.unwrap_or(200));

        let skipped_candidates = diagnostics
            .iter()
            .filter(|diagnostic| {
                matches!(
                    diagnostic.code,
                    ClaudeSessionScanDiagnosticCode::CwdOutsideAttributionScope
                        | ClaudeSessionScanDiagnosticCode::MissingCwdWithoutFallback
                        | ClaudeSessionScanDiagnosticCode::EmptyTranscript
                        | ClaudeSessionScanDiagnosticCode::MalformedTranscript
                        | ClaudeSessionScanDiagnosticCode::MissingSessionId
                        | ClaudeSessionScanDiagnosticCode::UnreadableFile
                )
            })
            .count();

        Ok(ClaudeSessionSourceFactList {
            facts: limited_facts,
            diagnostics,
            scanned_candidates,
            skipped_candidates,
            scan_cap_reached,
            cache_metrics,
        })
    })
    .await
    .map_err(|_| "Claude workspace-only session source fact scan timed out".to_string())?
}

pub(crate) async fn list_claude_session_source_facts_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    limit: Option<usize>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let cache_namespace = source_fact_cache_namespace(base_dir, attribution_scopes);
        let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
        let project_dir_set = project_dirs.iter().cloned().collect::<HashSet<_>>();
        let mut scan_dirs = Vec::new();
        let mut seen_dirs = HashSet::new();
        for dir in project_dirs {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, true));
            }
        }
        for dir in all_claude_project_dirs(base_dir) {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, false));
            }
        }

        let mut jsonl_paths: Vec<(PathBuf, bool)> = Vec::new();
        let mut subagent_jsonl_paths: Vec<(PathBuf, String, bool)> = Vec::new();
        let mut seen_paths = HashSet::new();
        let mut diagnostics = Vec::new();
        let mut found_dir = false;

        for (project_dir, allow_fallback) in scan_dirs {
            if !project_dir.exists() {
                continue;
            }
            found_dir = true;
            let mut entries = match fs::read_dir(&project_dir).await {
                Ok(entries) => entries,
                Err(_) => {
                    diagnostics.push(build_scan_diagnostic(
                        ClaudeSessionScanDiagnosticCode::UnreadableFile,
                        &project_dir,
                        None,
                        None,
                    ));
                    continue;
                }
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let is_direct_project_dir = project_dir_set.contains(&project_dir);
                    let allow_session_fallback = allow_fallback && is_direct_project_dir;
                    if seen_paths.insert(path.clone()) {
                        jsonl_paths.push((path.clone(), allow_session_fallback));
                    }
                    let parent_session_id = name.trim_end_matches(".jsonl").to_string();
                    let subagents_dir = path.with_extension("").join("subagents");
                    if subagents_dir.exists() {
                        let mut subagent_entries = match fs::read_dir(&subagents_dir).await {
                            Ok(entries) => entries,
                            Err(_) => {
                                diagnostics.push(build_scan_diagnostic(
                                    ClaudeSessionScanDiagnosticCode::UnreadableFile,
                                    &subagents_dir,
                                    Some(parent_session_id.clone()),
                                    None,
                                ));
                                continue;
                            }
                        };
                        while let Ok(Some(subagent_entry)) = subagent_entries.next_entry().await {
                            let subagent_path = subagent_entry.path();
                            let Some(subagent_name) =
                                subagent_path.file_name().and_then(|n| n.to_str())
                            else {
                                continue;
                            };
                            if subagent_name.starts_with("agent-")
                                && subagent_name.ends_with(".jsonl")
                                && seen_paths.insert(subagent_path.clone())
                            {
                                subagent_jsonl_paths.push((
                                    subagent_path,
                                    parent_session_id.clone(),
                                    allow_session_fallback,
                                ));
                            }
                        }
                    }
                }
            }
        }

        if !found_dir {
            return Ok(ClaudeSessionSourceFactList {
                facts: Vec::new(),
                diagnostics: Vec::new(),
                scanned_candidates: 0,
                skipped_candidates: 0,
                scan_cap_reached: false,
                cache_metrics: ClaudeSessionSourceFactCacheMetrics::default(),
            });
        }

        let discovered_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        cap_claude_scan_paths_by_mtime(
            &mut jsonl_paths,
            &mut subagent_jsonl_paths,
            limit.unwrap_or(200),
        );
        jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        subagent_jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        let scanned_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        let scan_cap_reached = discovered_candidates > limit.unwrap_or(200);
        let mut facts = Vec::new();
        let mut cache_metrics = ClaudeSessionSourceFactCacheMetrics::default();

        for (path, allow_fallback) in jsonl_paths {
            let outcome = scan_session_source_file_with_cache(
                &path,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }
        for (path, parent_session_id, allow_fallback) in subagent_jsonl_paths {
            let outcome = scan_subagent_source_file(
                &path,
                &parent_session_id,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }

        facts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let limited_facts =
            limit_claude_source_facts_preserving_relationships(facts, limit.unwrap_or(200));

        let skipped_candidates = diagnostics
            .iter()
            .filter(|diagnostic| {
                matches!(
                    diagnostic.code,
                    ClaudeSessionScanDiagnosticCode::CwdOutsideAttributionScope
                        | ClaudeSessionScanDiagnosticCode::MissingCwdWithoutFallback
                        | ClaudeSessionScanDiagnosticCode::EmptyTranscript
                        | ClaudeSessionScanDiagnosticCode::MalformedTranscript
                        | ClaudeSessionScanDiagnosticCode::MissingSessionId
                        | ClaudeSessionScanDiagnosticCode::UnreadableFile
                )
            })
            .count();

        Ok(ClaudeSessionSourceFactList {
            facts: limited_facts,
            diagnostics,
            scanned_candidates,
            skipped_candidates,
            scan_cap_reached,
            cache_metrics,
        })
    })
    .await
    .map_err(|_| "Claude session source fact scan timed out".to_string())?
}

pub(crate) async fn list_claude_sessions_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    limit: Option<usize>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
        let project_dir_set = project_dirs.iter().cloned().collect::<HashSet<_>>();
        let mut scan_dirs = Vec::new();
        let mut seen_dirs = HashSet::new();
        for dir in project_dirs {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, true));
            }
        }
        for dir in all_claude_project_dirs(base_dir) {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, false));
            }
        }

        let mut jsonl_paths: Vec<(PathBuf, bool)> = Vec::new();
        let mut seen_paths = HashSet::new();
        let mut found_dir = false;

        for (project_dir, allow_fallback) in scan_dirs {
            if !project_dir.exists() {
                continue;
            }
            found_dir = true;
            let mut entries = fs::read_dir(&project_dir)
                .await
                .map_err(|e| format!("Failed to read Claude project directory: {}", e))?;

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                        let is_direct_project_dir = project_dir_set.contains(&project_dir);
                        let allow_session_fallback = allow_fallback && is_direct_project_dir;
                        if seen_paths.insert(path.clone()) {
                            jsonl_paths.push((path.clone(), allow_session_fallback));
                        }
                    }
                }
            }
        }

        if !found_dir {
            return Ok(Vec::new());
        }

        // IO-before-limit: metadata/mtime only, then scan the newest `limit` files.
        // Sidebar list does not inventory subagent jsonl.
        let mut unused_subagent_jsonl_paths: Vec<(PathBuf, String, bool)> = Vec::new();
        cap_claude_scan_paths_by_mtime(
            &mut jsonl_paths,
            &mut unused_subagent_jsonl_paths,
            limit.unwrap_or(CLAUDE_LIST_DEFAULT_LIMIT),
        );

        // Scan all session files concurrently with a concurrency limit to prevent
        // memory exhaustion from spawning too many parallel file reads.
        const MAX_CONCURRENT_SCANS: usize = 10;
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_SCANS));
        let mut handles = Vec::new();
        for (path, allow_fallback) in jsonl_paths {
            let permit = semaphore.clone();
            let workspace_path = workspace_path.to_path_buf();
            let attribution_scopes = attribution_scopes.to_vec();
            handles.push(tokio::spawn(async move {
                let _permit = permit.acquire().await;
                scan_session_file(&path, &workspace_path, &attribution_scopes, allow_fallback).await
            }));
        }

        let mut sessions: Vec<ClaudeSessionSummary> = Vec::new();
        for handle in handles {
            if let Ok(Some(summary)) = handle.await {
                sessions.push(summary);
            }
        }

        // Sort by updated_at descending (most recent first)
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(limit_claude_sessions_preserving_relationships(
            sessions,
            limit.unwrap_or(CLAUDE_LIST_DEFAULT_LIMIT),
        ))
    })
    .await
    .map_err(|_| "Claude session scan timed out".to_string())?
}

fn limit_claude_sessions_preserving_relationships(
    sessions: Vec<ClaudeSessionSummary>,
    limit: usize,
) -> Vec<ClaudeSessionSummary> {
    if sessions.len() <= limit {
        return sessions;
    }

    let by_session_id: HashMap<String, ClaudeSessionSummary> = sessions
        .iter()
        .cloned()
        .map(|session| (session.session_id.clone(), session))
        .collect();
    let mut selected_ids: HashSet<String> = sessions
        .iter()
        .take(limit)
        .map(|session| session.session_id.clone())
        .collect();

    for session in sessions.iter().take(limit) {
        if let Some(parent_session_id) = session.parent_session_id.as_ref() {
            selected_ids.insert(parent_session_id.clone());
        }
    }

    let selected_parent_ids: HashSet<String> = selected_ids
        .iter()
        .filter(|session_id| {
            by_session_id
                .get(*session_id)
                .map(|session| session.parent_session_id.is_none())
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    for session in &sessions {
        if let Some(parent_session_id) = session.parent_session_id.as_ref() {
            if selected_parent_ids.contains(parent_session_id) {
                selected_ids.insert(session.session_id.clone());
            }
        }
    }

    let mut selected = sessions
        .into_iter()
        .filter(|session| selected_ids.contains(&session.session_id))
        .collect::<Vec<_>>();
    selected.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    selected
}

fn limit_claude_source_facts_preserving_relationships(
    facts: Vec<ClaudeSessionSourceFact>,
    limit: usize,
) -> Vec<ClaudeSessionSourceFact> {
    if facts.len() <= limit {
        return facts;
    }

    let by_session_id: HashMap<String, ClaudeSessionSourceFact> = facts
        .iter()
        .cloned()
        .map(|fact| (fact.canonical_session_id.clone(), fact))
        .collect();
    let mut selected_ids: HashSet<String> = facts
        .iter()
        .take(limit)
        .map(|fact| fact.canonical_session_id.clone())
        .collect();

    for fact in facts.iter().take(limit) {
        if let Some(parent_session_id) = fact.parent_session_id.as_ref() {
            selected_ids.insert(parent_session_id.clone());
        }
    }

    let selected_parent_ids: HashSet<String> = selected_ids
        .iter()
        .filter(|session_id| {
            by_session_id
                .get(*session_id)
                .map(|fact| fact.parent_session_id.is_none())
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    for fact in &facts {
        if let Some(parent_session_id) = fact.parent_session_id.as_ref() {
            if selected_parent_ids.contains(parent_session_id) {
                selected_ids.insert(fact.canonical_session_id.clone());
            }
        }
    }

    let mut selected = facts
        .into_iter()
        .filter(|fact| selected_ids.contains(&fact.canonical_session_id))
        .collect::<Vec<_>>();
    selected.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    selected
}

/// A single message from a Claude Code session, suitable for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deferred_images: Option<Vec<ClaudeDeferredImage>>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Usage data extracted from Claude session
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

/// Result of loading a Claude session, including messages and usage data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionLoadResult {
    pub messages: Vec<ClaudeSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ClaudeSessionUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

const CLAUDE_WINDOW_TAIL_CHUNK: u64 = 256 * 1024;

fn rewrite_session_id_fields(value: &mut Value, source_session_id: &str, forked_session_id: &str) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map.iter_mut() {
                if (key == "session_id" || key == "sessionId")
                    && nested
                        .as_str()
                        .map(|sid| sid == source_session_id)
                        .unwrap_or(false)
                {
                    *nested = Value::String(forked_session_id.to_string());
                    continue;
                }
                rewrite_session_id_fields(nested, source_session_id, forked_session_id);
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_session_id_fields(item, source_session_id, forked_session_id);
            }
        }
        _ => {}
    }
}

fn resolve_session_file_path(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<PathBuf, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
    for project_dir in project_dirs {
        let candidate = project_dir.join(format!("{}.jsonl", normalized_session_id));
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!("Session file not found: {}", normalized_session_id))
}

fn claude_session_file_search_dirs(base_dir: &Path, workspace_path: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    for dir in claude_project_dirs_for_path(base_dir, workspace_path)
        .into_iter()
        .chain(all_claude_project_dirs(base_dir))
    {
        if seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }
    dirs
}

fn is_target_user_message_entry(entry: &Value, target_message_id: &str) -> bool {
    let role = entry
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if role != "user" {
        return false;
    }
    entry
        .get("uuid")
        .and_then(|value| value.as_str())
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| message.get("id"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value == target_message_id)
        .unwrap_or(false)
}

pub async fn load_claude_session_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<ClaudeSessionLoadResult, String> {
    load_claude_session_with_config_window(workspace_path, session_id, config, None, None).await
}

pub async fn load_claude_session_with_config_window(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
    limit: Option<usize>,
    before: Option<&str>,
) -> Result<ClaudeSessionLoadResult, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    load_claude_session_from_base_dir_window(
        &base_dir,
        workspace_path,
        &normalized_session_id,
        limit,
        before,
    )
    .await
}

fn find_claude_session_file(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<PathBuf, String> {
    let project_dirs = claude_session_file_search_dirs(base_dir, workspace_path);
    for project_dir in project_dirs {
        let candidate = if let Some(subagent_id) = ClaudeSubagentSessionId::parse(session_id) {
            subagent_id.transcript_path(&project_dir)
        } else {
            project_dir.join(format!("{}.jsonl", session_id))
        };
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!("Session file not found: {}", session_id))
}

pub(crate) fn resolve_claude_session_file_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<PathBuf, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    find_claude_session_file(&base_dir, workspace_path, &normalized_session_id)
}

async fn read_claude_tail_window_bytes(
    path: &Path,
    end_exclusive: u64,
) -> Result<(u64, Vec<u8>), String> {
    let start = end_exclusive.saturating_sub(CLAUDE_WINDOW_TAIL_CHUNK);
    let mut file = fs::File::open(path)
        .await
        .map_err(|error| format!("Failed to open session file: {}", error))?;
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|error| format!("Failed to seek session file: {}", error))?;
    let mut buf = vec![0u8; (end_exclusive.saturating_sub(start)) as usize];
    let mut read = 0usize;
    while read < buf.len() {
        let n = file
            .read(&mut buf[read..])
            .await
            .map_err(|error| format!("Failed to read session file: {}", error))?;
        if n == 0 {
            break;
        }
        read += n;
    }
    buf.truncate(read);
    Ok((start, buf))
}

async fn load_claude_session_window_from_path(
    path: &Path,
    session_id: &str,
    limit: usize,
    before: Option<&str>,
) -> Result<ClaudeSessionLoadResult, String> {
    let file_len = fs::metadata(path)
        .await
        .map_err(|error| format!("Failed to stat session file: {}", error))?
        .len();
    let mut end = before
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value <= file_len)
        .unwrap_or(file_len);
    let mut assembled = Vec::new();
    let mut window_start = end;
    while end > 0 {
        let (start, bytes) = read_claude_tail_window_bytes(path, end).await?;
        window_start = start;
        let mut chunk = bytes;
        if start > 0 {
            if let Some(newline) = chunk.iter().position(|byte| *byte == b'\n') {
                chunk = chunk.split_off(newline + 1);
                window_start = start + newline as u64 + 1;
            }
        }
        assembled.splice(0..0, chunk);
        if assembled.iter().filter(|byte| **byte == b'\n').count() >= limit.saturating_mul(4)
            || start == 0
        {
            break;
        }
        end = start;
    }
    let has_more = window_start > 0;
    let mut result = parse_claude_session_from_reader(
        BufReader::new(std::io::Cursor::new(assembled)),
        session_id,
    )
    .await?;
    if result.messages.len() > limit {
        let skip = result.messages.len() - limit;
        result.messages.drain(0..skip);
        result.has_more = Some(true);
        result.next_cursor = Some(window_start.to_string());
    } else {
        result.has_more = Some(has_more);
        result.next_cursor = if has_more {
            Some(window_start.to_string())
        } else {
            None
        };
    }
    Ok(result)
}

pub(crate) async fn load_claude_session_from_base_dir_window(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
    limit: Option<usize>,
    before: Option<&str>,
) -> Result<ClaudeSessionLoadResult, String> {
    let session_file = find_claude_session_file(base_dir, workspace_path, session_id)?;
    if let Some(limit) = limit.filter(|value| *value > 0) {
        return load_claude_session_window_from_path(&session_file, session_id, limit, before)
            .await;
    }
    let file = fs::File::open(&session_file)
        .await
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    parse_claude_session_from_reader(BufReader::new(file), session_id).await
}

pub(crate) async fn load_claude_session_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<ClaudeSessionLoadResult, String> {
    load_claude_session_from_base_dir_window(base_dir, workspace_path, session_id, None, None).await
}

async fn parse_claude_session_from_reader<R: tokio::io::AsyncRead + Unpin>(
    reader: BufReader<R>,
    session_id: &str,
) -> Result<ClaudeSessionLoadResult, String> {
    let mut lines = reader.lines();

    let mut messages: Vec<ClaudeSessionMessage> = Vec::new();
    let mut last_usage: Option<ClaudeSessionUsage> = None;
    let mut counter: usize = 0;
    let mut line_index: usize = 0;
    let mut suppress_polluted_assistant_until_next_user = false;

    while let Ok(Some(line)) = lines.next_line().await {
        let current_line_index = line_index;
        line_index += 1;
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let entry: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let classification = classify_claude_history_entry(&entry);
        if matches!(
            classification,
            ClaudeHistoryEntryClassification::Hidden(
                ClaudeHistoryHiddenReason::StreamJsonStdinPayload
            )
        ) {
            suppress_polluted_assistant_until_next_user = true;
            continue;
        }
        if matches!(classification, ClaudeHistoryEntryClassification::Hidden(_)) {
            continue;
        }

        let msg = match entry.get("message") {
            Some(m) => m,
            None => continue,
        };

        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");

        if role != "user" && role != "assistant" {
            continue;
        }

        if suppress_polluted_assistant_until_next_user && role == "assistant" {
            continue;
        }
        if suppress_polluted_assistant_until_next_user
            && role == "user"
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
        {
            suppress_polluted_assistant_until_next_user = false;
        }

        // Extract usage data from assistant messages
        if role == "assistant" {
            if let Some(usage) = msg.get("usage") {
                last_usage = Some(ClaudeSessionUsage {
                    input_tokens: usage.get("input_tokens").and_then(|v| v.as_i64()),
                    output_tokens: usage.get("output_tokens").and_then(|v| v.as_i64()),
                    cache_creation_input_tokens: usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_i64()),
                    cache_read_input_tokens: usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_i64()),
                });
            }
        }

        // Skip meta entries
        let is_meta = is_claude_meta_entry(&entry, Some(msg));
        if is_meta {
            continue;
        }

        let timestamp = entry
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let uuid = entry.get("uuid").and_then(|v| v.as_str()).unwrap_or("");
        if let ClaudeHistoryEntryClassification::Displayable(event) = classification {
            counter += 1;
            let id = if uuid.is_empty() {
                format!("claude-control-event-{}", counter)
            } else {
                format!("{}-control-event", uuid)
            };
            messages.push(claude_control_event_message(event, id, timestamp));
            continue;
        }

        let content = msg.get("content");

        // Extract text and structured content from the message
        match content {
            Some(Value::String(text)) => {
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                counter += 1;
                let id = if uuid.is_empty() {
                    format!("claude-msg-{}", counter)
                } else {
                    uuid.to_string()
                };
                messages.push(ClaudeSessionMessage {
                    id,
                    role: role.to_string(),
                    text: text.to_string(),
                    images: None,
                    deferred_images: None,
                    timestamp,
                    kind: "message".to_string(),
                    tool_type: None,
                    title: None,
                    tool_input: None,
                    tool_output: None,
                    status: None,
                });
            }
            Some(Value::Array(blocks)) => {
                // Process content blocks: text, thinking, tool_use, tool_result
                let mut text_parts: Vec<String> = Vec::new();
                let (image_sources, deferred_images) = extract_images_and_deferred_from_content(
                    &Value::Array(blocks.clone()),
                    session_id,
                    current_line_index,
                    if uuid.is_empty() { None } else { Some(uuid) },
                );

                for block in blocks {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match block_type {
                        "text" => {
                            if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                                let t = t.trim();
                                if !t.is_empty() {
                                    text_parts.push(t.to_string());
                                }
                            }
                        }
                        "thinking" | "reasoning" => {
                            // Extract thinking/reasoning content
                            let thinking_text = block
                                .get("thinking")
                                .or_else(|| block.get("reasoning"))
                                .or_else(|| block.get("text"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .trim();
                            if !thinking_text.is_empty() {
                                counter += 1;
                                let id = if uuid.is_empty() {
                                    format!("claude-reasoning-{}", counter)
                                } else {
                                    format!("{}-reasoning", uuid)
                                };
                                messages.push(ClaudeSessionMessage {
                                    id,
                                    role: role.to_string(),
                                    text: thinking_text.to_string(),
                                    images: None,
                                    deferred_images: None,
                                    timestamp: timestamp.clone(),
                                    kind: "reasoning".to_string(),
                                    tool_type: None,
                                    title: None,
                                    tool_input: None,
                                    tool_output: None,
                                    status: None,
                                });
                            }
                        }
                        "tool_use" => {
                            let tool_name =
                                block.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                            let input = block
                                .get("input")
                                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                                .unwrap_or_default();
                            counter += 1;
                            let tool_id = block
                                .get("id")
                                .or_else(|| block.get("tool_use_id"))
                                .or_else(|| block.get("toolUseId"))
                                .or_else(|| block.get("tool_useId"))
                                .or_else(|| block.get("toolId"))
                                .or_else(|| block.get("tool_id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let id = if tool_id.is_empty() {
                                format!("claude-tool-{}", counter)
                            } else {
                                tool_id.to_string()
                            };
                            messages.push(ClaudeSessionMessage {
                                id,
                                role: role.to_string(),
                                text: input,
                                images: None,
                                deferred_images: None,
                                timestamp: timestamp.clone(),
                                kind: "tool".to_string(),
                                tool_type: Some(tool_name.to_string()),
                                title: Some(tool_name.to_string()),
                                tool_input: block.get("input").cloned(),
                                tool_output: None,
                                status: None,
                            });
                        }
                        "tool_result" => {
                            let result_content = block
                                .get("content")
                                .and_then(|v| {
                                    if let Some(s) = v.as_str() {
                                        Some(s.to_string())
                                    } else if let Some(arr) = v.as_array() {
                                        // tool_result content can also be an array
                                        let texts: Vec<String> = arr
                                            .iter()
                                            .filter_map(|item| {
                                                if item.get("type").and_then(|t| t.as_str())
                                                    == Some("text")
                                                {
                                                    item.get("text")
                                                        .and_then(|t| t.as_str())
                                                        .map(|s| s.to_string())
                                                } else {
                                                    None
                                                }
                                            })
                                            .collect();
                                        if texts.is_empty() {
                                            None
                                        } else {
                                            Some(texts.join("\n"))
                                        }
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or_default();
                            if !result_content.is_empty() {
                                counter += 1;
                                let tool_use_id = block
                                    .get("tool_use_id")
                                    .or_else(|| block.get("toolUseId"))
                                    .or_else(|| block.get("tool_useId"))
                                    .or_else(|| block.get("toolUseID"))
                                    .or_else(|| block.get("toolId"))
                                    .or_else(|| block.get("tool_id"))
                                    .or_else(|| block.get("id"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let id = if tool_use_id.is_empty() {
                                    format!("claude-toolresult-{}", counter)
                                } else {
                                    format!("{}-result", tool_use_id)
                                };
                                let is_error = block
                                    .get("is_error")
                                    .or_else(|| block.get("isError"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                messages.push(ClaudeSessionMessage {
                                    id,
                                    role: "assistant".to_string(),
                                    text: result_content,
                                    images: None,
                                    deferred_images: None,
                                    timestamp: timestamp.clone(),
                                    kind: "tool".to_string(),
                                    tool_type: Some(if is_error {
                                        "error".to_string()
                                    } else {
                                        "result".to_string()
                                    }),
                                    title: Some(if is_error {
                                        "Error".to_string()
                                    } else {
                                        "Result".to_string()
                                    }),
                                    tool_input: None,
                                    tool_output: entry
                                        .get("toolUseResult")
                                        .cloned()
                                        .or_else(|| block.get("output").cloned()),
                                    status: None,
                                });
                            }
                        }
                        _ => {}
                    }
                }

                // Add accumulated text parts as a message
                if !text_parts.is_empty()
                    || !image_sources.is_empty()
                    || !deferred_images.is_empty()
                {
                    counter += 1;
                    let id = if uuid.is_empty() {
                        format!("claude-msg-{}", counter)
                    } else {
                        uuid.to_string()
                    };
                    messages.push(ClaudeSessionMessage {
                        id,
                        role: role.to_string(),
                        text: text_parts.join("\n\n"),
                        images: if image_sources.is_empty() {
                            None
                        } else {
                            Some(image_sources)
                        },
                        deferred_images: if deferred_images.is_empty() {
                            None
                        } else {
                            Some(deferred_images)
                        },
                        timestamp,
                        kind: "message".to_string(),
                        tool_type: None,
                        title: None,
                        tool_input: None,
                        tool_output: None,
                        status: None,
                    });
                }
            }
            _ => continue,
        }
    }

    Ok(ClaudeSessionLoadResult {
        messages,
        usage: last_usage,
        has_more: None,
        next_cursor: None,
    })
}

pub async fn hydrate_claude_deferred_image_with_config(
    workspace_path: &Path,
    locator: ClaudeDeferredImageLocator,
    config: Option<&EngineConfig>,
) -> Result<ClaudeHydratedImage, String> {
    let normalized_session_id = normalize_session_id(&locator.session_id)?;
    if normalized_session_id != locator.session_id {
        return Err("Invalid Claude deferred image session id".to_string());
    }
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    hydrate_claude_deferred_image_from_base_dir(&base_dir, workspace_path, locator).await
}

pub(crate) async fn hydrate_claude_deferred_image_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    locator: ClaudeDeferredImageLocator,
) -> Result<ClaudeHydratedImage, String> {
    if !is_supported_image_media_type(Some(&locator.media_type)) {
        return Err(format!(
            "Unsupported Claude deferred image media type: {}",
            locator.media_type
        ));
    }

    let session_file = find_claude_session_file(base_dir, workspace_path, &locator.session_id)?;
    let file = fs::File::open(&session_file)
        .await
        .map_err(|error| format!("Failed to open Claude deferred image session file: {error}"))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut current_line_index = 0usize;

    while let Ok(Some(line)) = lines.next_line().await {
        if current_line_index != locator.line_index {
            current_line_index += 1;
            continue;
        }

        let entry: Value = serde_json::from_str(line.trim())
            .map_err(|error| format!("Failed to parse Claude deferred image line: {error}"))?;
        let uuid = entry.get("uuid").and_then(Value::as_str);
        if let Some(expected_message_id) = locator.message_id.as_deref() {
            if uuid != Some(expected_message_id) {
                return Err(
                    "Claude deferred image locator no longer matches message id".to_string()
                );
            }
        }
        let blocks = entry
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                "Claude deferred image locator line has no content blocks".to_string()
            })?;
        let block = blocks
            .get(locator.block_index)
            .ok_or_else(|| "Claude deferred image block no longer exists".to_string())?;
        let source = block
            .get("source")
            .and_then(Value::as_object)
            .ok_or_else(|| "Claude deferred image block has no source".to_string())?;
        let source_type = source
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if source_type != "base64" {
            return Err("Claude deferred image block is not base64 media".to_string());
        }
        let media_type = source
            .get("media_type")
            .and_then(Value::as_str)
            .unwrap_or("image/png")
            .trim()
            .to_string();
        if media_type != locator.media_type || !is_supported_image_media_type(Some(&media_type)) {
            return Err("Claude deferred image media type no longer matches".to_string());
        }
        let payload = source
            .get("data")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Claude deferred image payload is missing".to_string())?;
        if payload.len() > CLAUDE_HYDRATED_IMAGE_BASE64_BYTE_BUDGET {
            return Err("Claude deferred image payload exceeds hydration budget".to_string());
        }
        let byte_size = estimate_base64_decoded_bytes(payload);
        return Ok(ClaudeHydratedImage {
            locator,
            src: format!("data:{};base64,{}", media_type, payload),
            media_type,
            byte_size,
        });
    }

    Err("Claude deferred image locator line no longer exists".to_string())
}

pub async fn fork_claude_session_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<String, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    let source_file = resolve_session_file_path(&base_dir, workspace_path, &normalized_session_id)?;
    let target_dir = source_file
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Invalid session file path".to_string())?;

    let forked_session_id = uuid::Uuid::new_v4().to_string();
    let target_file = target_dir.join(format!("{}.jsonl", forked_session_id));

    let src = fs::File::open(&source_file)
        .await
        .map_err(|e| format!("Failed to open source session file: {}", e))?;
    let mut reader = BufReader::new(src).lines();

    let mut dst = fs::File::create(&target_file)
        .await
        .map_err(|e| format!("Failed to create forked session file: {}", e))?;

    while let Ok(Some(line)) = reader.next_line().await {
        let mut output = line;
        if let Ok(mut json_value) = serde_json::from_str::<Value>(&output) {
            rewrite_session_id_fields(&mut json_value, &normalized_session_id, &forked_session_id);
            output = serde_json::to_string(&json_value)
                .map_err(|e| format!("Failed to serialize forked session entry: {}", e))?;
        }
        dst.write_all(output.as_bytes())
            .await
            .map_err(|e| format!("Failed to write forked session entry: {}", e))?;
        dst.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to finalize forked session entry: {}", e))?;
    }

    dst.flush()
        .await
        .map_err(|e| format!("Failed to flush forked session file: {}", e))?;

    Ok(forked_session_id)
}

/// Fork a Claude session from a specific user message.
///
/// Clones `{session_id}.jsonl` into a new UUID session file, rewriting all
/// `session_id/sessionId` fields, and truncating history before the target user
/// message (exclusive). This preserves rewind semantics as full user+assistant
/// turn rollback. Returns an error when the target message id cannot be found.
async fn fork_claude_session_from_message_in_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
    message_id: &str,
) -> Result<String, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let target_message_id = message_id.trim();
    if target_message_id.is_empty() {
        return Err("message_id is required".to_string());
    }

    let source_file = resolve_session_file_path(base_dir, workspace_path, &normalized_session_id)?;
    let target_dir = source_file
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Invalid session file path".to_string())?;

    let forked_session_id = uuid::Uuid::new_v4().to_string();
    let target_file = target_dir.join(format!("{}.jsonl", forked_session_id));

    let src = fs::File::open(&source_file)
        .await
        .map_err(|e| format!("Failed to open source session file: {}", e))?;
    let mut reader = BufReader::new(src).lines();
    let mut dst = fs::File::create(&target_file)
        .await
        .map_err(|e| format!("Failed to create forked session file: {}", e))?;
    let mut found_target = false;

    while let Ok(Some(line)) = reader.next_line().await {
        let mut output = line;
        if let Ok(mut json_value) = serde_json::from_str::<Value>(&output) {
            if is_target_user_message_entry(&json_value, target_message_id) {
                found_target = true;
                break;
            }
            if matches!(
                classify_claude_history_entry(&json_value),
                ClaudeHistoryEntryClassification::Hidden(_)
            ) {
                continue;
            }
            rewrite_session_id_fields(&mut json_value, &normalized_session_id, &forked_session_id);
            output = serde_json::to_string(&json_value)
                .map_err(|e| format!("Failed to serialize forked session entry: {}", e))?;
        }
        dst.write_all(output.as_bytes())
            .await
            .map_err(|e| format!("Failed to write forked session entry: {}", e))?;
        dst.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to finalize forked session entry: {}", e))?;
    }

    if !found_target {
        let _ = fs::remove_file(&target_file).await;
        return Err(format!(
            "Target user message not found in session {}: {}",
            normalized_session_id, target_message_id
        ));
    }

    dst.flush()
        .await
        .map_err(|e| format!("Failed to flush forked session file: {}", e))?;

    Ok(forked_session_id)
}

pub async fn fork_claude_session_from_message_with_config(
    workspace_path: &Path,
    session_id: &str,
    message_id: &str,
    config: Option<&EngineConfig>,
) -> Result<String, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    fork_claude_session_from_message_in_base_dir(&base_dir, workspace_path, session_id, message_id)
        .await
}

async fn remove_file_if_exists(path: &Path, action: &str) -> Result<bool, String> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to {} {}: {}",
            action,
            path.display(),
            error
        )),
    }
}

async fn remove_dir_if_exists(path: &Path, action: &str) -> Result<bool, String> {
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to {} {}: {}",
            action,
            path.display(),
            error
        )),
    }
}

async fn remove_dir_if_empty(path: &Path) -> Result<(), String> {
    match fs::remove_dir(path).await {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::NotFound | ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(format!(
            "Failed to remove empty Claude subagent directory {}: {}",
            path.display(),
            error
        )),
    }
}

pub async fn delete_claude_session_with_config(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<(), String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    let project_dirs = claude_project_dirs_for_path(&base_dir, workspace_path);

    let mut deleted = false;

    if let Some(subagent_id) = ClaudeSubagentSessionId::parse(&normalized_session_id) {
        for project_dir in project_dirs {
            let transcript_deleted = remove_file_if_exists(
                &subagent_id.transcript_path(&project_dir),
                "delete Claude subagent transcript",
            )
            .await?;
            let meta_deleted = remove_file_if_exists(
                &subagent_id.meta_path(&project_dir),
                "delete Claude subagent metadata",
            )
            .await?;
            deleted |= transcript_deleted || meta_deleted;
            let subagents_dir = project_dir
                .join(&subagent_id.parent_session_id)
                .join("subagents");
            remove_dir_if_empty(&subagents_dir).await?;
            remove_dir_if_empty(&project_dir.join(&subagent_id.parent_session_id)).await?;
        }

        return if deleted {
            Ok(())
        } else {
            Err(format!("Session file not found: {}", normalized_session_id))
        };
    }

    let session_filename = format!("{}.jsonl", normalized_session_id);
    let agent_prefix = format!("agent-{}", normalized_session_id);

    for project_dir in project_dirs {
        // Delete the main session file
        let session_file = project_dir.join(&session_filename);
        deleted |= remove_file_if_exists(&session_file, "delete Claude session file").await?;

        let subagent_parent_dir = project_dir.join(&normalized_session_id);
        deleted |=
            remove_dir_if_exists(&subagent_parent_dir, "delete Claude subagent directory").await?;

        // Also delete any agent-{session_id}*.jsonl subagent files
        if project_dir.exists() {
            if let Ok(mut entries) = fs::read_dir(&project_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.starts_with(&agent_prefix) && name.ends_with(".jsonl") {
                            remove_file_if_exists(
                                &entry.path(),
                                "delete legacy Claude subagent transcript",
                            )
                            .await?;
                        }
                    }
                }
            }
        }
    }

    if deleted {
        Ok(())
    } else {
        Err(format!("Session file not found: {}", normalized_session_id))
    }
}

#[cfg(test)]
#[path = "claude_history_inline_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "claude_history_filter_tests.rs"]
mod filter_tests;

#[cfg(test)]
#[path = "claude_history_fork_tests.rs"]
mod fork_tests;
