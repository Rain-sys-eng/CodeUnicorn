use std::fs::File;
use std::io::{Read, Seek};
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::backend_budget::ScanCacheState;
#[cfg(test)]
use crate::shared::workspace_listing::WorkspaceDirectoryChildState;
use crate::shared::workspace_listing::{
    build_initial_directory_entries, canonicalize_or_original, is_special_directory_path,
    normalize_workspace_relative_directory_path, normalize_workspace_relative_file_path,
    normalized_relative_to_pathbuf, should_always_skip, sort_and_truncate_named_entries,
    workspace_files_response, workspace_scan_budget_reached, WorkspaceScanState,
    WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER, WORKSPACE_SCAN_TIME_BUDGET,
};
#[cfg(test)]
pub(crate) use crate::shared::workspace_listing::{
    list_workspace_directory_children_inner, list_workspace_files_inner,
};
pub(crate) use crate::shared::workspace_listing::{
    list_workspace_directory_children_inner_with_refresh, list_workspace_files_inner_with_refresh,
    WorkspaceFilesResponse,
};
use crate::text_encoding::decode_text_bytes;
use crate::utils::normalize_git_path;

fn normalize_workspace_relative_path(path: &str) -> Result<String, String> {
    let normalized = path.trim().replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return Err("Path cannot be empty.".to_string());
    }
    let relative = Path::new(trimmed);
    for component in relative.components() {
        match component {
            Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_)
            | Component::CurDir => {
                return Err("Invalid path.".to_string());
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

fn validate_workspace_item_basename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name cannot be empty.".to_string());
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Invalid item name.".to_string());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("Invalid item name.".to_string());
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err("Invalid item name.".to_string());
    }
    let reserved_windows_name = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    if matches!(
        reserved_windows_name.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        return Err("Invalid item name.".to_string());
    }
    if trimmed == ".git" {
        return Err("Cannot operate on .git directory.".to_string());
    }
    Ok(trimmed.to_string())
}

fn infer_workspace_item_kind(path: &Path) -> Result<WorkspaceFileItemKind, String> {
    let metadata =
        std::fs::metadata(path).map_err(|err| format!("Failed to read path metadata: {err}"))?;
    if metadata.is_dir() {
        return Ok(WorkspaceFileItemKind::Folder);
    }
    if metadata.is_file() {
        return Ok(WorkspaceFileItemKind::File);
    }
    Err("Path is neither a file nor a folder.".to_string())
}

fn resolve_workspace_root(root: &PathBuf) -> Result<PathBuf, String> {
    Ok(canonicalize_or_original(root))
}

fn resolve_workspace_item_path(
    canonical_root: &Path,
    relative_path: &str,
) -> Result<(String, PathBuf, WorkspaceFileItemKind), String> {
    let normalized_path = normalize_workspace_relative_path(relative_path)?;
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = canonicalize_or_original(&candidate);

    if !canonical_path.starts_with(canonical_root) {
        return Err("Invalid file path".to_string());
    }

    let kind = infer_workspace_item_kind(&canonical_path)?;
    Ok((normalized_path, canonical_path, kind))
}

fn resolve_workspace_target_directory(
    canonical_root: &Path,
    relative_path: &str,
) -> Result<(String, PathBuf), String> {
    let normalized_path = normalize_workspace_relative_directory_path(relative_path)?;
    let candidate = if normalized_path.is_empty() {
        canonical_root.to_path_buf()
    } else {
        canonical_root.join(normalized_relative_to_pathbuf(&normalized_path))
    };
    let canonical_path = canonicalize_or_original(&candidate);

    if !canonical_path.starts_with(canonical_root) {
        return Err("Invalid target directory".to_string());
    }
    if !canonical_path.is_dir() {
        return Err("Target path is not a directory.".to_string());
    }

    Ok((normalized_path, canonical_path))
}

