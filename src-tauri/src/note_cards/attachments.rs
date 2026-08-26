use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use super::location::find_note_card_path_in_project_dir;
use super::storage::note_asset_dir;
use super::types::*;

pub(crate) fn hydrate_attachment_path(
    project_dir: &Path,
    note_id: &str,
    mut attachment: NoteCardAttachment,
) -> NoteCardAttachment {
    attachment.relative_path =
        sanitize_attachment_relative_path(&attachment.relative_path, Some(&attachment.file_name));
    attachment.absolute_path = note_asset_dir(project_dir, note_id)
        .join(&attachment.relative_path)
        .to_string_lossy()
        .to_string();
    attachment
}

pub(crate) fn content_type_from_extension(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        "tif" | "tiff" => Some("image/tiff"),
        _ => None,
    }
}

pub(crate) fn extension_from_content_type(content_type: &str) -> &'static str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/tiff" => "tiff",
        _ => "img",
    }
}

pub(crate) fn sanitize_filename(value: &str, fallback_extension: Option<&str>) -> String {
    let raw = Path::new(value)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or(value)
        .trim();
    let sanitized = raw
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let collapsed = sanitized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if !collapsed.is_empty() && collapsed != "." && collapsed != ".." {
        return collapsed;
    }
    let extension_suffix = fallback_extension
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();
    format!("image{extension_suffix}")
}

pub(crate) fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn percent_decode_path(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        if bytes[cursor] == b'%' && cursor + 2 < bytes.len() {
            let hi = hex_value(bytes[cursor + 1]);
            let lo = hex_value(bytes[cursor + 2]);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                output.push(hi * 16 + lo);
                cursor += 3;
                continue;
            }
        }
        output.push(bytes[cursor]);
        cursor += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

pub(crate) fn has_windows_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && (bytes[1] == b':' || bytes[1] == b'|')
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

pub(crate) fn has_windows_drive_host(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && (bytes[1] == b':' || bytes[1] == b'|')
}

pub(crate) fn normalize_local_attachment_uri_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower_cased = trimmed.to_ascii_lowercase();
    if lower_cased.starts_with("asset://localhost") {
        let mut normalized = trimmed["asset://localhost".len()..].to_string();
        if !normalized.starts_with('/') {
            normalized = format!("/{normalized}");
        }
        if normalized.starts_with("//") {
            normalized = normalized[1..].to_string();
        }
        return Some(percent_decode_path(&normalized));
    }

    if !lower_cased.starts_with("file://") {
        return None;
    }

    let mut remainder = trimmed["file://".len()..].trim();
    if remainder.is_empty() {
        return None;
    }

    if remainder.to_ascii_lowercase().starts_with("localhost/") {
        remainder = &remainder["localhost/".len()..];
    } else if !remainder.starts_with('/')
        && !has_windows_drive_prefix(remainder)
        && !has_windows_drive_host(remainder)
    {
        let (host, tail) = remainder
            .split_once('/')
            .map(|(lhs, rhs)| (lhs, format!("/{}", rhs)))
            .unwrap_or((remainder, String::new()));
        if tail.is_empty() {
            return Some(format!("//{}", host));
        }
        return Some(format!("//{}{}", host, percent_decode_path(&tail)));
    }

    let mut normalized = remainder.replace('|', ":");
    if cfg!(windows)
        && normalized.len() >= 3
        && normalized.starts_with('/')
        && normalized.as_bytes()[1].is_ascii_alphabetic()
        && normalized.as_bytes()[2] == b':'
    {
        normalized = normalized[1..].to_string();
    }
    Some(percent_decode_path(&normalized))
}

pub(crate) fn normalize_attachment_source_path(value: &str) -> String {
    normalize_local_attachment_uri_path(value).unwrap_or_else(|| value.trim().to_string())
}

pub(crate) fn normalize_attachment_path_key(value: &str) -> String {
    let normalized = normalize_attachment_source_path(value).replace('\\', "/");
    if normalized.len() >= 3 {
        let bytes = normalized.as_bytes();
        if bytes[0] == b'/' && bytes[2] == b':' && bytes[1].is_ascii_alphabetic() {
            return normalized[1..].to_ascii_lowercase();
        }
    }
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            return normalized.to_ascii_lowercase();
        }
    }
    normalized
}

