use std::collections::{HashMap, HashSet};
use std::path::Path;

use tokio::sync::Mutex;

use super::{
    apply_attribution_to_entry, build_catalog_page, build_catalog_scan_mode,
    build_global_engine_catalog_entries, catalog_workspace_scope,
    infer_related_attribution_for_workspace, join_partial_sources, normalize_workspace_id,
    SessionCatalogAttributionStatus, WorkspaceSessionCatalogPage, WorkspaceSessionCatalogQuery,
};
use crate::engine;
use crate::types::WorkspaceEntry;

pub(crate) fn force_codex_related_query(
    query: Option<WorkspaceSessionCatalogQuery>,
) -> WorkspaceSessionCatalogQuery {
    let mut query = query.unwrap_or_default();
    query.engine = Some("codex".to_string());
    query
}

pub(crate) async fn list_project_related_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let workspaces_snapshot = workspaces.lock().await.clone();
    let selected_workspace = workspaces_snapshot
        .get(&workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    let workspace_scope = catalog_workspace_scope(workspaces, &workspace_id).await?;
    let strict_scope_ids = workspace_scope
        .iter()
        .map(|workspace| workspace.id.clone())
        .collect::<HashSet<_>>();

    let normalized_query = query.unwrap_or_default();
    let scan_mode = build_catalog_scan_mode(&normalized_query, cursor.as_deref(), limit);
    let engine_filter = normalized_query
        .engine
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let (global_entries, partial_sources) = build_global_engine_catalog_entries(
        engine_manager,
        workspaces,
        storage_path,
        scan_mode,
        engine_filter.as_deref(),
        normalized_query.scan_quality(),
    )
    .await?;
    let mut related_entries = global_entries
        .into_iter()
        .filter_map(|entry| {
            if strict_scope_ids.contains(&entry.workspace_id) {
                return None;
            }
            let attribution = infer_related_attribution_for_workspace(
                &workspaces_snapshot,
                &selected_workspace,
                &entry,
            )?;
            if attribution.status != SessionCatalogAttributionStatus::InferredRelated {
                return None;
            }
            Some(apply_attribution_to_entry(entry, attribution))
        })
        .collect::<Vec<_>>();
    // 出口过滤：已删除（tombstone）会话不得经 related 扫描复活
    crate::session_management::reject_tombstoned_catalog_entries(&mut related_entries);

    Ok(build_catalog_page(
        related_entries,
        normalized_query,
        cursor,
        limit,
        join_partial_sources(partial_sources),
        Vec::new(),
        Vec::new(),
    ))
}
