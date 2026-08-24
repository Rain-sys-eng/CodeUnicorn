//! Session archive v2：Index First 定位 + metadata-only 结算 + Codex RPC 后台化。
//!
//! Canonical 设计：`openspec/changes/redesign-session-archive-fast-path/`
//!
//! 与旧 `archive_workspace_sessions` 的根本差异：
//! - 定位走 session index（SQLite）点查 / engine 前缀定向，禁止
//!   `SessionCatalogScanMode::Exhaustive` 全量 catalog 扫描；
//! - 结算仅写 catalog metadata 的 `archived_at_by_session_id`（stable key 由
//!   纯函数推导，不依赖 catalog entry），命令同步返回；
//! - Codex `thread/archive` app-server RPC 在 metadata 落盘后 fire-and-forget，
//!   不阻塞返回、不进结果码，未连接的 workspace session 快速跳过。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::codex::WorkspaceSession;
use crate::session_index::store as session_index_store;
use crate::session_management;
use crate::session_management::{
    WorkspaceSessionBatchMutationResponse, WorkspaceSessionBatchMutationResult,
};
use crate::shared::codex_core;
use crate::state::AppState;
use crate::types::WorkspaceEntry;

const CODEX_ARCHIVE_RPC_TIMEOUT: Duration = Duration::from_millis(1_500);

