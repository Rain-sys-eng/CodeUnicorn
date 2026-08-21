//! DSH session / workspace unary operations.

use super::host::DshHostClient;
use serde_json::{json, Value};
use std::path::Path;

pub const THREAD_PREFIX: &str = "dsh:";
pub const PENDING_PREFIX: &str = "dsh-pending-";

pub fn thread_id_for_session(session_id: &str) -> String {
    format!("{THREAD_PREFIX}{session_id}")
}

pub fn session_id_from_thread(thread_id: &str) -> String {
    let trimmed = thread_id.trim();
    if let Some(rest) = trimmed.strip_prefix(THREAD_PREFIX) {
        return rest.to_string();
    }
    if let Some(rest) = trimmed.strip_prefix(PENDING_PREFIX) {
        return rest.to_string();
    }
    trimmed.to_string()
}

pub fn is_pending_thread(thread_id: &str) -> bool {
    thread_id.trim().starts_with(PENDING_PREFIX)
}

pub fn strip_windows_verbatim_prefix(path: &str) -> String {
    let raw = path.replace('/', "\\");
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }
    path.to_string()
}

pub fn canonicalize_host_path(path: &Path) -> String {
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    strip_windows_verbatim_prefix(&canonical.to_string_lossy())
}

pub async fn create_workspace(client: &DshHostClient, path: &Path) -> Result<Value, String> {
    let path = canonicalize_host_path(path);
    client
        .call("workspace.create", json!({ "path": path }))
        .await
}

pub fn workspace_id_from_create(value: &Value) -> Result<String, String> {
    value
        .get("workspace")
        .and_then(|ws| ws.get("workspaceId"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "dsh workspace.create missing workspaceId".to_string())
}

pub fn create_session_payload(
    workspace_id: &str,
    session_id: Option<&str>,
    agent_preset: Option<&str>,
) -> Value {
    let mut payload = json!({ "workspaceId": workspace_id });
    if let Some(session_id) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
        payload["sessionId"] = json!(session_id);
    }
    if let Some(agent_preset) = agent_preset
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload["agentPreset"] = json!(agent_preset);
    }
    payload
}

pub async fn create_session(
    client: &DshHostClient,
    workspace_id: &str,
    session_id: Option<&str>,
    agent_preset: Option<&str>,
) -> Result<String, String> {
    let payload = create_session_payload(workspace_id, session_id, agent_preset);
    let value = client.call("session.create", payload).await?;
    value
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "dsh session.create did not return a sessionId".to_string())
}

pub async fn select_model(
    client: &DshHostClient,
    session_id: &str,
    provider: &str,
    model: &str,
    reasoning_effort: Option<&str>,
) -> Result<Value, String> {
    let mut payload = json!({
        "sessionId": session_id,
        "provider": provider,
        "model": model,
    });
    if let Some(effort) = reasoning_effort
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload["reasoningEffort"] = json!(effort);
    }
    client.call("session.selectModel", payload).await
}

pub const DSH_PERMISSION_PRESET_WORKSPACE_WRITE: &str = "workspace-write";
pub const DSH_PERMISSION_PRESET_DANGER_FULL_ACCESS: &str = "danger-full-access";

/// Live `/permission` injects into the current agent inbox. Skip it while a
/// continued session still has an open turn, otherwise in-flight tools can
/// flip from `ask` to `never` (or the reverse) mid-approval.
pub fn should_set_permission_preset(continue_session: bool, has_open_turn: bool) -> bool {
    !continue_session || !has_open_turn
}

/// Map mossx composer access mode onto a shipped DSH permission preset.
///
/// Auto mode must select `danger-full-access` (unconfined sandbox +
/// `approval: never`). DSH `never` rejects sandbox escalations instead of
/// granting them, so leaving the session on `workspace-write + ask` — or
/// flipping only the approval knob — still pops the upgrade card.
pub fn permission_preset_for_access_mode(access_mode: Option<&str>) -> &'static str {
    match access_mode.map(str::trim).filter(|value| !value.is_empty()) {
        Some("full-access") => DSH_PERMISSION_PRESET_DANGER_FULL_ACCESS,
        _ => DSH_PERMISSION_PRESET_WORKSPACE_WRITE,
    }
}