pub(crate) fn sanitize_attachment_relative_path(
    value: &str,
    fallback_file_name: Option<&str>,
) -> String {
    let normalized = normalize_attachment_path_key(value);
    let candidate = normalized
        .split('/')
        .rev()
        .map(str::trim)
        .find(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
        .unwrap_or_default();
    let fallback = fallback_file_name.unwrap_or("image");
    if !candidate.is_empty() {
        sanitize_filename(candidate, None)
    } else {
        sanitize_filename(fallback, None)
    }
}

pub(crate) fn looks_like_absolute_attachment_input(value: &str) -> bool {
    let normalized = normalize_attachment_path_key(value);
    normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized.starts_with("file://")
        || normalized
            .as_bytes()
            .get(1)
            .zip(normalized.as_bytes().get(2))
            .map(|(colon, slash)| *colon == b':' && matches!(*slash, b'/' | b'\\'))
            .unwrap_or(false)
}

pub(crate) fn parse_data_url(value: &str) -> Result<(String, Vec<u8>), String> {
    if !value.starts_with("data:") {
        return Err("Attachment is not a data URL".to_string());
    }
    let Some((header, payload)) = value.split_once(',') else {
        return Err("Malformed data URL".to_string());
    };
    if !header.contains(";base64") {
        return Err("Only base64 data URLs are supported".to_string());
    }
    let content_type = header
        .trim_start_matches("data:")
        .split(';')
        .next()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .unwrap_or("image/png")
        .to_string();
    if !content_type.starts_with("image/") {
        return Err("Only image note attachments are supported".to_string());
    }
    let bytes = BASE64_STANDARD
        .decode(payload.trim())
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_NOTE_ATTACHMENT_BYTES {
        return Err(format!(
            "Image attachment is too large (max {} bytes).",
            MAX_NOTE_ATTACHMENT_BYTES
        ));
    }
    Ok((content_type, bytes))
}

pub(crate) fn match_existing_attachment<'a>(
    value: &str,
    existing_by_key: &'a HashMap<String, NoteCardAttachment>,
) -> Option<NoteCardAttachment> {
    let normalized = normalize_attachment_path_key(value);
    if let Some(attachment) = existing_by_key.get(&normalized) {
        return Some(attachment.clone());
    }
    if looks_like_absolute_attachment_input(value) {
        return None;
    }
    let relative_key = sanitize_attachment_relative_path(value, None);
    existing_by_key.get(&relative_key).cloned()
}