fn relative_path_from_absolute(
    canonical_root: &Path,
    absolute_path: &Path,
) -> Result<String, String> {
    let relative = absolute_path
        .strip_prefix(canonical_root)
        .map_err(|_| "Failed to compute relative path".to_string())?;
    Ok(normalize_git_path(&relative.to_string_lossy()))
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceFileItemKind {
    File,
    Folder,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceFileOperationResult {
    pub(crate) path: String,
    pub(crate) kind: WorkspaceFileItemKind,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceTextSearchMatch {
    pub(crate) line: usize,
    pub(crate) column: usize,
    pub(crate) end_column: usize,
    pub(crate) preview: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceTextSearchFileResult {
    pub(crate) path: String,
    pub(crate) match_count: usize,
    pub(crate) matches: Vec<WorkspaceTextSearchMatch>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceTextSearchResponse {
    pub(crate) files: Vec<WorkspaceTextSearchFileResult>,
    pub(crate) file_count: usize,
    pub(crate) match_count: usize,
    pub(crate) limit_hit: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceTextSearchOptions {
    pub(crate) case_sensitive: bool,
    pub(crate) whole_word: bool,
    pub(crate) is_regex: bool,
    pub(crate) include_pattern: Option<String>,
    pub(crate) exclude_pattern: Option<String>,
}

const MAX_SEARCH_MATCHES: usize = 1_000;
const MAX_SEARCH_FILE_BYTES: u64 = 1_024 * 1_024;
const MAX_PREVIEW_CHARS: usize = 180;

fn compile_search_regex(
    query: &str,
    options: &WorkspaceTextSearchOptions,
) -> Result<Regex, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Search query cannot be empty.".to_string());
    }
    let pattern = if options.is_regex {
        trimmed.to_string()
    } else {
        regex::escape(trimmed)
    };
    let pattern = if options.whole_word {
        format!(r"\b(?:{})\b", pattern)
    } else {
        pattern
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|error| format!("Invalid search pattern: {error}"))
}

fn split_glob_patterns(input: Option<&str>) -> Vec<String> {
    input
        .unwrap_or_default()
        .split([',', '\n'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn glob_pattern_to_regex(pattern: &str) -> Result<Regex, String> {
    let normalized = pattern
        .replace('\\', "/")
        .trim()
        .trim_matches('/')
        .to_string();
    if normalized.is_empty() {
        return Err("Glob pattern cannot be empty.".to_string());
    }
    let mut regex_source = String::from("^");
    let chars: Vec<char> = normalized.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        let current = chars[index];
        if current == '*' {
            let has_double = chars.get(index + 1).copied() == Some('*');
            if has_double {
                regex_source.push_str(".*");
                index += 2;
                continue;
            }
            regex_source.push_str("[^/]*");
            index += 1;
            continue;
        }
        if current == '?' {
            regex_source.push_str("[^/]");
            index += 1;
            continue;
        }
        if matches!(
            current,
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | '\\'
        ) {
            regex_source.push('\\');
        }
        regex_source.push(current);
        index += 1;
    }
    regex_source.push('$');
    Regex::new(&regex_source).map_err(|error| format!("Invalid glob pattern `{pattern}`: {error}"))
}

fn compile_glob_patterns(input: Option<&str>) -> Result<Vec<Regex>, String> {
    split_glob_patterns(input)
        .into_iter()
        .map(|pattern| glob_pattern_to_regex(&pattern))
        .collect()
}

fn path_matches_patterns(path: &str, patterns: &[Regex]) -> bool {
    patterns.iter().any(|pattern| pattern.is_match(path))
}

fn build_preview(line: &str, start: usize, end: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= MAX_PREVIEW_CHARS {
        return line.trim().to_string();
    }
    let start_char = line[..start].chars().count();
    let end_char = line[..end].chars().count();
    let context = MAX_PREVIEW_CHARS / 2;
    let slice_start = start_char.saturating_sub(context / 2);
    let slice_end = (end_char + context).min(chars.len());
    let mut preview = chars[slice_start..slice_end].iter().collect::<String>();
    if slice_start > 0 {
        preview = format!("…{preview}");
    }
    if slice_end < chars.len() {
        preview.push('…');
    }
    preview.trim().to_string()
}

pub(crate) fn search_workspace_text_inner(
    root: &PathBuf,
    query: &str,
    options: &WorkspaceTextSearchOptions,
) -> Result<WorkspaceTextSearchResponse, String> {
    let regex = compile_search_regex(query, options)?;
    let include_patterns = compile_glob_patterns(options.include_pattern.as_deref())?;
    let exclude_patterns = compile_glob_patterns(options.exclude_pattern.as_deref())?;
    let root_for_filter = root.clone();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
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
                        return false;
                    }
                }
            }
            name != ".DS_Store"
        })
        .build();

    let mut files = Vec::new();
    let mut total_files = 0usize;
    let mut total_matches = 0usize;
    let mut limit_hit = false;

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let rel_path = match entry.path().strip_prefix(root) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        if !include_patterns.is_empty() && !path_matches_patterns(&normalized, &include_patterns) {
            continue;
        }
        if !exclude_patterns.is_empty() && path_matches_patterns(&normalized, &exclude_patterns) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.len() > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        let bytes = match std::fs::read(entry.path()) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.contains(&0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let mut file_matches = Vec::new();
        let mut file_match_count = 0usize;
        for (line_index, line) in content.lines().enumerate() {
            for capture in regex.find_iter(line) {
                file_match_count += 1;
                total_matches += 1;
                if file_matches.len() < 50 {
                    file_matches.push(WorkspaceTextSearchMatch {
                        line: line_index + 1,
                        column: line[..capture.start()].chars().count() + 1,
                        end_column: line[..capture.end()].chars().count() + 1,
                        preview: build_preview(line, capture.start(), capture.end()),
                    });
                }
                if total_matches >= MAX_SEARCH_MATCHES {
                    limit_hit = true;
                    break;
                }
            }
            if limit_hit {
                break;
            }
        }
        if file_match_count > 0 {
            total_files += 1;
            files.push(WorkspaceTextSearchFileResult {
                path: normalized,
                match_count: file_match_count,
                matches: file_matches,
            });
        }
        if limit_hit {
            break;
        }
    }

    Ok(WorkspaceTextSearchResponse {
        files,
        file_count: total_files,
        match_count: total_matches,
        limit_hit,
    })
}

pub(crate) fn list_external_absolute_directory_children_inner(
    absolute_directory_path: &str,
    allowed_roots: &[PathBuf],
    max_entries: usize,
) -> Result<WorkspaceFilesResponse, String> {
    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_directory_path,
        allowed_roots,
        "directory",
        "Invalid directory path.",
    )?;

    let entries = std::fs::read_dir(&canonical_path)
        .map_err(|err| format!("Failed to read directory: {err}"))?;
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

    let mut files = Vec::new();
    let mut directories = Vec::new();
    for (name, entry) in sorted_entries {
        let path = entry.path();
        let normalized = normalize_git_path(&path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            if should_always_skip(&name) {
                continue;
            }
            directories.push(normalized);
        } else if file_type.is_file() {
            if name == ".DS_Store" {
                continue;
            }
            files.push(normalized);
        }

        if files.len() + directories.len() >= max_entries {
            limit_hit = true;
            break;
        }
    }

    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    let scan_state = if limit_hit {
        WorkspaceScanState::Partial
    } else {
        WorkspaceScanState::Complete
    };
    Ok(workspace_files_response(
        "list_external_absolute_directory_children",
        "workspaces.file.external-subtree-listing",
        Some(absolute_directory_path),
        Some(1),
        max_entries,
        ScanCacheState::Unsupported,
        files,
        directories,
        Vec::new(),
        Vec::new(),
        scan_state,
        limit_hit,
        Vec::new(),
    ))
}

const MAX_WORKSPACE_FILE_BYTES: u64 = 400_000;
const MAX_WORKSPACE_PREVIEW_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceFileResponse {
    content: String,
    truncated: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePreviewHandleResponse {
    pub(crate) absolute_path: String,
    pub(crate) byte_length: u64,
    pub(crate) extension: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct ExternalSpecFileResponse {
    pub(crate) exists: bool,
    pub(crate) content: String,
    pub(crate) truncated: bool,
}

fn normalize_external_spec_root(spec_root: &str) -> Result<PathBuf, String> {
    let trimmed = spec_root.trim();
    if trimmed.is_empty() {
        return Err("Spec root cannot be empty.".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_absolute() {
        return Err("Spec root must be an absolute path.".to_string());
    }
    let canonical = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
    if !canonical.is_dir() {
        return Err("Custom spec root is not a directory.".to_string());
    }
    Ok(canonical)
}

struct ResolvedExternalSpecRoot {
    root: PathBuf,
    exists: bool,
}

fn resolve_external_spec_root(spec_root: &str) -> Result<ResolvedExternalSpecRoot, String> {
    let custom_root = normalize_external_spec_root(spec_root)?;
    let file_name = custom_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case("openspec") {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    let nested = custom_root.join("openspec");
    if nested.is_dir() {
        let canonical_nested = nested
            .canonicalize()
            .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
        return Ok(ResolvedExternalSpecRoot {
            root: canonical_nested,
            exists: true,
        });
    }

    // Backward compatibility: older clients may pass the openspec root directly
    // even if directory name is not literally `openspec`.
    let legacy_root = custom_root.join("changes").is_dir() && custom_root.join("specs").is_dir();
    if legacy_root {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    Ok(ResolvedExternalSpecRoot {
        root: nested,
        exists: false,
    })
}

fn resolve_external_spec_logical_path(
    spec_root: &Path,
    logical_path: &str,
) -> Result<PathBuf, String> {
    let normalized = logical_path.trim().replace('\\', "/");
    if normalized == "openspec" {
        return Ok(spec_root.to_path_buf());
    }
    if !normalized.starts_with("openspec/") {
        return Err("External spec path must be under openspec/.".to_string());
    }
    let suffix = normalized["openspec/".len()..].trim();
    if suffix.is_empty() {
        return Ok(spec_root.to_path_buf());
    }
    let relative = Path::new(suffix);
    for component in relative.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid external spec path.".to_string());
            }
            _ => {}
        }
    }
    Ok(spec_root.join(relative))
}

pub(crate) fn list_external_spec_tree_inner(
    spec_root: &str,
    max_files: usize,
) -> Result<WorkspaceFilesResponse, String> {
    // External spec probing is a pre-send path for some flows; keep it bounded
    // so deep trees cannot stall the first-turn UX.
    const EXTERNAL_SPEC_TREE_MAX_FILES: usize = 8_000;
    let resolved = resolve_external_spec_root(spec_root)?;
    let effective_max_files = max_files.min(EXTERNAL_SPEC_TREE_MAX_FILES).max(1);
    let max_directories = effective_max_files.saturating_mul(2).max(1_000);
    let scan_started_at = Instant::now();
    let mut scanned_entries = 0usize;
    let mut files = Vec::new();
    let mut directories = vec!["openspec".to_string()];
    let mut limit_hit = false;
    if !resolved.exists {
        let directory_entries =
            build_initial_directory_entries(&files, &directories, WorkspaceScanState::Complete);
        return Ok(workspace_files_response(
            "list_external_spec_tree",
            "workspaces.file.external-spec-listing",
            None,
            Some(2),
            effective_max_files,
            ScanCacheState::Unsupported,
            files,
            directories,
            Vec::new(),
            Vec::new(),
            WorkspaceScanState::Complete,
            false,
            directory_entries,
        ));
    }
    let root = resolved.root;

    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                return !should_always_skip(&name);
            }
            name != ".DS_Store"
        })
        .build();

    for entry in walker {
        if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
            limit_hit = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        scanned_entries = scanned_entries.saturating_add(1);
        let rel_path = match entry.path().strip_prefix(&root) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let logical = format!("openspec/{normalized}");
        if entry.file_type().is_some_and(|ft| ft.is_dir()) {
            if directories.len() < max_directories {
                directories.push(logical);
            } else {
                limit_hit = true;
            }
        } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
            files.push(logical);
            if files.len() >= effective_max_files {
                limit_hit = true;
                break;
            }
        }
    }

    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    let scan_state = if limit_hit {
        WorkspaceScanState::Partial
    } else {
        WorkspaceScanState::Complete
    };
    let directory_entries = build_initial_directory_entries(&files, &directories, scan_state);
    Ok(workspace_files_response(
        "list_external_spec_tree",
        "workspaces.file.external-spec-listing",
        None,
        Some(2),
        effective_max_files,
        ScanCacheState::Unsupported,
        files,
        directories,
        Vec::new(),
        Vec::new(),
        scan_state,
        limit_hit,
        directory_entries,
    ))
}

