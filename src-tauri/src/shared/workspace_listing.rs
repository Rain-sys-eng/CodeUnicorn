use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::backend_budget::{
    estimate_json_payload_bytes, stable_hash, PayloadBudgetMetadata, ScanCache,
    ScanCacheKeySignature, ScanCacheState,
};
use crate::utils::normalize_git_path;

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceFilesResponse {
    pub(crate) files: Vec<String>,
    pub(crate) directories: Vec<String>,
    #[serde(default)]
    pub(crate) gitignored_files: Vec<String>,
    #[serde(default)]
    pub(crate) gitignored_directories: Vec<String>,
    #[serde(default = "default_workspace_scan_state")]
    pub(crate) scan_state: WorkspaceScanState,
    #[serde(default)]
    pub(crate) limit_hit: bool,
    #[serde(default)]
    pub(crate) directory_entries: Vec<WorkspaceDirectoryEntry>,
    #[serde(
        default,
        rename = "listingBudget",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) listing_budget: Option<WorkspaceFileListingBudgetMetadata>,
    #[serde(
        default,
        rename = "sourceVersion",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) source_version: Option<String>,
    #[serde(
        default,
        rename = "payloadBudget",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) payload_budget: Option<PayloadBudgetMetadata>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFileListingBudgetMetadata {
    pub(crate) depth: Option<usize>,
    pub(crate) max_entries: usize,
    pub(crate) returned_entries: usize,
    pub(crate) payload_bytes: usize,
    pub(crate) source_version: String,
    pub(crate) scan_state: WorkspaceScanState,
    pub(crate) limit_hit: bool,
    pub(crate) cache_state: ScanCacheState,
    pub(crate) requested_path: Option<String>,
    pub(crate) partial: bool,
    pub(crate) page_cursor: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceScanState {
    Complete,
    Partial,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceDirectoryChildState {
    Unknown,
    Loaded,
    Empty,
    Partial,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceDirectorySpecialKind {
    Dependency,
    BuildArtifact,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceDirectoryEntry {
    pub(crate) path: String,
    pub(crate) child_state: WorkspaceDirectoryChildState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) special_kind: Option<WorkspaceDirectorySpecialKind>,
    #[serde(default)]
    pub(crate) has_more: bool,
}

fn default_workspace_scan_state() -> WorkspaceScanState {
    WorkspaceScanState::Complete
}

pub(crate) fn workspace_files_response(
    command: &str,
    surface_id: &str,
    requested_path: Option<&str>,
    depth: Option<usize>,
    max_entries: usize,
    cache_state: ScanCacheState,
    files: Vec<String>,
    directories: Vec<String>,
    gitignored_files: Vec<String>,
    gitignored_directories: Vec<String>,
    scan_state: WorkspaceScanState,
    limit_hit: bool,
    directory_entries: Vec<WorkspaceDirectoryEntry>,
) -> WorkspaceFilesResponse {
    let mut response = WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files,
        gitignored_directories,
        scan_state,
        limit_hit,
        directory_entries,
        listing_budget: None,
        source_version: None,
        payload_budget: None,
    };
    let source_version = build_workspace_listing_source_version(&response);
    response.source_version = Some(source_version.clone());
    let payload_bytes = estimate_json_payload_bytes(&response);
    let returned_entries = response.files.len()
        + response.directories.len()
        + response.gitignored_files.len()
        + response.gitignored_directories.len()
        + response.directory_entries.len();
    let partial = scan_state == WorkspaceScanState::Partial || limit_hit;
    response.listing_budget = Some(WorkspaceFileListingBudgetMetadata {
        depth,
        max_entries,
        returned_entries,
        payload_bytes,
        source_version: source_version.clone(),
        scan_state,
        limit_hit,
        cache_state: cache_state.clone(),
        requested_path: requested_path.map(str::to_string),
        partial,
        page_cursor: None,
    });
    response.payload_budget = Some(PayloadBudgetMetadata {
        command: command.to_string(),
        surface_id: surface_id.to_string(),
        item_count: returned_entries,
        estimated_bytes: payload_bytes,
        partial,
        truncated: limit_hit,
        cache_state,
        evidence_class: "measured".to_string(),
    });
    response
}

fn build_workspace_listing_source_version(response: &WorkspaceFilesResponse) -> String {
    let serialized = serde_json::json!({
        "files": &response.files,
        "directories": &response.directories,
        "gitignoredFiles": &response.gitignored_files,
        "gitignoredDirectories": &response.gitignored_directories,
        "scanState": response.scan_state,
        "limitHit": response.limit_hit,
        "directoryEntries": &response.directory_entries,
    });
    stable_hash(&serialized.to_string())
}

pub(crate) fn should_always_skip(name: &str) -> bool {
    name == ".git"
}

pub(crate) fn is_special_dependency_dir_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".pnpm-store"
            | ".yarn"
            | "bower_components"
            | "vendor"
            | ".venv"
            | "venv"
            | "env"
            | "__pypackages__"
            | "Pods"
            | "Carthage"
            | ".m2"
            | ".ivy2"
            | ".cargo"
    )
}

