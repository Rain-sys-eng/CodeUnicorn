use super::claude_history::{
    encode_project_path, load_claude_session_from_base_dir_window, CLAUDE_WINDOW_TAIL_CHUNK,
};
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// OpenSpec change: fix-claude-history-window-message-loss
///
/// 这些测试锁定 window 加载的三条保真契约：
///   T1 chunk 边界完整行守恒（不得 glue 吞行）
///   T2 全文件可覆盖时不 drain、无死游标
///   T3 多页遍历连续无损（并集 == 全量、无交集）
///   T4 单行超过 byte window 时由更早分页完整带回（fail-closed，不产生错位）

fn create_project_dir(base_dir: &Path, workspace_path: &Path) -> PathBuf {
    let project_dir = base_dir.join(encode_project_path(&workspace_path.to_string_lossy()));
    std::fs::create_dir_all(&project_dir).expect("create project dir");
    project_dir
}

fn user_line(uuid: &str, text: &str, workspace_path: &Path) -> String {
    json!({
        "uuid": uuid,
        "timestamp": "2026-08-26T00:00:00.000Z",
        "cwd": workspace_path.to_string_lossy(),
        "message": { "role": "user", "content": text }
    })
    .to_string()
}

fn assistant_text_line(uuid: &str, text: &str, workspace_path: &Path) -> String {
    json!({
        "uuid": uuid,
        "timestamp": "2026-08-26T00:00:00.000Z",
        "cwd": workspace_path.to_string_lossy(),
        "message": { "role": "assistant", "content": [{ "type": "text", "text": text }] }
    })
    .to_string()
}

struct SessionFixture {
    temp_root: PathBuf,
    base_dir: PathBuf,
    workspace_path: PathBuf,
    session_id: String,
}

impl SessionFixture {
    fn new(tag: &str) -> Self {
        let unique = Uuid::new_v4();
        let temp_root =
            std::env::temp_dir().join(format!("ccgui-claude-window-fidelity-{tag}-{unique}"));
        let base_dir = temp_root.join("claude-projects");
        let workspace_path = temp_root.join("workspace");
        std::fs::create_dir_all(&workspace_path).expect("create workspace");
        let session_id = format!("{tag}-{unique}");
        Self {
            temp_root,
            base_dir,
            workspace_path,
            session_id,
        }
    }

    fn write_session(&self, lines: &[String]) {
        let project_dir = create_project_dir(&self.base_dir, &self.workspace_path);
        let session_path = project_dir.join(format!("{}.jsonl", self.session_id));
        let mut file = File::create(&session_path).expect("create session file");
        for line in lines {
            writeln!(file, "{line}").expect("write line");
        }
    }

    async fn load_window(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> super::claude_history::ClaudeSessionLoadResult {
        load_claude_session_from_base_dir_window(
            &self.base_dir,
            &self.workspace_path,
            &self.session_id,
            Some(limit),
            before,
        )
        .await
        .expect("window load")
    }
}

impl Drop for SessionFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.temp_root);
    }
}

/// 构造一条总长度恰好为 target_len 的 user 行（json 包装开销通过迭代补齐）。
fn exact_len_user_line(
    uuid: &str,
    prefix: &str,
    target_len: usize,
    workspace_path: &Path,
) -> String {
    let mut pad = target_len;
    loop {
        let text = format!("{prefix}{}", "p".repeat(pad));
        let line = user_line(uuid, &text, workspace_path);
        match line.len().cmp(&target_len) {
            std::cmp::Ordering::Equal => return line,
            std::cmp::Ordering::Less => pad += target_len - line.len(),
            std::cmp::Ordering::Greater => pad -= line.len() - target_len,
        }
    }
}

