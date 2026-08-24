use super::*;

#[derive(Debug, Clone)]
pub(crate) struct CodexSessionDeleteBatchResult {
    pub(crate) session_id: String,
    pub(crate) deleted: bool,
    pub(crate) deleted_count: usize,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone)]
struct CodexSessionFileInspection {
    path: PathBuf,
    file_stem: String,
    session_ids: HashSet<String>,
    workspace_match: Option<bool>,
}

pub(crate) async fn delete_codex_session_for_workspace(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    session_id: &str,
) -> Result<usize, String> {
    let normalized_session_id = session_id.trim();
    let results =
        delete_codex_sessions_for_workspace(workspaces, workspace_id, &[session_id.to_string()])
            .await?;
    let result = results
        .iter()
        .find(|result| result.session_id == normalized_session_id)
        .ok_or_else(|| {
            format!(
                "codex session delete result missing for session {}",
                normalized_session_id
            )
        })?;
    if let Some(error) = &result.error {
        return Err(error.clone());
    }
    Ok(result.deleted_count)
}

pub(crate) async fn delete_codex_sessions_for_workspace(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    session_ids: &[String],
) -> Result<Vec<CodexSessionDeleteBatchResult>, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    if session_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut normalized_session_ids = Vec::new();
    let mut seen_session_ids = HashSet::new();
    for session_id in session_ids {
        let normalized = session_id.trim();
        if normalized.is_empty() {
            return Err("session_id is required".to_string());
        }
        if is_invalid_session_path_segment(normalized) {
            return Err("invalid session_id".to_string());
        }
        if seen_session_ids.insert(normalized.to_string()) {
            normalized_session_ids.push(normalized.to_string());
        }
    }

    let (workspace_path, sessions_roots) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let workspace_path = PathBuf::from(&entry.path);
        let sessions_roots = resolve_sessions_roots(&workspaces, Some(workspace_path.as_path()));
        (workspace_path, sessions_roots)
    };

    tokio::task::spawn_blocking(move || {
        delete_codex_session_files_batch(
            &normalized_session_ids,
            workspace_path.as_path(),
            &sessions_roots,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

pub(crate) fn collect_matching_codex_session_files(
    session_id: &str,
    workspace_path: &Path,
    sessions_roots: &[PathBuf],
) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for root in sessions_roots {
        collect_jsonl_files(root, &mut files, &mut seen);
    }

    let mut matched_targets = Vec::new();
    let mut unknown_candidates = Vec::new();
    for path in files {
        if !codex_session_file_matches_session_id(&path, session_id)? {
            continue;
        }
        match codex_session_file_matches_workspace(&path, workspace_path)? {
            Some(true) => matched_targets.push(path),
            Some(false) => continue,
            None => unknown_candidates.push(path),
        }
    }

    if matched_targets.is_empty() {
        match unknown_candidates.len() {
            0 => {}
            1 => matched_targets = unknown_candidates,
            count => {
                return Err(format!(
                    "ambiguous codex session files for session {}: {} candidates missing workspace metadata",
                    session_id, count
                ));
            }
        }
    }

    if matched_targets.is_empty() {
        return Err(format!(
            "codex session file not found for session {}",
            session_id
        ));
    }

    Ok(matched_targets)
}

fn inspect_codex_session_file(
    path: &Path,
    workspace_path: &Path,
) -> Result<CodexSessionFileInspection, String> {
    let file = File::open(path).map_err(|err| {
        format!(
            "failed to open codex session file {}: {}",
            path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut session_ids = HashSet::new();
    let mut workspace_match = None;

    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if workspace_match.is_none() {
            if let Some(cwd) = extract_cwd(&value) {
                workspace_match = Some(path_matches_workspace(&cwd, workspace_path));
            }
        }
        if let Some(session_id) = extract_session_id_from_session_value(&value) {
            session_ids.insert(session_id);
        }
    }

    Ok(CodexSessionFileInspection {
        path: path.to_path_buf(),
        file_stem,
        session_ids,
        workspace_match,
    })
}

fn inspection_matches_session_id(
    inspection: &CodexSessionFileInspection,
    session_id: &str,
) -> bool {
    inspection.file_stem == session_id
        || inspection.file_stem.ends_with(&format!("-{session_id}"))
        || inspection.session_ids.contains(session_id)
}

fn delete_codex_session_files_batch(
    session_ids: &[String],
    workspace_path: &Path,
    sessions_roots: &[PathBuf],
) -> Result<Vec<CodexSessionDeleteBatchResult>, String> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for root in sessions_roots {
        collect_jsonl_files(root, &mut files, &mut seen);
    }
    let inspections = files
        .iter()
        .map(|path| inspect_codex_session_file(path, workspace_path))
        .collect::<Result<Vec<_>, _>>()?;

    let mut matches_by_session_id: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let mut results = Vec::new();
    for session_id in session_ids {
        let normalized_session_id = session_id.trim();
        let mut matched_targets = Vec::new();
        let mut unknown_candidates = Vec::new();
        for inspection in &inspections {
            if !inspection_matches_session_id(inspection, normalized_session_id) {
                continue;
            }
            match inspection.workspace_match {
                Some(true) => matched_targets.push(inspection.path.clone()),
                Some(false) => {}
                None => unknown_candidates.push(inspection.path.clone()),
            }
        }

        if matched_targets.is_empty() {
            match unknown_candidates.len() {
                0 => {}
                1 => matched_targets = unknown_candidates,
                count => {
                    results.push(CodexSessionDeleteBatchResult {
                        session_id: normalized_session_id.to_string(),
                        deleted: false,
                        deleted_count: 0,
                        error: Some(format!(
                            "ambiguous codex session files for session {}: {} candidates missing workspace metadata",
                            normalized_session_id, count
                        )),
                    });
                    continue;
                }
            }
        }

        if matched_targets.is_empty() {
            results.push(CodexSessionDeleteBatchResult {
                session_id: normalized_session_id.to_string(),
                deleted: false,
                deleted_count: 0,
                error: Some(format!(
                    "codex session file not found for session {}",
                    normalized_session_id
                )),
            });
            continue;
        }

        matches_by_session_id.insert(normalized_session_id.to_string(), matched_targets);
    }

    let mut deleted_paths = HashSet::new();
    for session_id in session_ids {
        let normalized_session_id = session_id.trim();
        let Some(paths) = matches_by_session_id.get(normalized_session_id) else {
            continue;
        };
        let mut deleted_count = 0;
        let mut delete_error = None;
        for path in paths {
            if deleted_paths.insert(path.clone()) {
                if let Err(err) = fs::remove_file(path) {
                    delete_error = Some(format!(
                        "failed to delete codex session file {}: {}",
                        path.display(),
                        err
                    ));
                    break;
                }
            }
            deleted_count += 1;
        }
        results.push(CodexSessionDeleteBatchResult {
            session_id: normalized_session_id.to_string(),
            deleted: delete_error.is_none() && deleted_count > 0,
            deleted_count: if delete_error.is_none() {
                deleted_count
            } else {
                0
            },
            error: delete_error,
        });
    }

    Ok(results)
}

/// v2 删除链路：按 index 已解析的 physical_path 直接删除 codex 会话文件。
/// 返回 Ok(true) 表示有文件被删除；文件不存在返回 Ok(false)（幂等 ALREADY_MISSING）。
/// 禁止回退到全量收集 + 逐文件解析的旧路径。
pub(crate) fn delete_codex_session_file_at(path: &Path) -> Result<bool, String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "failed to delete codex session file {}: {}",
            path.display(),
            error
        )),
    }
}

