use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

mod context_pack;
mod file_classification;
mod path_safety;
mod relation_resolution;

use context_pack::{
    build_relationship_impact_and_context, enrich_context_pack_with_api_contracts,
    enrich_context_pack_with_stale_state, summarize_relationship_stale_state,
};
use file_classification::{
    classify_layer, classify_role, is_builtin_ignored_path, language_for_project_file,
    should_read_project_text_file,
};
use path_safety::validate_relative_relationship_path;
use relation_resolution::{
    build_indexes, build_java_call_resolution_context, build_symbol_file_index,
    c_include_specifier, call_candidates_for_line, dedupe_relations, document_path_mentions,
    evidence, first_quoted_value, import_specifiers, java_declared_type, java_import_specifier,
    java_package_name, parent_dir_text, path_is_inside_dir, project_file_stem, push_relation,
    python_import_specifiers, relationship_symbols_for_file, resolve_call_target,
    resolve_java_call_target, resolve_java_import, resolve_python_import, resolve_relative_import,
    resolve_rust_mod, resolve_rust_use, rust_mod_specifier, rust_use_roots, tauri_command_names,
};

use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::app_paths;
use crate::project_identity::project_storage_key;
use crate::project_map_api_contracts::build_api_contract_artifact;
use crate::state::AppState;
use crate::storage::{with_storage_lock, write_string_atomically};
use crate::types::WorkspaceEntry;