pub(crate) fn cleanup_stale_assets(
    asset_dir: &Path,
    keep_relative_paths: &HashSet<String>,
) -> Result<(), String> {
    if !asset_dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(asset_dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let relative_name = entry.file_name().to_string_lossy().to_string();
        if keep_relative_paths.contains(&relative_name) {
            continue;
        }
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    let mut remaining_entries = std::fs::read_dir(asset_dir).map_err(|error| error.to_string())?;
    if remaining_entries.next().is_none() {
        std::fs::remove_dir(asset_dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn remove_note_assets(project_dir: &Path, note_id: &str) -> Result<(), String> {
    let asset_dir = note_asset_dir(project_dir, note_id);
    if !asset_dir.exists() {
        return Ok(());
    }
    if asset_dir.is_dir() {
        std::fs::remove_dir_all(&asset_dir).map_err(|error| error.to_string())?;
    } else {
        std::fs::remove_file(&asset_dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn delete_note_card_files(project_dir: &Path, note_id: &str) -> Result<bool, String> {
    let note_path = find_note_card_path_in_project_dir(project_dir, note_id)?.map(|(path, _)| path);
    let asset_dir = note_asset_dir(project_dir, note_id);
    if note_path.is_none() && !asset_dir.exists() {
        return Ok(false);
    }

    if let Some(path) = note_path {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    if asset_dir.exists() {
        remove_note_assets(project_dir, note_id)?;
    }

    Ok(true)
}

pub(crate) fn materialize_attachments(
    project_dir: &Path,
    note_id: &str,
    attachment_inputs: Option<Vec<String>>,
    existing_attachments: &[NoteCardAttachment],
) -> Result<Vec<NoteCardAttachment>, String> {
    let Some(inputs) = attachment_inputs else {
        return Ok(existing_attachments.to_vec());
    };

    let asset_dir = note_asset_dir(project_dir, note_id);
    if !inputs.is_empty() {
        std::fs::create_dir_all(&asset_dir).map_err(|error| error.to_string())?;
    }

    let mut existing_by_key = HashMap::new();
    for attachment in existing_attachments {
        existing_by_key.insert(
            normalize_attachment_path_key(&attachment.absolute_path),
            attachment.clone(),
        );
        let relative_key = sanitize_attachment_relative_path(
            &attachment.relative_path,
            Some(&attachment.file_name),
        );
        existing_by_key.insert(relative_key, attachment.clone());
    }

    let mut used_relative_paths = HashSet::new();
    let mut seen_input_keys = HashSet::new();
    let mut next_attachments = Vec::new();

    for raw_input in inputs {
        let input = raw_input.trim();
        if input.is_empty() {
            continue;
        }
        let input_key = normalize_attachment_path_key(input);
        if !seen_input_keys.insert(input_key) {
            continue;
        }

        if let Some(existing_attachment) = match_existing_attachment(input, &existing_by_key) {
            if used_relative_paths.contains(&existing_attachment.relative_path) {
                continue;
            }
            used_relative_paths.insert(existing_attachment.relative_path.clone());
            next_attachments.push(existing_attachment);
            continue;
        }

        let attachment_id = uuid::Uuid::new_v4().to_string();
        let (content_type, bytes, file_name) = if input.starts_with("data:") {
            let (resolved_content_type, decoded_bytes) = parse_data_url(input)?;
            let extension = extension_from_content_type(&resolved_content_type);
            (
                resolved_content_type,
                decoded_bytes,
                sanitize_filename(&format!("image.{extension}"), Some(extension)),
            )
        } else {
            let normalized_input = normalize_attachment_source_path(input);
            let source_path = PathBuf::from(&normalized_input);
            if !source_path.exists() {
                return Err(format!("Attachment source not found: {input}"));
            }
            let extension = source_path
                .extension()
                .and_then(OsStr::to_str)
                .unwrap_or_default()
                .to_string();
            let resolved_content_type = content_type_from_extension(&extension)
                .ok_or_else(|| format!("Unsupported image attachment: {input}"))?;
            let content_type = resolved_content_type.to_string();
            let bytes = std::fs::read(&source_path).map_err(|error| error.to_string())?;
            if bytes.len() > MAX_NOTE_ATTACHMENT_BYTES {
                return Err(format!(
                    "Image attachment is too large (max {} bytes).",
                    MAX_NOTE_ATTACHMENT_BYTES
                ));
            }
            let file_name = sanitize_filename(
                source_path
                    .file_name()
                    .and_then(OsStr::to_str)
                    .unwrap_or("image"),
                Some(extension_from_content_type(&content_type)),
            );
            (content_type, bytes, file_name)
        };

        let mut collision_index = 0usize;
        let relative_path = loop {
            let suffix = if collision_index == 0 {
                String::new()
            } else {
                format!("-{collision_index}")
            };
            let candidate = format!("{}{}-{file_name}", &attachment_id[..8], suffix);
            if !used_relative_paths.contains(&candidate) {
                break candidate;
            }
            collision_index = collision_index.saturating_add(1);
        };
        let destination_path = asset_dir.join(&relative_path);
        std::fs::write(&destination_path, &bytes).map_err(|error| error.to_string())?;
        used_relative_paths.insert(relative_path.clone());
        next_attachments.push(NoteCardAttachment {
            id: attachment_id,
            file_name,
            content_type,
            relative_path: relative_path.clone(),
            absolute_path: destination_path.to_string_lossy().to_string(),
            size_bytes: bytes.len() as u64,
        });
    }

    cleanup_stale_assets(&asset_dir, &used_relative_paths)?;
    Ok(next_attachments)
}