/// v2 删除链路：codex 会话文件名快速定位（只读目录项，不打开文件解析内容）。
/// rollout 文件名内嵌 session id 后缀（rollout-<ts>-<uuid>.jsonl），文件名匹配即足够。
pub(crate) fn locate_codex_session_file_fast(
    session_id: &str,
    sessions_roots: &[PathBuf],
) -> Option<PathBuf> {
    let normalized = session_id.trim();
    if normalized.is_empty() || is_invalid_session_path_segment(normalized) {
        return None;
    }
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for root in sessions_roots {
        collect_jsonl_files(root, &mut files, &mut seen);
    }
    let exact = format!("{normalized}.jsonl");
    let suffix = format!("-{normalized}.jsonl");
    files.into_iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == exact || name.ends_with(&suffix))
            .unwrap_or(false)
    })
}

pub(crate) fn codex_session_file_matches_session_id(
    path: &Path,
    session_id: &str,
) -> Result<bool, String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Ok(false);
    }

    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim();
    if file_stem == normalized_session_id
        || file_stem.ends_with(&format!("-{normalized_session_id}"))
    {
        return Ok(true);
    }

    let file = File::open(path).map_err(|err| {
        format!(
            "failed to open codex session file {}: {}",
            path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);
    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if entry_type != "session_meta" {
            continue;
        }
        let payload = value.get("payload").and_then(|value| value.as_object());
        let payload_id = payload
            .and_then(|payload| payload.get("id"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        return Ok(payload_id == normalized_session_id);
    }

    Ok(false)
}

pub(crate) fn codex_session_file_matches_workspace(
    path: &Path,
    workspace_path: &Path,
) -> Result<Option<bool>, String> {
    let file = File::open(path).map_err(|err| {
        format!(
            "failed to open codex session file {}: {}",
            path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if entry_type != "session_meta" && entry_type != "turn_context" {
            continue;
        }
        let Some(cwd) = extract_cwd(&value) else {
            continue;
        };
        return Ok(Some(path_matches_workspace(&cwd, workspace_path)));
    }

    Ok(None)
}
