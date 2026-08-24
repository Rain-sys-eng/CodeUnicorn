//! Shared helpers for CLI engines that accept local image attachments.
//!
//! Used by Grok (`--prompt-file` ACP blocks), OpenCode (`run -f`), Kimi
//! (path injection + ReadMediaFile workflow), PI (`@file` argv), and DSH
//! (`session.prompt` image parts).

use std::path::{Path, PathBuf};

/// CLI-only text block Grok injects when the user attaches images with empty text.
///
/// Multimodal `--prompt-file` requires at least one text content block. This
/// string is **not** user-authored and MUST be stripped from history / canvas
/// display (see `parse_grok_user_prompt_for_display`).
pub(crate) const GROK_IMAGE_ONLY_FALLBACK_TEXT: &str = "Please analyze the attached image(s).";

/// Collect trimmed, non-empty, deduped image path entries from send params.
pub(crate) fn collect_non_empty_image_paths(images: Option<&[String]>) -> Vec<String> {
    let Some(images) = images else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in images {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.iter().any(|existing: &String| existing == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

/// Summarize an image attachment for user-visible errors and logs.
///
/// Data URLs MUST NOT appear verbatim: a Retina screenshot is multi-MB
/// base64 and would flood the turn-failed bubble (looks like a leak).
pub(crate) fn describe_image_ref_for_error(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.get(..5).map(|s| s.eq_ignore_ascii_case("data:")) != Some(true) {
        return trimmed.to_string();
    }
    let rest = trimmed.get(5..).unwrap_or("");
    let (meta, payload) = rest.split_once(',').unwrap_or((rest, ""));
    let mime = meta
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("image");
    let encoded = payload.trim();
    if encoded.is_empty() {
        return format!("data URL ({mime})");
    }
    format!(
        "data URL ({mime}, ~{})",
        format_compact_bytes(estimate_base64_decoded_len(encoded))
    )
}

fn estimate_base64_decoded_len(encoded: &str) -> usize {
    let len = encoded.len();
    let padding = if encoded.ends_with("==") {
        2
    } else if encoded.ends_with('=') {
        1
    } else {
        0
    };
    (len.saturating_mul(3) / 4).saturating_sub(padding)
}

fn format_compact_bytes(bytes: usize) -> String {
    const KIB: usize = 1024;
    const MIB: usize = 1024 * 1024;
    if bytes >= MIB {
        let tenths = (bytes * 10 + MIB / 2) / MIB;
        format!("{}.{}MB", tenths / 10, tenths % 10)
    } else if bytes >= KIB {
        format!("{}KB", (bytes + KIB / 2) / KIB)
    } else {
        format!("{bytes}B")
    }
}

/// Normalize a user-facing image reference into a local filesystem path.
///
/// Supports absolute/relative paths, `file://` URLs, and rejects empty input.
/// Data URLs are rejected because callers must handle them separately.
pub(crate) fn normalize_local_image_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    if trimmed.get(..5).map(|s| s.eq_ignore_ascii_case("data:")) == Some(true) {
        return Err("data URL is not a filesystem path".to_string());
    }
    let without_scheme = if let Some(rest) = trimmed.strip_prefix("file://") {
        let rest = rest.strip_prefix("localhost").unwrap_or(rest);
        percent_decode_path(rest)
    } else {
        trimmed.to_string()
    };
    let path = PathBuf::from(without_scheme);
    if path.as_os_str().is_empty() {
        return Err("empty path".to_string());
    }
    Ok(path)
}

/// Resolve image paths that exist on disk as absolute paths.
///
/// Data URLs and unreadable paths are skipped with a warning-friendly error list.
pub(crate) fn resolve_existing_image_files(
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Vec<PathBuf>, String> {
    let raw_paths = collect_non_empty_image_paths(images);
    if raw_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut resolved = Vec::new();
    let mut errors = Vec::new();
    for raw in raw_paths {
        if raw.get(..5).map(|s| s.eq_ignore_ascii_case("data:")) == Some(true) {
            // Persist data URL to a temp file under the workspace so path-based
            // CLIs (OpenCode -f, Kimi ReadMediaFile) can consume it.
            match materialize_data_url_to_workspace(&raw, workspace_path) {
                Ok(path) => resolved.push(path),
                Err(error) => {
                    errors.push(format!("{}: {error}", describe_image_ref_for_error(&raw)))
                }
            }
            continue;
        }
        match normalize_local_image_path(&raw) {
            Ok(path) => {
                let absolute = if path.is_absolute() {
                    path
                } else {
                    workspace_path.join(path)
                };
                match std::fs::metadata(&absolute) {
                    Ok(meta) if meta.is_file() => resolved.push(absolute),
                    Ok(_) => errors.push(format!("{}: not a regular file", absolute.display())),
                    Err(error) => {
                        errors.push(format!("{}: {}", absolute.display(), error));
                    }
                }
            }
            Err(error) => errors.push(format!("{}: {error}", describe_image_ref_for_error(&raw))),
        }
    }

    if resolved.is_empty() {
        return Err(format!(
            "none of the attached images could be resolved ({})",
            errors.join("; ")
        ));
    }
    if !errors.is_empty() {
        log::warn!(
            "[cli-image] partial image resolve: {} ok, {} failed ({})",
            resolved.len(),
            errors.len(),
            errors.join("; ")
        );
    }
    Ok(resolved)
}

fn materialize_data_url_to_workspace(raw: &str, workspace_path: &Path) -> Result<PathBuf, String> {
    let rest = raw.get(5..).ok_or_else(|| "invalid data URL".to_string())?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| "invalid data URL".to_string())?;
    if !meta.to_ascii_lowercase().contains(";base64") {
        return Err("data URL must be base64".to_string());
    }
    let mime = meta
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png");
    let ext = match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("invalid base64 data URL: {error}"))?;
    let dir = workspace_path.join(".mossx").join("image-staging");
    std::fs::create_dir_all(&dir).map_err(|error| format!("mkdir staging: {error}"))?;
    let path = dir.join(format!("attach-{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&path, bytes).map_err(|error| format!("write staging: {error}"))?;
    Ok(path)
}

fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                (bytes[index + 1] as char).to_digit(16),
                (bytes[index + 2] as char).to_digit(16),
            ) {
                out.push((hi * 16 + lo) as u8);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Stable marker separating user-visible text from Kimi CLI-only image injection.
/// The Kimi history loader strips everything from this marker onward.
pub(crate) const KIMI_IMAGE_INJECTION_MARKER: &str = "\n\n<!-- mossx:kimi-image-attachments -->\n";

/// Build a Kimi headless prompt that makes attached images reachable.
///
/// Kimi's `-p` path only accepts a text prompt. Interactive paste expands to
/// `image_url` parts via TUI store; headless uses path tags + ReadMediaFile
/// (auto permission in print mode). Absolute paths are required.
///
/// The injection block is marked so UI/history can strip it and restore
/// `images[]` for thumbnail display — users must never see the tool instructions.
pub(crate) fn build_kimi_prompt_with_images(text: &str, image_paths: &[PathBuf]) -> String {
    if image_paths.is_empty() {
        return text.to_string();
    }

    let mut out = text.trim_end().to_string();
    out.push_str(KIMI_IMAGE_INJECTION_MARKER);
    out.push_str("The user attached the following image file(s). ");
    out.push_str(
        "You MUST call ReadMediaFile on each path below before answering any question about visual content.\n",
    );
    for (index, path) in image_paths.iter().enumerate() {
        let display = path.display();
        out.push_str(&format!("{}. {}\n", index + 1, display));
        // Kimi's degraded-media / ReadMediaFile workflow recognizes this tag form.
        out.push_str(&format!(
            "<image path=\"{}\"></image>\n",
            escape_xml_attr(&display.to_string())
        ));
    }
    out
}

/// Split a Kimi wire prompt into user-visible text + image paths for UI/history.
///
/// Returns `(display_text, image_paths)`. When no mossx injection marker is
/// present, also falls back to detecting the plain-English instruction block
/// from older builds.
pub(crate) fn split_kimi_prompt_for_display(text: &str) -> (String, Vec<String>) {
    if let Some(split_at) = text.find(KIMI_IMAGE_INJECTION_MARKER) {
        let visible = text[..split_at].trim_end().to_string();
        let injection = &text[split_at + KIMI_IMAGE_INJECTION_MARKER.len()..];
        return (visible, extract_image_paths_from_injection(injection));
    }

    // Legacy injection without HTML marker (pre-marker builds).
    const LEGACY_PREFIX: &str =
        "The user attached the following image file(s). You MUST call ReadMediaFile";
    if let Some(split_at) = text.find(LEGACY_PREFIX) {
        // Prefer splitting at the double-newline before the instruction.
        let boundary = text[..split_at]
            .rfind("\n\n")
            .map(|idx| idx)
            .unwrap_or(split_at);
        let visible = text[..boundary].trim_end().to_string();
        let injection = text[boundary..].trim_start();
        return (visible, extract_image_paths_from_injection(injection));
    }

    (text.to_string(), Vec::new())
}

/// Stable marker separating user-visible text from PI CLI-only image injection.
///
/// Legacy transport (pre `@file` switch): sessions written before the upgrade
/// may still contain this marker; keep it for history parsing only.
pub(crate) const PI_IMAGE_INJECTION_MARKER: &str = "\n\n<!-- mossx:pi-image-attachments -->\n";

/// Build Pi `@file` arguments that attach image files as native image content
/// blocks in print mode. One argument per image, in attachment order.
pub(crate) fn pi_image_file_args(image_paths: &[PathBuf]) -> Vec<String> {
    image_paths
        .iter()
        .map(|path| format!("@{}", path.display()))
        .collect()
}

/// Build a PI headless prompt that makes attached images reachable via Read tools.
///
/// Legacy transport kept for history round-trip tests of pre-`@file` sessions;
/// new sends MUST use `pi_image_file_args` instead.
#[cfg(test)]
pub(crate) fn build_pi_prompt_with_images(text: &str, image_paths: &[PathBuf]) -> String {
    if image_paths.is_empty() {
        return text.to_string();
    }

    let mut out = text.trim_end().to_string();
    out.push_str(PI_IMAGE_INJECTION_MARKER);
    out.push_str("The user attached the following image file(s). ");
    out.push_str(
        "You MUST call the read tool on each absolute path below before answering questions about visual content.\n",
    );
    for (index, path) in image_paths.iter().enumerate() {
        let display = path.display();
        out.push_str(&format!("{}. {}\n", index + 1, display));
    }
    out
}

/// Split a PI wire prompt into user-visible text + image paths for UI/history.
pub(crate) fn split_pi_prompt_for_display(text: &str) -> (String, Vec<String>) {
    if let Some(split_at) = text.find(PI_IMAGE_INJECTION_MARKER) {
        let visible = text[..split_at].trim_end().to_string();
        let injection = &text[split_at + PI_IMAGE_INJECTION_MARKER.len()..];
        return (visible, extract_image_paths_from_injection(injection));
    }
    (text.to_string(), Vec::new())
}

/// Split a Pi `@file`-era user message text into user-visible text + image paths.
///
/// Pi's file processor wraps each attached file as `<file name="/abs/path">...</file>`
/// ahead of the user text; the inner content may hold processing hints. Image
/// content blocks are ignored by history (display goes through paths), so only
/// the text block needs splitting here.
pub(crate) fn split_pi_file_attachments_for_display(text: &str) -> (String, Vec<String>) {
    if !text.contains("<file name=\"") {
        return (text.to_string(), Vec::new());
    }
    let mut paths: Vec<String> = Vec::new();
    let mut visible = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<file name=\"") {
        visible.push_str(&rest[..start]);
        let after_open = &rest[start + "<file name=\"".len()..];
        let Some(quote_end) = after_open.find('"') else {
            // Malformed tag: keep the remainder verbatim.
            visible.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let raw_path = &after_open[..quote_end];
        let Some(open_tag_end) = after_open[quote_end..].find('>').map(|i| quote_end + i) else {
            visible.push_str(&rest[start..]);
            rest = "";
            break;
        };
        // open_tag_end 相对 after_open（已去掉 `<file name="` 前缀）；切 rest
        // 必须换算回绝对位置——直接用相对索引在多字节路径（中文目录名）下
        // 会切进 UTF-8 字符中间 panic（2026-08-24 er-qi 中文路径附件实测：
        // panic 杀 command 任务，invoke 永不 resolve，前端永远卡加载）。
        let inner_start = start + "<file name=\"".len() + open_tag_end + 1;
        if let Some(close_at) = rest[inner_start..].find("</file>") {
            rest = &rest[inner_start + close_at + "</file>".len()..];
        } else {
            // Truncated wrapper: skip just the open tag.
            rest = &rest[inner_start..];
        }
        let path = unescape_xml_attr(raw_path);
        if !path.is_empty() && !paths.iter().any(|existing| existing == &path) {
            paths.push(path);
        }
    }
    visible.push_str(rest);
    (visible.trim().to_string(), paths)
}

fn extract_image_paths_from_injection(injection: &str) -> Vec<String> {
    let mut paths = Vec::new();
    // Prefer structured tags: <image path="..."></image>
    let mut rest = injection;
    while let Some(start) = rest.find("<image path=\"") {
        let after = &rest[start + "<image path=\"".len()..];
        if let Some(end) = after.find('"') {
            let raw = &after[..end];
            let path = unescape_xml_attr(raw);
            if !path.is_empty() && !paths.iter().any(|existing: &String| existing == &path) {
                paths.push(path);
            }
            rest = &after[end + 1..];
            continue;
        }
        break;
    }
    if !paths.is_empty() {
        return paths;
    }

    // Fallback: numbered absolute paths like `1. /tmp/a.png`
    for line in injection.lines() {
        let trimmed = line.trim();
        let Some((_idx, path_part)) = trimmed.split_once(". ") else {
            continue;
        };
        let path = path_part.trim();
        if path.starts_with('/') && !paths.iter().any(|existing: &String| existing == path) {
            paths.push(path.to_string());
        }
    }
    paths
}

fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn unescape_xml_attr(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describe_image_ref_omits_data_url_payload() {
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let summarized = describe_image_ref_for_error(data_url);
        assert!(summarized.starts_with("data URL (image/png, ~"));
        assert!(!summarized.contains("iVBORw0KGgo"));
        assert_eq!(
            describe_image_ref_for_error("/tmp/radar.png"),
            "/tmp/radar.png"
        );
    }

    #[test]
    fn resolve_errors_do_not_dump_data_url_payload() {
        let dir = std::env::temp_dir().join(format!("cli-image-err-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let data_url = "data:image/png;base64,not-valid-base64-payload";
        let error = resolve_existing_image_files(Some(&[data_url.to_string()]), &dir).unwrap_err();
        assert!(error.contains("none of the attached images could be resolved"));
        assert!(error.contains("data URL (image/png"));
        assert!(!error.contains("not-valid-base64-payload"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn collects_and_dedupes_paths() {
        let paths = collect_non_empty_image_paths(Some(&[
            " /a.png ".to_string(),
            "".to_string(),
            "/a.png".to_string(),
            "/b.jpg".to_string(),
        ]));
        assert_eq!(paths, vec!["/a.png".to_string(), "/b.jpg".to_string()]);
    }

    #[test]
    fn kimi_prompt_injects_image_tags() {
        let prompt =
            build_kimi_prompt_with_images("what is this?", &[PathBuf::from("/tmp/demo.png")]);
        assert!(prompt.contains("what is this?"));
        assert!(prompt.contains(KIMI_IMAGE_INJECTION_MARKER));
        assert!(prompt.contains("ReadMediaFile"));
        assert!(prompt.contains("<image path=\"/tmp/demo.png\"></image>"));
    }

    #[test]
    fn splits_kimi_prompt_for_display_with_marker() {
        let prompt = build_kimi_prompt_with_images(
            "截图说明",
            &[PathBuf::from("/tmp/a.png"), PathBuf::from("/tmp/b.png")],
        );
        let (visible, images) = split_kimi_prompt_for_display(&prompt);
        assert_eq!(visible, "截图说明");
        assert_eq!(
            images,
            vec!["/tmp/a.png".to_string(), "/tmp/b.png".to_string()]
        );
        assert!(!visible.contains("ReadMediaFile"));
        assert!(!visible.contains("<image path"));
    }

    #[test]
    fn splits_legacy_kimi_prompt_without_marker() {
        let legacy = "hello\n\nThe user attached the following image file(s). You MUST call ReadMediaFile on each path below before answering any question about visual content.\n1. /tmp/legacy.png\n<image path=\"/tmp/legacy.png\"></image>\n";
        let (visible, images) = split_kimi_prompt_for_display(legacy);
        assert_eq!(visible, "hello");
        assert_eq!(images, vec!["/tmp/legacy.png".to_string()]);
    }

    #[test]
    fn split_leaves_plain_prompt_unchanged() {
        let (visible, images) = split_kimi_prompt_for_display("just text");
        assert_eq!(visible, "just text");
        assert!(images.is_empty());
    }

    #[test]
    fn materializes_data_url_to_workspace_file() {
        let dir = std::env::temp_dir().join(format!("cli-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let paths = resolve_existing_image_files(Some(&[data_url.to_string()]), &dir).unwrap();
        assert_eq!(paths.len(), 1);
        assert!(paths[0].exists());
        assert!(paths[0].starts_with(dir.join(".mossx").join("image-staging")));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pi_image_file_args_prefixes_each_path_in_order() {
        let args = pi_image_file_args(&[
            PathBuf::from("/abs/one.png"),
            PathBuf::from("/abs/dir with space/two.jpg"),
        ]);
        assert_eq!(args, vec!["@/abs/one.png", "@/abs/dir with space/two.jpg"]);
        assert!(pi_image_file_args(&[]).is_empty());
    }

    #[test]
    fn split_pi_file_attachments_single_image_with_text() {
        let (visible, images) = split_pi_file_attachments_for_display(
            "<file name=\"/a/one.png\"></file>\nlook at this",
        );
        assert_eq!(visible, "look at this");
        assert_eq!(images, vec!["/a/one.png"]);
    }

    #[test]
    fn split_pi_file_attachments_multi_image_with_hints_and_dedupe() {
        let (visible, images) = split_pi_file_attachments_for_display(
            "<file name=\"/a/one.png\"></file>\n<file name=\"/a/two.png\">[Image resized to 1024x768.]</file>\n<file name=\"/a/one.png\"></file>\ncompare",
        );
        assert_eq!(visible, "compare");
        assert_eq!(images, vec!["/a/one.png", "/a/two.png"]);
    }

    #[test]
    fn split_pi_file_attachments_image_only_text() {
        let (visible, images) =
            split_pi_file_attachments_for_display("<file name=\"/a/one.png\"></file>\n");
        assert_eq!(visible, "");
        assert_eq!(images, vec!["/a/one.png"]);
    }

    #[test]
    fn split_pi_file_attachments_leaves_plain_text_unchanged() {
        let (visible, images) = split_pi_file_attachments_for_display("just text");
        assert_eq!(visible, "just text");
        assert!(images.is_empty());
    }

    #[test]
    fn split_pi_file_attachments_keeps_malformed_tag_verbatim() {
        let (visible, images) =
            split_pi_file_attachments_for_display("before <file name=\"/a/broken.png after");
        assert_eq!(visible, "before <file name=\"/a/broken.png after");
        assert!(images.is_empty());
    }

    #[test]
    fn split_pi_file_attachments_multibyte_path_does_not_panic() {
        // 回归（2026-08-24 er-qi 实测 panic）：中文路径附件的 open_tag_end 相对
        // after_open 计算，修复前直接拿去切 rest，字节落在「发」的 UTF-8
        // 中间 → panic 杀 command 任务，会话永远打不开。
        let (visible, images) = split_pi_file_attachments_for_display(
            "<file name=\"/Users/me/二期文档/车辆健康报告接口文档/SP4驾驶分析-存储介质设计报告.md\"></file>\n分析这份文档",
        );
        assert_eq!(visible, "分析这份文档");
        assert_eq!(
            images,
            vec!["/Users/me/二期文档/车辆健康报告接口文档/SP4驾驶分析-存储介质设计报告.md"]
        );
        // 前缀文本 + 多附件 + 中文路径混合
        let (visible2, images2) = split_pi_file_attachments_for_display(
            "看一下 <file name=\"/a/one.png\"></file> 和 <file name=\"/b/中文二.png\"></file> 的区别",
        );
        assert_eq!(visible2, "看一下  和  的区别");
        assert_eq!(images2, vec!["/a/one.png", "/b/中文二.png"]);
    }

    #[test]
    fn legacy_pi_injection_roundtrip_still_parses() {
        let wire = build_pi_prompt_with_images("what is this", &[PathBuf::from("/abs/one.png")]);
        assert!(wire.contains(PI_IMAGE_INJECTION_MARKER));
        let (visible, images) = split_pi_prompt_for_display(&wire);
        assert_eq!(visible, "what is this");
        assert_eq!(images, vec!["/abs/one.png"]);
    }
}