const RELATIONSHIP_REPAIR_SAMPLE_LIMIT: usize = 20;
const RELATIONSHIP_BACKUP_KEEP_COUNT: usize = 2;
const RELATIONSHIP_BACKUP_BUDGET_BYTES: u64 = 200 * 1024 * 1024;
const RELATIONSHIP_BACKUP_DIR_PREFIX: &str = "backup-";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMapRelationshipReadResponse {
    storage_key: String,
    storage_dir: String,
    exists: bool,
    manifest: Option<Value>,
    profile: Option<Value>,
    run: Option<Value>,
    scan: Option<Value>,
    files_manifest: Option<Value>,
    files: Option<Value>,
    relations: Option<Value>,
    relations_by_file: Option<Value>,
    relations_by_type: Option<Value>,
    symbols: Option<Value>,
    modules: Option<Value>,
    impact: Option<Value>,
    context_pack: Option<Value>,
    api_contracts: Option<Value>,
    stale: Option<Value>,
    repair: Option<Value>,
    read_errors: Vec<ProjectMapRelationshipReadError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMapRelationshipReadError {
    path: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMapRelationshipWriteFile {
    relative_path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMapRelationshipScanOptions {
    max_files: Option<usize>,
    include_ignored_hints: Option<bool>,
    paths: Option<Vec<String>>,
    changed_files: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMapRelationshipScanResponse {
    storage_key: String,
    storage_dir: String,
    scan_run_id: String,
    generated_at: String,
    scanned_root: String,
    file_count: usize,
    relation_count: usize,
    api_endpoint_count: usize,
    api_group_count: usize,
    ignored_count: usize,
    repair_issue_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedFile {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) basename: String,
    pub(crate) extension: String,
    pub(crate) language: String,
    pub(crate) layer: String,
    pub(crate) role: String,
    pub(crate) size_bytes: u64,
    pub(crate) line_count: usize,
    pub(crate) content_hash: String,
    pub(crate) parse_status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelationEvidence {
    path: String,
    line: usize,
    excerpt: String,
    extractor_version: String,
    observed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRelation {
    id: String,
    source_file_id: String,
    target_file_id: String,
    relation_type: String,
    #[serde(rename = "type")]
    type_alias: String,
    direction: String,
    confidence: String,
    source_kind: String,
    evidence: Vec<RelationEvidence>,
    fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepairIssue {
    id: String,
    kind: String,
    severity: String,
    message: String,
    file_id: Option<String>,
    relation_id: Option<String>,
    path: Option<String>,
    action: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRelationIndex {
    incoming: Vec<String>,
    outgoing: Vec<String>,
    tests: Vec<String>,
    specs: Vec<String>,
    styles: Vec<String>,
    bridge_targets: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModuleSummary {
    id: String,
    label: String,
    file_ids: Vec<String>,
    file_count: usize,
    relation_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelationshipSymbol {
    id: String,
    file_id: String,
    name: String,
    kind: String,
    language: String,
    line: usize,
}

fn relationship_storage_key(entry: &WorkspaceEntry) -> String {
    project_storage_key(entry)
}

async fn workspace_entry(state: &AppState, workspace_id: &str) -> Result<WorkspaceEntry, String> {
    let workspaces = state.workspaces.lock().await;
    workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| format!("Workspace not found: {workspace_id}"))
}

fn relationship_root_for_mode(
    entry: &WorkspaceEntry,
    storage_mode: Option<&str>,
) -> Result<(String, PathBuf), String> {
    let key = relationship_storage_key(entry);
    let root = match storage_mode {
        Some(mode) if mode.eq_ignore_ascii_case("project") => PathBuf::from(&entry.path)
            .join(".ccgui")
            .join("project-map-relations"),
        Some(mode) if mode.eq_ignore_ascii_case("global") => {
            app_paths::app_home_dir()?.join("project-map-relations")
        }
        Some(mode) => {
            return Err(format!(
                "Invalid project map relationship storage mode: {mode}"
            ));
        }
        None => app_paths::app_home_dir()?.join("project-map-relations"),
    };

    Ok((key.clone(), root.join(key)))
}

fn validate_relationship_snapshot_ownership(
    storage_key: &str,
    files: &[ProjectMapRelationshipWriteFile],
) -> Result<(), String> {
    let mut found_manifest = false;
    let mut found_api_contract_file = false;
    let mut found_api_contract_manifest = false;
    for file in files {
        let relative = validate_relative_relationship_path(&file.relative_path)?;
        if relative != PathBuf::from("manifest.json") {
            let normalized_relative = relative.to_string_lossy().replace('\\', "/");
            let is_api_contract_file = matches!(
                normalized_relative.as_str(),
                "api-contracts/latest.json"
                    | "api-contracts/manifest.json"
                    | "api-contracts/endpoints.json"
                    | "api-contracts/groups.json"
                    | "api-contracts/schemas.json"
                    | "api-contracts/chains.json"
            );
            if is_api_contract_file {
                found_api_contract_file = true;
            }
            if relative == PathBuf::from("api-contracts/manifest.json") {
                found_api_contract_manifest = true;
                validate_api_contract_storage_key_content(
                    storage_key,
                    &file.content,
                    "api-contracts/manifest.json",
                )?;
            }
            if relative == PathBuf::from("api-contracts/latest.json") {
                validate_api_contract_storage_key_content(
                    storage_key,
                    &file.content,
                    "api-contracts/latest.json",
                )?;
            }
            continue;
        }
        found_manifest = true;
        let manifest: Value = serde_json::from_str(&file.content)
            .map_err(|err| format!("Failed to parse project map relationship manifest: {err}"))?;
        let manifest_storage_key = manifest
            .get("storageKey")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "Project map relationship manifest is missing storageKey.".to_string()
            })?;
        if manifest_storage_key != storage_key {
            return Err(format!(
                "Project map relationship manifest ownership mismatch: expected {storage_key}, received {manifest_storage_key}."
            ));
        }
    }
    if !found_manifest {
        return Err("Project map relationship snapshot is missing manifest.json.".to_string());
    }
    if found_api_contract_file && !found_api_contract_manifest {
        return Err(
            "Project map API contract snapshot is missing api-contracts/manifest.json.".to_string(),
        );
    }
    Ok(())
}

fn validate_api_contract_storage_key_content(
    expected_storage_key: &str,
    content: &str,
    label: &str,
) -> Result<(), String> {
    let value: Value =
        serde_json::from_str(content).map_err(|err| format!("Failed to parse {label}: {err}"))?;
    validate_api_contract_storage_key_value(expected_storage_key, &value, label)
}

fn validate_api_contract_storage_key_value(
    expected_storage_key: &str,
    value: &Value,
    label: &str,
) -> Result<(), String> {
    let actual_storage_key = value
        .get("storageKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{label} is missing storageKey."))?;
    if actual_storage_key != expected_storage_key {
        return Err(format!(
            "{label} ownership mismatch: expected {expected_storage_key}, received {actual_storage_key}."
        ));
    }
    Ok(())
}

fn read_api_contracts_with_ownership(
    root: &Path,
    storage_key: &str,
    read_errors: &mut Vec<ProjectMapRelationshipReadError>,
) -> Option<Value> {
    let latest_path = "api-contracts/latest.json";
    let manifest_path = "api-contracts/manifest.json";
    let latest_exists = root.join(latest_path).is_file();
    let manifest_exists = root.join(manifest_path).is_file();

    if latest_exists && !manifest_exists {
        read_errors.push(ProjectMapRelationshipReadError {
            path: manifest_path.to_string(),
            message: "Project map API contract artifact is missing ownership manifest.".to_string(),
        });
        return None;
    }

    let manifest = read_json_with_errors(root, manifest_path, read_errors);
    if let Some(manifest) = manifest.as_ref() {
        if let Err(message) =
            validate_api_contract_storage_key_value(storage_key, manifest, manifest_path)
        {
            read_errors.push(ProjectMapRelationshipReadError {
                path: manifest_path.to_string(),
                message,
            });
            return None;
        }
    }

    let artifact = read_json_with_errors(root, latest_path, read_errors);
    if let Some(artifact) = artifact.as_ref() {
        if let Err(message) =
            validate_api_contract_storage_key_value(storage_key, artifact, latest_path)
        {
            read_errors.push(ProjectMapRelationshipReadError {
                path: latest_path.to_string(),
                message,
            });
            return None;
        }
    }
    artifact
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    with_storage_lock(path, || {
        write_string_atomically(path, content)
            .map_err(|err| format!("Failed to commit project map relationship file: {err}"))
    })
}

fn backup_relationship_files(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }

    let backup_root = root.join("backups").join(format!(
        "backup-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    ));
    for relative in [
        "manifest.json",
        "profile.json",
        "runs/latest.json",
        "scans/latest.json",
        "files/manifest.json",
        "symbols/manifest.json",
        "relations/latest.json",
        "relations/by-file.json",
        "relations/by-type.json",
        "modules/latest.json",
        "impact/latest.json",
        "context-packs/latest.json",
        "api-contracts/latest.json",
        "api-contracts/manifest.json",
        "api-contracts/endpoints.json",
        "api-contracts/groups.json",
        "api-contracts/schemas.json",
        "api-contracts/chains.json",
        "repair/latest.json",
    ] {
        let source = root.join(relative);
        if !source.is_file() {
            continue;
        }
        let target = backup_root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create relationship backup directory: {err}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|err| format!("Failed to copy relationship backup file: {err}"))?;
    }
    Ok(())
}

fn write_relationship_snapshot_files(
    root: &Path,
    storage_key: &str,
    mut files: Vec<ProjectMapRelationshipWriteFile>,
    create_backup_snapshot: bool,
) -> Result<(), String> {
    validate_relationship_snapshot_ownership(storage_key, &files)?;
    files.sort_by_key(|file| file.relative_path == "manifest.json");

    with_storage_lock(root, || {
        fs::create_dir_all(root)
            .map_err(|err| format!("Failed to create project map relationship root: {err}"))?;

        if create_backup_snapshot {
            backup_relationship_files(root)?;
        }

        for file in files {
            let relative = validate_relative_relationship_path(&file.relative_path)?;
            let target = root.join(relative);
            if !target.starts_with(root) {
                return Err("Project map relationship write escaped the storage root.".to_string());
            }
            atomic_write(&target, &file.content)?;
        }

        gc_relationship_backups(root)?;
        Ok(())
    })
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root).ok().map(normalize_path)
}

fn stable_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn content_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn stable_file_id(path: &str) -> String {
    format!("file-{}", stable_hash(&path.to_ascii_lowercase()))
}

fn relation_id(source_file_id: &str, target_file_id: &str, relation_type: &str) -> String {
    let fingerprint = format!("{source_file_id}>{relation_type}>{target_file_id}");
    format!("rel-{}", stable_hash(&fingerprint))
}

fn git_metadata(root: &Path) -> (Option<String>, Option<String>) {
    let Ok(repository) = git2::Repository::discover(root) else {
        return (None, None);
    };
    let git_common_root = repository
        .path()
        .parent()
        .map(|path| path.to_string_lossy().to_string());
    let git_commit_hash = repository
        .head()
        .ok()
        .and_then(|head| head.target())
        .map(|oid| oid.to_string());
    (git_common_root, git_commit_hash)
}

fn git_status_changed_paths(root: &Path) -> Vec<String> {
    let Ok(repository) = git2::Repository::discover(root) else {
        return Vec::new();
    };
    let Some(workdir) = repository.workdir() else {
        return Vec::new();
    };
    let mut options = git2::StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let Ok(statuses) = repository.statuses(Some(&mut options)) else {
        return Vec::new();
    };

    let mut changed_paths = Vec::new();
    for status in statuses.iter() {
        if status.status().contains(git2::Status::IGNORED) {
            continue;
        }
        let Some(relative_to_workdir) = status.path() else {
            continue;
        };
        let absolute_path = workdir.join(relative_to_workdir);
        if let Some(relative_to_scan_root) = relative_path(root, &absolute_path) {
            changed_paths.push(relative_to_scan_root);
        }
    }
    changed_paths.sort();
    changed_paths.dedup();
    changed_paths
}

const IGNORED_HINT_LIMIT: usize = 500;

fn push_ignored_hint(ignored_paths: &mut Vec<Value>, hint: Value) {
    if ignored_paths.len() < IGNORED_HINT_LIMIT {
        ignored_paths.push(hint);
    }
}

fn normalize_requested_scan_path(value: &str) -> Option<String> {
    let trimmed = value.trim().replace('\\', "/");
    if trimmed.is_empty() || trimmed.starts_with('/') {
        return None;
    }
    let mut segments = Vec::new();
    for segment in trimmed.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            segments.pop()?;
            continue;
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        None
    } else {
        Some(segments.join("/"))
    }
}

fn relative_matches_requested_path(relative: &str, requested: &str) -> bool {
    if relative == requested {
        return true;
    }
    match relative.strip_prefix(requested) {
        Some(tail) => tail.starts_with('/'),
        None => false,
    }
}

fn relationship_read_includes_section(include: Option<&[String]>, section: &str) -> bool {
    let Some(sections) = include else {
        return true;
    };
    if sections.is_empty() {
        return true;
    }
    sections.iter().any(|item| {
        item.trim().eq_ignore_ascii_case(section)
            || (section == "relationsByFile" && item.trim() == "relations_by_file")
            || (section == "relationsByType" && item.trim() == "relations_by_type")
            || (section == "contextPack" && item.trim() == "context_pack")
            || (section == "apiContracts" && item.trim() == "api_contracts")
            || (section == "filesManifest" && item.trim() == "files_manifest")
    })
}

fn compact_relationship_repair_value(value: Value) -> Value {
    if value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        >= 2
    {
        return value;
    }

    let generated_at = value
        .get("generatedAt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let issues = value
        .get("issues")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    compact_relationship_repair_from_issues(generated_at, &issues)
}

fn compact_relationship_repair_from_issues(generated_at: String, issues: &[Value]) -> Value {
    let mut by_kind = BTreeMap::<String, usize>::new();
    let mut samples = BTreeMap::<String, Vec<Value>>::new();
    for issue in issues {
        let kind = issue
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        *by_kind.entry(kind.clone()).or_insert(0) += 1;
        let kind_samples = samples.entry(kind).or_default();
        if kind_samples.len() < RELATIONSHIP_REPAIR_SAMPLE_LIMIT {
            kind_samples.push(issue.clone());
        }
    }
    let sample_count = samples.values().map(Vec::len).sum::<usize>();
    json!({
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "issueCount": issues.len(),
        "byKind": by_kind,
        "issues": samples.into_values().flatten().collect::<Vec<_>>(),
        "truncated": sample_count < issues.len()
    })
}

fn compact_relationship_repair_from_structs(
    generated_at: &str,
    issues: &[RepairIssue],
    duplicate_count: usize,
) -> Value {
    let values = issues
        .iter()
        .filter(|issue| issue.kind != "duplicate-relation")
        .map(|issue| {
            json!({
                "id": issue.id,
                "kind": issue.kind,
                "severity": issue.severity,
                "message": issue.message,
                "fileId": issue.file_id,
                "relationId": issue.relation_id,
                "path": issue.path,
                "action": issue.action
            })
        })
        .collect::<Vec<_>>();
    let mut compact = compact_relationship_repair_from_issues(generated_at.to_string(), &values);
    if duplicate_count > 0 {
        if let Some(count) = compact.get("issueCount").and_then(Value::as_u64) {
            compact["issueCount"] = json!(count + duplicate_count as u64);
        }
        compact["byKind"]["duplicate-relation"] = json!(duplicate_count);
        compact["truncated"] = json!(true);
    }
    compact
}

fn parse_relationship_backup_stamp(name: &str) -> Option<&str> {
    let stamp = name.strip_prefix(RELATIONSHIP_BACKUP_DIR_PREFIX)?;
    if stamp.len() != 16 || !stamp.ends_with('Z') {
        return None;
    }
    if stamp[..8].chars().all(|ch| ch.is_ascii_digit())
        && stamp.as_bytes().get(8) == Some(&b'T')
        && stamp[9..15].chars().all(|ch| ch.is_ascii_digit())
    {
        Some(stamp)
    } else {
        None
    }
}

fn directory_size(path: &Path) -> u64 {
    let mut total = 0;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            total += directory_size(&child);
        } else if let Ok(metadata) = entry.metadata() {
            total += metadata.len();
        }
    }
    total
}

fn gc_relationship_backups(root: &Path) -> Result<(), String> {
    let backups_root = root.join("backups");
    if !backups_root.is_dir() {
        return Ok(());
    }
    let mut backups = Vec::new();
    let entries = fs::read_dir(&backups_root)
        .map_err(|err| format!("Failed to list relationship backups: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read relationship backup: {err}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(stamp) = parse_relationship_backup_stamp(name) else {
            continue;
        };
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        backups.push((stamp.to_string(), modified, path));
    }
    backups.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.cmp(&left.1)));

    let mut kept = 0usize;
    let mut kept_bytes = 0u64;
    for (_, _, path) in backups {
        let size = directory_size(&path);
        let over_count = kept >= RELATIONSHIP_BACKUP_KEEP_COUNT;
        let over_budget = kept_bytes + size > RELATIONSHIP_BACKUP_BUDGET_BYTES;
        if over_count || over_budget {
            fs::remove_dir_all(&path).map_err(|err| {
                format!(
                    "Failed to remove expired relationship backup {}: {err}",
                    path.display()
                )
            })?;
            continue;
        }
        kept += 1;
        kept_bytes += size;
    }
    Ok(())
}

fn read_json_with_errors(
    root: &Path,
    relative_path: &str,
    read_errors: &mut Vec<ProjectMapRelationshipReadError>,
) -> Option<Value> {
    let target = root.join(relative_path);
    match fs::read_to_string(&target) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(value) => Some(value),
            Err(error) => {
                read_errors.push(ProjectMapRelationshipReadError {
                    path: relative_path.to_string(),
                    message: format!("Failed to parse project map relationship artifact: {error}"),
                });
                None
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            read_errors.push(ProjectMapRelationshipReadError {
                path: relative_path.to_string(),
                message: format!("Failed to read project map relationship artifact: {error}"),
            });
            None
        }
    }
}

