use super::claude_history::{
    claude_list_io_stats_for_prefix, encode_project_path, list_claude_sessions_from_base_dir,
    load_claude_session_from_base_dir, load_claude_session_from_base_dir_window,
    ClaudeSessionAttributionScope, CLAUDE_LIST_SCAN_MAX_BYTES,
};
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::time::{Duration, SystemTime};
use uuid::Uuid;

const EIGHT_MIB: u64 = 8 * 1024 * 1024;
const LIST_READ_BYTE_CAP: u64 = 256 * 1024;

fn create_project_dir(
    base_dir: &std::path::Path,
    workspace_path: &std::path::Path,
) -> std::path::PathBuf {
    let project_dir = base_dir.join(encode_project_path(&workspace_path.to_string_lossy()));
    std::fs::create_dir_all(&project_dir).expect("create project dir");
    project_dir
}

fn write_sparse_session(
    path: &std::path::Path,
    workspace_path: &std::path::Path,
    prompt: &str,
    logical_size: u64,
) {
    let line = json!({
        "timestamp": "2026-08-13T00:00:00.000Z",
        "cwd": workspace_path.to_string_lossy(),
        "message": { "role": "user", "content": prompt }
    })
    .to_string();
    let mut file = File::create(path).expect("create sparse session");
    writeln!(file, "{line}").expect("write header line");
    file.set_len(logical_size).expect("inflate sparse size");
}

#[tokio::test]
async fn list_claude_sessions_caps_read_bytes_on_sparse_large_file() {
    let unique = Uuid::new_v4();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-list-budget-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("sparse-{}", unique);
    let session_path = project_dir.join(format!("{session_id}.jsonl"));
    write_sparse_session(
        &session_path,
        &workspace_path,
        "First user preview for list budget",
        EIGHT_MIB,
    );

    let sessions = list_claude_sessions_from_base_dir(
        &base_dir,
        &workspace_path,
        &[ClaudeSessionAttributionScope::workspace_path(
            workspace_path.clone(),
        )],
        Some(10),
    )
    .await
    .expect("list sparse session");

    let (_opened, read_bytes) = claude_list_io_stats_for_prefix(&temp_root);
    assert_eq!(sessions.len(), 1, "list should still find the session");
    assert_eq!(sessions[0].session_id, session_id);
    assert_eq!(
        sessions[0].first_message,
        "First user preview for list budget"
    );
    assert!(
        read_bytes <= LIST_READ_BYTE_CAP,
        "list_claude_sessions read {read_bytes} bytes from an {EIGHT_MIB}-byte file; cap is {LIST_READ_BYTE_CAP} (budget {CLAUDE_LIST_SCAN_MAX_BYTES})"
    );
    assert!(
        read_bytes > 0,
        "io meter must observe the header read so the cap assertion is meaningful"
    );

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn list_claude_sessions_opens_only_limit_files_after_mtime_sort() {
    let unique = Uuid::new_v4();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-list-limit-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let project_dir = create_project_dir(&base_dir, &workspace_path);

    let base_mtime = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    for index in 0..8 {
        let session_id = format!("limit-{unique}-{index}");
        let path = project_dir.join(format!("{session_id}.jsonl"));
        write_sparse_session(
            &path,
            &workspace_path,
            &format!("prompt {index}"),
            if index < 5 { EIGHT_MIB } else { 512 },
        );
        let file = File::options()
            .write(true)
            .open(&path)
            .expect("reopen for mtime");
        file.set_modified(base_mtime + Duration::from_secs(index as u64))
            .expect("set mtime");
    }

    let sessions = list_claude_sessions_from_base_dir(
        &base_dir,
        &workspace_path,
        &[ClaudeSessionAttributionScope::workspace_path(
            workspace_path.clone(),
        )],
        Some(3),
    )
    .await
    .expect("list limited sessions");

    let (opened, read_bytes) = claude_list_io_stats_for_prefix(&temp_root);
    assert_eq!(sessions.len(), 3);
    let ids: Vec<String> = sessions.iter().map(|s| s.session_id.clone()).collect();
    assert!(
        ids.iter()
            .all(|id| { id.ends_with("-5") || id.ends_with("-6") || id.ends_with("-7") }),
        "IO-before-limit must keep the newest files, got {ids:?}"
    );
    assert_eq!(
        opened, 3,
        "list_claude_sessions opened {opened} files with limit=3; must not scan the whole directory"
    );
    assert!(
        read_bytes <= LIST_READ_BYTE_CAP,
        "limit=3 must not read the five 8MiB older files; read {read_bytes} bytes"
    );

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn list_claude_sessions_does_not_inventory_subagent_jsonl() {
    let unique = Uuid::new_v4();
    let temp_root =
        std::env::temp_dir().join(format!("ccgui-claude-list-skip-subagent-{}", unique));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let parent_id = format!("parent-{unique}");
    write_sparse_session(
        &project_dir.join(format!("{parent_id}.jsonl")),
        &workspace_path,
        "parent prompt",
        256,
    );
    let subagents_dir = project_dir.join(&parent_id).join("subagents");
    std::fs::create_dir_all(&subagents_dir).expect("create subagents");
    write_sparse_session(
        &subagents_dir.join("agent-deadbeef.jsonl"),
        &workspace_path,
        "child prompt",
        EIGHT_MIB,
    );

    let sessions = list_claude_sessions_from_base_dir(
        &base_dir,
        &workspace_path,
        &[ClaudeSessionAttributionScope::workspace_path(
            workspace_path.clone(),
        )],
        None,
    )
    .await
    .expect("list parent only");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, parent_id);
    assert!(
        sessions.iter().all(|s| s.parent_session_id.is_none()),
        "sidebar list must not inventory subagent jsonl"
    );
    let (opened, _) = claude_list_io_stats_for_prefix(&temp_root);
    assert_eq!(opened, 1, "must not open the 8MiB subagent transcript");

    let _ = std::fs::remove_dir_all(&temp_root);
}

#[tokio::test]
async fn load_claude_session_window_returns_tail_and_has_more() {
    let unique = Uuid::new_v4();
    let temp_root = std::env::temp_dir().join(format!("ccgui-claude-load-window-{unique}"));
    let base_dir = temp_root.join("claude-projects");
    let workspace_path = temp_root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("workspace");
    let project_dir = create_project_dir(&base_dir, &workspace_path);
    let session_id = format!("window-{unique}");
    let session_path = project_dir.join(format!("{session_id}.jsonl"));
    let mut file = File::create(&session_path).expect("create");
    for index in 0..20 {
        let line = json!({
            "uuid": format!("u-{index}"),
            "timestamp": format!("2026-08-13T00:00:{index:02}.000Z"),
            "cwd": workspace_path.to_string_lossy(),
            "message": { "role": "user", "content": format!("prompt {index}") }
        });
        writeln!(file, "{line}").expect("write");
    }
    drop(file);

    let windowed = load_claude_session_from_base_dir_window(
        &base_dir,
        &workspace_path,
        &session_id,
        Some(3),
        None,
    )
    .await
    .expect("window load");
    assert_eq!(windowed.messages.len(), 3);
    assert_eq!(windowed.messages[0].text, "prompt 17");
    assert_eq!(windowed.messages[2].text, "prompt 19");
    assert_eq!(windowed.has_more, Some(true));
    assert!(windowed.next_cursor.is_some());

    let full = load_claude_session_from_base_dir(&base_dir, &workspace_path, &session_id)
        .await
        .expect("full load");
    assert_eq!(full.messages.len(), 20);
    assert_eq!(full.has_more, None);

    let _ = std::fs::remove_dir_all(&temp_root);
}