pub(crate) fn read_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
) -> Result<ExternalSpecFileResponse, String> {
    let resolved = resolve_external_spec_root(spec_root)?;
    if !resolved.exists {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if !candidate.exists() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve external spec file: {err}"))?;
    if !canonical_path.starts_with(&root) {
        return Err("Invalid external spec file path.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read external spec file metadata: {err}"))?;
    if !metadata.is_file() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }

    let file = File::open(&canonical_path)
        .map_err(|err| format!("Failed to open external spec file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read external spec file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }
    let content = decode_text_bytes(&buffer, "External spec file")?;
    Ok(ExternalSpecFileResponse {
        exists: true,
        content,
        truncated,
    })
}

pub(crate) fn write_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
    content: &str,
) -> Result<(), String> {
    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }
    let resolved = resolve_external_spec_root(spec_root)?;
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if candidate == root {
        return Err("Cannot write to external spec root directory directly.".to_string());
    }

    let normalized = logical_path.replace('\\', "/");
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.ends_with("/.git")
    {
        return Err("Cannot write to .git directory".to_string());
    }

    if let Some(parent) = candidate.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create external spec parent directory: {err}"))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec root: {err}"))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec parent directory: {err}"))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid external spec file path.".to_string());
        }
    } else {
        return Err("Invalid external spec file path.".to_string());
    }

    std::fs::write(&candidate, content)
        .map_err(|err| format!("Failed to write external spec file: {err}"))?;
    Ok(())
}

pub(crate) fn read_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileResponse, String> {
    read_workspace_file_with_limit_inner(root, relative_path, MAX_WORKSPACE_FILE_BYTES)
}

pub(crate) fn read_workspace_file_preview_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileResponse, String> {
    read_workspace_file_with_limit_inner(root, relative_path, MAX_WORKSPACE_PREVIEW_FILE_BYTES)
}

fn read_workspace_file_with_limit_inner(
    root: &PathBuf,
    relative_path: &str,
    max_bytes: u64,
) -> Result<WorkspaceFileResponse, String> {
    let normalized_path = normalize_workspace_relative_file_path(relative_path)?;
    let canonical_root = canonicalize_or_original(root);
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = canonicalize_or_original(&candidate);
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(max_bytes + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > max_bytes as usize;
    if truncated {
        buffer.truncate(max_bytes as usize);
    }

    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

/// 2.3 按需 tail：读文件**末尾**最多 max_bytes（默认 8 KiB），byte budget 对齐
/// tool-output 口径；首字节对齐（read 从头截断）不适用日志场景。
pub(crate) fn read_workspace_file_tail_inner(
    root: &PathBuf,
    relative_path: &str,
    max_bytes: u64,
) -> Result<WorkspaceFileResponse, String> {
    let normalized_path = normalize_workspace_relative_file_path(relative_path)?;
    let canonical_root = canonicalize_or_original(root);
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = canonicalize_or_original(&candidate);
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }
    let file_len = metadata.len();
    let read_from = file_len.saturating_sub(max_bytes);
    let mut file =
        File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.seek(std::io::SeekFrom::Start(read_from))
        .map_err(|err| format!("Failed to seek file: {err}"))?;
    file.take(max_bytes + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;
    let truncated = buffer.len() > max_bytes as usize;
    if truncated {
        buffer.truncate(max_bytes as usize);
    }
    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

pub(crate) fn read_external_absolute_file_inner(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
) -> Result<WorkspaceFileResponse, String> {
    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_path,
        allowed_roots,
        "file",
        "Invalid file path",
    )?;

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }

    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

fn build_preview_handle_response(
    canonical_path: &Path,
) -> Result<WorkspacePreviewHandleResponse, String> {
    let metadata = std::fs::metadata(canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }

    Ok(WorkspacePreviewHandleResponse {
        absolute_path: canonical_path.to_string_lossy().to_string(),
        byte_length: metadata.len(),
        extension: canonical_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase()),
    })
}

pub(crate) fn resolve_workspace_preview_handle_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspacePreviewHandleResponse, String> {
    let canonical_root = canonicalize_or_original(root);
    let candidate = canonical_root.join(relative_path);
    let canonical_path = canonicalize_or_original(&candidate);
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }
    build_preview_handle_response(&canonical_path)
}

pub(crate) fn resolve_external_spec_preview_handle_inner(
    spec_root: &str,
    logical_path: &str,
) -> Result<WorkspacePreviewHandleResponse, String> {
    let resolved = resolve_external_spec_root(spec_root)?;
    if !resolved.exists {
        return Err("External spec root does not exist.".to_string());
    }
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve external spec file: {err}"))?;
    if !canonical_path.starts_with(&root) {
        return Err("Invalid external spec file path.".to_string());
    }
    build_preview_handle_response(&canonical_path)
}

pub(crate) fn resolve_external_absolute_preview_handle_inner(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
) -> Result<WorkspacePreviewHandleResponse, String> {
    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_path,
        allowed_roots,
        "file",
        "Invalid file path",
    )?;
    build_preview_handle_response(&canonical_path)
}

pub(crate) fn write_external_absolute_file_inner(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
    content: &str,
) -> Result<(), String> {
    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }

    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_path,
        allowed_roots,
        "file",
        "Invalid file path",
    )?;

    std::fs::write(&canonical_path, content)
        .map_err(|err| format!("Failed to write file: {err}"))?;
    Ok(())
}

fn resolve_allowed_external_absolute_path(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
    expected_kind: &str,
    invalid_path_message: &str,
) -> Result<PathBuf, String> {
    let trimmed = absolute_path.trim();
    if trimmed.is_empty() {
        return Err(invalid_path_message.to_string());
    }

    let raw_path = PathBuf::from(trimmed);
    if !raw_path.is_absolute() {
        return Err(invalid_path_message.to_string());
    }

    let canonical_path = canonicalize_or_original(&raw_path);

    let mut within_allowed_root = false;
    for root in allowed_roots {
        let canonical_root = canonicalize_or_original(root);
        if canonical_path.starts_with(&canonical_root) {
            within_allowed_root = true;
            break;
        }
    }
    if !within_allowed_root {
        return Err("Path is not within allowed directories.".to_string());
    }

    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    let kind_matches = match expected_kind {
        "file" => metadata.is_file(),
        "directory" => metadata.is_dir(),
        _ => false,
    };
    if !kind_matches {
        return Err(format!("Path is not a {expected_kind}."));
    }
    Ok(canonical_path)
}