pub(crate) fn is_special_build_artifact_dir_name(name: &str) -> bool {
    matches!(
        name,
        "target"
            | "dist"
            | "build"
            | "out"
            | "coverage"
            | ".next"
            | ".nuxt"
            | ".svelte-kit"
            | ".angular"
            | ".parcel-cache"
            | ".turbo"
            | ".cache"
            | ".gradle"
            | "CMakeFiles"
            | "bin"
            | "obj"
            | "__pycache__"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".tox"
            | ".dart_tool"
            | "temp"
            | "tmp"
            | ".tmp"
    ) || name.starts_with("cmake-build-")
}

pub(crate) fn is_special_directory_path(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .map(|name| {
            is_special_dependency_dir_name(name) || is_special_build_artifact_dir_name(name)
        })
        .unwrap_or(false)
}

pub(crate) fn normalized_relative_to_pathbuf(normalized: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for segment in normalized.split('/') {
        if !segment.is_empty() {
            path.push(segment);
        }
    }
    path
}

fn normalize_workspace_relative_path(
    path: &str,
    empty_message: &str,
    invalid_message: &str,
) -> Result<String, String> {
    let normalized = path.trim().replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return Err(empty_message.to_string());
    }
    let relative = Path::new(trimmed);
    for component in relative.components() {
        match component {
            Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_)
            | Component::CurDir => {
                return Err(invalid_message.to_string());
            }
            Component::Normal(_) => {}
        }
    }
    if trimmed == ".git"
        || trimmed.starts_with(".git/")
        || trimmed.contains("/.git/")
        || trimmed.ends_with("/.git")
    {
        return Err("Cannot access .git directory.".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn normalize_workspace_relative_directory_path(path: &str) -> Result<String, String> {
    if path.is_empty() {
        return Ok(String::new());
    }
    normalize_workspace_relative_path(
        path,
        "Directory path cannot be empty.",
        "Invalid directory path.",
    )
}

pub(crate) fn normalize_workspace_relative_file_path(path: &str) -> Result<String, String> {
    normalize_workspace_relative_path(path, "File path cannot be empty.", "Invalid file path.")
}

/// Canonicalize a path, falling back to the original when the OS cannot
/// resolve a final path. Windows network mounts (RaiDrive/SSHFS) can fail
/// `GetFinalPathNameByHandleW` even though the handle opens.
pub(crate) fn canonicalize_or_original(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

pub(crate) fn sort_and_dedup_workspace_lists(
    files: &mut Vec<String>,
    directories: &mut Vec<String>,
    gitignored_files: &mut Vec<String>,
    gitignored_directories: &mut Vec<String>,
) {
    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    gitignored_files.sort();
    gitignored_files.dedup();
    gitignored_directories.sort();
    gitignored_directories.dedup();
}

pub(crate) fn sort_and_truncate_named_entries<T>(
    entries: &mut Vec<(String, T)>,
    max_entries: usize,
) {
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    if entries.len() > max_entries {
        entries.truncate(max_entries);
    }
}

fn special_directory_kind(path: &str) -> Option<WorkspaceDirectorySpecialKind> {
    let leaf = path.rsplit('/').next().unwrap_or_default();
    if is_special_dependency_dir_name(leaf) {
        return Some(WorkspaceDirectorySpecialKind::Dependency);
    }
    if is_special_build_artifact_dir_name(leaf) {
        return Some(WorkspaceDirectorySpecialKind::BuildArtifact);
    }
    None
}

fn has_known_direct_child(parent: &str, files: &[String], directories: &[String]) -> bool {
    let prefix = format!("{parent}/");
    files.iter().chain(directories.iter()).any(|path| {
        path.strip_prefix(&prefix)
            .is_some_and(|child| !child.is_empty() && !child.contains('/'))
    })
}

pub(crate) fn build_initial_directory_entries(
    files: &[String],
    directories: &[String],
    scan_state: WorkspaceScanState,
) -> Vec<WorkspaceDirectoryEntry> {
    directories
        .iter()
        .map(|path| {
            let special_kind = special_directory_kind(path);
            let child_state = if special_kind.is_some() {
                WorkspaceDirectoryChildState::Unknown
            } else if has_known_direct_child(path, files, directories) {
                match scan_state {
                    WorkspaceScanState::Complete => WorkspaceDirectoryChildState::Loaded,
                    WorkspaceScanState::Partial => WorkspaceDirectoryChildState::Partial,
                }
            } else {
                match scan_state {
                    WorkspaceScanState::Complete => WorkspaceDirectoryChildState::Empty,
                    WorkspaceScanState::Partial => WorkspaceDirectoryChildState::Unknown,
                }
            };
            WorkspaceDirectoryEntry {
                path: path.clone(),
                child_state,
                special_kind,
                has_more: child_state == WorkspaceDirectoryChildState::Partial,
            }
        })
        .collect()
}

pub(crate) fn build_directory_child_entries(
    parent_path: &str,
    files: &[String],
    directories: &[String],
    scan_state: WorkspaceScanState,
) -> Vec<WorkspaceDirectoryEntry> {
    let parent_child_state = match scan_state {
        WorkspaceScanState::Partial => WorkspaceDirectoryChildState::Partial,
        WorkspaceScanState::Complete if files.is_empty() && directories.is_empty() => {
            WorkspaceDirectoryChildState::Empty
        }
        WorkspaceScanState::Complete => WorkspaceDirectoryChildState::Loaded,
    };
    let mut entries = vec![WorkspaceDirectoryEntry {
        path: parent_path.to_string(),
        child_state: parent_child_state,
        special_kind: special_directory_kind(parent_path),
        has_more: scan_state == WorkspaceScanState::Partial,
    }];

    entries.extend(directories.iter().map(|path| WorkspaceDirectoryEntry {
        path: path.clone(),
        child_state: WorkspaceDirectoryChildState::Unknown,
        special_kind: special_directory_kind(path),
        has_more: false,
    }));
    entries
}

const WORKSPACE_SCAN_ENTRY_BUDGET: usize = 30_000;
pub(crate) const WORKSPACE_SCAN_TIME_BUDGET: Duration = Duration::from_millis(1_200);
pub(crate) const WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER: usize = 8;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
enum WorkspaceListingCacheMode {
    Initial,
    DirectoryChildren,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct WorkspaceListingCacheKey {
    root_identity: String,
    mode: WorkspaceListingCacheMode,
    requested_path: Option<String>,
    max_entries: usize,
}

static WORKSPACE_LISTING_CACHE: OnceLock<
    ScanCache<WorkspaceListingCacheKey, WorkspaceFilesResponse>,
> = OnceLock::new();

fn workspace_listing_cache() -> &'static ScanCache<WorkspaceListingCacheKey, WorkspaceFilesResponse>
{
    WORKSPACE_LISTING_CACHE.get_or_init(ScanCache::default)
}

pub(crate) fn workspace_scan_budget_reached(started_at: Instant, scanned_entries: usize) -> bool {
    scanned_entries >= WORKSPACE_SCAN_ENTRY_BUDGET
        || started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET
}

fn workspace_metadata_modified_ms(metadata: &std::fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn workspace_listing_cache_key(
    root_identity: &Path,
    mode: WorkspaceListingCacheMode,
    requested_path: Option<String>,
    max_entries: usize,
) -> WorkspaceListingCacheKey {
    WorkspaceListingCacheKey {
        root_identity: root_identity.to_string_lossy().to_string(),
        mode,
        requested_path,
        max_entries,
    }
}

fn workspace_listing_scan_options(
    mode: &WorkspaceListingCacheMode,
    requested_path: Option<&str>,
    max_entries: usize,
) -> String {
    format!(
        "mode={mode:?};path={};max={max_entries};schema=workspace-files-v1",
        requested_path.unwrap_or("")
    )
}

fn workspace_metadata_signature_part(label: &str, path: &Path) -> String {
    match std::fs::metadata(path) {
        Ok(metadata) => format!(
            "{label}:present:{}:{}",
            metadata.len(),
            workspace_metadata_modified_ms(&metadata)
        ),
        Err(_) => format!("{label}:missing"),
    }
}

fn workspace_gitignore_signature_parts(root: &Path, requested_path: Option<&str>) -> Vec<String> {
    let mut parts = vec![
        workspace_metadata_signature_part("gitignore:root", &root.join(".gitignore")),
        workspace_metadata_signature_part("gitignore:exclude", &root.join(".git/info/exclude")),
    ];
    let Some(requested_path) = requested_path else {
        return parts;
    };
    let mut current = PathBuf::new();
    for segment in requested_path
        .split('/')
        .filter(|segment| !segment.is_empty())
    {
        current.push(segment);
        let label = format!(
            "gitignore:{}",
            normalize_git_path(&current.to_string_lossy())
        );
        parts.push(workspace_metadata_signature_part(
            &label,
            &root.join(&current).join(".gitignore"),
        ));
    }
    parts
}

fn workspace_initial_listing_source_signature(
    root: &Path,
    cached_response: &WorkspaceFilesResponse,
) -> String {
    let mut parts = vec![
        "strategy=initial-directory-metadata-v2".to_string(),
        format!("scan-state={:?}", cached_response.scan_state),
        format!("limit-hit={}", cached_response.limit_hit),
        workspace_metadata_signature_part("root", root),
    ];
    for directory in &cached_response.directories {
        let directory_path = root.join(normalized_relative_to_pathbuf(directory));
        parts.push(workspace_metadata_signature_part(
            &format!("dir:{directory}"),
            &directory_path,
        ));
    }
    for file in &cached_response.files {
        if file.rsplit('/').next() == Some(".gitignore") {
            let file_path = root.join(normalized_relative_to_pathbuf(file));
            parts.push(workspace_metadata_signature_part(
                &format!("gitignore:file:{file}"),
                &file_path,
            ));
        }
    }
    parts.extend(workspace_gitignore_signature_parts(root, None));
    parts.sort();
    stable_hash(&parts.join("|"))
}

fn workspace_directory_listing_source_signature(
    root: &Path,
    directory_path: &Path,
    requested_path: &str,
) -> String {
    let mut parts = vec![
        "strategy=directory-metadata-v2".to_string(),
        workspace_metadata_signature_part("directory", directory_path),
    ];
    parts.extend(workspace_gitignore_signature_parts(
        root,
        Some(requested_path),
    ));
    parts.sort();
    stable_hash(&parts.join("|"))
}

fn workspace_listing_cache_signature(
    root_identity: &Path,
    mode: &WorkspaceListingCacheMode,
    requested_path: Option<&str>,
    max_entries: usize,
    source_signature: String,
) -> ScanCacheKeySignature {
    ScanCacheKeySignature::new(
        &root_identity.to_string_lossy(),
        "workspace-filetree",
        &workspace_listing_scan_options(mode, requested_path, max_entries),
        &source_signature,
    )
}

fn with_workspace_listing_cache_state(
    mut response: WorkspaceFilesResponse,
    cache_state: ScanCacheState,
) -> WorkspaceFilesResponse {
    if let Some(listing_budget) = response.listing_budget.as_mut() {
        listing_budget.cache_state = cache_state.clone();
    }
    if let Some(payload_budget) = response.payload_budget.as_mut() {
        payload_budget.cache_state = cache_state;
    }
    response
}

#[cfg(test)]
pub(crate) fn list_workspace_files_inner(
    root: &PathBuf,
    max_files: usize,
) -> WorkspaceFilesResponse {
    list_workspace_files_inner_with_refresh(root, max_files, false)
}

pub(crate) fn list_workspace_files_inner_with_refresh(
    root: &PathBuf,
    max_files: usize,
    force_refresh: bool,
) -> WorkspaceFilesResponse {
    let canonical_root = canonicalize_or_original(root);
    let mode = WorkspaceListingCacheMode::Initial;
    let cache_key = workspace_listing_cache_key(&canonical_root, mode.clone(), None, max_files);
    if force_refresh {
        workspace_listing_cache().invalidate(&cache_key);
    }
    let (response, evidence) = workspace_listing_cache().get_or_compute_with_signatures(
        cache_key,
        |cached_response| {
            workspace_listing_cache_signature(
                &canonical_root,
                &mode,
                None,
                max_files,
                workspace_initial_listing_source_signature(&canonical_root, cached_response),
            )
        },
        |computed_response| {
            workspace_listing_cache_signature(
                &canonical_root,
                &mode,
                None,
                max_files,
                workspace_initial_listing_source_signature(&canonical_root, computed_response),
            )
        },
        || list_workspace_files_uncached(&canonical_root, max_files),
    );
    with_workspace_listing_cache_state(response, evidence.cache_state)
}

fn list_workspace_files_uncached(root: &PathBuf, max_files: usize) -> WorkspaceFilesResponse {
    let scan_started_at = Instant::now();
    let mut scanned_entries = 0usize;
    let max_directories = max_files.saturating_mul(2).max(1_000);
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut gitignored_files = Vec::new();
    let mut gitignored_directories = Vec::new();
    let mut limit_hit = false;
    let pruned_special_directories: Arc<Mutex<HashSet<String>>> =
        Arc::new(Mutex::new(HashSet::new()));

    let repo = git2::Repository::open(root).ok();

    if let Ok(entries) = std::fs::read_dir(root) {
        let mut root_entries = Vec::new();
        for entry in entries {
            if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
                limit_hit = true;
                break;
            }
            scanned_entries += 1;
            if let Ok(entry) = entry {
                root_entries.push(entry);
            }
        }
        root_entries.sort_by(|a, b| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        });
        for entry in root_entries {
            if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
                limit_hit = true;
                break;
            }
            let path = entry.path();
            let rel_path = match path.strip_prefix(root) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let normalized = normalize_git_path(&rel_path.to_string_lossy());
            if normalized.is_empty() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(rel_path).ok())
                .unwrap_or(false);
            if file_type.is_dir() {
                if should_always_skip(&name) {
                    continue;
                }
                if directories.len() >= max_directories {
                    limit_hit = true;
                    continue;
                }
                directories.push(normalized.clone());
                if is_ignored {
                    gitignored_directories.push(normalized);
                }
            } else if file_type.is_file() {
                if name == ".DS_Store" {
                    continue;
                }
                files.push(normalized.clone());
                if is_ignored {
                    gitignored_files.push(normalized);
                }
                if files.len() >= max_files {
                    sort_and_dedup_workspace_lists(
                        &mut files,
                        &mut directories,
                        &mut gitignored_files,
                        &mut gitignored_directories,
                    );
                    let scan_state = WorkspaceScanState::Partial;
                    let directory_entries =
                        build_initial_directory_entries(&files, &directories, scan_state);
                    return workspace_files_response(
                        "list_workspace_files",
                        "workspaces.file.initial-listing",
                        None,
                        Some(2),
                        max_files,
                        ScanCacheState::Unsupported,
                        files,
                        directories,
                        gitignored_files,
                        gitignored_directories,
                        scan_state,
                        true,
                        directory_entries,
                    );
                }
            }
        }
    }

    let root_for_filter = root.clone();
    let pruned_special_directories_for_filter = Arc::clone(&pruned_special_directories);
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(false)
        .filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                if should_always_skip(&name) {
                    return false;
                }
                if let Ok(rel_path) = entry.path().strip_prefix(&root_for_filter) {
                    let normalized = normalize_git_path(&rel_path.to_string_lossy());
                    if !normalized.is_empty() && is_special_directory_path(&normalized) {
                        if let Ok(mut special_dirs) = pruned_special_directories_for_filter.lock() {
                            special_dirs.insert(normalized);
                        }
                        return false;
                    }
                }
                return true;
            }
            name != ".DS_Store"
        })
        .build();

    for entry in walker {
        if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
            limit_hit = true;
            break;
        }
        scanned_entries += 1;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.depth() <= 1 {
            continue;
        }
        if let Ok(rel_path) = entry.path().strip_prefix(root) {
            let normalized = normalize_git_path(&rel_path.to_string_lossy());
            if normalized.is_empty() {
                continue;
            }
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(rel_path).ok())
                .unwrap_or(false);
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                if directories.len() >= max_directories {
                    limit_hit = true;
                    continue;
                }
                directories.push(normalized.clone());
                if is_ignored {
                    gitignored_directories.push(normalized);
                }
            } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
                files.push(normalized.clone());
                if is_ignored {
                    gitignored_files.push(normalized);
                }
                if files.len() >= max_files {
                    limit_hit = true;
                    break;
                }
            }
        }
    }

    if let Ok(special_dirs) = pruned_special_directories.lock() {
        for normalized in special_dirs.iter() {
            directories.push(normalized.clone());
            let relative_path = normalized_relative_to_pathbuf(normalized);
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(&relative_path).ok())
                .unwrap_or(false);
            if is_ignored {
                gitignored_directories.push(normalized.clone());
            }
        }
    }

    sort_and_dedup_workspace_lists(
        &mut files,
        &mut directories,
        &mut gitignored_files,
        &mut gitignored_directories,
    );
    let scan_state = if limit_hit {
        WorkspaceScanState::Partial
    } else {
        WorkspaceScanState::Complete
    };
    let directory_entries = build_initial_directory_entries(&files, &directories, scan_state);
    workspace_files_response(
        "list_workspace_files",
        "workspaces.file.initial-listing",
        None,
        Some(2),
        max_files,
        ScanCacheState::Unsupported,
        files,
        directories,
        gitignored_files,
        gitignored_directories,
        scan_state,
        limit_hit,
        directory_entries,
    )
}