fn scan_workspace(
    entry: &WorkspaceEntry,
    storage_key: &str,
    storage_root: &Path,
    options: ProjectMapRelationshipScanOptions,
) -> Result<ProjectMapRelationshipScanResponse, String> {
    let scan_root = PathBuf::from(&entry.path);
    if !scan_root.is_dir() {
        return Err(format!(
            "Project map relationship scan root is not a directory: {}",
            scan_root.display()
        ));
    }

    let generated_at = chrono::Utc::now().to_rfc3339();
    let scan_run_id = format!("relationship-scan-{}", Uuid::new_v4());
    let max_files = options.max_files.unwrap_or(10_000);
    let include_ignored_hints = options.include_ignored_hints.unwrap_or(true);
    let requested_paths = options
        .paths
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| normalize_requested_scan_path(&path))
        .collect::<Vec<_>>();
    let explicit_changed_paths = options.changed_files.as_ref().map(|paths| {
        paths
            .iter()
            .filter_map(|path| normalize_requested_scan_path(path))
            .collect::<Vec<_>>()
    });

    let mut files = Vec::new();
    let mut file_contents = Vec::new();
    let mut ignored_paths = Vec::new();
    let mut repair_issues = Vec::new();
    let mut walker_builder = ignore::WalkBuilder::new(&scan_root);
    walker_builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true);
    let walker = walker_builder
        .filter_entry(|entry| !is_builtin_ignored_path(entry.path()))
        .build();

    for entry_result in walker {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                if include_ignored_hints {
                    push_ignored_hint(
                        &mut ignored_paths,
                        json!({
                            "path": null,
                            "reason": error.to_string(),
                            "source": "walker-error"
                        }),
                    );
                }
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(relative) = relative_path(&scan_root, path) else {
            continue;
        };
        if !requested_paths.is_empty()
            && !requested_paths
                .iter()
                .any(|requested| relative_matches_requested_path(&relative, requested))
        {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if files.len() >= max_files {
            if include_ignored_hints {
                push_ignored_hint(
                    &mut ignored_paths,
                    json!({
                        "path": relative,
                        "reason": format!("maxFiles limit reached: {max_files}"),
                        "source": "scanner-limit"
                    }),
                );
            }
            break;
        }

        let metadata = fs::metadata(path)
            .map_err(|err| format!("Failed to read metadata for {}: {err}", path.display()))?;
        let basename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();
        let language = language_for_project_file(&relative, &extension).to_string();
        if !should_read_project_text_file(&relative, &extension) {
            files.push(ScannedFile {
                id: stable_file_id(&relative),
                path: relative.clone(),
                basename,
                extension: extension.clone(),
                language,
                layer: classify_layer(&relative, &extension).to_string(),
                role: classify_role(&relative, &extension).to_string(),
                size_bytes: metadata.len(),
                line_count: 0,
                content_hash: stable_hash(&format!("{}:{}", relative, metadata.len())),
                parse_status: "skipped".to_string(),
            });
            continue;
        }
        let content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(error) => {
                let file = ScannedFile {
                    id: stable_file_id(&relative),
                    path: relative.clone(),
                    basename,
                    extension: extension.clone(),
                    language,
                    layer: classify_layer(&relative, &extension).to_string(),
                    role: classify_role(&relative, &extension).to_string(),
                    size_bytes: metadata.len(),
                    line_count: 0,
                    content_hash: String::new(),
                    parse_status: "parse-failed".to_string(),
                };
                repair_issues.push(RepairIssue {
                    id: format!(
                        "repair-{}",
                        stable_hash(&format!("parse-failed:{}", file.path))
                    ),
                    kind: "parse-failed".to_string(),
                    severity: "warning".to_string(),
                    message: format!("Failed to read scan file: {error}"),
                    file_id: Some(file.id.clone()),
                    relation_id: None,
                    path: Some(file.path.clone()),
                    action: "quarantined".to_string(),
                });
                files.push(file);
                continue;
            }
        };
        let file = ScannedFile {
            id: stable_file_id(&relative),
            path: relative.clone(),
            basename,
            extension: extension.clone(),
            language,
            layer: classify_layer(&relative, &extension).to_string(),
            role: classify_role(&relative, &extension).to_string(),
            size_bytes: metadata.len(),
            line_count: content.lines().count(),
            content_hash: content_hash(&content),
            parse_status: "parsed".to_string(),
        };
        file_contents.push((file.clone(), content));
        files.push(file);
    }

    let path_to_file_id = files
        .iter()
        .map(|file| (file.path.clone(), file.id.clone()))
        .collect::<HashMap<_, _>>();
    let file_by_basename = files
        .iter()
        .map(|file| (file.basename.to_ascii_lowercase(), file.id.clone()))
        .collect::<HashMap<_, _>>();
    let mut java_file_by_type = HashMap::new();
    let mut command_file_by_name = HashMap::new();
    let mut relationship_symbols = Vec::new();
    for (file, content) in &file_contents {
        if file.language == "java" {
            if let Some(type_name) = java_declared_type(content) {
                java_file_by_type.insert(type_name.clone(), file.id.clone());
                if let Some(package_name) = java_package_name(content) {
                    java_file_by_type
                        .insert(format!("{package_name}.{type_name}"), file.id.clone());
                }
            }
        }
        if file.language == "rust" {
            for command_name in tauri_command_names(content) {
                command_file_by_name.insert(command_name, file.id.clone());
            }
        }
        relationship_symbols.extend(relationship_symbols_for_file(file, content));
    }
    let symbol_file_by_key = build_symbol_file_index(&files, &relationship_symbols);

    let mut relations = Vec::new();
    for (file, content) in &file_contents {
        let java_call_context = if file.language == "java" {
            Some(build_java_call_resolution_context(
                file,
                content,
                &java_file_by_type,
                &relationship_symbols,
            ))
        } else {
            None
        };
        for (line_index, line) in content.lines().enumerate() {
            let line_number = line_index + 1;
            if matches!(
                file.language.as_str(),
                "typescript" | "javascript" | "vue" | "svelte"
            ) {
                for specifier in import_specifiers(line) {
                    if let Some(target_path) = resolve_relative_import(
                        &scan_root,
                        &file.path,
                        &specifier,
                        &path_to_file_id,
                    ) {
                        if let Some(target_file_id) = path_to_file_id.get(&target_path) {
                            push_relation(
                                &mut relations,
                                "imports",
                                &file.id,
                                target_file_id,
                                "high",
                                evidence(&file.path, line_number, line, &generated_at),
                            );
                        }
                    }
                }
                if line.trim_start().starts_with("export ") {
                    push_relation(
                        &mut relations,
                        "exports",
                        &file.id,
                        &file.id,
                        "medium",
                        evidence(&file.path, line_number, line, &generated_at),
                    );
                }
                if let Some(command_name) =
                    line.split("invoke(").nth(1).and_then(first_quoted_value)
                {
                    if let Some(target_file_id) = command_file_by_name.get(&command_name) {
                        push_relation(
                            &mut relations,
                            "bridges_to",
                            &file.id,
                            target_file_id,
                            "medium",
                            evidence(&file.path, line_number, line, &generated_at),
                        );
                    }
                }
            }
            if matches!(file.language.as_str(), "c" | "cpp") {
                if let Some(specifier) = c_include_specifier(line) {
                    if let Some(target_path) = resolve_relative_import(
                        &scan_root,
                        &file.path,
                        &specifier,
                        &path_to_file_id,
                    ) {
                        if let Some(target_file_id) = path_to_file_id.get(&target_path) {
                            push_relation(
                                &mut relations,
                                "imports",
                                &file.id,
                                target_file_id,
                                "high",
                                evidence(&file.path, line_number, line, &generated_at),
                            );
                        }
                    }
                }
            }
            if file.language == "python" {
                for specifier in python_import_specifiers(line) {
                    if let Some(target_path) =
                        resolve_python_import(&scan_root, &file.path, &specifier, &path_to_file_id)
                    {
                        if let Some(target_file_id) = path_to_file_id.get(&target_path) {
                            push_relation(
                                &mut relations,
                                "imports",
                                &file.id,
                                target_file_id,
                                "medium",
                                evidence(&file.path, line_number, line, &generated_at),
                            );
                        }
                    }
                }
            }
            if file.language == "rust" {
                for specifier in rust_use_roots(line) {
                    if let Some(target_path) =
                        resolve_rust_use(&scan_root, &file.path, &specifier, &path_to_file_id)
                    {
                        if let Some(target_file_id) = path_to_file_id.get(&target_path) {
                            push_relation(
                                &mut relations,
                                "imports",
                                &file.id,
                                target_file_id,
                                "medium",
                                evidence(&file.path, line_number, line, &generated_at),
                            );
                        }
                    }
                }
                if let Some(module_name) = rust_mod_specifier(line) {
                    if let Some(target_path) =
                        resolve_rust_mod(&scan_root, &file.path, &module_name, &path_to_file_id)
                    {
                        if let Some(target_file_id) = path_to_file_id.get(&target_path) {
                            push_relation(
                                &mut relations,
                                "imports",
                                &file.id,
                                target_file_id,
                                "high",
                                evidence(&file.path, line_number, line, &generated_at),
                            );
                        }
                    }
                }
            }
            if file.language == "java" {
                if let Some(import_name) = java_import_specifier(line) {
                    if let Some(target_file_id) =
                        resolve_java_import(&import_name, &java_file_by_type)
                    {
                        push_relation(
                            &mut relations,
                            "imports",
                            &file.id,
                            &target_file_id,
                            "high",
                            evidence(&file.path, line_number, line, &generated_at),
                        );
                    }
                }
            }
            if !matches!(
                file.language.as_str(),
                "markdown" | "json" | "toml" | "yaml" | "xml" | "properties" | "text"
            ) {
                for call_candidate in call_candidates_for_line(line) {
                    let target_file_id = if let Some(java_call_context) = &java_call_context {
                        resolve_java_call_target(&call_candidate, &file.id, java_call_context)
                    } else {
                        resolve_call_target(&call_candidate, &file.id, &symbol_file_by_key)
                    };
                    if let Some(target_file_id) = target_file_id {
                        push_relation(
                            &mut relations,
                            "calls",
                            &file.id,
                            &target_file_id,
                            "medium",
                            evidence(
                                &file.path,
                                line_number,
                                &format!("calls {call_candidate}"),
                                &generated_at,
                            ),
                        );
                    }
                }
            }
            if file.language == "markdown" {
                for mention in document_path_mentions(line) {
                    let target_file_id = path_to_file_id
                        .get(&mention)
                        .or_else(|| file_by_basename.get(&mention.to_ascii_lowercase()));
                    if let Some(target_file_id) = target_file_id {
                        if target_file_id != &file.id {
                            push_relation(
                                &mut relations,
                                "documents",
                                &file.id,
                                target_file_id,
                                "medium",
                                evidence(&file.path, line_number, line, &generated_at),
                            );
                        }
                    }
                }
            }
        }
    }

    for file in &files {
        if file.role == "test" {
            continue;
        }
        let stem = project_file_stem(&file.basename);
        for test_name in [
            format!("{stem}.test.ts"),
            format!("{stem}.test.tsx"),
            format!("{stem}.spec.ts"),
            format!("{stem}.spec.tsx"),
            format!("{stem}test.java"),
            format!("{stem}tests.java"),
            format!("{stem}_test.rs"),
        ] {
            if let Some(test_file_id) = file_by_basename.get(&test_name) {
                push_relation(
                    &mut relations,
                    "tested_by",
                    &file.id,
                    test_file_id,
                    "medium",
                    evidence(
                        &file.path,
                        1,
                        "matched by test filename convention",
                        &generated_at,
                    ),
                );
            }
        }
        for style_name in [format!("{stem}.css"), format!("{stem}.scss")] {
            if let Some(style_file_id) = file_by_basename.get(&style_name) {
                push_relation(
                    &mut relations,
                    "styled_by",
                    &file.id,
                    style_file_id,
                    "medium",
                    evidence(
                        &file.path,
                        1,
                        "matched by style filename convention",
                        &generated_at,
                    ),
                );
            }
        }
    }

    let manifest_files = files
        .iter()
        .filter(|file| file.role == "manifest")
        .collect::<Vec<_>>();
    for manifest in &manifest_files {
        let manifest_dir = parent_dir_text(&manifest.path);
        let mut configured_count = 0usize;
        for target in &files {
            if target.id == manifest.id {
                continue;
            }
            if target.role == "manifest" && path_is_inside_dir(&target.path, &manifest_dir) {
                push_relation(
                    &mut relations,
                    "contains",
                    &manifest.id,
                    &target.id,
                    "medium",
                    evidence(
                        &manifest.path,
                        1,
                        "nested manifest discovered by project layout",
                        &generated_at,
                    ),
                );
            }
            if configured_count >= 120 || !path_is_inside_dir(&target.path, &manifest_dir) {
                continue;
            }
            push_relation(
                &mut relations,
                "configures",
                &manifest.id,
                &target.id,
                "medium",
                evidence(
                    &manifest.path,
                    1,
                    "manifest configures files in the same module",
                    &generated_at,
                ),
            );
            configured_count += 1;
        }
    }

    let mut files_by_stem: BTreeMap<String, Vec<&ScannedFile>> = BTreeMap::new();
    for file in &files {
        let stem = project_file_stem(&file.basename);
        if stem.len() >= 3 {
            files_by_stem.entry(stem).or_default().push(file);
        }
    }
    for related_files in files_by_stem.values() {
        if related_files.len() < 2 || related_files.len() > 8 {
            continue;
        }
        for source_index in 0..related_files.len() {
            for target in related_files.iter().skip(source_index + 1).copied() {
                let source = related_files[source_index];
                if source.id == target.id {
                    continue;
                }
                push_relation(
                    &mut relations,
                    "related",
                    &source.id,
                    &target.id,
                    "low",
                    evidence(
                        &source.path,
                        1,
                        "same-stem project convention",
                        &generated_at,
                    ),
                );
            }
        }
    }

    let (relations, duplicate_count) = dedupe_relations(relations);
    let (by_file, by_type, hotspots, modules) = build_indexes(&files, &relations);
    let (git_common_root, git_commit_hash) = git_metadata(&scan_root);
    let (impact_artifact, mut context_pack_artifact) = build_relationship_impact_and_context(
        &files,
        &relations,
        &hotspots,
        &scan_root,
        explicit_changed_paths.as_deref(),
        &scan_run_id,
        &generated_at,
    );
    let api_contract_artifact = build_api_contract_artifact(
        &file_contents,
        storage_key,
        &scan_run_id,
        &generated_at,
        &ignored_paths,
    );
    context_pack_artifact =
        enrich_context_pack_with_api_contracts(context_pack_artifact, &api_contract_artifact);
    let api_endpoint_count = api_contract_artifact
        .get("endpoints")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let api_group_count = api_contract_artifact
        .get("groups")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let api_endpoints = api_contract_artifact
        .get("endpoints")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let api_groups = api_contract_artifact
        .get("groups")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let api_schemas = api_contract_artifact
        .get("schemas")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let api_chains = api_contract_artifact
        .get("callChains")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let api_adapters = api_contract_artifact
        .get("adapters")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let api_workspace_fingerprint = api_contract_artifact
        .get("workspaceFingerprint")
        .cloned()
        .unwrap_or(Value::Null);
    let api_stale = api_contract_artifact
        .get("stale")
        .cloned()
        .unwrap_or(Value::Null);
    let api_repair = api_contract_artifact
        .get("repair")
        .cloned()
        .unwrap_or(Value::Null);
    let manifest = json!({
        "schemaVersion": 1,
        "storageKey": storage_key,
        "workspaceId": entry.id,
        "workspacePath": entry.path,
        "projectName": entry.name,
        "scannedRoot": normalize_path(&scan_root),
        "gitCommonRoot": git_common_root,
        "gitCommitHash": git_commit_hash,
        "generatedAt": generated_at,
        "scanRunId": scan_run_id,
        "fileCount": files.len(),
        "relationCount": relations.len(),
        "apiEndpointCount": api_endpoint_count,
        "apiGroupCount": api_group_count,
        "apiBranch": {
            "status": "success",
            "endpointCount": api_endpoint_count,
            "groupCount": api_group_count,
            "adapterCount": api_adapters.as_array().map(Vec::len).unwrap_or(0),
            "workspaceFingerprint": api_workspace_fingerprint,
            "stale": api_stale,
            "repair": api_repair
        },
        "ignoredCount": ignored_paths.len(),
        "repairIssueCount": repair_issues.len() + duplicate_count,
        "source": "deterministic-scan"
    });
    let snapshot_files = vec![
        ProjectMapRelationshipWriteFile {
            relative_path: "manifest.json".to_string(),
            content: serde_json::to_string_pretty(&manifest)
                .map_err(|err| format!("Failed to serialize relationship manifest: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "profile.json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "primaryLanguages": files.iter().map(|file| file.language.clone()).collect::<Vec<_>>(),
                "layers": files.iter().map(|file| file.layer.clone()).collect::<Vec<_>>()
            }))
            .map_err(|err| format!("Failed to serialize relationship profile: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "runs/latest.json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "scanRunId": scan_run_id,
                "startedAt": generated_at,
                "completedAt": generated_at,
                "fileCount": files.len(),
                "relationCount": relations.len(),
                "apiEndpointCount": api_endpoint_count,
                "apiGroupCount": api_group_count,
                "apiBranch": {
                    "status": "success",
                    "endpointCount": api_endpoint_count,
                    "groupCount": api_group_count,
                    "adapterCount": api_adapters.as_array().map(Vec::len).unwrap_or(0),
                    "skipped": api_contract_artifact.get("skipped").cloned().unwrap_or_else(|| Value::Array(Vec::new()))
                },
                "ignoredCount": ignored_paths.len()
            }))
            .map_err(|err| format!("Failed to serialize relationship run: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "scans/latest.json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "scanRunId": scan_run_id,
                "options": {
                    "maxFiles": max_files,
                    "requestedPaths": requested_paths,
                    "changedFiles": explicit_changed_paths.clone().unwrap_or_default()
                },
                "ignored": ignored_paths
            }))
            .map_err(|err| format!("Failed to serialize relationship scan: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "files/manifest.json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "chunkCount": 1,
                "fileCount": files.len()
            }))
            .map_err(|err| format!("Failed to serialize relationship files manifest: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "files/chunks-000.json".to_string(),
            content: serde_json::to_string_pretty(&files)
                .map_err(|err| format!("Failed to serialize relationship files chunk: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "symbols/manifest.json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "chunkCount": 1,
                "symbolCount": relationship_symbols.len()
            }))
            .map_err(|err| format!("Failed to serialize relationship symbols manifest: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "symbols/chunks-000.json".to_string(),
            content: serde_json::to_string_pretty(&relationship_symbols)
                .map_err(|err| format!("Failed to serialize relationship symbols chunk: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "relations/latest.json".to_string(),
            content: serde_json::to_string_pretty(&relations)
                .map_err(|err| format!("Failed to serialize relationship relations: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "relations/by-file.json".to_string(),
            content: serde_json::to_string_pretty(&by_file)
                .map_err(|err| format!("Failed to serialize relationship by-file index: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "relations/by-type.json".to_string(),
            content: serde_json::to_string_pretty(&by_type)
                .map_err(|err| format!("Failed to serialize relationship by-type index: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "modules/latest.json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "generatedAt": generated_at,
                "modules": modules,
                "hotspots": hotspots
            }))
                .map_err(|err| format!("Failed to serialize relationship modules: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "impact/latest.json".to_string(),
            content: serde_json::to_string_pretty(&impact_artifact)
            .map_err(|err| format!("Failed to serialize relationship impact: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "context-packs/latest.json".to_string(),
            content: serde_json::to_string_pretty(&context_pack_artifact)
            .map_err(|err| format!("Failed to serialize relationship context pack: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "api-contracts/latest.json".to_string(),
            content: serde_json::to_string_pretty(&api_contract_artifact)
            .map_err(|err| format!("Failed to serialize API contract artifact: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "api-contracts/manifest.json".to_string(),
            content: serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "storageKey": storage_key,
                "workspaceId": entry.id,
                "scanRunId": scan_run_id,
                "generatedAt": generated_at,
                "endpointCount": api_endpoint_count,
                "groupCount": api_group_count,
                "schemaCount": api_schemas.as_array().map(Vec::len).unwrap_or(0),
                "chainCount": api_chains.as_array().map(Vec::len).unwrap_or(0),
                "adapterCount": api_adapters.as_array().map(Vec::len).unwrap_or(0),
                "workspaceFingerprint": api_contract_artifact.get("workspaceFingerprint").cloned().unwrap_or(Value::Null),
                "stale": api_contract_artifact.get("stale").cloned().unwrap_or(Value::Null),
                "repair": api_contract_artifact.get("repair").cloned().unwrap_or(Value::Null),
                "source": "project-map-api-contract-scan"
            }))
            .map_err(|err| format!("Failed to serialize API contract manifest: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "api-contracts/endpoints.json".to_string(),
            content: serde_json::to_string_pretty(&api_endpoints)
            .map_err(|err| format!("Failed to serialize API endpoint index: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "api-contracts/groups.json".to_string(),
            content: serde_json::to_string_pretty(&api_groups)
            .map_err(|err| format!("Failed to serialize API group index: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "api-contracts/schemas.json".to_string(),
            content: serde_json::to_string_pretty(&api_schemas)
            .map_err(|err| format!("Failed to serialize API schema index: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "api-contracts/chains.json".to_string(),
            content: serde_json::to_string_pretty(&api_chains)
            .map_err(|err| format!("Failed to serialize API chain index: {err}"))?,
        },
        ProjectMapRelationshipWriteFile {
            relative_path: "repair/latest.json".to_string(),
            content: serde_json::to_string_pretty(&compact_relationship_repair_from_structs(
                &generated_at,
                &repair_issues,
                duplicate_count,
            ))
            .map_err(|err| format!("Failed to serialize relationship repair summary: {err}"))?,
        },
    ];
    write_relationship_snapshot_files(storage_root, storage_key, snapshot_files, false)?;

    Ok(ProjectMapRelationshipScanResponse {
        storage_key: storage_key.to_string(),
        storage_dir: storage_root.to_string_lossy().to_string(),
        scan_run_id,
        generated_at,
        scanned_root: normalize_path(&scan_root),
        file_count: files.len(),
        relation_count: relations.len(),
        api_endpoint_count,
        api_group_count,
        ignored_count: ignored_paths.len(),
        repair_issue_count: repair_issues.len() + duplicate_count,
    })
}

#[tauri::command]
pub(crate) async fn project_map_relationship_scan(
    workspace_id: String,
    options: Option<ProjectMapRelationshipScanOptions>,
    storage_mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<ProjectMapRelationshipScanResponse, String> {
    let entry = workspace_entry(&state, &workspace_id).await?;
    let (key, root) = relationship_root_for_mode(&entry, storage_mode.as_deref())?;
    let options = options.unwrap_or(ProjectMapRelationshipScanOptions {
        max_files: None,
        include_ignored_hints: None,
        paths: None,
        changed_files: None,
    });

    tokio::task::spawn_blocking(move || scan_workspace(&entry, &key, &root, options))
        .await
        .map_err(|err| format!("Project map relationship scan task failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn project_map_relationship_read(
    workspace_id: String,
    storage_mode: Option<String>,
    include: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<ProjectMapRelationshipReadResponse, String> {
    let entry = workspace_entry(&state, &workspace_id).await?;
    let (key, root) = relationship_root_for_mode(&entry, storage_mode.as_deref())?;
    let include_ref = include.as_deref();
    let exists = root.join("manifest.json").is_file();
    let mut read_errors = Vec::new();
    let want_manifest = relationship_read_includes_section(include_ref, "manifest");
    let want_profile = relationship_read_includes_section(include_ref, "profile");
    let want_run = relationship_read_includes_section(include_ref, "run");
    let want_scan = relationship_read_includes_section(include_ref, "scan");
    let want_files_manifest = relationship_read_includes_section(include_ref, "filesManifest")
        || relationship_read_includes_section(include_ref, "files");
    let want_files = relationship_read_includes_section(include_ref, "files");
    let want_relations = relationship_read_includes_section(include_ref, "relations");
    let want_relations_by_file = relationship_read_includes_section(include_ref, "relationsByFile");
    let want_relations_by_type = relationship_read_includes_section(include_ref, "relationsByType");
    let want_symbols = relationship_read_includes_section(include_ref, "symbols");
    let want_modules = relationship_read_includes_section(include_ref, "modules");
    let want_impact = relationship_read_includes_section(include_ref, "impact");
    let want_context_pack = relationship_read_includes_section(include_ref, "contextPack");
    let want_api_contracts = relationship_read_includes_section(include_ref, "apiContracts");
    let want_stale = relationship_read_includes_section(include_ref, "stale");
    let want_repair = relationship_read_includes_section(include_ref, "repair");

    let manifest = if want_manifest || want_stale {
        read_json_with_errors(&root, "manifest.json", &mut read_errors)
    } else {
        None
    };
    let profile = want_profile
        .then(|| read_json_with_errors(&root, "profile.json", &mut read_errors))
        .flatten();
    let run = want_run
        .then(|| read_json_with_errors(&root, "runs/latest.json", &mut read_errors))
        .flatten();
    let scan = want_scan
        .then(|| read_json_with_errors(&root, "scans/latest.json", &mut read_errors))
        .flatten();
    let files_manifest = want_files_manifest
        .then(|| read_json_with_errors(&root, "files/manifest.json", &mut read_errors))
        .flatten();
    let files = if want_files || want_stale {
        read_json_with_errors(&root, "files/chunks-000.json", &mut read_errors)
    } else {
        None
    };
    let relations = want_relations
        .then(|| read_json_with_errors(&root, "relations/latest.json", &mut read_errors))
        .flatten();
    let relations_by_file = want_relations_by_file
        .then(|| read_json_with_errors(&root, "relations/by-file.json", &mut read_errors))
        .flatten();
    let relations_by_type = want_relations_by_type
        .then(|| read_json_with_errors(&root, "relations/by-type.json", &mut read_errors))
        .flatten();
    let symbols = want_symbols
        .then(|| read_json_with_errors(&root, "symbols/chunks-000.json", &mut read_errors))
        .flatten();
    let modules = want_modules
        .then(|| read_json_with_errors(&root, "modules/latest.json", &mut read_errors))
        .flatten();
    let impact = want_impact
        .then(|| read_json_with_errors(&root, "impact/latest.json", &mut read_errors))
        .flatten();
    let context_pack = want_context_pack
        .then(|| read_json_with_errors(&root, "context-packs/latest.json", &mut read_errors))
        .flatten();
    let api_contracts = want_api_contracts
        .then(|| read_api_contracts_with_ownership(&root, &key, &mut read_errors))
        .flatten();
    let stale = (exists && want_stale)
        .then(|| summarize_relationship_stale_state(Path::new(&entry.path), &manifest, &files));
    let context_pack = if want_context_pack {
        enrich_context_pack_with_stale_state(context_pack, &stale)
    } else {
        None
    };
    let repair = want_repair
        .then(|| {
            read_json_with_errors(&root, "repair/latest.json", &mut read_errors)
                .map(compact_relationship_repair_value)
        })
        .flatten();

    Ok(ProjectMapRelationshipReadResponse {
        storage_key: key,
        storage_dir: root.to_string_lossy().to_string(),
        exists,
        manifest: if want_manifest { manifest } else { None },
        profile,
        run,
        scan,
        files_manifest,
        files: if want_files { files } else { None },
        relations,
        relations_by_file,
        relations_by_type,
        symbols,
        modules,
        impact,
        context_pack,
        api_contracts,
        stale: if want_stale { stale } else { None },
        repair,
        read_errors,
    })
}

#[tauri::command]
pub(crate) async fn project_map_relationship_write_snapshot(
    workspace_id: String,
    files: Vec<ProjectMapRelationshipWriteFile>,
    create_backup: Option<bool>,
    storage_mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let entry = workspace_entry(&state, &workspace_id).await?;
    let (key, root) = relationship_root_for_mode(&entry, storage_mode.as_deref())?;
    write_relationship_snapshot_files(&root, &key, files, create_backup.unwrap_or(false))
}

#[tauri::command]
pub(crate) async fn project_map_relationship_clear(
    workspace_id: String,
    storage_mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let entry = workspace_entry(&state, &workspace_id).await?;
    let (_, root) = relationship_root_for_mode(&entry, storage_mode.as_deref())?;
    with_storage_lock(&root, || {
        if root.exists() {
            fs::remove_dir_all(&root)
                .map_err(|err| format!("Failed to clear project map relationship data: {err}"))?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        compact_relationship_repair_value, gc_relationship_backups,
        parse_relationship_backup_stamp, relationship_read_includes_section,
        validate_relationship_snapshot_ownership, validate_relative_relationship_path,
        ProjectMapRelationshipWriteFile, RELATIONSHIP_BACKUP_DIR_PREFIX,
    };
    use serde_json::json;
    use std::fs;
    use std::time::UNIX_EPOCH;

    #[test]
    fn relationship_write_paths_are_constrained() {
        assert!(validate_relative_relationship_path("manifest.json").is_ok());
        assert!(validate_relative_relationship_path("profile.json").is_ok());
        assert!(validate_relative_relationship_path("runs/latest.json").is_ok());
        assert!(validate_relative_relationship_path("scans/latest.json").is_ok());
        assert!(validate_relative_relationship_path("files/manifest.json").is_ok());
        assert!(validate_relative_relationship_path("files/chunks-000.json").is_ok());
        assert!(validate_relative_relationship_path("symbols/chunks-001.json").is_ok());
        assert!(validate_relative_relationship_path("relations/latest.json").is_ok());
        assert!(validate_relative_relationship_path("relations/by-file.json").is_ok());
        assert!(validate_relative_relationship_path("relations/by-type.json").is_ok());
        assert!(validate_relative_relationship_path("modules/latest.json").is_ok());
        assert!(validate_relative_relationship_path("impact/latest.json").is_ok());
        assert!(validate_relative_relationship_path("context-packs/latest.json").is_ok());
        assert!(validate_relative_relationship_path("api-contracts/latest.json").is_ok());
        assert!(validate_relative_relationship_path("api-contracts/manifest.json").is_ok());
        assert!(validate_relative_relationship_path("api-contracts/endpoints.json").is_ok());
        assert!(validate_relative_relationship_path("api-contracts/groups.json").is_ok());
        assert!(validate_relative_relationship_path("api-contracts/schemas.json").is_ok());
        assert!(validate_relative_relationship_path("api-contracts/chains.json").is_ok());
        assert!(validate_relative_relationship_path("repair/latest.json").is_ok());
        assert!(validate_relative_relationship_path("../manifest.json").is_err());
        assert!(validate_relative_relationship_path("files/../../manifest.json").is_err());
        assert!(validate_relative_relationship_path("files/Chunks-000.json").is_err());
        assert!(validate_relative_relationship_path("relations/archive/latest.json").is_err());
        assert!(validate_relative_relationship_path("relations/con.json").is_err());
        assert!(validate_relative_relationship_path("random.json").is_err());
    }

    #[test]
    fn relationship_snapshot_ownership_requires_matching_manifest() {
        let files = vec![ProjectMapRelationshipWriteFile {
            relative_path: "manifest.json".to_string(),
            content: r#"{"schemaVersion":1,"storageKey":"project-12345678"}"#.to_string(),
        }];

        assert!(validate_relationship_snapshot_ownership("project-12345678", &files).is_ok());
        assert!(validate_relationship_snapshot_ownership("other-12345678", &files).is_err());
        assert!(validate_relationship_snapshot_ownership("project-12345678", &[]).is_err());
    }

    #[test]
    fn relationship_read_include_defaults_to_all_sections() {
        assert!(relationship_read_includes_section(None, "relations"));
        assert!(relationship_read_includes_section(Some(&[]), "repair"));
        assert!(relationship_read_includes_section(
            Some(&["manifest".to_string(), "stale".to_string()]),
            "stale"
        ));
        assert!(!relationship_read_includes_section(
            Some(&["manifest".to_string(), "apiContracts".to_string()]),
            "relations"
        ));
    }

    #[test]
    fn compact_repair_caps_legacy_issue_arrays() {
        let issues = (0..50)
            .map(|index| {
                json!({
                    "id": format!("repair-{index}"),
                    "kind": "duplicate-relation",
                    "severity": "info",
                    "message": "Duplicate deterministic relationship was quarantined.",
                    "action": "quarantined"
                })
            })
            .collect::<Vec<_>>();
        let compact = compact_relationship_repair_value(json!({
            "schemaVersion": 1,
            "generatedAt": "2026-08-12T05:20:05Z",
            "issues": issues
        }));
        assert_eq!(compact["schemaVersion"], 2);
        assert_eq!(compact["issueCount"], 50);
        assert_eq!(compact["byKind"]["duplicate-relation"], 50);
        assert_eq!(compact["issues"].as_array().map(Vec::len), Some(20));
        assert_eq!(compact["truncated"], true);
    }

    #[test]
    fn relationship_backup_stamp_only_matches_utc_directories() {
        assert_eq!(
            parse_relationship_backup_stamp("backup-20260812T052012Z"),
            Some("20260812T052012Z")
        );
        assert!(parse_relationship_backup_stamp("backup-notes").is_none());
        assert!(parse_relationship_backup_stamp("keep-me").is_none());
        assert!(parse_relationship_backup_stamp(&format!(
            "{RELATIONSHIP_BACKUP_DIR_PREFIX}latest"
        ))
        .is_none());
    }

    #[test]
    fn relationship_backup_gc_keeps_newest_two_timestamped_dirs() {
        let root = std::env::temp_dir().join(format!(
            "ccgui-relationship-backup-gc-{}",
            uuid::Uuid::new_v4()
        ));
        let backups = root.join("backups");
        fs::create_dir_all(&backups).expect("create backups");
        for (index, name) in [
            "backup-20260719T153052Z",
            "backup-20260801T080748Z",
            "backup-20260812T052012Z",
            "notes",
        ]
        .into_iter()
        .enumerate()
        {
            let dir = backups.join(name);
            fs::create_dir_all(&dir).expect("create backup dir");
            fs::write(dir.join("manifest.json"), format!("{index}")).expect("write marker");
            let _ = fs::File::open(&dir).and_then(|file| {
                file.set_modified(
                    UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000 + index as u64),
                )
            });
        }
        gc_relationship_backups(&root).expect("gc backups");
        assert!(!backups.join("backup-20260719T153052Z").exists());
        assert!(backups.join("backup-20260801T080748Z").exists());
        assert!(backups.join("backup-20260812T052012Z").exists());
        assert!(backups.join("notes").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