pub(crate) fn write_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
    content: &str,
) -> Result<(), String> {
    let canonical_root = canonicalize_or_original(root);
    let candidate = canonical_root.join(relative_path);

    if let Some(parent) = candidate.parent() {
        let canonical_parent = canonicalize_or_original(parent);
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid file path".to_string());
        }
    }

    // Block writes into .git directories.
    let normalized = relative_path.replace('\\', "/");
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.contains("/.git")
    {
        return Err("Cannot write to .git directory".to_string());
    }

    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }

    std::fs::write(&candidate, content).map_err(|err| format!("Failed to write file: {err}"))?;
    Ok(())
}

pub(crate) fn create_workspace_directory_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<(), String> {
    let normalized_path = normalize_workspace_relative_path(relative_path)?;
    let canonical_root = canonicalize_or_original(root);
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));

    if let Some(parent) = candidate.parent() {
        let canonical_parent = canonicalize_or_original(parent);
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid directory path".to_string());
        }
    }

    if candidate.exists() {
        let metadata = std::fs::metadata(&candidate)
            .map_err(|err| format!("Failed to read path metadata: {err}"))?;
        if metadata.is_dir() {
            return Ok(());
        }
        return Err("Path already exists and is not a directory.".to_string());
    }

    std::fs::create_dir(&candidate).map_err(|err| format!("Failed to create directory: {err}"))?;
    Ok(())
}

pub(crate) fn trash_workspace_item_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<(), String> {
    let normalized_path = normalize_workspace_relative_path(relative_path)?;
    let canonical_root = canonicalize_or_original(root);
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = canonicalize_or_original(&candidate);

    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }

    if !canonical_path.exists() {
        return Err("Path does not exist".to_string());
    }

    trash::delete(&canonical_path).map_err(|err| format!("Failed to move to trash: {err}"))?;

    Ok(())
}

/// Copy a file or directory within the workspace, appending " copy" (or " copy N")
/// to avoid name collisions.
pub(crate) fn copy_workspace_item_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<String, String> {
    duplicate_workspace_item_inner(root, relative_path).map(|result| result.path)
}

pub(crate) fn duplicate_workspace_item_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileOperationResult, String> {
    let canonical_root = resolve_workspace_root(root)?;
    let (_normalized_path, canonical_path, kind) =
        resolve_workspace_item_path(&canonical_root, relative_path)?;
    let parent = canonical_path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    copy_workspace_item_to_directory(&canonical_root, &canonical_path, kind, parent, false)
}

pub(crate) fn paste_workspace_item_inner(
    root: &PathBuf,
    source_path: &str,
    target_directory: &str,
) -> Result<WorkspaceFileOperationResult, String> {
    let canonical_root = resolve_workspace_root(root)?;
    let (_normalized_source, canonical_source, kind) =
        resolve_workspace_item_path(&canonical_root, source_path)?;
    let (_normalized_target, canonical_target) =
        resolve_workspace_target_directory(&canonical_root, target_directory)?;
    copy_workspace_item_to_directory(
        &canonical_root,
        &canonical_source,
        kind,
        &canonical_target,
        true,
    )
}

pub(crate) fn rename_workspace_item_inner(
    root: &PathBuf,
    relative_path: &str,
    new_name: &str,
) -> Result<WorkspaceFileOperationResult, String> {
    let canonical_root = resolve_workspace_root(root)?;
    let (_normalized_path, canonical_path, kind) =
        resolve_workspace_item_path(&canonical_root, relative_path)?;
    let validated_name = validate_workspace_item_basename(new_name)?;
    let parent = canonical_path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let target = parent.join(validated_name);

    if target.exists() {
        return Err("Target path already exists.".to_string());
    }

    std::fs::rename(&canonical_path, &target)
        .map_err(|err| format!("Failed to rename workspace item: {err}"))?;

    Ok(WorkspaceFileOperationResult {
        path: relative_path_from_absolute(&canonical_root, &target)?,
        kind,
    })
}

pub(crate) fn paste_external_workspace_items_inner(
    _root: &PathBuf,
    _source_paths: &[String],
    _target_directory: &str,
) -> Result<Vec<WorkspaceFileOperationResult>, String> {
    Err("External file import is not supported in this build yet. Use internal file tree Copy and Paste.".to_string())
}

fn build_copy_destination_name(
    source_path: &Path,
    kind: WorkspaceFileItemKind,
    counter: u32,
) -> Result<String, String> {
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid source file name".to_string())?;
    let source_stem = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(source_name);
    let source_extension = source_path
        .extension()
        .and_then(|extension| extension.to_str());
    let suffix = if counter == 0 {
        " copy".to_string()
    } else {
        format!(" copy {counter}")
    };

    Ok(match (kind, source_extension) {
        (WorkspaceFileItemKind::File, Some(extension)) => {
            format!("{source_stem}{suffix}.{extension}")
        }
        _ => format!("{source_stem}{suffix}"),
    })
}

fn resolve_collision_safe_destination(
    target_directory: &Path,
    source_path: &Path,
    kind: WorkspaceFileItemKind,
    prefer_original_name: bool,
) -> Result<PathBuf, String> {
    let source_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid source file name".to_string())?;

    if prefer_original_name {
        let original_destination = target_directory.join(source_name);
        if !original_destination.exists() {
            return Ok(original_destination);
        }
    }

    for counter in 0..=999u32 {
        let destination_name = build_copy_destination_name(source_path, kind, counter)?;
        let destination = target_directory.join(destination_name);
        if !destination.exists() {
            return Ok(destination);
        }
    }

    Err("Too many copies exist".to_string())
}