#[cfg(test)]
pub(crate) fn list_workspace_directory_children_inner(
    root: &PathBuf,
    directory_path: &str,
    max_entries: usize,
) -> Result<WorkspaceFilesResponse, String> {
    list_workspace_directory_children_inner_with_refresh(root, directory_path, max_entries, false)
}

pub(crate) fn list_workspace_directory_children_inner_with_refresh(
    root: &PathBuf,
    directory_path: &str,
    max_entries: usize,
    force_refresh: bool,
) -> Result<WorkspaceFilesResponse, String> {
    let normalized_path = normalize_workspace_relative_directory_path(directory_path)?;
    let canonical_root = canonicalize_or_original(root);
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = canonicalize_or_original(&candidate);
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid directory path.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read directory metadata: {err}"))?;
    if !metadata.is_dir() {
        return Err("Path is not a directory.".to_string());
    }

    let mode = WorkspaceListingCacheMode::DirectoryChildren;
    let cache_key = workspace_listing_cache_key(
        &canonical_root,
        mode.clone(),
        Some(normalized_path.clone()),
        max_entries,
    );
    if force_refresh {
        workspace_listing_cache().invalidate(&cache_key);
    }
    let source_signature = workspace_directory_listing_source_signature(
        &canonical_root,
        &canonical_path,
        &normalized_path,
    );
    let signature = workspace_listing_cache_signature(
        &canonical_root,
        &mode,
        Some(&normalized_path),
        max_entries,
        source_signature,
    );
    let (response, evidence) =
        workspace_listing_cache().get_or_compute(cache_key, signature, || {
            list_workspace_directory_children_uncached(
                &canonical_root,
                &canonical_path,
                &normalized_path,
                max_entries,
            )
        });
    Ok(with_workspace_listing_cache_state(
        response,
        evidence.cache_state,
    ))
}

