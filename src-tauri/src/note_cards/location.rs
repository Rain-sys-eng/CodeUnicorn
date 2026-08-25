use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use super::markdown::{strip_markdown_to_plain_text, summarize_note};
use super::storage::*;
use super::types::*;

pub(crate) fn find_note_card_path_in_project_dir(
    project_dir: &Path,
    note_id: &str,
) -> Result<Option<(PathBuf, bool)>, String> {
    let active_path = note_file_path(project_dir, note_id, false);
    if active_path.exists() {
        return Ok(Some((active_path, false)));
    }
    let archive_path = note_file_path(project_dir, note_id, true);
    if archive_path.exists() {
        return Ok(Some((archive_path, true)));
    }
    Ok(None)
}

#[derive(Debug, Clone)]
pub(crate) struct NoteCardLocation {
    pub(crate) project_dir: PathBuf,
    pub(crate) note_path: PathBuf,
    pub(crate) archived: bool,
}

pub(crate) fn list_candidate_project_dirs(
    base: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let preferred = project_dir_path(base, workspace_id, workspace_name, workspace_path);
    let mut candidates = vec![preferred.clone()];
    if !base.exists() {
        return Ok(candidates);
    }
    let entries = std::fs::read_dir(base).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let path = entry.path();
        if path != preferred {
            candidates.push(path);
        }
    }
    Ok(candidates)
}

pub(crate) fn workspace_id_matches(
    note_workspace_id: &str,
    expected_workspace_id: Option<&str>,
) -> bool {
    let expected = expected_workspace_id.map(str::trim).unwrap_or_default();
    expected.is_empty()
        || note_workspace_id.trim().is_empty()
        || note_workspace_id.trim() == expected
}

pub(crate) fn resolve_note_card_location(
    base: &Path,
    note_id: &str,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
) -> Result<Option<NoteCardLocation>, String> {
    let candidates =
        list_candidate_project_dirs(base, workspace_id, workspace_name, workspace_path)?;
    for project_dir in candidates {
        let Some((note_path, archived)) =
            find_note_card_path_in_project_dir(&project_dir, note_id)?
        else {
            continue;
        };
        match read_note_card(&note_path, &project_dir, archived) {
            Ok(note) => {
                if workspace_id_matches(&note.workspace_id, workspace_id) {
                    return Ok(Some(NoteCardLocation {
                        project_dir,
                        note_path,
                        archived,
                    }));
                }
            }
            Err(error) => {
                log::warn!(
                    "Failed to read candidate note card {} while resolving {}: {}",
                    note_path.display(),
                    note_id,
                    error
                );
            }
        }
    }
    Ok(None)
}

pub(crate) fn move_directory_contents(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
    let entries = std::fs::read_dir(source).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            move_directory_contents(&source_path, &target_path)?;
            std::fs::remove_dir(&source_path).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::copy(&source_path, &target_path).map_err(|error| error.to_string())?;
        std::fs::remove_file(&source_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn relocate_note_assets(
    source_project_dir: &Path,
    target_project_dir: &Path,
    note_id: &str,
) -> Result<(), String> {
    if source_project_dir == target_project_dir {
        return Ok(());
    }
    let source_asset_dir = note_asset_dir(source_project_dir, note_id);
    if !source_asset_dir.exists() {
        return Ok(());
    }
    let target_asset_dir = note_asset_dir(target_project_dir, note_id);
    if target_asset_dir.exists() {
        if target_asset_dir.is_dir() {
            std::fs::remove_dir_all(&target_asset_dir).map_err(|error| error.to_string())?;
        } else {
            std::fs::remove_file(&target_asset_dir).map_err(|error| error.to_string())?;
        }
    }
    if let Some(parent) = target_asset_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if let Err(error) = std::fs::rename(&source_asset_dir, &target_asset_dir) {
        log::warn!(
            "Failed to rename note asset dir from {} to {}: {}. Falling back to copy.",
            source_asset_dir.display(),
            target_asset_dir.display(),
            error
        );
        move_directory_contents(&source_asset_dir, &target_asset_dir)?;
        std::fs::remove_dir_all(&source_asset_dir)
            .map_err(|remove_error| remove_error.to_string())?;
    }
    Ok(())
}

pub(crate) fn collect_workspace_note_summaries(
    base: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
    archived: bool,
    query: Option<&str>,
) -> Result<Vec<WorkspaceNoteCardSummary>, String> {
    let normalized_query = query.unwrap_or_default().trim().to_lowercase();
    let mut items_by_id: HashMap<String, WorkspaceNoteCardSummary> = HashMap::new();
    for project_dir in
        list_candidate_project_dirs(base, workspace_id, workspace_name, workspace_path)?
    {
        let collection_dir = if archived {
            archive_collection_dir(&project_dir)
        } else {
            active_collection_dir(&project_dir)
        };
        if !collection_dir.exists() {
            continue;
        }
        let entries = std::fs::read_dir(&collection_dir).map_err(|error| error.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.extension().and_then(OsStr::to_str) != Some("json") {
                continue;
            }
            match read_note_card(&path, &project_dir, archived) {
                Ok(note) => {
                    if !workspace_id_matches(&note.workspace_id, workspace_id) {
                        continue;
                    }
                    if !normalized_query.is_empty() {
                        let haystack = format!(
                            "{} {} {}",
                            note.title.to_lowercase(),
                            note.plain_text_excerpt.to_lowercase(),
                            strip_markdown_to_plain_text(&note.body_markdown).to_lowercase(),
                        );
                        if !haystack.contains(&normalized_query) {
                            continue;
                        }
                    }
                    let summary = summarize_note(&note, archived);
                    match items_by_id.get(&summary.id) {
                        Some(existing) if existing.updated_at >= summary.updated_at => {}
                        _ => {
                            items_by_id.insert(summary.id.clone(), summary);
                        }
                    }
                }
                Err(error) => {
                    log::warn!("Failed to read note card {}: {}", path.display(), error);
                }
            }
        }
    }
    Ok(items_by_id.into_values().collect())
}

#[cfg(test)]
pub(crate) fn read_collection_summaries(
    project_dir: &Path,
    archived: bool,
) -> Result<Vec<WorkspaceNoteCardSummary>, String> {
    let collection_dir = if archived {
        archive_collection_dir(project_dir)
    } else {
        active_collection_dir(project_dir)
    };
    if !collection_dir.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    let entries = std::fs::read_dir(&collection_dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(OsStr::to_str) != Some("json") {
            continue;
        }
        match read_note_card(&path, project_dir, archived) {
            Ok(note) => items.push(summarize_note(&note, archived)),
            Err(error) => {
                log::warn!("Failed to read note card {}: {}", path.display(), error);
            }
        }
    }
    Ok(items)
}
