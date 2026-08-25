use super::*;
use std::path::{Path, PathBuf};

fn test_project_dir(
    base: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
) -> PathBuf {
    project_dir_path(base, workspace_id, workspace_name, workspace_path)
}

#[test]
fn derives_project_name_from_workspace_path_basename() {
    let derived = derive_project_name(
        Some("workspace-123"),
        Some("Alias Name"),
        Some("/tmp/My Fancy Repo"),
    );
    assert_eq!(derived, "my-fancy-repo");
}

#[test]
fn derives_project_name_from_workspace_id_when_name_and_path_are_missing() {
    let derived = derive_project_name(Some("workspace-123"), None, None);
    assert_eq!(derived, "workspace-123");
}

#[test]
fn reads_legacy_note_without_source() {
    let raw = r#"{
      "id": "legacy-note",
      "workspaceId": "workspace-1",
      "workspaceName": null,
      "workspacePath": null,
      "projectName": "workspace-1",
      "title": "Legacy",
      "bodyMarkdown": "body",
      "plainTextExcerpt": "body",
      "attachments": [],
      "createdAt": 1,
      "updatedAt": 1,
      "archivedAt": null
    }"#;

    let note: WorkspaceNoteCard = serde_json::from_str(raw).expect("deserialize legacy note");

    assert_eq!(note.id, "legacy-note");
    assert_eq!(note.source, None);
}

#[test]
fn normalizes_conversation_source_item_ids() {
    let normalized = normalize_note_source(Some(WorkspaceNoteCardSource::ConversationSelection {
        thread_id: " thread-1 ".to_string(),
        item_ids: vec![
            "item-1".to_string(),
            " item-1 ".to_string(),
            String::new(),
            "item-2".to_string(),
        ],
    }))
    .expect("normalize source");

    assert_eq!(
        normalized,
        Some(WorkspaceNoteCardSource::ConversationSelection {
            thread_id: "thread-1".to_string(),
            item_ids: vec!["item-1".to_string(), "item-2".to_string()],
        })
    );
}

#[test]
fn rejects_invalid_code_source_ranges() {
    let invalid_sources = [
        WorkspaceNoteCardSource::CodeSelection {
            path: " ".to_string(),
            start_line: 1,
            end_line: 1,
            language: None,
        },
        WorkspaceNoteCardSource::CodeSelection {
            path: "src/main.rs".to_string(),
            start_line: 0,
            end_line: 1,
            language: None,
        },
        WorkspaceNoteCardSource::CodeSelection {
            path: "src/main.rs".to_string(),
            start_line: 4,
            end_line: 3,
            language: None,
        },
    ];

    for source in invalid_sources {
        assert!(normalize_note_source(Some(source)).is_err());
    }
}

#[test]
fn keeps_ordinary_note_source_absent() {
    assert_eq!(normalize_note_source(None).expect("normalize source"), None);
}