fn list_workspace_directory_children_uncached(
    canonical_root: &Path,
    canonical_path: &Path,
    normalized_path: &str,
    max_entries: usize,
) -> WorkspaceFilesResponse {
    let include_gitignore_markers = !normalized_path.is_empty();
    let repo = if include_gitignore_markers {
        git2::Repository::open(canonical_root).ok()
    } else {
        None
    };
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut gitignored_files = Vec::new();
    let mut gitignored_directories = Vec::new();

    let entries = match std::fs::read_dir(canonical_path) {
        Ok(entries) => entries,
        Err(_) => {
            let scan_state = WorkspaceScanState::Partial;
            let empty_files = Vec::new();
            let empty_directories = Vec::new();
            return workspace_files_response(
                "list_workspace_directory_children",
                "workspaces.file.subtree-listing",
                Some(normalized_path),
                Some(1),
                max_entries,
                ScanCacheState::Unsupported,
                empty_files,
                empty_directories,
                Vec::new(),
                Vec::new(),
                scan_state,
                true,
                build_directory_child_entries(
                    normalized_path,
                    &Vec::new(),
                    &Vec::new(),
                    scan_state,
                ),
            );
        }
    };
    let scan_started_at = Instant::now();
    let max_scanned_entries = max_entries
        .saturating_mul(WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER)
        .max(max_entries);
    let mut sorted_entries = Vec::new();
    let mut limit_hit = false;
    for entry in entries {
        if scan_started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET {
            limit_hit = true;
            break;
        }
        if sorted_entries.len() >= max_scanned_entries {
            limit_hit = true;
            break;
        }
        if let Ok(entry) = entry {
            sorted_entries.push((entry.file_name().to_string_lossy().to_string(), entry));
        }
    }
    sort_and_truncate_named_entries(&mut sorted_entries, max_scanned_entries);

    for (_, entry) in sorted_entries {
        if scan_started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET {
            limit_hit = true;
            break;
        }
        let path = entry.path();
        let rel_path = match path.strip_prefix(canonical_root) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let is_ignored = if include_gitignore_markers {
            repo.as_ref()
                .and_then(|r| r.status_should_ignore(rel_path).ok())
                .unwrap_or(false)
        } else {
            false
        };

        if file_type.is_dir() {
            if should_always_skip(&name) {
                continue;
            }
            directories.push(normalized.clone());
            if is_ignored {
                gitignored_directories.push(normalized);
            }
        } else if file_type.is_file() {
            if name == ".DS_Store" {
                continue;
            }
            files.push(normalized.clone());
            if is_ignored {
                gitignored_files.push(normalized);
            }
        }

        if files.len() + directories.len() >= max_entries {
            limit_hit = true;
            break;
        }
    }

    sort_and_dedup_workspace_lists(
        &mut files,
        &mut directories,
        &mut gitignored_files,
        &mut gitignored_directories,
    );
    let scan_state = if limit_hit {
        WorkspaceScanState::Partial
    } else {
        WorkspaceScanState::Complete
    };
    let directory_entries =
        build_directory_child_entries(normalized_path, &files, &directories, scan_state);
    workspace_files_response(
        "list_workspace_directory_children",
        "workspaces.file.subtree-listing",
        Some(normalized_path),
        Some(1),
        max_entries,
        ScanCacheState::Unsupported,
        files,
        directories,
        gitignored_files,
        gitignored_directories,
        scan_state,
        limit_hit,
        directory_entries,
    )
}

#[cfg(test)]
mod junk_dir_tests {
    use super::is_special_directory_path;

    #[test]
    fn temp_family_paths_are_special_directories() {
        assert!(is_special_directory_path("service/temp"));
        assert!(is_special_directory_path("apps/web/tmp"));
        assert!(is_special_directory_path("pkg/.tmp"));
        assert!(is_special_directory_path("target"));
        assert!(is_special_directory_path("apps/web/node_modules"));
    }
}

#[cfg(test)]
mod canonicalize_or_original_tests {
    use super::canonicalize_or_original;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn falls_back_to_original_when_path_cannot_be_resolved() {
        let missing = std::env::temp_dir().join(format!(
            "mossx-missing-canonicalize-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        assert!(!missing.exists());
        assert_eq!(canonicalize_or_original(&missing), missing);
    }

    #[test]
    fn returns_canonical_path_when_path_exists() {
        let temp = std::env::temp_dir();
        let canonical = temp.canonicalize().expect("temp dir should canonicalize");
        assert_eq!(canonicalize_or_original(&temp), canonical);
    }
}