/// T1：一条 assistant text 行压住 window 组装的 chunk 边界（file_len - CHUNK）时，
/// window 加载必须完整保留该行，且全部写入行一行不少（禁止 glue 吞行）。
#[tokio::test]
async fn window_preserves_line_straddling_chunk_boundary() {
    let fixture = SessionFixture::new("boundary");
    let chunk = CLAUDE_WINDOW_TAIL_CHUNK as usize;
    // file_len 恰好 2 * chunk，首个（唯一）内部 chunk 边界就在 chunk 处。
    let boundary = chunk;
    let file_len_target = chunk * 2;

    let mut lines: Vec<String> = Vec::new();
    let mut cursor = 0usize;
    let mut index = 0usize;
    // 填充到 boundary - 100，使下一条 marked 行横跨边界。
    while cursor + 4096 < boundary - 100 {
        let text = format!("filler head {index} {}", "x".repeat(2048));
        let line = user_line(&format!("head-{index}"), &text, &fixture.workspace_path);
        cursor += line.len() + 1;
        lines.push(line);
        index += 1;
    }
    {
        let line = exact_len_user_line(
            "head-pad",
            "pad",
            boundary - 100 - cursor - 1,
            &fixture.workspace_path,
        );
        cursor += line.len() + 1;
        assert_eq!(
            cursor,
            boundary - 100,
            "pre-marked cursor must land exactly"
        );
        lines.push(line);
    }
    let marked_text = format!("MARKED-ASSISTANT-REPLY {}", "m".repeat(4096));
    let marked_line =
        assistant_text_line("marked-assistant", &marked_text, &fixture.workspace_path);
    assert!(
        cursor < boundary && cursor + marked_line.len() + 1 > boundary,
        "marked line must straddle the chunk boundary"
    );
    cursor += marked_line.len() + 1;
    lines.push(marked_line);
    // 尾部补到恰好 2 * chunk。
    while cursor + 4096 < file_len_target {
        let text = format!("filler tail {index} {}", "y".repeat(2048));
        let line = user_line(&format!("tail-{index}"), &text, &fixture.workspace_path);
        cursor += line.len() + 1;
        lines.push(line);
        index += 1;
    }
    {
        let line = exact_len_user_line(
            "tail-pad",
            "tpad",
            file_len_target - cursor - 1,
            &fixture.workspace_path,
        );
        cursor += line.len() + 1;
        assert_eq!(cursor, file_len_target, "file length must land exactly");
        lines.push(line);
    }
    let total_lines = lines.len();
    fixture.write_session(&lines);

    // limit 取大值保证 threshold 不提前截断（整文件组装）。
    let result = fixture.load_window(10_000, None).await;
    let texts: Vec<&str> = result.messages.iter().map(|m| m.text.as_str()).collect();
    assert!(
        texts.iter().any(|t| t.contains("MARKED-ASSISTANT-REPLY")),
        "assistant text line straddling the chunk boundary must survive window assembly"
    );
    assert_eq!(
        result.messages.len(),
        total_lines,
        "every complete jsonl line must be projected exactly once (no glue loss)"
    );
}

/// T2：全文件可被 window 覆盖但 messages 数超过 limit 时，不得 drain，
/// 且 has_more=false、next_cursor=None（死游标消除）。
#[tokio::test]
async fn window_whole_file_returns_all_messages_without_dead_cursor() {
    let fixture = SessionFixture::new("dead-cursor");
    let mut lines = Vec::new();
    for index in 0..100 {
        lines.push(user_line(
            &format!("u-{index}"),
            &format!("prompt {index}"),
            &fixture.workspace_path,
        ));
    }
    fixture.write_session(&lines);

    let result = fixture.load_window(80, None).await;
    assert_eq!(
        result.messages.len(),
        100,
        "whole-file window must not drain parsed messages"
    );
    assert_eq!(result.messages[0].text, "prompt 0");
    assert_eq!(result.messages[99].text, "prompt 99");
    assert_eq!(
        result.has_more,
        Some(false),
        "window_start == 0 means nothing older exists on disk"
    );
    assert_eq!(
        result.next_cursor, None,
        "cursor \"0\" strands drained rows: older pages must not be advertised"
    );
}