pub fn permission_command_line(preset: &str) -> String {
    format!("/permission {preset}")
}

/// DSH `0.1.1-rc.2` Typert Gateway matches `commands/execute` args by
/// exact key set (`agentId`, `line`, `images`). Missing `images` is
/// `arguments-invalid` even for `/permission`, which has no attachments.
pub fn execute_command_payload(session_id: &str, line: &str) -> Value {
    json!({
        "args": {
            "agentId": session_id,
            "line": line,
            "images": [],
        }
    })
}

fn command_execution_error(value: &Value) -> Option<String> {
    let result = value.get("result").unwrap_or(value);
    match result.get("kind").and_then(Value::as_str) {
        Some("success") => None,
        Some("error") => Some(
            result
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("command failed")
                .to_string(),
        ),
        _ => Some("command.execute returned no success result".to_string()),
    }
}

pub async fn set_permission_preset(
    client: &DshHostClient,
    session_id: &str,
    access_mode: Option<&str>,
) -> Result<Value, String> {
    let preset = permission_preset_for_access_mode(access_mode);
    let line = permission_command_line(preset);
    let value = client
        .call("commands/execute", execute_command_payload(session_id, &line))
        .await?;
    if let Some(error) = command_execution_error(&value) {
        return Err(format!(
            "dsh permission preset `{preset}` failed: {error}"
        ));
    }
    Ok(value)
}

pub async fn prompt(
    client: &DshHostClient,
    session_id: &str,
    text: &str,
    images: &[DshPromptImage],
) -> Result<Value, String> {
    client
        .call(
            "session.prompt",
            json!({
                "sessionId": session_id,
                "mode": "queue",
                "content": build_prompt_content(text, images),
            }),
        )
        .await
}

/// DSH `session.prompt` content parts.
///
/// Host Zod (`promptContentPartSchema`) is `$strip` + `name?: string`.
/// `name: null` is **not** optional — it is `invalid payload for session.prompt`.
pub(crate) fn build_prompt_content(text: &str, images: &[DshPromptImage]) -> Vec<Value> {
    let mut content = vec![json!({ "type": "text", "text": text })];
    for image in images {
        let mut part = json!({
            "type": "image",
            "mediaType": image.media_type,
            "data": image.data,
        });
        if let Some(name) = image
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            part["name"] = json!(name);
        }
        content.push(part);
    }
    content
}

pub async fn cancel(client: &DshHostClient, session_id: &str) -> Result<Value, String> {
    client
        .call("session.cancel", json!({ "sessionId": session_id }))
        .await
}

pub async fn fork(client: &DshHostClient, session_id: &str) -> Result<String, String> {
    let value = client
        .call("session.fork", json!({ "sessionId": session_id }))
        .await?;
    value
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "dsh session.fork did not return a sessionId".to_string())
}