fn copy_workspace_item_to_directory(
    canonical_root: &Path,
    source_path: &Path,
    source_kind: WorkspaceFileItemKind,
    target_directory: &Path,
    prefer_original_name: bool,
) -> Result<WorkspaceFileOperationResult, String> {
    if source_kind == WorkspaceFileItemKind::Folder && target_directory.starts_with(source_path) {
        return Err("Cannot copy a folder into itself or its descendant.".to_string());
    }

    let destination = resolve_collision_safe_destination(
        target_directory,
        source_path,
        source_kind,
        prefer_original_name,
    )?;

    match source_kind {
        WorkspaceFileItemKind::Folder => copy_dir_recursive(source_path, &destination)?,
        WorkspaceFileItemKind::File => {
            std::fs::copy(source_path, &destination)
                .map_err(|err| format!("Failed to copy file: {err}"))?;
        }
    }

    Ok(WorkspaceFileOperationResult {
        path: relative_path_from_absolute(canonical_root, &destination)?,
        kind: source_kind,
    })
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|err| format!("Failed to create directory: {err}"))?;
    for entry in std::fs::read_dir(src).map_err(|err| format!("Failed to read directory: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to read entry: {err}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = std::fs::symlink_metadata(&src_path)
            .map_err(|err| format!("Failed to read entry metadata: {err}"))?
            .file_type();
        if file_type.is_symlink() {
            return Err("Cannot copy symbolic links in workspace directories.".to_string());
        }
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|err| format!("Failed to copy file: {err}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        compile_search_regex, create_workspace_directory_inner, duplicate_workspace_item_inner,
        is_special_directory_path, list_external_absolute_directory_children_inner,
        list_external_spec_tree_inner, list_workspace_directory_children_inner,
        list_workspace_directory_children_inner_with_refresh, list_workspace_files_inner,
        list_workspace_files_inner_with_refresh, normalize_workspace_relative_directory_path,
        normalize_workspace_relative_path, paste_workspace_item_inner,
        read_external_absolute_file_inner, read_external_spec_file_inner,
        read_workspace_file_inner, rename_workspace_item_inner,
        resolve_external_absolute_preview_handle_inner, resolve_external_spec_preview_handle_inner,
        resolve_workspace_preview_handle_inner, search_workspace_text_inner,
        sort_and_truncate_named_entries, write_external_absolute_file_inner,
        write_workspace_file_inner, WorkspaceDirectoryChildState, WorkspaceScanState,
        WorkspaceTextSearchOptions,
    };
    use crate::backend_budget::ScanCacheState;
    use crate::utils::normalize_git_path;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use uuid::Uuid;

    #[test]
    fn special_directory_path_detection_supports_dependency_dirs() {
        assert!(is_special_directory_path("node_modules"));
        assert!(is_special_directory_path("apps/web/node_modules"));
        assert!(is_special_directory_path("tools/.pnpm-store"));
        assert!(is_special_directory_path("sdk/.m2"));
        assert!(is_special_directory_path("rust/.cargo"));
    }

    #[test]
    fn special_directory_path_detection_supports_build_dirs() {
        assert!(is_special_directory_path("target"));
        assert!(is_special_directory_path("packages/ui/dist"));
        assert!(is_special_directory_path("service/build"));
        assert!(is_special_directory_path("native/cmake-build-debug"));
        assert!(is_special_directory_path("cache/.turbo"));
    }

    #[test]
    fn special_directory_path_detection_does_not_match_source_or_docs() {
        assert!(!is_special_directory_path("src"));
        assert!(!is_special_directory_path("docs"));
        assert!(!is_special_directory_path("apps/web/src"));
    }

    #[test]
    fn normalize_workspace_relative_path_rejects_empty_or_escaped_inputs() {
        assert!(normalize_workspace_relative_path("").is_err());
        assert!(normalize_workspace_relative_path("/").is_err());
        assert!(normalize_workspace_relative_path("../outside").is_err());
        assert!(normalize_workspace_relative_path("./local").is_err());
        assert!(normalize_workspace_relative_path(".git/config").is_err());
    }

    #[test]
    fn normalize_workspace_relative_path_accepts_regular_relative_path() {
        assert_eq!(
            normalize_workspace_relative_path("src/main.ts").expect("valid relative path"),
            "src/main.ts".to_string()
        );
    }

    #[test]
    fn normalize_workspace_relative_directory_path_accepts_root_sentinel() {
        assert_eq!(
            normalize_workspace_relative_directory_path("").expect("root path"),
            ""
        );
        assert!(normalize_workspace_relative_directory_path("   ").is_err());
        assert!(normalize_workspace_relative_directory_path("/").is_err());
        assert!(normalize_workspace_relative_directory_path("../outside").is_err());
        assert!(normalize_workspace_relative_directory_path(".git/config").is_err());
    }

    #[test]
    fn write_workspace_file_updates_relative_file() {
        let root = std::env::temp_dir().join(format!("mossx-write-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        std::fs::write(root.join("docs/note.md"), "before").expect("seed file");

        write_workspace_file_inner(&PathBuf::from(&root), "docs/note.md", "after")
            .expect("write workspace file");

        let content = std::fs::read_to_string(root.join("docs/note.md")).expect("read file");
        assert_eq!(content, "after");

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn create_workspace_directory_creates_relative_directory() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock moved backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("mossx-dir-create-{suffix}"));
        std::fs::create_dir_all(&root).expect("create root");

        create_workspace_directory_inner(&PathBuf::from(&root), "docs").expect("create docs");
        assert!(root.join("docs").is_dir());

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn duplicate_workspace_item_preserves_extension_and_collision_suffix() {
        let root = std::env::temp_dir().join(format!("mossx-duplicate-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create src");
        std::fs::write(root.join("src/index.ts"), "one").expect("write index");
        std::fs::write(root.join("src/index copy.ts"), "existing").expect("write copy");

        let result = duplicate_workspace_item_inner(&PathBuf::from(&root), "src/index.ts")
            .expect("duplicate file");

        assert_eq!(result.path, "src/index copy 1.ts");
        assert!(root.join("src/index copy 1.ts").is_file());

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn paste_workspace_item_copies_folder_to_target_directory() {
        let root = std::env::temp_dir().join(format!("mossx-paste-folder-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/components")).expect("create source");
        std::fs::create_dir_all(root.join("examples")).expect("create target");
        std::fs::write(root.join("src/components/Button.tsx"), "button").expect("write file");

        let result =
            paste_workspace_item_inner(&PathBuf::from(&root), "src/components", "examples")
                .expect("paste folder");

        assert_eq!(result.path, "examples/components");
        assert!(root.join("examples/components/Button.tsx").is_file());

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn paste_workspace_item_uses_copy_suffix_on_target_collision() {
        let root = std::env::temp_dir().join(format!("mossx-paste-collision-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create source");
        std::fs::create_dir_all(root.join("examples/components")).expect("create existing target");
        std::fs::write(root.join("src/components.tsx"), "source").expect("write source");
        std::fs::write(root.join("examples/components.tsx"), "existing").expect("write target");

        let result =
            paste_workspace_item_inner(&PathBuf::from(&root), "src/components.tsx", "examples")
                .expect("paste file");

        assert_eq!(result.path, "examples/components copy.tsx");
        assert!(root.join("examples/components copy.tsx").is_file());

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn paste_workspace_item_rejects_folder_into_descendant() {
        let root = std::env::temp_dir().join(format!("mossx-paste-descendant-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/components")).expect("create dirs");

        let result = paste_workspace_item_inner(&PathBuf::from(&root), "src", "src/components");

        assert!(result.is_err());
        assert_eq!(
            result.err().as_deref(),
            Some("Cannot copy a folder into itself or its descendant.")
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn rename_workspace_item_renames_file_and_rejects_conflict() {
        let root = std::env::temp_dir().join(format!("mossx-rename-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        std::fs::write(root.join("docs/readme.md"), "readme").expect("write readme");
        std::fs::write(root.join("docs/guide.md"), "guide").expect("write guide");

        let conflict =
            rename_workspace_item_inner(&PathBuf::from(&root), "docs/readme.md", "guide.md");
        assert!(conflict.is_err());
        assert_eq!(
            conflict.err().as_deref(),
            Some("Target path already exists.")
        );

        let result =
            rename_workspace_item_inner(&PathBuf::from(&root), "docs/readme.md", "intro.md")
                .expect("rename file");
        assert_eq!(result.path, "docs/intro.md");
        assert!(root.join("docs/intro.md").is_file());

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn rename_workspace_item_rejects_path_like_basename() {
        let root = std::env::temp_dir().join(format!("mossx-rename-invalid-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        std::fs::write(root.join("docs/readme.md"), "readme").expect("write readme");

        let result =
            rename_workspace_item_inner(&PathBuf::from(&root), "docs/readme.md", "../escape.md");

        assert!(result.is_err());
        assert_eq!(result.err().as_deref(), Some("Invalid item name."));

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn rename_workspace_item_rejects_windows_reserved_basename() {
        let root = std::env::temp_dir().join(format!("mossx-rename-windows-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        std::fs::write(root.join("docs/readme.md"), "readme").expect("write readme");

        for name in ["CON", "aux.txt", "bad:name.md", "trailing."] {
            let result = rename_workspace_item_inner(&PathBuf::from(&root), "docs/readme.md", name);
            assert!(result.is_err(), "{name} should be rejected");
            assert_eq!(result.err().as_deref(), Some("Invalid item name."));
        }

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn compile_search_regex_respects_whole_word() {
        let regex = compile_search_regex(
            "code",
            &WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: true,
                is_regex: false,
                include_pattern: None,
                exclude_pattern: None,
            },
        )
        .expect("regex");

        assert!(regex.is_match("code"));
        assert!(!regex.is_match("codemoss"));
    }

    #[test]
    fn search_workspace_text_finds_matches_and_honors_include_pattern() {
        let root = std::env::temp_dir().join(format!("mossx-search-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create src dir");
        std::fs::write(
            root.join("src/main.ts"),
            "const codemoss = 1;\nconst code = 2;\n",
        )
        .expect("write main.ts");
        std::fs::write(root.join("README.md"), "codemoss docs\n").expect("write readme");

        let response = search_workspace_text_inner(
            &root,
            "codemoss",
            &WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
                is_regex: false,
                include_pattern: Some("src/**".to_string()),
                exclude_pattern: None,
            },
        )
        .expect("search response");

        assert_eq!(response.file_count, 1);
        assert_eq!(response.match_count, 1);
        assert_eq!(response.files[0].path, "src/main.ts");
        assert_eq!(response.files[0].matches[0].line, 1);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_keeps_scanning_files_when_directory_cap_reached() {
        let root = std::env::temp_dir().join(format!("mossx-files-cap-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create root");

        for index in 0..1_010usize {
            std::fs::create_dir_all(root.join(format!("a-dir-{index:04}")))
                .expect("create directory");
        }
        std::fs::write(root.join("z-last-file.ts"), "export const ok = true;\n")
            .expect("write test file");

        let response = list_workspace_files_inner(&root, 1);

        assert!(
            response.files.iter().any(|path| path == "z-last-file.ts"),
            "expected file scan to continue after directory cap"
        );
        assert!(
            response.directories.len() <= 1_000,
            "directory list should still honor cap"
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_keeps_scanning_deep_files_when_directory_cap_reached() {
        let root = std::env::temp_dir().join(format!("mossx-files-deep-cap-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create root");

        for index in 0..1_010usize {
            std::fs::create_dir_all(root.join(format!("a-dir-{index:04}")))
                .expect("create directory");
        }
        let deep_dir = root.join("z-deep").join("nested");
        std::fs::create_dir_all(&deep_dir).expect("create deep dir");
        std::fs::write(deep_dir.join("hit.ts"), "export const deep = true;\n")
            .expect("write deep file");

        let response = list_workspace_files_inner(&root, 1);

        assert!(
            response
                .files
                .iter()
                .any(|path| path == "z-deep/nested/hit.ts"),
            "expected walker to keep scanning deep files after directory cap"
        );
        assert!(
            response.directories.len() <= 1_000,
            "directory list should still honor cap"
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_marks_truncated_directory_state_as_partial() {
        let root = std::env::temp_dir().join(format!("mossx-files-partial-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("packages/large")).expect("create large dir");
        std::fs::write(
            root.join("packages/large/index.ts"),
            "export const large = true;\n",
        )
        .expect("write large file");

        let response = list_workspace_files_inner(&root, 1);
        let packages_entry = response
            .directory_entries
            .iter()
            .find(|entry| entry.path == "packages")
            .expect("packages metadata");

        assert_eq!(response.scan_state, WorkspaceScanState::Partial);
        assert!(response.limit_hit);
        assert_eq!(
            packages_entry.child_state,
            WorkspaceDirectoryChildState::Partial
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_includes_budget_source_and_payload_metadata() {
        let root = std::env::temp_dir().join(format!("mossx-files-budget-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create src dir");
        std::fs::write(root.join("src/app.ts"), "app\n").expect("write app");

        let response = list_workspace_files_inner(&root, 20);
        let listing_budget = response
            .listing_budget
            .as_ref()
            .expect("listing budget metadata");
        let payload_budget = response
            .payload_budget
            .as_ref()
            .expect("payload budget metadata");

        assert_eq!(
            response.source_version.as_deref(),
            Some(listing_budget.source_version.as_str())
        );
        assert_eq!(listing_budget.depth, Some(2));
        assert_eq!(listing_budget.max_entries, 20);
        assert_eq!(listing_budget.scan_state, response.scan_state);
        assert_eq!(listing_budget.limit_hit, response.limit_hit);
        assert!(
            listing_budget.returned_entries >= response.files.len() + response.directories.len()
        );
        assert!(listing_budget.payload_bytes > 0);
        assert_eq!(payload_budget.command, "list_workspace_files");
        assert_eq!(payload_budget.surface_id, "workspaces.file.initial-listing");
        assert_eq!(payload_budget.item_count, listing_budget.returned_entries);
        assert_ne!(listing_budget.cache_state, ScanCacheState::Unsupported);
        assert_ne!(payload_budget.cache_state, ScanCacheState::Unsupported);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_reports_cache_miss_hit_and_invalidation() {
        let root = std::env::temp_dir().join(format!("mossx-files-cache-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/deep")).expect("create deep dir");
        std::fs::write(root.join("src/deep/app.ts"), "app\n").expect("write app");

        let first = list_workspace_files_inner(&root, 20);
        assert_eq!(
            first
                .payload_budget
                .as_ref()
                .expect("first payload budget")
                .cache_state,
            ScanCacheState::Miss
        );

        let second = list_workspace_files_inner(&root, 20);
        assert_eq!(
            second
                .payload_budget
                .as_ref()
                .expect("second payload budget")
                .cache_state,
            ScanCacheState::Hit
        );

        std::fs::write(root.join("src/deep/next.ts"), "next\n").expect("write next");
        let third = list_workspace_files_inner(&root, 20);
        assert_eq!(
            third
                .payload_budget
                .as_ref()
                .expect("third payload budget")
                .cache_state,
            ScanCacheState::Invalidated
        );
        assert!(third.files.iter().any(|path| path == "src/deep/next.ts"));

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_force_refresh_bypasses_cached_signature() {
        let root = std::env::temp_dir().join(format!("mossx-files-force-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create src dir");
        std::fs::write(root.join("src/app.ts"), "app\n").expect("write app");

        let first = list_workspace_files_inner(&root, 20);
        assert_eq!(
            first
                .payload_budget
                .as_ref()
                .expect("first payload budget")
                .cache_state,
            ScanCacheState::Miss
        );

        std::fs::write(root.join("src/manual.ts"), "manual\n").expect("write manual");
        let refreshed = list_workspace_files_inner_with_refresh(&root, 20, true);
        assert_eq!(
            refreshed
                .payload_budget
                .as_ref()
                .expect("refreshed payload budget")
                .cache_state,
            ScanCacheState::Miss
        );
        assert!(refreshed.files.iter().any(|path| path == "src/manual.ts"));

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn sort_and_truncate_named_entries_sorts_before_truncating() {
        let mut entries = vec![
            ("z-item".to_string(), 1usize),
            ("m-item".to_string(), 2usize),
            ("a-item".to_string(), 3usize),
            ("b-item".to_string(), 4usize),
        ];

        sort_and_truncate_named_entries(&mut entries, 2);

        let names: Vec<String> = entries.into_iter().map(|(name, _)| name).collect();
        assert_eq!(names, vec!["a-item".to_string(), "b-item".to_string()]);
    }

    #[test]
    fn list_workspace_directory_children_returns_sorted_entries() {
        let root = std::env::temp_dir().join(format!("mossx-dir-children-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("bucket")).expect("create bucket dir");
        std::fs::write(root.join("bucket/z.ts"), "z\n").expect("write z");
        std::fs::write(root.join("bucket/a.ts"), "a\n").expect("write a");
        std::fs::write(root.join("bucket/m.ts"), "m\n").expect("write m");

        let response =
            list_workspace_directory_children_inner(&root, "bucket", 3).expect("list children");

        assert_eq!(
            response.files,
            vec![
                "bucket/a.ts".to_string(),
                "bucket/m.ts".to_string(),
                "bucket/z.ts".to_string()
            ]
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_directory_children_includes_subtree_budget_contract() {
        let root =
            std::env::temp_dir().join(format!("mossx-dir-children-budget-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("bucket")).expect("create bucket dir");
        std::fs::write(root.join("bucket/a.ts"), "a\n").expect("write a");

        let response =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("list children");
        let listing_budget = response
            .listing_budget
            .as_ref()
            .expect("listing budget metadata");
        let payload_budget = response
            .payload_budget
            .as_ref()
            .expect("payload budget metadata");

        assert_eq!(listing_budget.requested_path.as_deref(), Some("bucket"));
        assert_eq!(listing_budget.depth, Some(1));
        assert_eq!(listing_budget.max_entries, 10);
        assert_eq!(payload_budget.command, "list_workspace_directory_children");
        assert_eq!(payload_budget.surface_id, "workspaces.file.subtree-listing");
        assert_eq!(payload_budget.estimated_bytes, listing_budget.payload_bytes);
        assert_ne!(listing_budget.cache_state, ScanCacheState::Unsupported);
        assert_ne!(payload_budget.cache_state, ScanCacheState::Unsupported);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_directory_children_reports_path_scoped_cache_states() {
        let root =
            std::env::temp_dir().join(format!("mossx-dir-children-cache-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("bucket")).expect("create bucket dir");
        std::fs::write(root.join("bucket/a.ts"), "a\n").expect("write a");

        let first =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("first children");
        assert_eq!(
            first
                .payload_budget
                .as_ref()
                .expect("first payload budget")
                .cache_state,
            ScanCacheState::Miss
        );

        let second =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("second children");
        assert_eq!(
            second
                .payload_budget
                .as_ref()
                .expect("second payload budget")
                .cache_state,
            ScanCacheState::Hit
        );

        std::fs::write(root.join("bucket/b.ts"), "b\n").expect("write b");
        let third =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("third children");
        assert_eq!(
            third
                .payload_budget
                .as_ref()
                .expect("third payload budget")
                .cache_state,
            ScanCacheState::Invalidated
        );
        assert!(third.files.iter().any(|path| path == "bucket/b.ts"));

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_directory_children_force_refresh_bypasses_cached_signature() {
        let root =
            std::env::temp_dir().join(format!("mossx-dir-children-force-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("bucket")).expect("create bucket dir");
        std::fs::write(root.join("bucket/a.ts"), "a\n").expect("write a");

        let first =
            list_workspace_directory_children_inner(&root, "bucket", 10).expect("first children");
        assert_eq!(
            first
                .payload_budget
                .as_ref()
                .expect("first payload budget")
                .cache_state,
            ScanCacheState::Miss
        );

        std::fs::write(root.join("bucket/manual.ts"), "manual\n").expect("write manual");
        let refreshed =
            list_workspace_directory_children_inner_with_refresh(&root, "bucket", 10, true)
                .expect("force refreshed children");
        assert_eq!(
            refreshed
                .payload_budget
                .as_ref()
                .expect("refreshed payload budget")
                .cache_state,
            ScanCacheState::Miss
        );
        assert!(refreshed
            .files
            .iter()
            .any(|path| path == "bucket/manual.ts"));

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_directory_children_accepts_empty_path_as_root() {
        let root = std::env::temp_dir().join(format!("mossx-root-children-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create src dir");
        std::fs::write(root.join("README.md"), "# test\n").expect("write readme");
        std::fs::write(root.join("src/main.ts"), "main\n").expect("write nested file");

        let response =
            list_workspace_directory_children_inner(&root, "", 10).expect("list root children");

        assert_eq!(response.files, vec!["README.md".to_string()]);
        assert_eq!(response.directories, vec!["src".to_string()]);
        assert!(!response.files.contains(&"src/main.ts".to_string()));
        assert!(response
            .directory_entries
            .iter()
            .any(|entry| entry.path == "src"
                && entry.child_state == WorkspaceDirectoryChildState::Unknown));

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_directory_children_defers_root_gitignore_markers() {
        let root = std::env::temp_dir().join(format!("mossx-root-gitignore-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create src dir");
        std::fs::write(root.join(".gitignore"), "src/ignored.ts\n").expect("write gitignore");
        std::fs::write(root.join("src/ignored.ts"), "ignored\n").expect("write ignored file");
        git2::Repository::init(&root).expect("init git repo");

        let root_response =
            list_workspace_directory_children_inner(&root, "", 10).expect("list root children");
        assert!(root_response.gitignored_files.is_empty());
        assert!(root_response.gitignored_directories.is_empty());

        let src_response =
            list_workspace_directory_children_inner(&root, "src", 10).expect("list src children");
        assert_eq!(
            src_response.gitignored_files,
            vec!["src/ignored.ts".to_string()]
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_directory_children_reports_empty_directory() {
        let root = std::env::temp_dir().join(format!("mossx-dir-empty-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("empty")).expect("create empty dir");

        let response =
            list_workspace_directory_children_inner(&root, "empty", 20).expect("list children");
        let parent_entry = response
            .directory_entries
            .iter()
            .find(|entry| entry.path == "empty")
            .expect("empty directory metadata");

        assert_eq!(response.scan_state, WorkspaceScanState::Complete);
        assert!(!response.limit_hit);
        assert_eq!(
            parent_entry.child_state,
            WorkspaceDirectoryChildState::Empty
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_directory_children_reports_partial_when_entry_cap_hits() {
        let root = std::env::temp_dir().join(format!("mossx-dir-partial-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("bucket")).expect("create bucket dir");
        std::fs::write(root.join("bucket/a.ts"), "a\n").expect("write a");
        std::fs::write(root.join("bucket/b.ts"), "b\n").expect("write b");

        let response =
            list_workspace_directory_children_inner(&root, "bucket", 1).expect("list children");
        let parent_entry = response
            .directory_entries
            .iter()
            .find(|entry| entry.path == "bucket")
            .expect("bucket metadata");

        assert_eq!(response.files.len() + response.directories.len(), 1);
        assert_eq!(response.scan_state, WorkspaceScanState::Partial);
        assert!(response.limit_hit);
        assert_eq!(
            parent_entry.child_state,
            WorkspaceDirectoryChildState::Partial
        );
        assert!(parent_entry.has_more);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_external_absolute_directory_children_returns_sorted_entries() {
        let root =
            std::env::temp_dir().join(format!("mossx-external-dir-children-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("skill")).expect("create skill dir");
        std::fs::write(root.join("skill/z.ts"), "z\n").expect("write z");
        std::fs::write(root.join("skill/a.ts"), "a\n").expect("write a");
        std::fs::write(root.join("skill/m.ts"), "m\n").expect("write m");
        let canonical_skill_dir = root
            .join("skill")
            .canonicalize()
            .expect("canonical skill dir");
        let expected_base = normalize_git_path(&canonical_skill_dir.to_string_lossy());

        let response = list_external_absolute_directory_children_inner(
            root.join("skill").to_str().expect("directory path"),
            std::slice::from_ref(&root),
            3,
        )
        .expect("list children");

        assert_eq!(
            response.files,
            vec![
                format!("{expected_base}/a.ts"),
                format!("{expected_base}/m.ts"),
                format!("{expected_base}/z.ts")
            ]
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_external_absolute_directory_children_rejects_relative_path() {
        let root = PathBuf::from("/tmp");
        let result = list_external_absolute_directory_children_inner("relative/path", &[root], 20);
        assert!(result.is_err());
        assert_eq!(result.err().as_deref(), Some("Invalid directory path."));
    }

    #[test]
    fn read_workspace_file_decodes_gb18030_text() {
        let root = std::env::temp_dir().join(format!("mossx-read-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        let (encoded, _, had_errors) = encoding_rs::GB18030.encode("usb异常断开");
        assert!(!had_errors, "encode should succeed");
        std::fs::write(root.join("docs/main_lin_test.c"), encoded.as_ref()).expect("write file");

        let response = read_workspace_file_inner(&PathBuf::from(&root), "docs/main_lin_test.c")
            .expect("read file");

        assert_eq!(response.content, "usb异常断开");
        assert!(!response.truncated);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn read_workspace_file_rejects_git_directory_access() {
        let root = std::env::temp_dir().join(format!("mossx-read-git-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".git")).expect("create git dir");
        std::fs::write(root.join(".git").join("config"), "[core]\n").expect("write git config");

        let result = read_workspace_file_inner(&PathBuf::from(&root), ".git/config");

        assert!(result.is_err());
        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn read_external_absolute_file_decodes_gb18030_text() {
        let root = std::env::temp_dir().join(format!("mossx-read-absolute-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        let (encoded, _, had_errors) = encoding_rs::GB18030.encode("外部绝对路径可读取");
        assert!(!had_errors, "encode should succeed");
        let file_path = root.join("docs/skill.md");
        std::fs::write(&file_path, encoded.as_ref()).expect("write file");

        let response = read_external_absolute_file_inner(
            file_path.to_str().expect("file path"),
            std::slice::from_ref(&root),
        )
        .expect("read file");

        assert_eq!(response.content, "外部绝对路径可读取");
        assert!(!response.truncated);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn resolve_workspace_preview_handle_keeps_file_backed_payload_bounded() {
        let root = std::env::temp_dir().join(format!("mossx-preview-handle-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        std::fs::write(root.join("docs/report.pdf"), b"%PDF-1.7").expect("write pdf");

        let response =
            resolve_workspace_preview_handle_inner(&PathBuf::from(&root), "docs/report.pdf")
                .expect("preview handle");

        assert!(response.absolute_path.ends_with("docs/report.pdf"));
        assert_eq!(response.extension.as_deref(), Some("pdf"));
        assert!(response.byte_length > 0);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn read_external_absolute_file_rejects_relative_path() {
        let root = PathBuf::from("/tmp");
        let result = read_external_absolute_file_inner("relative/path.md", &[root]);
        assert!(result.is_err());
        assert_eq!(result.err().as_deref(), Some("Invalid file path"));
    }

    #[test]
    fn write_external_absolute_file_updates_existing_file() {
        let root = std::env::temp_dir().join(format!("mossx-write-absolute-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        let file_path = root.join("docs/skill.md");
        std::fs::write(&file_path, "before").expect("write file");

        write_external_absolute_file_inner(
            file_path.to_str().expect("file path"),
            std::slice::from_ref(&root),
            "after",
        )
        .expect("write absolute file");

        let content = std::fs::read_to_string(&file_path).expect("read updated file");
        assert_eq!(content, "after");

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn write_external_absolute_file_rejects_relative_path() {
        let root = PathBuf::from("/tmp");
        let result = write_external_absolute_file_inner("relative/path.md", &[root], "content");
        assert!(result.is_err());
        assert_eq!(result.err().as_deref(), Some("Invalid file path"));
    }

    #[test]
    fn write_external_absolute_file_rejects_path_outside_allowed_roots() {
        let root =
            std::env::temp_dir().join(format!("mossx-write-absolute-root-{}", Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("mossx-write-absolute-outside-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create root docs");
        std::fs::create_dir_all(outside.join("docs")).expect("create outside docs");
        let file_path = outside.join("docs/skill.md");
        std::fs::write(&file_path, "before").expect("write file");

        let result = write_external_absolute_file_inner(
            file_path.to_str().expect("file path"),
            &[root.clone()],
            "after",
        );

        assert_eq!(
            result.err().as_deref(),
            Some("Path is not within allowed directories.")
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
        std::fs::remove_dir_all(&outside).expect("cleanup outside");
    }

    #[test]
    fn resolve_external_preview_handles_respect_allowed_roots_and_openspec_aliases() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-preview-spec-{}", Uuid::new_v4()));
        let openspec_root = project_root.join("openspec");
        std::fs::create_dir_all(&openspec_root).expect("create spec root");
        std::fs::write(openspec_root.join("project.docx"), b"docx").expect("write docx");

        let spec_response = resolve_external_spec_preview_handle_inner(
            project_root.to_str().expect("project root"),
            "openspec/project.docx",
        )
        .expect("spec preview handle");
        assert_eq!(spec_response.extension.as_deref(), Some("docx"));

        let absolute_response = resolve_external_absolute_preview_handle_inner(
            openspec_root
                .join("project.docx")
                .to_str()
                .expect("absolute path"),
            std::slice::from_ref(&project_root),
        )
        .expect("absolute preview handle");
        assert_eq!(absolute_response.extension.as_deref(), Some("docx"));

        std::fs::remove_dir_all(&project_root).expect("cleanup root");
    }

    #[test]
    fn read_external_spec_file_decodes_gb18030_text() {
        let project_root = std::env::temp_dir().join(format!("mossx-spec-{}", Uuid::new_v4()));
        let openspec_root = project_root.join("openspec");
        std::fs::create_dir_all(&openspec_root).expect("create spec root");
        let (encoded, _, had_errors) = encoding_rs::GB18030.encode("重新插拔usb会恢复");
        assert!(!had_errors, "encode should succeed");
        std::fs::write(openspec_root.join("legacy.c"), encoded.as_ref()).expect("write file");

        let response = read_external_spec_file_inner(
            project_root.to_str().expect("root path"),
            "openspec/legacy.c",
        )
        .expect("read file");

        assert!(response.exists);
        assert_eq!(response.content, "重新插拔usb会恢复");
        assert!(!response.truncated);

        std::fs::remove_dir_all(&project_root).expect("cleanup root");
    }

    #[test]
    fn read_external_spec_file_supports_direct_openspec_root_input() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-openspec-direct-{}", Uuid::new_v4()));
        let openspec_root = project_root.join("openspec");
        std::fs::create_dir_all(&openspec_root).expect("create spec root");
        std::fs::write(openspec_root.join("project.md"), "# Project Context").expect("write file");

        let response = read_external_spec_file_inner(
            openspec_root.to_str().expect("root path"),
            "openspec/project.md",
        )
        .expect("read file");

        assert!(response.exists);
        assert_eq!(response.content, "# Project Context");

        std::fs::remove_dir_all(&project_root).expect("cleanup root");
    }

    #[test]
    fn list_external_spec_tree_returns_placeholder_when_project_root_has_no_openspec() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-project-no-openspec-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&project_root).expect("create project root");
        std::fs::write(project_root.join("package.json"), "{}").expect("write project file");

        let response =
            list_external_spec_tree_inner(project_root.to_str().expect("root path"), 100)
                .expect("list tree");

        assert_eq!(response.files, Vec::<String>::new());
        assert_eq!(response.directories, vec!["openspec".to_string()]);

        std::fs::remove_dir_all(&project_root).expect("cleanup root");
    }
}