#[test]
fn create_archive_and_restore_note_card_roundtrip() {
    let base = std::env::temp_dir().join(format!("note-card-tests-{}", uuid::Uuid::new_v4()));
    let project_dir = test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
    ensure_project_dirs(&project_dir).expect("create project dirs");

    let created = {
        let note_id = uuid::Uuid::new_v4().to_string();
        let body_markdown = "## Idea\nhello world".to_string();
        let note = WorkspaceNoteCard {
            id: note_id.clone(),
            workspace_id: "workspace-1".to_string(),
            workspace_name: Some("Repo".to_string()),
            workspace_path: Some("/tmp/repo".to_string()),
            project_name: derive_project_name(Some("workspace-1"), Some("Repo"), Some("/tmp/repo")),
            title: resolve_note_title(None, &body_markdown),
            body_markdown: body_markdown.clone(),
            plain_text_excerpt: build_plain_text_excerpt(&body_markdown),
            attachments: Vec::new(),
            source: Some(WorkspaceNoteCardSource::CodeSelection {
                path: "src/main.rs".to_string(),
                start_line: 4,
                end_line: 8,
                language: Some("rust".to_string()),
            }),
            created_at: now_ms(),
            updated_at: now_ms(),
            archived_at: None,
        };
        let path = note_file_path(&project_dir, &note_id, false);
        write_note_card(&path, &note).expect("write active note");
        note
    };

    let active_items = read_collection_summaries(&project_dir, false).expect("list active");
    assert_eq!(active_items.len(), 1);
    assert_eq!(active_items[0].title, created.title);

    let mut archived_note = read_note_card(
        &note_file_path(&project_dir, &created.id, false),
        &project_dir,
        false,
    )
    .expect("read note before archive");
    archived_note.archived_at = Some(now_ms());
    let archive_path = note_file_path(&project_dir, &created.id, true);
    write_note_card(&archive_path, &archived_note).expect("write archived note");
    std::fs::remove_file(note_file_path(&project_dir, &created.id, false))
        .expect("remove active note");

    let archived_items = read_collection_summaries(&project_dir, true).expect("list archive");
    assert_eq!(archived_items.len(), 1);
    assert!(archived_items[0].archived);

    let restored = read_note_card(&archive_path, &project_dir, true).expect("read archived note");
    assert_eq!(restored.id, created.id);
    assert_eq!(restored.source, created.source);

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn summarize_note_includes_preview_attachments() {
    let note = WorkspaceNoteCard {
        id: "note-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        workspace_name: Some("Repo".to_string()),
        workspace_path: Some("/tmp/repo".to_string()),
        project_name: "repo".to_string(),
        title: "Preview note".to_string(),
        body_markdown: "body".to_string(),
        plain_text_excerpt: "body".to_string(),
        attachments: vec![
            NoteCardAttachment {
                id: "attachment-1".to_string(),
                file_name: "image-1.png".to_string(),
                content_type: "image/png".to_string(),
                relative_path: "image-1.png".to_string(),
                absolute_path: "/tmp/repo/assets/note-1/image-1.png".to_string(),
                size_bytes: 4,
            },
            NoteCardAttachment {
                id: "attachment-2".to_string(),
                file_name: "image-2.png".to_string(),
                content_type: "image/png".to_string(),
                relative_path: "image-2.png".to_string(),
                absolute_path: "/tmp/repo/assets/note-1/image-2.png".to_string(),
                size_bytes: 4,
            },
            NoteCardAttachment {
                id: "attachment-3".to_string(),
                file_name: "image-3.png".to_string(),
                content_type: "image/png".to_string(),
                relative_path: "image-3.png".to_string(),
                absolute_path: "/tmp/repo/assets/note-1/image-3.png".to_string(),
                size_bytes: 4,
            },
            NoteCardAttachment {
                id: "attachment-4".to_string(),
                file_name: "image-4.png".to_string(),
                content_type: "image/png".to_string(),
                relative_path: "image-4.png".to_string(),
                absolute_path: "/tmp/repo/assets/note-1/image-4.png".to_string(),
                size_bytes: 4,
            },
        ],
        source: None,
        created_at: now_ms(),
        updated_at: now_ms(),
        archived_at: None,
    };

    let summary = summarize_note(&note, false);
    assert_eq!(summary.image_count, 4);
    assert_eq!(summary.preview_attachments.len(), 3);
    assert_eq!(summary.preview_attachments[0].file_name, "image-1.png");
    assert_eq!(summary.preview_attachments[2].file_name, "image-3.png");
}

#[test]
fn delete_note_card_removes_document_and_assets() {
    let base =
        std::env::temp_dir().join(format!("note-card-delete-tests-{}", uuid::Uuid::new_v4()));
    let project_dir = test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
    ensure_project_dirs(&project_dir).expect("create project dirs");

    let note_id = uuid::Uuid::new_v4().to_string();
    let note = WorkspaceNoteCard {
        id: note_id.clone(),
        workspace_id: "workspace-1".to_string(),
        workspace_name: Some("Repo".to_string()),
        workspace_path: Some("/tmp/repo".to_string()),
        project_name: derive_project_name(Some("workspace-1"), Some("Repo"), Some("/tmp/repo")),
        title: "Delete me".to_string(),
        body_markdown: "body".to_string(),
        plain_text_excerpt: "body".to_string(),
        attachments: vec![NoteCardAttachment {
            id: uuid::Uuid::new_v4().to_string(),
            file_name: "image.png".to_string(),
            content_type: "image/png".to_string(),
            relative_path: "preview-image.png".to_string(),
            absolute_path: note_asset_dir(&project_dir, &note_id)
                .join("preview-image.png")
                .to_string_lossy()
                .to_string(),
            size_bytes: 4,
        }],
        source: None,
        created_at: now_ms(),
        updated_at: now_ms(),
        archived_at: None,
    };

    let note_path = note_file_path(&project_dir, &note_id, false);
    write_note_card(&note_path, &note).expect("write note");
    let asset_dir = note_asset_dir(&project_dir, &note_id);
    std::fs::create_dir_all(&asset_dir).expect("create asset dir");
    std::fs::write(asset_dir.join("preview-image.png"), b"test").expect("write image");

    let deleted = delete_note_card_files(&project_dir, &note_id).expect("delete note");
    assert!(deleted);
    assert!(!note_path.exists());
    assert!(!asset_dir.exists());

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn sanitize_attachment_path_stays_inside_note_asset_dir() {
    let base =
        std::env::temp_dir().join(format!("note-card-hydrate-tests-{}", uuid::Uuid::new_v4()));
    let project_dir = test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
    let hydrated = hydrate_attachment_path(
        &project_dir,
        "note-1",
        NoteCardAttachment {
            id: "attachment-1".to_string(),
            file_name: "image.png".to_string(),
            content_type: "image/png".to_string(),
            relative_path: "../../escape.png".to_string(),
            absolute_path: String::new(),
            size_bytes: 4,
        },
    );
    let asset_dir = note_asset_dir(&project_dir, "note-1");
    assert_eq!(hydrated.relative_path, "escape.png");
    assert!(Path::new(&hydrated.absolute_path).starts_with(&asset_dir));
}

#[test]
fn resolve_note_card_location_falls_back_to_workspace_id_scan() {
    let base =
        std::env::temp_dir().join(format!("note-card-location-tests-{}", uuid::Uuid::new_v4()));
    let original_project_dir = test_project_dir(
        &base,
        Some("workspace-1"),
        Some("Repo"),
        Some("/tmp/original-repo"),
    );
    let renamed_project_dir = test_project_dir(
        &base,
        Some("workspace-1"),
        Some("Renamed Repo"),
        Some("/tmp/renamed-repo"),
    );
    ensure_project_dirs(&original_project_dir).expect("create original project dirs");
    ensure_project_dirs(&renamed_project_dir).expect("create renamed project dirs");

    let note_id = uuid::Uuid::new_v4().to_string();
    let note = WorkspaceNoteCard {
        id: note_id.clone(),
        workspace_id: "workspace-1".to_string(),
        workspace_name: Some("Repo".to_string()),
        workspace_path: Some("/tmp/original-repo".to_string()),
        project_name: derive_project_name(
            Some("workspace-1"),
            Some("Repo"),
            Some("/tmp/original-repo"),
        ),
        title: "Keep me".to_string(),
        body_markdown: "body".to_string(),
        plain_text_excerpt: "body".to_string(),
        attachments: Vec::new(),
        source: None,
        created_at: now_ms(),
        updated_at: now_ms(),
        archived_at: None,
    };
    let note_path = note_file_path(&original_project_dir, &note_id, false);
    write_note_card(&note_path, &note).expect("write original note");

    let located = resolve_note_card_location(
        &base,
        &note_id,
        Some("workspace-1"),
        Some("Renamed Repo"),
        Some("/tmp/renamed-repo"),
    )
    .expect("resolve note location")
    .expect("location exists");

    assert_eq!(located.project_dir, original_project_dir);
    assert_eq!(located.note_path, note_path);
    assert!(!located.archived);

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn normalize_attachment_path_key_handles_file_and_asset_variants() {
    assert_eq!(
        normalize_attachment_path_key("file:///C:/Users/Test/Image.png"),
        "c:/users/test/image.png"
    );
    assert_eq!(
        normalize_attachment_path_key("file:///tmp/demo/My%20Image.png"),
        "/tmp/demo/My Image.png"
    );
    assert_eq!(
        normalize_attachment_path_key("asset://localhost//tmp/demo/My%20Image.png"),
        "/tmp/demo/My Image.png"
    );
    assert_eq!(
        normalize_attachment_path_key("file:///tmp/demo/%E4%B8%AD%E6%96%87%20Image.png"),
        "/tmp/demo/中文 Image.png"
    );
    assert_eq!(
        normalize_attachment_path_key("file://server/share/My%20Image.png"),
        "//server/share/My Image.png"
    );
}

#[test]
fn materialize_attachments_skips_duplicate_existing_paths() {
    let base = std::env::temp_dir().join(format!(
        "note-card-attachment-dedupe-tests-{}",
        uuid::Uuid::new_v4()
    ));
    let project_dir = test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
    ensure_project_dirs(&project_dir).expect("create project dirs");
    let note_id = "note-1";
    let asset_dir = note_asset_dir(&project_dir, note_id);
    std::fs::create_dir_all(&asset_dir).expect("create asset dir");
    let existing_attachment = NoteCardAttachment {
        id: "attachment-1".to_string(),
        file_name: "image.png".to_string(),
        content_type: "image/png".to_string(),
        relative_path: "attachment-image.png".to_string(),
        absolute_path: asset_dir
            .join("attachment-image.png")
            .to_string_lossy()
            .to_string(),
        size_bytes: 4,
    };
    std::fs::write(&existing_attachment.absolute_path, b"test").expect("write image");

    let next = materialize_attachments(
        &project_dir,
        note_id,
        Some(vec![
            existing_attachment.absolute_path.clone(),
            existing_attachment.absolute_path.clone(),
        ]),
        &[existing_attachment.clone()],
    )
    .expect("materialize attachments");

    assert_eq!(next.len(), 1);
    assert_eq!(next[0].relative_path, existing_attachment.relative_path);

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn materialize_attachments_accepts_percent_encoded_file_uri_sources() {
    let base = std::env::temp_dir().join(format!(
        "note-card-attachment-file-uri-tests-{}",
        uuid::Uuid::new_v4()
    ));
    let project_dir = test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
    ensure_project_dirs(&project_dir).expect("create project dirs");

    let source_path = base.join("My Image.png");
    std::fs::write(&source_path, b"image-bytes").expect("write source image");

    let normalized_source = source_path.to_string_lossy().replace('\\', "/");
    let encoded_source = normalized_source.replace(' ', "%20");
    let file_uri = if normalized_source.starts_with('/') {
        format!("file://{encoded_source}")
    } else {
        format!("file:///{encoded_source}")
    };

    let next = materialize_attachments(&project_dir, "note-1", Some(vec![file_uri]), &[])
        .expect("materialize attachments");

    assert_eq!(next.len(), 1);
    assert_eq!(next[0].file_name, "My-Image.png");
    assert_eq!(next[0].size_bytes, 11);
    assert!(Path::new(&next[0].absolute_path).exists());

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn collect_workspace_note_summaries_matches_full_body_query() {
    let base =
        std::env::temp_dir().join(format!("note-card-search-tests-{}", uuid::Uuid::new_v4()));
    let project_dir = test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
    ensure_project_dirs(&project_dir).expect("create project dirs");

    let long_prefix = "前缀内容".repeat(80);
    let body = format!("{long_prefix}\n\n深层关键词 body-keyword");
    let note = WorkspaceNoteCard {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: "workspace-1".to_string(),
        workspace_name: Some("Repo".to_string()),
        workspace_path: Some("/tmp/repo".to_string()),
        project_name: derive_project_name(Some("workspace-1"), Some("Repo"), Some("/tmp/repo")),
        title: "Search me".to_string(),
        body_markdown: body.clone(),
        plain_text_excerpt: build_plain_text_excerpt(&body),
        attachments: Vec::new(),
        source: None,
        created_at: now_ms(),
        updated_at: now_ms(),
        archived_at: None,
    };
    write_note_card(&note_file_path(&project_dir, &note.id, false), &note).expect("write note");

    let matched = collect_workspace_note_summaries(
        &base,
        Some("workspace-1"),
        Some("Repo"),
        Some("/tmp/repo"),
        false,
        Some("body-keyword"),
    )
    .expect("collect summaries");

    assert_eq!(matched.len(), 1);
    assert_eq!(matched[0].id, note.id);

    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn resolve_note_card_location_skips_corrupted_candidate_and_finds_valid_note() {
    let base = std::env::temp_dir().join(format!(
        "note-card-corrupted-location-tests-{}",
        uuid::Uuid::new_v4()
    ));
    let preferred_project_dir = test_project_dir(
        &base,
        Some("workspace-1"),
        Some("Renamed Repo"),
        Some("/tmp/renamed-repo"),
    );
    let fallback_project_dir =
        test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
    ensure_project_dirs(&preferred_project_dir).expect("create preferred project dirs");
    ensure_project_dirs(&fallback_project_dir).expect("create fallback project dirs");

    let note_id = uuid::Uuid::new_v4().to_string();
    std::fs::write(
        note_file_path(&preferred_project_dir, &note_id, false),
        "{ not-valid-json",
    )
    .expect("write corrupted preferred note");

    let valid_note = WorkspaceNoteCard {
        id: note_id.clone(),
        workspace_id: "workspace-1".to_string(),
        workspace_name: Some("Repo".to_string()),
        workspace_path: Some("/tmp/repo".to_string()),
        project_name: derive_project_name(Some("workspace-1"), Some("Repo"), Some("/tmp/repo")),
        title: "Valid".to_string(),
        body_markdown: "body".to_string(),
        plain_text_excerpt: "body".to_string(),
        attachments: Vec::new(),
        source: None,
        created_at: now_ms(),
        updated_at: now_ms(),
        archived_at: None,
    };
    let fallback_note_path = note_file_path(&fallback_project_dir, &note_id, false);
    write_note_card(&fallback_note_path, &valid_note).expect("write valid note");

    let located = resolve_note_card_location(
        &base,
        &note_id,
        Some("workspace-1"),
        Some("Renamed Repo"),
        Some("/tmp/renamed-repo"),
    )
    .expect("resolve note location")
    .expect("location exists");

    assert_eq!(located.project_dir, fallback_project_dir);
    assert_eq!(located.note_path, fallback_note_path);

    std::fs::remove_dir_all(&base).ok();
}