pub async fn list_sessions(client: &DshHostClient) -> Result<Vec<Value>, String> {
    let value = client.call("session.list", json!({})).await?;
    Ok(value
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

pub async fn history(
    client: &DshHostClient,
    session_id: &str,
    max_messages: Option<u32>,
    before_seq: Option<i64>,
) -> Result<Value, String> {
    let mut payload = json!({ "sessionId": session_id });
    if let Some(max_messages) = max_messages {
        payload["maxMessages"] = json!(max_messages);
    }
    if let Some(before_seq) = before_seq {
        payload["beforeSeq"] = json!(before_seq);
    }
    client.call("session.history", payload).await
}

pub async fn archive_session(client: &DshHostClient, session_id: &str) -> Result<Value, String> {
    client
        .call(
            "workspace.archiveSession",
            json!({ "sessionId": session_id }),
        )
        .await
}

pub async fn load_models(client: &DshHostClient) -> Result<Value, String> {
    client.call("llm.models", json!({})).await
}

#[derive(Debug, Clone)]
pub struct DshPromptImage {
    pub media_type: String,
    pub data: String,
    pub name: Option<String>,
}

/// DSH host default (`dsh-attachment-local`) is 5 MiB per image.
const DSH_MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

/// Load composer attachments into DSH `PromptContentPart.image` values.
///
/// Follows the Grok / PI path: `file://`, workspace-relative paths, and
/// pasted data URLs all resolve. Any attached-but-unreadable image fails
/// the send instead of being silently dropped.
pub fn load_prompt_images(
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Vec<DshPromptImage>, String> {
    let raw_paths = crate::engine::cli_image_input::collect_non_empty_image_paths(images);
    if raw_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut loaded = Vec::with_capacity(raw_paths.len());
    let mut errors = Vec::new();
    for raw in &raw_paths {
        match load_one_prompt_image(raw, workspace_path) {
            Ok(image) => loaded.push(image),
            Err(error) => errors.push(format!(
                "{}: {error}",
                crate::engine::cli_image_input::describe_image_ref_for_error(raw)
            )),
        }
    }

    if !errors.is_empty() {
        return Err(format!(
            "DSH image input failed: {} of {} attached images could not be loaded ({})",
            errors.len(),
            raw_paths.len(),
            errors.join("; ")
        ));
    }
    Ok(loaded)
}

fn load_one_prompt_image(raw: &str, workspace_path: &Path) -> Result<DshPromptImage, String> {
    if is_data_url(raw) {
        return load_data_url_image(raw);
    }

    let path = crate::engine::cli_image_input::normalize_local_image_path(raw)?;
    let path = if path.is_absolute() {
        path
    } else {
        workspace_path.join(path)
    };
    let metadata = std::fs::metadata(&path).map_err(|error| format!("stat failed: {error}"))?;
    if !metadata.is_file() {
        return Err("not a regular file".to_string());
    }
    if metadata.len() > DSH_MAX_IMAGE_BYTES {
        return Err(format!(
            "exceeds {} byte limit ({})",
            DSH_MAX_IMAGE_BYTES,
            metadata.len()
        ));
    }
    let bytes = std::fs::read(&path).map_err(|error| format!("read failed: {error}"))?;
    if bytes.is_empty() {
        return Err("empty image data".to_string());
    }
    let declared = media_type_for_path(&path)?;
    let media_type = sniff_dsh_media_type(&bytes, declared)?;
    use base64::Engine as _;
    Ok(DshPromptImage {
        media_type: media_type.to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty()),
    })
}

fn is_data_url(raw: &str) -> bool {
    raw.get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:"))
}

fn load_data_url_image(raw: &str) -> Result<DshPromptImage, String> {
    let rest = raw.get(5..).ok_or_else(|| "invalid data URL".to_string())?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| "invalid data URL".to_string())?;
    if !meta.to_ascii_lowercase().contains(";base64") {
        return Err("data URL must be base64".to_string());
    }
    let declared = meta
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("image/png");
    let declared = canonical_dsh_media_type(declared)?;
    let encoded: String = payload
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace())
        .collect();
    if encoded.is_empty() {
        return Err("empty image data".to_string());
    }
    let max_encoded_bytes = DSH_MAX_IMAGE_BYTES
        .saturating_add(2)
        .saturating_div(3)
        .saturating_mul(4) as usize;
    if encoded.len() > max_encoded_bytes {
        return Err(format!("exceeds {} byte limit", DSH_MAX_IMAGE_BYTES));
    }
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&encoded)
        .map_err(|error| format!("invalid base64 data URL: {error}"))?;
    if bytes.is_empty() {
        return Err("empty image data".to_string());
    }
    if bytes.len() as u64 > DSH_MAX_IMAGE_BYTES {
        return Err(format!(
            "exceeds {} byte limit ({})",
            DSH_MAX_IMAGE_BYTES,
            bytes.len()
        ));
    }
    let media_type = sniff_dsh_media_type(&bytes, declared)?;
    Ok(DshPromptImage {
        media_type: media_type.to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        name: None,
    })
}

fn sniff_dsh_media_type(bytes: &[u8], declared: &str) -> Result<&'static str, String> {
    let sniffed = match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [b'G', b'I', b'F', b'8', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', ..] if bytes.get(8..12) == Some(b"WEBP") => "image/webp",
        _ => {
            return Err("unsupported or malformed image data".to_string());
        }
    };
    let _ = canonical_dsh_media_type(declared)?;
    Ok(sniffed)
}