/// T3：window_start > 0 的大文件，逐页遍历必须连续无损（并集 == 全量、无交集）。
#[tokio::test]
async fn window_pagination_is_contiguous_and_lossless() {
    let fixture = SessionFixture::new("pagination");
    // 40 行 × ~9KB ≈ 360KB；limit=3 → threshold 12 newlines，末 256KB 内行数足够，
    // 首页 window_start > 0。
    let mut lines = Vec::new();
    for index in 0..40 {
        let text = format!("page-line-{index:02} {}", "z".repeat(9 * 1024));
        lines.push(user_line(
            &format!("p-{index:02}"),
            &text,
            &fixture.workspace_path,
        ));
    }
    fixture.write_session(&lines);

    let mut seen: Vec<String> = Vec::new();
    let mut before: Option<String> = None;
    let mut pages = 0usize;
    loop {
        let result = fixture.load_window(3, before.as_deref()).await;
        for message in &result.messages {
            assert!(
                !seen.contains(&message.text),
                "page overlap: message delivered twice"
            );
            seen.push(message.text.clone());
        }
        pages += 1;
        if result.has_more == Some(true) {
            before = result.next_cursor.clone();
            assert!(
                before.as_deref().map(|c| c != "0").unwrap_or(false),
                "cursor must be a real line-aligned offset, never \"0\""
            );
        } else {
            break;
        }
        assert!(pages < 10, "pagination must terminate");
    }
    assert!(pages >= 2, "fixture must force multiple pages");
    assert_eq!(
        seen.len(),
        40,
        "every message must appear exactly once across pages"
    );
    for index in 0..40 {
        let marker = format!("page-line-{index:02}");
        assert!(
            seen.iter().any(|t| t.contains(&marker)),
            "missing {marker} across paginated walk"
        );
    }
}

/// T4：单行 >256KB（模拟大图消息）压 page seam 时，本页 fail-closed，
/// 由更早分页完整带回；全分页遍历后该消息恰好出现一次。
#[tokio::test]
async fn window_giant_single_line_is_carried_by_older_page() {
    let fixture = SessionFixture::new("giant-line");
    let mut lines = Vec::new();
    for index in 0..10 {
        lines.push(user_line(
            &format!("g-head-{index}"),
            &format!("head prompt {index}"),
            &fixture.workspace_path,
        ));
    }
    let giant_text = format!("GIANT-IMAGE-MESSAGE {}", "g".repeat(300 * 1024));
    lines.push(user_line("giant", &giant_text, &fixture.workspace_path));
    for index in 0..10 {
        lines.push(user_line(
            &format!("g-tail-{index}"),
            &format!("tail prompt {index}"),
            &fixture.workspace_path,
        ));
    }
    fixture.write_session(&lines);

    let mut seen: Vec<String> = Vec::new();
    let mut before: Option<String> = None;
    let mut pages = 0usize;
    loop {
        let result = fixture.load_window(1, before.as_deref()).await;
        for message in &result.messages {
            assert!(
                !message.text.contains("GIANT-IMAGE-MESSAGE") || message.text.len() > 300 * 1024,
                "giant line must never surface as a truncated fragment"
            );
            seen.push(message.text.clone());
        }
        pages += 1;
        if result.has_more == Some(true) {
            before = result.next_cursor.clone();
        } else {
            break;
        }
        assert!(pages < 10, "pagination must terminate");
    }
    let giant_hits = seen
        .iter()
        .filter(|t| t.contains("GIANT-IMAGE-MESSAGE"))
        .count();
    assert_eq!(
        giant_hits, 1,
        "giant line must be delivered exactly once by some page"
    );
    for index in 0..10 {
        assert!(seen
            .iter()
            .any(|t| t.contains(&format!("head prompt {index}"))));
        assert!(seen
            .iter()
            .any(|t| t.contains(&format!("tail prompt {index}"))));
    }
}
