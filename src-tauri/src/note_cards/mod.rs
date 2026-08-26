mod types;
mod storage;
mod markdown;
mod attachments;
mod location;
mod commands;

#[cfg(test)]
pub(crate) use attachments::{
    delete_note_card_files, hydrate_attachment_path, materialize_attachments,
    normalize_attachment_path_key,
};
pub(crate) use commands::*;
#[cfg(test)]
pub(crate) use location::{
    collect_workspace_note_summaries, read_collection_summaries, resolve_note_card_location,
};
#[cfg(test)]
pub(crate) use markdown::{build_plain_text_excerpt, resolve_note_title, summarize_note};
#[cfg(test)]
pub(crate) use storage::{
    derive_project_name, ensure_project_dirs, note_asset_dir, note_file_path,
    normalize_note_source, now_ms, project_dir_path, read_note_card, write_note_card,
};
#[cfg(test)]
pub(crate) use types::{NoteCardAttachment, WorkspaceNoteCard, WorkspaceNoteCardSource};

#[cfg(test)]
mod tests;