fn canonical_dsh_media_type(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "image/png" => Ok("image/png"),
        "image/jpeg" | "image/jpg" => Ok("image/jpeg"),
        "image/webp" => Ok("image/webp"),
        "image/gif" => Ok("image/gif"),
        other => Err(format!("unsupported image media type: {other}")),
    }
}

fn media_type_for_path(path: &Path) -> Result<&'static str, String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "gif" => Ok("image/gif"),
        "webp" => Ok("image/webp"),
        "png" => Ok("image/png"),
        other => Err(format!(
            "unsupported image extension: {}",
            if other.is_empty() { "(none)" } else { other }
        )),
    }
}

/// Parse mossx catalog id `provider/model` (or a bare model) plus optional provider.
pub fn split_model_selection(
    catalog_or_model: &str,
    explicit_provider: Option<&str>,
) -> Option<(String, String)> {
    let trimmed = catalog_or_model.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(provider) = explicit_provider
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let model = trimmed
            .strip_prefix(&format!("{provider}/"))
            .unwrap_or(trimmed)
            .trim();
        if model.is_empty() {
            return None;
        }
        return Some((provider.to_string(), model.to_string()));
    }
    // Catalog ids are `${provider}/${model}`. Keep the first slash as the
    // provider boundary so model ids such as `ovh/Qwen2.5` stay intact.
    let (provider, model) = trimmed.split_once('/')?;
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || model.is_empty() {
        return None;
    }
    Some((provider.to_string(), model.to_string()))
}

