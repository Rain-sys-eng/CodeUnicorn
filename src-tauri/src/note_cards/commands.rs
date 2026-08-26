use super::attachments::{delete_note_card_files, hydrate_attachment_path, materialize_attachments};
use super::location::*;
use super::markdown::*;
use super::storage::*;
use super::types::*;

#[tauri::command]
pub(crate) fn note_card_list(
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
    archived: bool,
    query: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<WorkspaceNoteCardListResult, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        if !base.exists() {
            return Ok(WorkspaceNoteCardListResult {
                items: Vec::new(),
                total: 0,
            });
        }
        let normalized_query = query.as_deref().unwrap_or("").trim().to_lowercase();
        let mut items = collect_workspace_note_summaries(
            &base,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
            archived,
            Some(normalized_query.as_str()),
        )?;
        items.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        let total = items.len();
        let page_index = page.unwrap_or(0);
        let page_limit = page_size.unwrap_or(100).clamp(1, 200);
        let start = page_index.saturating_mul(page_limit);
        let paged = if start >= items.len() {
            Vec::new()
        } else {
            let end = (start + page_limit).min(items.len());
            items[start..end].to_vec()
        };
        Ok(WorkspaceNoteCardListResult {
            items: paged,
            total,
        })
    })
}

#[tauri::command]
pub(crate) fn note_card_get(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<Option<WorkspaceNoteCard>, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Ok(None);
        };
        let mut note = read_note_card(
            &location.note_path,
            &location.project_dir,
            location.archived,
        )?;
        if note.workspace_id.trim().is_empty() {
            note.workspace_id = workspace_id;
        }
        Ok(Some(note))
    })
}

#[tauri::command]
pub(crate) fn note_card_create(
    input: CreateWorkspaceNoteCardInput,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let source = normalize_note_source(input.source.clone())?;
        let base = storage_dir()?;
        let project_name = derive_project_name(
            Some(input.workspace_id.as_str()),
            input.workspace_name.as_deref(),
            input.workspace_path.as_deref(),
        );
        let project_dir = project_dir_path(
            &base,
            Some(input.workspace_id.as_str()),
            input.workspace_name.as_deref(),
            input.workspace_path.as_deref(),
        );
        ensure_project_dirs(&project_dir)?;
        let note_id = uuid::Uuid::new_v4().to_string();
        let body_markdown = input.body_markdown.trim().to_string();
        let attachments =
            materialize_attachments(&project_dir, &note_id, input.attachment_inputs.clone(), &[])?;
        let current_ms = now_ms();
        let note = WorkspaceNoteCard {
            id: note_id.clone(),
            workspace_id: input.workspace_id.clone(),
            workspace_name: input.workspace_name.clone(),
            workspace_path: input.workspace_path.clone(),
            project_name,
            title: resolve_note_title(input.title.as_deref(), &body_markdown),
            body_markdown: body_markdown.clone(),
            plain_text_excerpt: build_plain_text_excerpt(&body_markdown),
            attachments,
            source,
            created_at: current_ms,
            updated_at: current_ms,
            archived_at: None,
        };
        let path = note_file_path(&project_dir, &note_id, false);
        write_note_card(&path, &note)?;
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_update(
    note_id: String,
    workspace_id: String,
    patch: UpdateWorkspaceNoteCardInput,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            patch.workspace_name.as_deref(),
            patch.workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found".to_string());
        };
        let mut note = read_note_card(
            &location.note_path,
            &location.project_dir,
            location.archived,
        )?;
        let next_workspace_name = if patch.workspace_name.is_some() {
            patch.workspace_name.clone()
        } else {
            note.workspace_name.clone()
        };
        let next_workspace_path = if patch.workspace_path.is_some() {
            patch.workspace_path.clone()
        } else {
            note.workspace_path.clone()
        };
        let target_project_dir = project_dir_path(
            &base,
            Some(workspace_id.as_str()),
            next_workspace_name.as_deref(),
            next_workspace_path.as_deref(),
        );
        ensure_project_dirs(&target_project_dir)?;
        let body_markdown = patch
            .body_markdown
            .clone()
            .unwrap_or_else(|| note.body_markdown.clone())
            .trim()
            .to_string();
        let attachments = materialize_attachments(
            &location.project_dir,
            &note.id,
            patch.attachment_inputs.clone(),
            &note.attachments,
        )?;
        note.workspace_id = workspace_id;
        note.workspace_name = next_workspace_name;
        note.workspace_path = next_workspace_path;
        note.project_name = derive_project_name(
            Some(note.workspace_id.as_str()),
            note.workspace_name.as_deref(),
            note.workspace_path.as_deref(),
        );
        note.title = resolve_note_title(
            patch.title.as_deref().or(Some(note.title.as_str())),
            &body_markdown,
        );
        note.body_markdown = body_markdown.clone();
        note.plain_text_excerpt = build_plain_text_excerpt(&body_markdown);
        note.attachments = attachments;
        note.updated_at = now_ms();
        relocate_note_assets(&location.project_dir, &target_project_dir, &note.id)?;
        note.attachments = note
            .attachments
            .into_iter()
            .map(|attachment| hydrate_attachment_path(&target_project_dir, &note.id, attachment))
            .collect();
        let target_note_path = note_file_path(&target_project_dir, &note.id, location.archived);
        write_note_card(&target_note_path, &note)?;
        if location.note_path != target_note_path && location.note_path.exists() {
            std::fs::remove_file(&location.note_path).map_err(|error| error.to_string())?;
        }
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_archive(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found in active collection".to_string());
        };
        if location.archived {
            return Err("note card not found in active collection".to_string());
        }
        let mut note = read_note_card(&location.note_path, &location.project_dir, false)?;
        note.updated_at = now_ms();
        note.archived_at = Some(note.updated_at);
        let archive_path = note_file_path(&location.project_dir, &note_id, true);
        write_note_card(&archive_path, &note)?;
        std::fs::remove_file(&location.note_path).map_err(|error| error.to_string())?;
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_restore(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found in archive collection".to_string());
        };
        if !location.archived {
            return Err("note card not found in archive collection".to_string());
        }
        let mut note = read_note_card(&location.note_path, &location.project_dir, true)?;
        note.updated_at = now_ms();
        note.archived_at = None;
        let active_path = note_file_path(&location.project_dir, &note_id, false);
        write_note_card(&active_path, &note)?;
        std::fs::remove_file(&location.note_path).map_err(|error| error.to_string())?;
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_delete(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found".to_string());
        };
        let deleted = delete_note_card_files(&location.project_dir, &note_id)?;
        if !deleted {
            return Err("note card not found".to_string());
        }
        Ok(())
    })
}
