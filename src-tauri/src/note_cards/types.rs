use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use regex::Regex;

pub(crate) static FILE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) static MARKDOWN_IMAGE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\([^)]+\)").expect("valid markdown image regex"));
pub(crate) static MARKDOWN_LINK_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]]+)\]\([^)]+\)").expect("valid markdown link regex"));
pub(crate) static MARKDOWN_PREFIX_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s{0,3}(?:#{1,6}|\>|\-|\*|\+|\d+\.)\s*").expect("valid markdown prefix regex")
});
pub(crate) static MULTISPACE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+").expect("valid multispace regex"));
pub(crate) const MAX_NOTE_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
pub(crate) const MAX_NOTE_SOURCE_ITEM_IDS: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteCardAttachment {
    pub id: String,
    pub file_name: String,
    pub content_type: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteCardPreviewAttachment {
    pub id: String,
    pub file_name: String,
    pub content_type: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum WorkspaceNoteCardSource {
    CodeSelection {
        path: String,
        #[serde(rename = "startLine")]
        start_line: u32,
        #[serde(rename = "endLine")]
        end_line: u32,
        language: Option<String>,
    },
    ConversationSelection {
        #[serde(rename = "threadId")]
        thread_id: String,
        #[serde(rename = "itemIds")]
        item_ids: Vec<String>,
    },
    ConversationThread {
        #[serde(rename = "threadId")]
        thread_id: String,
        #[serde(rename = "itemCount")]
        item_count: usize,
        #[serde(rename = "capturedAt")]
        captured_at: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceNoteCard {
    pub id: String,
    pub workspace_id: String,
    pub workspace_name: Option<String>,
    pub workspace_path: Option<String>,
    pub project_name: String,
    pub title: String,
    pub body_markdown: String,
    pub plain_text_excerpt: String,
    pub attachments: Vec<NoteCardAttachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<WorkspaceNoteCardSource>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceNoteCardSummary {
    pub id: String,
    pub title: String,
    pub plain_text_excerpt: String,
    pub body_markdown: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub archived_at: Option<i64>,
    pub archived: bool,
    pub image_count: usize,
    pub preview_attachments: Vec<NoteCardPreviewAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceNoteCardListResult {
    pub items: Vec<WorkspaceNoteCardSummary>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateWorkspaceNoteCardInput {
    pub workspace_id: String,
    pub workspace_name: Option<String>,
    pub workspace_path: Option<String>,
    pub title: Option<String>,
    pub body_markdown: String,
    pub attachment_inputs: Option<Vec<String>>,
    pub source: Option<WorkspaceNoteCardSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateWorkspaceNoteCardInput {
    pub workspace_name: Option<String>,
    pub workspace_path: Option<String>,
    pub title: Option<String>,
    pub body_markdown: Option<String>,
    pub attachment_inputs: Option<Vec<String>>,
}