/// mossx managed catalog prefix. The DSH host has no adapter for this provider.
pub fn is_reserved_mossx_dsh_provider(provider: &str) -> bool {
    provider.trim().eq_ignore_ascii_case("ccgui")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_windows_verbatim_prefix() {
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\C:\Users\foo"),
            r"C:\Users\foo"
        );
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\UNC\server\share\proj"),
            r"\\server\share\proj"
        );
        assert_eq!(
            strip_windows_verbatim_prefix("//?/C:/Users/foo"),
            r"C:\Users\foo"
        );
        assert_eq!(
            strip_windows_verbatim_prefix(r"C:\Users\foo"),
            r"C:\Users\foo"
        );
        assert_eq!(
            strip_windows_verbatim_prefix("/tmp/project"),
            "/tmp/project"
        );
    }

    #[test]
    fn thread_roundtrip() {
        assert_eq!(session_id_from_thread("dsh:session-abc"), "session-abc");
        assert!(is_pending_thread("dsh-pending-1"));
        assert_eq!(thread_id_for_session("session-abc"), "dsh:session-abc");
    }

    #[test]
    fn create_session_payload_omits_blank_preset() {
        let payload = create_session_payload("ws-1", None, Some("  "));
        assert_eq!(payload["workspaceId"], "ws-1");
        assert!(payload.get("agentPreset").is_none());
        assert!(payload.get("sessionId").is_none());
    }

    #[test]
    fn create_session_payload_includes_preset() {
        let payload = create_session_payload("ws-1", Some("sess-1"), Some("minimal"));
        assert_eq!(payload["workspaceId"], "ws-1");
        assert_eq!(payload["sessionId"], "sess-1");
        assert_eq!(payload["agentPreset"], "minimal");
    }

    #[test]
    fn maps_full_access_to_danger_full_access_preset() {
        assert_eq!(
            permission_preset_for_access_mode(Some("full-access")),
            DSH_PERMISSION_PRESET_DANGER_FULL_ACCESS
        );
        assert_eq!(
            permission_preset_for_access_mode(Some("  full-access  ")),
            DSH_PERMISSION_PRESET_DANGER_FULL_ACCESS
        );
    }

    #[test]
    fn skips_permission_switch_only_for_busy_continue_turns() {
        assert!(should_set_permission_preset(false, false));
        assert!(should_set_permission_preset(false, true));
        assert!(should_set_permission_preset(true, false));
        assert!(!should_set_permission_preset(true, true));
    }

    #[test]
    fn maps_non_auto_access_to_workspace_write_preset() {
        assert_eq!(
            permission_preset_for_access_mode(None),
            DSH_PERMISSION_PRESET_WORKSPACE_WRITE
        );
        assert_eq!(
            permission_preset_for_access_mode(Some("default")),
            DSH_PERMISSION_PRESET_WORKSPACE_WRITE
        );
        assert_eq!(
            permission_preset_for_access_mode(Some("current")),
            DSH_PERMISSION_PRESET_WORKSPACE_WRITE
        );
        assert_eq!(
            permission_preset_for_access_mode(Some("read-only")),
            DSH_PERMISSION_PRESET_WORKSPACE_WRITE
        );
        assert_eq!(
            permission_preset_for_access_mode(Some("")),
            DSH_PERMISSION_PRESET_WORKSPACE_WRITE
        );
    }

    #[test]
    fn execute_command_payload_uses_typert_args_envelope() {
        let payload = execute_command_payload(
            "session-1",
            "/permission danger-full-access",
        );
        let args = payload.get("args").expect("typert args envelope");
        assert_eq!(args["agentId"], "session-1");
        assert_eq!(args["line"], "/permission danger-full-access");
        assert_eq!(args["images"], json!([]));
        let mut keys: Vec<&str> = args
            .as_object()
            .expect("args object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["agentId", "images", "line"]);
        assert_eq!(
            permission_command_line(DSH_PERMISSION_PRESET_WORKSPACE_WRITE),
            "/permission workspace-write"
        );
    }

    #[test]
    fn split_provider_model() {
        assert_eq!(
            split_model_selection("deepseek-official/deepseek-v4-flash", None).unwrap(),
            (
                "deepseek-official".to_string(),
                "deepseek-v4-flash".to_string()
            )
        );
        assert_eq!(
            split_model_selection("deepseek-v4-flash", Some("deepseek-official")).unwrap(),
            (
                "deepseek-official".to_string(),
                "deepseek-v4-flash".to_string()
            )
        );
        assert_eq!(
            split_model_selection("vision-http/ovh/Qwen2.5-VL-72B-Instruct", None).unwrap(),
            (
                "vision-http".to_string(),
                "ovh/Qwen2.5-VL-72B-Instruct".to_string()
            )
        );
        assert_eq!(split_model_selection("deepseek-v4-flash", None), None);
        assert_eq!(
            split_model_selection("ccgui/grok-4.5", None).unwrap(),
            ("ccgui".to_string(), "grok-4.5".to_string())
        );
        assert!(is_reserved_mossx_dsh_provider("ccgui"));
        assert!(is_reserved_mossx_dsh_provider("CCGUI"));
        assert!(!is_reserved_mossx_dsh_provider("ggggg"));
        assert!(!is_reserved_mossx_dsh_provider("deepseek-official"));
        assert!(!is_reserved_mossx_dsh_provider("vision-http"));
    }

    const TINY_PNG_BASE64: &str =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    fn tiny_png_bytes() -> Vec<u8> {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(TINY_PNG_BASE64)
            .expect("fixture png")
    }

    fn tiny_jpeg_bytes() -> Vec<u8> {
        vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F']
    }

    #[test]
    fn prompt_content_omits_null_name_for_pasted_data_url() {
        let content = build_prompt_content(
            "看图",
            &[DshPromptImage {
                media_type: "image/png".to_string(),
                data: TINY_PNG_BASE64.to_string(),
                name: None,
            }],
        );
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "看图");
        assert_eq!(content[1]["type"], "image");
        assert_eq!(content[1]["mediaType"], "image/png");
        assert_eq!(content[1]["data"], TINY_PNG_BASE64);
        assert!(
            content[1].get("name").is_none(),
            "DSH Zod optional string rejects name:null: {}",
            content[1]
        );
    }

    #[test]
    fn prompt_content_keeps_filename_when_present() {
        let content = build_prompt_content(
            "",
            &[DshPromptImage {
                media_type: "image/jpeg".to_string(),
                data: "abcd".to_string(),
                name: Some("shot.jpg".to_string()),
            }],
        );
        assert_eq!(content[1]["name"], "shot.jpg");
    }

    #[test]
    fn prompt_content_omits_blank_filename() {
        let content = build_prompt_content(
            "hi",
            &[DshPromptImage {
                media_type: "image/png".to_string(),
                data: TINY_PNG_BASE64.to_string(),
                name: Some("   ".to_string()),
            }],
        );
        assert!(content[1].get("name").is_none());
    }

    #[test]
    fn loads_pasted_data_url_without_filename() {
        let data_url = format!("data:image/png;base64,{TINY_PNG_BASE64}");
        let images =
            load_prompt_images(Some(&[data_url]), Path::new(".")).expect("data URL should load");
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].media_type, "image/png");
        assert_eq!(images[0].data, TINY_PNG_BASE64);
        assert_eq!(images[0].name, None);
    }

    #[test]
    fn normalizes_browser_jpg_alias_on_data_url() {
        use base64::Engine as _;
        let jpeg = base64::engine::general_purpose::STANDARD.encode(tiny_jpeg_bytes());
        let data_url = format!("data:image/jpg;base64,{jpeg}");
        let images = load_prompt_images(Some(&[data_url]), Path::new("."))
            .expect("image/jpg should canonicalize");
        assert_eq!(images[0].media_type, "image/jpeg");
        let content = build_prompt_content("", &images);
        assert_eq!(content[1]["mediaType"], "image/jpeg");
        assert!(content[1].get("name").is_none());
    }

    #[test]
    fn normalizes_jpg_alias_and_file_url() {
        let dir = std::env::temp_dir().join(format!("dsh-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shot.jpg");
        std::fs::write(&path, tiny_jpeg_bytes()).unwrap();
        let file_url = format!("file://{}", path.display());

        let images = load_prompt_images(Some(&[file_url]), &dir).expect("file URL should load");
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].media_type, "image/jpeg");
        assert_eq!(images[0].name.as_deref(), Some("shot.jpg"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sniffs_png_bytes_even_when_filename_says_jpg() {
        let dir = std::env::temp_dir().join(format!("dsh-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("misnamed.jpg");
        std::fs::write(&path, tiny_png_bytes()).unwrap();

        let images = load_prompt_images(Some(&[path.to_string_lossy().to_string()]), &dir)
            .expect("sniff should correct media type");
        assert_eq!(images[0].media_type, "image/png");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_unreadable_attachments_instead_of_dropping_them() {
        let error = load_prompt_images(
            Some(&["/definitely-missing-dsh-image.png".to_string()]),
            Path::new("."),
        )
        .expect_err("missing files must fail the send");
        assert!(
            error.contains("could not be loaded"),
            "unexpected error: {error}"
        );
        assert!(
            error.contains("/definitely-missing-dsh-image.png"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn rejects_mixed_good_and_bad_attachments() {
        let data_url = format!("data:image/png;base64,{TINY_PNG_BASE64}");
        let error = load_prompt_images(
            Some(&[data_url, "/definitely-missing-dsh-image.png".to_string()]),
            Path::new("."),
        )
        .expect_err("partial failure must fail the send");
        assert!(error.contains("1 of 2"), "unexpected error: {error}");
    }

    #[test]
    fn error_does_not_dump_data_url_payload() {
        let data_url = format!("data:image/png;base64,not-valid-base64-{TINY_PNG_BASE64}");
        let error = load_prompt_images(Some(&[data_url.clone()]), Path::new("."))
            .expect_err("invalid base64 must fail");
        assert!(
            !error.contains("not-valid-base64"),
            "data URL leaked into error: {error}"
        );
        assert!(error.contains("data URL"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_unsupported_heic() {
        let error = load_prompt_images(
            Some(&["data:image/heic;base64,AAAA".to_string()]),
            Path::new("."),
        )
        .expect_err("HEIC must be rejected");
        assert!(
            error.contains("unsupported image media type"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn empty_or_blank_image_list_stays_text_only() {
        assert!(load_prompt_images(None, Path::new(".")).unwrap().is_empty());
        assert!(
            load_prompt_images(Some(&["  ".to_string()]), Path::new("."))
                .unwrap()
                .is_empty()
        );
    }
}