/// 统一归档结果码（canonical 见 OpenSpec change spec）。
pub(crate) mod codes {
    pub const OK: &str = "OK";
    pub const ALREADY_ARCHIVED: &str = "ALREADY_ARCHIVED";
    pub const NOT_ARCHIVED: &str = "NOT_ARCHIVED";
    pub const INVALID_SESSION_ID: &str = "INVALID_SESSION_ID";
    pub const METADATA_WRITE_FAILED: &str = "METADATA_WRITE_FAILED";
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionArchiveV2Target {
    pub thread_id: String,
    #[serde(default)]
    pub engine: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveWorkspaceSessionsV2Request {
    pub workspace_id: String,
    pub targets: Vec<SessionArchiveV2Target>,
}

#[derive(Debug, Clone)]
struct ResolvedArchiveTarget {
    thread_id: String,
    engine: String,
    native_session_id: String,
    owner_workspace_id: String,
    provider_profile_id: Option<String>,
    stable_key: String,
}

fn failure_result(
    thread_id: &str,
    code: &str,
    error: impl Into<String>,
) -> WorkspaceSessionBatchMutationResult {
    WorkspaceSessionBatchMutationResult {
        session_id: thread_id.to_string(),
        stable_session_key: None,
        owner_workspace_id: None,
        ok: false,
        archived_at: None,
        error: Some(error.into()),
        code: Some(code.to_string()),
        deleted_from_disk: None,
        metadata_cleaned: None,
    }
}

fn success_result(
    target: &ResolvedArchiveTarget,
    archived_at: Option<i64>,
    code: &str,
) -> WorkspaceSessionBatchMutationResult {
    WorkspaceSessionBatchMutationResult {
        session_id: target.thread_id.clone(),
        stable_session_key: Some(target.stable_key.clone()),
        owner_workspace_id: Some(target.owner_workspace_id.clone()),
        ok: true,
        archived_at,
        error: None,
        code: Some(code.to_string()),
        deleted_from_disk: None,
        metadata_cleaned: None,
    }
}

/// threadId 前缀解析：`claude:abc` → "claude"；裸 id 返回 None（按 codex 处理）。
fn engine_hint_for(thread_id: &str, explicit_engine: Option<&str>) -> Option<String> {
    let explicit = explicit_engine
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .filter(|engine| {
            !engine.is_empty()
                && (session_index_store::INDEX_LIST_ENGINES.contains(&engine.as_str())
                    || engine == "shared")
        });
    if explicit.is_some() {
        return explicit;
    }
    let (head, rest) = thread_id.split_once(':')?;
    let head = head.trim().to_ascii_lowercase();
    if rest.trim().is_empty() {
        return None;
    }
    if head == "shared" || session_index_store::INDEX_LIST_ENGINES.contains(&head.as_str()) {
        Some(head)
    } else {
        None
    }
}

/// Resolve 阶段：index 点查结果优选 + engine 前缀定向（纯函数，可单测）。
/// archive 不存在 ghost 概念：无法定位时以请求 workspace 为 owner 写 metadata，
/// project scope 的 archive evidence 读取会合并 scope 内全部 workspace metadata。
fn resolve_one_target(
    target: &SessionArchiveV2Target,
    lookups: &[session_index_store::SessionIndexDeleteLookup],
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    requesting_workspace_id: &str,
) -> Result<ResolvedArchiveTarget, Box<WorkspaceSessionBatchMutationResult>> {
    let thread_id = target.thread_id.trim().to_string();
    if thread_id.is_empty() {
        return Err(Box::new(failure_result(
            &target.thread_id,
            codes::INVALID_SESSION_ID,
            "empty session id",
        )));
    }
    let engine_hint = engine_hint_for(&thread_id, target.engine.as_deref());
    let requesting_path = workspaces_snapshot
        .get(requesting_workspace_id)
        .map(|entry| entry.path.clone());

    // index 行优选：engine 匹配 > 未 tombstone > workspace_path 匹配 > updated_at 最新
    let mut candidates: Vec<&session_index_store::SessionIndexDeleteLookup> =
        lookups.iter().collect();
    if let Some(engine) = &engine_hint {
        let engine_matches: Vec<_> = candidates
            .iter()
            .copied()
            .filter(|hit| hit.row.engine.eq_ignore_ascii_case(engine))
            .collect();
        if !engine_matches.is_empty() {
            candidates = engine_matches;
        }
    }
    candidates.sort_by(|left, right| {
        let left_active = left.tombstoned_at.is_none();
        let right_active = right.tombstoned_at.is_none();
        right_active
            .cmp(&left_active)
            .then_with(|| {
                let left_ws = requesting_path.is_some()
                    && left.row.workspace_path.as_ref() == requesting_path.as_ref();
                let right_ws = requesting_path.is_some()
                    && right.row.workspace_path.as_ref() == requesting_path.as_ref();
                right_ws.cmp(&left_ws)
            })
            .then_with(|| right.row.updated_at.cmp(&left.row.updated_at))
    });

    let (engine, native_session_id, owner_workspace_id, provider_profile_id) =
        if let Some(hit) = candidates.first() {
            let row = &hit.row;
            let owner_workspace_id = row
                .workspace_path
                .as_ref()
                .and_then(|path| {
                    workspaces_snapshot
                        .iter()
                        .find(|(_, entry)| entry.path == *path)
                        .map(|(id, _)| id.clone())
                })
                .unwrap_or_else(|| requesting_workspace_id.to_string());
            (
                row.engine.clone(),
                row.session_id.clone(),
                owner_workspace_id,
                row.provider_profile_id.clone(),
            )
        } else {
            let engine = engine_hint.unwrap_or_else(|| {
                session_management::parse_catalog_identity(&thread_id)
                    .engine_name()
                    .to_string()
            });
            (
                engine,
                thread_id.clone(),
                requesting_workspace_id.to_string(),
                None,
            )
        };

    let stable_key =
        session_management::metadata_stable_key_for_session_id(&owner_workspace_id, &thread_id);
    Ok(ResolvedArchiveTarget {
        thread_id,
        engine,
        native_session_id,
        owner_workspace_id,
        provider_profile_id,
        stable_key,
    })
}

/// 按 owner workspace 分组执行一次 metadata mutation；mutation 失败时整组
/// 标记 `METADATA_WRITE_FAILED`。
async fn settle_archive_metadata(
    storage_path: &Path,
    targets: &[ResolvedArchiveTarget],
    archived_at: i64,
) -> Vec<WorkspaceSessionBatchMutationResult> {
    let mut targets_by_owner: HashMap<String, Vec<&ResolvedArchiveTarget>> = HashMap::new();
    for target in targets {
        targets_by_owner
            .entry(target.owner_workspace_id.clone())
            .or_default()
            .push(target);
    }
    let mut results = Vec::new();
    for (owner_workspace_id, bucket) in targets_by_owner {
        let mutation = session_management::with_catalog_metadata_mutation(
            storage_path,
            &owner_workspace_id,
            |metadata| {
                let mut owner_results = Vec::new();
                for target in &bucket {
                    let lookup_keys = session_management::catalog_metadata_lookup_keys_for_session(
                        &owner_workspace_id,
                        &target.thread_id,
                        &target.engine,
                    );
                    let existing = lookup_keys
                        .iter()
                        .find_map(|key| metadata.archived_at_by_session_id.get(key).copied());
                    if let Some(existing_archived_at) = existing {
                        owner_results.push(success_result(
                            target,
                            Some(existing_archived_at),
                            codes::ALREADY_ARCHIVED,
                        ));
                        continue;
                    }
                    metadata
                        .archived_at_by_session_id
                        .insert(target.stable_key.clone(), archived_at);
                    owner_results.push(success_result(target, Some(archived_at), codes::OK));
                }
                Ok(owner_results)
            },
        );
        match mutation {
            Ok(mut owner_results) => results.append(&mut owner_results),
            Err(error) => {
                for target in &bucket {
                    results.push(failure_result(
                        &target.thread_id,
                        codes::METADATA_WRITE_FAILED,
                        format!("failed to update archive metadata: {error}"),
                    ));
                }
            }
        }
    }
    results
}

async fn settle_unarchive_metadata(
    storage_path: &Path,
    targets: &[ResolvedArchiveTarget],
) -> Vec<WorkspaceSessionBatchMutationResult> {
    let mut targets_by_owner: HashMap<String, Vec<&ResolvedArchiveTarget>> = HashMap::new();
    for target in targets {
        targets_by_owner
            .entry(target.owner_workspace_id.clone())
            .or_default()
            .push(target);
    }
    let mut results = Vec::new();
    for (owner_workspace_id, bucket) in targets_by_owner {
        let mutation = session_management::with_catalog_metadata_mutation(
            storage_path,
            &owner_workspace_id,
            |metadata| {
                let mut owner_results = Vec::new();
                for target in &bucket {
                    let lookup_keys = session_management::catalog_metadata_lookup_keys_for_session(
                        &owner_workspace_id,
                        &target.thread_id,
                        &target.engine,
                    );
                    let was_archived = lookup_keys
                        .iter()
                        .any(|key| metadata.archived_at_by_session_id.contains_key(key));
                    if !was_archived {
                        owner_results.push(failure_result(
                            &target.thread_id,
                            codes::NOT_ARCHIVED,
                            "Session is not archived",
                        ));
                        continue;
                    }
                    for key in lookup_keys {
                        metadata.archived_at_by_session_id.remove(&key);
                    }
                    owner_results.push(success_result(target, None, codes::OK));
                }
                Ok(owner_results)
            },
        );
        match mutation {
            Ok(mut owner_results) => results.append(&mut owner_results),
            Err(error) => {
                for target in &bucket {
                    results.push(failure_result(
                        &target.thread_id,
                        codes::METADATA_WRITE_FAILED,
                        format!("failed to update archive metadata: {error}"),
                    ));
                }
            }
        }
    }
    results
}

/// Codex `thread/archive` RPC 后台化：仅对已连接的 workspace session 发送，
/// fire-and-forget，不进结果码。MUST NOT 为归档冷拉起 app-server。
async fn spawn_codex_archive_rpc_background(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    targets: &[ResolvedArchiveTarget],
) {
    let sessions_snapshot = sessions.lock().await;
    for target in targets {
        if !target.engine.eq_ignore_ascii_case("codex") {
            continue;
        }
        let session_key = codex_core::session_key_for_provider(
            &target.owner_workspace_id,
            target.provider_profile_id.as_deref(),
        );
        let Some(session) = sessions_snapshot.get(&session_key).cloned() else {
            continue;
        };
        let native_session_id = target.native_session_id.clone();
        tokio::spawn(async move {
            let params = serde_json::json!({ "threadId": native_session_id.clone() });
            let _ = session
                .send_request_with_timeout("thread/archive", params, CODEX_ARCHIVE_RPC_TIMEOUT)
                .await;
            session
                .clear_thread_effective_mode(&native_session_id)
                .await;
        });
    }
}

type LookupMap = HashMap<String, Vec<session_index_store::SessionIndexDeleteLookup>>;

async fn fetch_lookup_map(lookup_ids: Vec<String>) -> LookupMap {
    tokio::task::spawn_blocking(move || {
        let mut map = HashMap::new();
        if let Ok(connection) = session_index_store::open_connection() {
            for id in lookup_ids {
                let rows = session_index_store::lookup_rows_for_delete(&connection, &id)
                    .unwrap_or_default();
                map.insert(id, rows);
            }
        }
        map
    })
    .await
    .unwrap_or_default()
}

fn resolve_targets(
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    workspace_id: &str,
    targets: &[SessionArchiveV2Target],
    lookups_by_thread_id: &LookupMap,
) -> (
    Vec<ResolvedArchiveTarget>,
    Vec<WorkspaceSessionBatchMutationResult>,
) {
    let mut resolved = Vec::new();
    let mut failures = Vec::new();
    for target in targets {
        let thread_id = target.thread_id.trim().to_string();
        let lookups = lookups_by_thread_id
            .get(&thread_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        match resolve_one_target(target, lookups, workspaces_snapshot, workspace_id) {
            Ok(target) => resolved.push(target),
            Err(result) => failures.push(*result),
        }
    }
    (resolved, failures)
}

fn normalize_targets(
    targets: Vec<SessionArchiveV2Target>,
) -> Result<Vec<SessionArchiveV2Target>, String> {
    let normalized: Vec<SessionArchiveV2Target> = targets
        .into_iter()
        .filter(|target| !target.thread_id.trim().is_empty())
        .collect();
    if normalized.is_empty() {
        return Err("session ids are required".to_string());
    }
    Ok(normalized)
}

async fn ensure_workspace_exists(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<String, String> {
    let workspace_id = session_management::normalize_workspace_id(workspace_id)?;
    let workspaces_snapshot = workspaces.lock().await;
    if !workspaces_snapshot.contains_key(&workspace_id) {
        return Err("workspace not found".to_string());
    }
    Ok(workspace_id)
}

fn lookup_ids_of(targets: &[SessionArchiveV2Target]) -> Vec<String> {
    targets
        .iter()
        .map(|target| target.thread_id.trim().to_string())
        .collect()
}

/// 可注入 lookup 的归档实现：生产路径由 core 先 fetch index，测试直接注入。
pub(crate) async fn archive_workspace_sessions_v2_with_lookups(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    storage_path: &Path,
    workspace_id: String,
    targets: Vec<SessionArchiveV2Target>,
    lookups_by_thread_id: &LookupMap,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let workspace_id = ensure_workspace_exists(workspaces, &workspace_id).await?;
    let targets = normalize_targets(targets)?;
    let archived_at = session_management::now_millis();
    let workspaces_snapshot = workspaces.lock().await.clone();
    let (resolved, mut failures) = resolve_targets(
        &workspaces_snapshot,
        &workspace_id,
        &targets,
        lookups_by_thread_id,
    );
    let mut results = settle_archive_metadata(storage_path, &resolved, archived_at).await;
    let succeeded: Vec<ResolvedArchiveTarget> = resolved
        .into_iter()
        .filter(|target| {
            results
                .iter()
                .any(|result| result.session_id == target.thread_id && result.ok)
        })
        .collect();
    spawn_codex_archive_rpc_background(sessions, &succeeded).await;
    results.append(&mut failures);
    Ok(WorkspaceSessionBatchMutationResponse { results })
}

pub(crate) async fn unarchive_workspace_sessions_v2_with_lookups(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    targets: Vec<SessionArchiveV2Target>,
    lookups_by_thread_id: &LookupMap,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let workspace_id = ensure_workspace_exists(workspaces, &workspace_id).await?;
    let targets = normalize_targets(targets)?;
    let workspaces_snapshot = workspaces.lock().await.clone();
    let (resolved, mut failures) = resolve_targets(
        &workspaces_snapshot,
        &workspace_id,
        &targets,
        lookups_by_thread_id,
    );
    let mut results = settle_unarchive_metadata(storage_path, &resolved).await;
    results.append(&mut failures);
    Ok(WorkspaceSessionBatchMutationResponse { results })
}

pub(crate) async fn archive_workspace_sessions_v2_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    storage_path: &Path,
    workspace_id: String,
    targets: Vec<SessionArchiveV2Target>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let lookup_ids = lookup_ids_of(&targets);
    let lookups = fetch_lookup_map(lookup_ids).await;
    archive_workspace_sessions_v2_with_lookups(
        workspaces,
        sessions,
        storage_path,
        workspace_id,
        targets,
        &lookups,
    )
    .await
}

pub(crate) async fn unarchive_workspace_sessions_v2_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    targets: Vec<SessionArchiveV2Target>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let lookup_ids = lookup_ids_of(&targets);
    let lookups = fetch_lookup_map(lookup_ids).await;
    unarchive_workspace_sessions_v2_with_lookups(
        workspaces,
        storage_path,
        workspace_id,
        targets,
        &lookups,
    )
    .await
}

#[tauri::command]
pub(crate) async fn archive_workspace_sessions_v2(
    request: ArchiveWorkspaceSessionsV2Request,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    archive_workspace_sessions_v2_core(
        &state.workspaces,
        &state.sessions,
        state.storage_path.as_path(),
        request.workspace_id,
        request.targets,
    )
    .await
}

#[tauri::command]
pub(crate) async fn unarchive_workspace_sessions_v2(
    request: ArchiveWorkspaceSessionsV2Request,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    unarchive_workspace_sessions_v2_core(
        &state.workspaces,
        state.storage_path.as_path(),
        request.workspace_id,
        request.targets,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings};

    fn workspace_entry(id: &str, path: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: path.to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn workspaces(entries: Vec<WorkspaceEntry>) -> HashMap<String, WorkspaceEntry> {
        entries
            .into_iter()
            .map(|entry| (entry.id.clone(), entry))
            .collect()
    }

    fn target(thread_id: &str) -> SessionArchiveV2Target {
        SessionArchiveV2Target {
            thread_id: thread_id.to_string(),
            engine: None,
        }
    }

    #[test]
    fn resolve_rejects_empty_id() {
        let snapshot = workspaces(vec![workspace_entry("ws-1", "/repo")]);
        let result = resolve_one_target(&target("  "), &[], &snapshot, "ws-1");
        let error = result.expect_err("empty id must fail");
        assert_eq!(error.code.as_deref(), Some(codes::INVALID_SESSION_ID));
    }

    #[test]
    fn resolve_falls_back_to_requesting_workspace_when_index_misses() {
        let snapshot = workspaces(vec![workspace_entry("ws-1", "/repo")]);
        let resolved = resolve_one_target(&target("claude:abc-1"), &[], &snapshot, "ws-1")
            .expect("prefix fallback");
        assert_eq!(resolved.engine, "claude");
        assert_eq!(resolved.owner_workspace_id, "ws-1");
        assert_eq!(resolved.stable_key, "claude:ws-1:abc-1");
    }

    #[test]
    fn resolve_treats_bare_id_as_codex() {
        let snapshot = workspaces(vec![workspace_entry("ws-1", "/repo")]);
        let resolved = resolve_one_target(&target("uuid-9"), &[], &snapshot, "ws-1")
            .expect("bare id resolves as codex");
        assert_eq!(resolved.engine, "codex");
        assert_eq!(resolved.stable_key, "codex:ws-1:uuid-9");
    }

    #[test]
    fn resolve_uses_index_row_for_owner_and_provider() {
        let snapshot = workspaces(vec![
            workspace_entry("ws-1", "/repo"),
            workspace_entry("ws-2", "/repo/.worktrees/feature"),
        ]);
        let lookups = vec![session_index_store::SessionIndexDeleteLookup {
            row: session_index_store::SessionIndexRow {
                engine: "codex".to_string(),
                session_id: "uuid-9".to_string(),
                title: String::new(),
                native_title: None,
                updated_at: 100,
                created_at: None,
                cwd: None,
                workspace_path: Some("/repo/.worktrees/feature".to_string()),
                physical_path: None,
                parent_session_id: None,
                size_bytes: None,
                provider_profile_id: Some("provider-a".to_string()),
                provider_profile_name: None,
            },
            tombstoned_at: None,
        }];
        let resolved =
            resolve_one_target(&target("uuid-9"), &lookups, &snapshot, "ws-1").expect("index hit");
        assert_eq!(resolved.owner_workspace_id, "ws-2");
        assert_eq!(resolved.provider_profile_id.as_deref(), Some("provider-a"));
        assert_eq!(resolved.native_session_id, "uuid-9");
        assert_eq!(resolved.stable_key, "codex:ws-2:uuid-9");
    }

    #[test]
    fn resolve_prefers_non_tombstoned_row() {
        let snapshot = workspaces(vec![workspace_entry("ws-1", "/repo")]);
        let row = |updated_at: i64| session_index_store::SessionIndexRow {
            engine: "claude".to_string(),
            session_id: "abc-1".to_string(),
            title: String::new(),
            native_title: None,
            updated_at,
            created_at: None,
            cwd: None,
            workspace_path: Some("/repo".to_string()),
            physical_path: None,
            parent_session_id: None,
            size_bytes: None,
            provider_profile_id: None,
            provider_profile_name: None,
        };
        let lookups = vec![
            session_index_store::SessionIndexDeleteLookup {
                row: row(200),
                tombstoned_at: Some(300),
            },
            session_index_store::SessionIndexDeleteLookup {
                row: row(100),
                tombstoned_at: None,
            },
        ];
        let resolved = resolve_one_target(&target("claude:abc-1"), &lookups, &snapshot, "ws-1")
            .expect("resolves");
        assert_eq!(resolved.native_session_id, "abc-1");
    }

    #[test]
    fn engine_hint_prefers_explicit_engine() {
        assert_eq!(
            engine_hint_for("uuid-1", Some("Claude")).as_deref(),
            Some("claude")
        );
        assert_eq!(
            engine_hint_for("shared:s-1", None).as_deref(),
            Some("shared")
        );
        assert_eq!(engine_hint_for("unknown:x", None), None);
        assert_eq!(engine_hint_for("uuid-1", None), None);
    }
}
