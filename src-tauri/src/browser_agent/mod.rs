mod capture_script;
mod platform;
mod toolbar;
mod types;

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

use crate::state::AppState;

use toolbar::{
    browser_element_selector_script, browser_element_selector_stop_script,
    handle_browser_toolbar_navigation, spawn_browser_toolbar_injection,
};
pub(crate) use types::*;

const BROWSER_WEBVIEW_EVENT: &str = "browser-agent://webview-event";
const BROWSER_RENDERER_WEBVIEW_LABEL: &str = "browser-agent-webview-main";
const BROWSER_RENDERER_WINDOW_LABEL: &str = "browser-agent-window";
const BROWSER_DOCK_WINDOW_LABEL: &str = "browser-agent-dock";
const BROWSER_CAPTURE_BRIDGE_HOST: &str = "browser-agent-capture.invalid";
const BROWSER_CAPTURE_BRIDGE_PATH: &str = "/__mossx_capture__";
const BROWSER_CAPTURE_CHUNK_SIZE: usize = 1_600;
const BROWSER_CAPTURE_WAIT_ATTEMPTS: usize = 80;
const BROWSER_TAB_CONTEXT_MENU_EVENT: &str = "browser-agent://tab-context-action";
const BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST: &str = "browser-agent-tab-menu.invalid";
const BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH: &str = "/__mossx_tab_context_menu__";
const BROWSER_TAB_CONTEXT_MENU_TOP_OFFSET: f64 = 16.0;
const BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS: u64 = 60_000;

static BROWSER_RENDERER_SESSION_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static BROWSER_EMBEDDED_WEBVIEW_BINDING: OnceLock<Mutex<Option<EmbeddedBrowserWebviewBinding>>> =
    OnceLock::new();
static BROWSER_CAPTURE_BRIDGE: OnceLock<Mutex<HashMap<String, BrowserCaptureBridgeState>>> =
    OnceLock::new();
static BROWSER_TAB_CONTEXT_MENU_INVOCATION: OnceLock<
    Mutex<Option<BrowserTabContextMenuInvocation>>,
> = OnceLock::new();

#[derive(Debug, Clone)]
struct BrowserCaptureBridgeState {
    browser_session_id: String,
    chunks: Vec<Option<String>>,
}

#[derive(Debug, Clone)]
struct BrowserCaptureNavigationChunk {
    token: String,
    browser_session_id: String,
    index: usize,
    total: usize,
    payload: String,
}

/// 每个 tab 菜单仅有一个短时、一次性的 native bridge 授权。target session 可与
/// renderer session 不同，因为用户可在当前 A 页面上右键非活动 B tab。
#[derive(Debug, Clone, PartialEq, Eq)]
struct BrowserTabContextMenuInvocation {
    nonce: String,
    target_browser_session_id: String,
    renderer_browser_session_id: String,
    issued_at: u64,
}

impl BrowserTabContextMenuInvocation {
    fn new(
        target_browser_session_id: &str,
        renderer_browser_session_id: &str,
        issued_at: u64,
    ) -> Self {
        Self {
            nonce: format!("browser-tab-menu-{}", uuid::Uuid::new_v4()),
            target_browser_session_id: target_browser_session_id.to_string(),
            renderer_browser_session_id: renderer_browser_session_id.to_string(),
            issued_at,
        }
    }

    fn authorizes(
        &self,
        nonce: &str,
        target_browser_session_id: &str,
        renderer_browser_session_id: &str,
        now: u64,
    ) -> bool {
        self.nonce == nonce
            && self.target_browser_session_id == target_browser_session_id
            && self.renderer_browser_session_id == renderer_browser_session_id
            && now >= self.issued_at
            && now - self.issued_at <= BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS
    }
}

/// 唯一 embedded renderer 的回调归属事实。native callback 是异步共享通道，不能只用
/// “当前 session”猜测归属；必须同时确认页面 URL 与本次绑定一致。
#[derive(Debug, Clone, PartialEq, Eq)]
struct EmbeddedBrowserWebviewBinding {
    browser_session_id: String,
    expected_url: String,
    load_started: bool,
}

impl EmbeddedBrowserWebviewBinding {
    fn navigating_to(browser_session_id: &str, expected_url: &str) -> Self {
        Self {
            browser_session_id: browser_session_id.to_string(),
            expected_url: expected_url.to_string(),
            load_started: false,
        }
    }

    fn accepts_page_load(
        &mut self,
        callback_url: &str,
        event: tauri::webview::PageLoadEvent,
    ) -> Option<String> {
        if !browser_webview_urls_match(self.expected_url.as_str(), callback_url) {
            return None;
        }
        match event {
            tauri::webview::PageLoadEvent::Started => self.load_started = true,
            tauri::webview::PageLoadEvent::Finished if !self.load_started => return None,
            tauri::webview::PageLoadEvent::Finished => {}
        }
        Some(self.browser_session_id.clone())
    }

    fn accepts_title(&self, callback_url: &str) -> Option<String> {
        (self.load_started && browser_webview_urls_match(self.expected_url.as_str(), callback_url))
            .then(|| self.browser_session_id.clone())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabContextMenuAction {
    browser_session_id: String,
    action: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserRawCapture {
    title: Option<String>,
    url: Option<String>,
    selected_text: Option<String>,
    viewport: Option<BrowserViewportState>,
    visible_text: Option<String>,
    #[serde(default)]
    headings: Vec<BrowserTextNode>,
    #[serde(default)]
    links: Vec<BrowserActionTarget>,
    #[serde(default)]
    buttons: Vec<BrowserActionTarget>,
    #[serde(default)]
    forms: Vec<BrowserFormSummary>,
    #[serde(default)]
    content_regions: Vec<BrowserContentRegion>,
    page_type: Option<BrowserPageType>,
    primary_content: Option<BrowserPrimaryContent>,
    #[serde(default)]
    readable_blocks: Vec<BrowserReadableBlock>,
    #[serde(default)]
    noise_diagnostics: Vec<BrowserNoiseDiagnostic>,
    #[serde(default)]
    visual_evidence: Vec<BrowserVisualEvidence>,
    #[serde(default)]
    omitted_capabilities: Vec<String>,
    language_hint: Option<String>,
}

fn browser_renderer_session_binding() -> &'static Mutex<Option<String>> {
    BROWSER_RENDERER_SESSION_ID.get_or_init(|| Mutex::new(None))
}

fn browser_embedded_webview_binding() -> &'static Mutex<Option<EmbeddedBrowserWebviewBinding>> {
    BROWSER_EMBEDDED_WEBVIEW_BINDING.get_or_init(|| Mutex::new(None))
}

fn browser_capture_bridge() -> &'static Mutex<HashMap<String, BrowserCaptureBridgeState>> {
    BROWSER_CAPTURE_BRIDGE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn browser_tab_context_menu_invocation() -> &'static Mutex<Option<BrowserTabContextMenuInvocation>>
{
    BROWSER_TAB_CONTEXT_MENU_INVOCATION.get_or_init(|| Mutex::new(None))
}

fn register_browser_tab_context_menu_invocation(invocation: BrowserTabContextMenuInvocation) {
    if let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() {
        *active_invocation = Some(invocation);
    }
}

fn consume_browser_tab_context_menu_invocation(
    nonce: &str,
    target_browser_session_id: &str,
    renderer_browser_session_id: &str,
    now: u64,
) -> bool {
    let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() else {
        return false;
    };
    consume_tab_context_menu_invocation(
        &mut active_invocation,
        nonce,
        target_browser_session_id,
        renderer_browser_session_id,
        now,
    )
}

fn consume_tab_context_menu_invocation(
    active_invocation: &mut Option<BrowserTabContextMenuInvocation>,
    nonce: &str,
    target_browser_session_id: &str,
    renderer_browser_session_id: &str,
    now: u64,
) -> bool {
    let is_authorized = active_invocation
        .as_ref()
        .map(|invocation| {
            invocation.authorizes(
                nonce,
                target_browser_session_id,
                renderer_browser_session_id,
                now,
            )
        })
        .unwrap_or(false);
    if is_authorized {
        *active_invocation = None;
    }
    is_authorized
}

fn clear_browser_tab_context_menu_invocation(nonce: &str) {
    if let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() {
        if active_invocation
            .as_ref()
            .map(|invocation| invocation.nonce == nonce)
            .unwrap_or(false)
        {
            *active_invocation = None;
        }
    }
}

fn invalidate_browser_tab_context_menu_invocation() {
    if let Ok(mut active_invocation) = browser_tab_context_menu_invocation().lock() {
        *active_invocation = None;
    }
}

fn bind_browser_renderer_session(browser_session_id: &str) {
    if let Ok(mut binding) = browser_renderer_session_binding().lock() {
        *binding = Some(browser_session_id.to_string());
    }
}

fn clear_browser_renderer_session(browser_session_id: &str) {
    if let Ok(mut binding) = browser_renderer_session_binding().lock() {
        if binding.as_deref() == Some(browser_session_id) {
            *binding = None;
        }
    }
}

fn browser_webview_urls_match(expected_url: &str, callback_url: &str) -> bool {
    let Ok(mut expected) = expected_url.parse::<tauri::Url>() else {
        return expected_url == callback_url;
    };
    let Ok(mut callback) = callback_url.parse::<tauri::Url>() else {
        return false;
    };
    expected.set_fragment(None);
    callback.set_fragment(None);
    expected == callback
}

fn current_browser_embedded_webview_binding() -> Option<EmbeddedBrowserWebviewBinding> {
    browser_embedded_webview_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.clone())
}

fn begin_browser_embedded_webview_navigation(
    browser_session_id: &str,
    expected_url: &str,
) -> EmbeddedBrowserWebviewBinding {
    // 页面切换后，旧 document 中遗留的菜单 URL 不能在切回同一 renderer 时复用。
    invalidate_browser_tab_context_menu_invocation();
    let next_binding =
        EmbeddedBrowserWebviewBinding::navigating_to(browser_session_id, expected_url);
    if let Ok(mut binding) = browser_embedded_webview_binding().lock() {
        *binding = Some(next_binding.clone());
    }
    next_binding
}

fn restore_browser_embedded_webview_binding(
    binding_to_restore: Option<EmbeddedBrowserWebviewBinding>,
) {
    if let Ok(mut binding) = browser_embedded_webview_binding().lock() {
        *binding = binding_to_restore;
    }
}

fn restore_browser_embedded_webview_session(browser_session_id: &str, expected_url: &str) {
    let mut restored_binding =
        EmbeddedBrowserWebviewBinding::navigating_to(browser_session_id, expected_url);
    // sync bounds 后恢复的是仍保留在同一 native renderer 内的页面，不会重新 navigate。
    restored_binding.load_started = true;
    restore_browser_embedded_webview_binding(Some(restored_binding));
}

fn update_browser_embedded_webview_navigation_target(browser_session_id: &str, expected_url: &str) {
    if let Ok(mut binding) = browser_embedded_webview_binding().lock() {
        let Some(binding) = binding.as_mut() else {
            return;
        };
        if binding.browser_session_id != browser_session_id {
            return;
        }
        binding.expected_url = expected_url.to_string();
        binding.load_started = false;
    }
}

fn clear_browser_embedded_webview_session(browser_session_id: &str) {
    let cleared = {
        let Ok(mut binding) = browser_embedded_webview_binding().lock() else {
            return;
        };
        if binding
            .as_ref()
            .map(|active| active.browser_session_id.as_str())
            == Some(browser_session_id)
        {
            *binding = None;
            true
        } else {
            false
        }
    };
    if cleared {
        invalidate_browser_tab_context_menu_invocation();
    }
}

fn browser_embedded_webview_page_load_session_id(
    callback_url: &str,
    event: tauri::webview::PageLoadEvent,
) -> Option<String> {
    browser_embedded_webview_binding()
        .lock()
        .ok()
        .and_then(|mut binding| binding.as_mut()?.accepts_page_load(callback_url, event))
}

fn browser_embedded_webview_title_session_id(callback_url: &str) -> Option<String> {
    browser_embedded_webview_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.as_ref()?.accepts_title(callback_url))
}

fn current_browser_renderer_session(fallback_session_id: &str) -> String {
    browser_renderer_session_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.clone())
        .unwrap_or_else(|| fallback_session_id.to_string())
}

fn current_browser_embedded_webview_session_id() -> Option<String> {
    current_browser_embedded_webview_binding().map(|binding| binding.browser_session_id)
}

fn settings_from_app_settings(settings: &crate::types::AppSettings) -> BrowserAgentSettings {
    BrowserAgentSettings {
        enabled: settings.browser_agent_enabled,
        prefer_for_ai_browser_operations: settings.browser_agent_prefer_built_in,
        allow_external_provider_fallback: settings.browser_agent_allow_external_provider_fallback,
        ..BrowserAgentSettings::default()
    }
}

async fn current_settings(state: &State<'_, AppState>) -> BrowserAgentSettings {
    let settings = state.app_settings.lock().await;
    settings_from_app_settings(&settings)
}

fn default_route_decision(
    requested_capability: &str,
    settings: &BrowserAgentSettings,
    user_override: bool,
    platform_capability: &BrowserPlatformCapability,
) -> BrowserProviderRouteDecision {
    if !settings.enabled {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent is disabled in settings.".to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("browser_agent_disabled".to_string()),
        };
    }

    if user_override {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "User explicitly opted out of the built-in Browser Agent.".to_string(),
            user_override,
            fallback_used: true,
            fallback_reason: Some("user_override".to_string()),
        };
    }

    if !settings.prefer_for_ai_browser_operations {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent is enabled but not preferred for AI browser operations."
                .to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("browser_agent_not_preferred".to_string()),
        };
    }

    let capability_state = match requested_capability {
        "read_snapshot" => &platform_capability.snapshot_capture,
        "navigate" | "reload" | "scroll" => &platform_capability.navigation_actions,
        "click" | "type" => &platform_capability.element_actions,
        "submit" | "full_agent_task" => &platform_capability.form_submit_actions,
        _ => &BrowserCapabilityState::Unsupported,
    };
    if *capability_state == BrowserCapabilityState::Unsupported {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent platform capability is unsupported for this operation."
                .to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("platform_unsupported".to_string()),
        };
    }

    let phase_blocked = match requested_capability {
        "read_snapshot" => !settings.allow_read_only_snapshots,
        "navigate" | "reload" | "scroll" => !settings.allow_navigation_actions,
        "click" | "type" => !settings.allow_element_actions,
        "submit" | "full_agent_task" => !settings.allow_form_submit_actions,
        _ => true,
    };
    if phase_blocked {
        return BrowserProviderRouteDecision {
            requested_capability: requested_capability.to_string(),
            selected_provider: "browser_skill".to_string(),
            reason: "Browser Agent feature phase blocks this operation.".to_string(),
            user_override,
            fallback_used: settings.allow_external_provider_fallback,
            fallback_reason: Some("phase_blocked".to_string()),
        };
    }

    BrowserProviderRouteDecision {
        requested_capability: requested_capability.to_string(),
        selected_provider: "built_in_browser_agent".to_string(),
        reason: "Browser Agent is enabled and preferred for AI browser operations.".to_string(),
        user_override,
        fallback_used: false,
        fallback_reason: None,
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn browser_diagnostic(
    diagnostic_id: &str,
    kind: &str,
    severity: &str,
    message: &str,
) -> BrowserDiagnostic {
    BrowserDiagnostic {
        diagnostic_id: diagnostic_id.to_string(),
        kind: kind.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        source: Some("browser_agent".to_string()),
        redacted: true,
    }
}

fn blocked_url(raw_url: &str, blocked_reason: &str, message: &str) -> BrowserUrlValidationResult {
    BrowserUrlValidationResult {
        raw_url: raw_url.to_string(),
        normalized_url: None,
        allowed: false,
        blocked_reason: Some(blocked_reason.to_string()),
        diagnostic: Some(browser_diagnostic(
            "browser-url-blocked",
            "security_warning",
            "warning",
            message,
        )),
        workspace_local_allowed: false,
    }
}

fn origin_from_normalized_url(normalized_url: &str) -> Option<String> {
    let (scheme, rest) = normalized_url.split_once("://")?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim();
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
}

fn host_from_normalized_url(normalized_url: &str) -> Option<String> {
    let (_, rest) = normalized_url.split_once("://")?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim();
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = if host_port.starts_with('[') {
        host_port
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or_default()
    } else {
        host_port.split(':').next().unwrap_or_default()
    };
    let normalized = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn is_blocked_local_host(host: &str) -> bool {
    host == "localhost"
        || host == "::1"
        || host.starts_with("127.")
        || host == "0.0.0.0"
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("172.16.")
        || host.starts_with("172.17.")
        || host.starts_with("172.18.")
        || host.starts_with("172.19.")
        || host.starts_with("172.20.")
        || host.starts_with("172.21.")
        || host.starts_with("172.22.")
        || host.starts_with("172.23.")
        || host.starts_with("172.24.")
        || host.starts_with("172.25.")
        || host.starts_with("172.26.")
        || host.starts_with("172.27.")
        || host.starts_with("172.28.")
        || host.starts_with("172.29.")
        || host.starts_with("172.30.")
        || host.starts_with("172.31.")
}

fn is_workspace_local_development_host(host: &str) -> bool {
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

fn is_cleanup_candidate(session: &BrowserSession, now: u64, max_closed_age_ms: u64) -> bool {
    let terminal = matches!(
        session.status,
        BrowserSessionStatus::Closed
            | BrowserSessionStatus::Failed
            | BrowserSessionStatus::Unsupported
    );
    terminal && now.saturating_sub(session.updated_at) > max_closed_age_ms
}

fn browser_evidence_id(snapshot_id: &str) -> String {
    format!("browser-evidence-{snapshot_id}")
}

fn snapshot_summary(snapshot: &BrowserContextSnapshot) -> String {
    let title = snapshot
        .source
        .title
        .as_deref()
        .unwrap_or(snapshot.source.normalized_url.as_str());
    let text = snapshot
        .page
        .primary_content
        .as_ref()
        .map(|content| content.text.as_str())
        .unwrap_or(snapshot.page.visible_text.as_str())
        .replace('\n', " ");
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return title.to_string();
    }
    let excerpt = compact.chars().take(360).collect::<String>();
    format!("{title}\n{excerpt}")
}

fn default_browser_viewport() -> BrowserViewportState {
    BrowserViewportState {
        width: None,
        height: None,
        scroll_x: None,
        scroll_y: None,
        scroll_height: None,
        scroll_width: None,
        device_pixel_ratio: None,
    }
}

fn current_browser_renderer_session_id() -> Option<String> {
    browser_renderer_session_binding()
        .lock()
        .ok()
        .and_then(|binding| binding.clone())
}

fn percent_decode_browser_capture(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &value[index + 1..index + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn parse_browser_capture_navigation(target_url: &str) -> Option<BrowserCaptureNavigationChunk> {
    let prefix = format!("https://{BROWSER_CAPTURE_BRIDGE_HOST}{BROWSER_CAPTURE_BRIDGE_PATH}?");
    let query = target_url.strip_prefix(prefix.as_str())?;
    let mut token = None;
    let mut browser_session_id = None;
    let mut index = None;
    let mut total = None;
    let mut payload = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        match key {
            "token" => token = Some(percent_decode_browser_capture(value)),
            "session" => browser_session_id = Some(percent_decode_browser_capture(value)),
            "index" => index = value.parse::<usize>().ok(),
            "total" => total = value.parse::<usize>().ok(),
            "payload" => payload = Some(value.to_string()),
            _ => {}
        }
    }
    Some(BrowserCaptureNavigationChunk {
        token: token?,
        browser_session_id: browser_session_id?,
        index: index?,
        total: total?,
        payload: payload?,
    })
}

fn handle_browser_capture_navigation(target_url: &str) -> bool {
    let Some(chunk) = parse_browser_capture_navigation(target_url) else {
        return false;
    };
    if chunk.total == 0 || chunk.total > 256 || chunk.index >= chunk.total {
        return true;
    }
    if let Ok(mut bridge) = browser_capture_bridge().lock() {
        let entry = bridge
            .entry(chunk.token)
            .or_insert_with(|| BrowserCaptureBridgeState {
                browser_session_id: chunk.browser_session_id.clone(),
                chunks: vec![None; chunk.total],
            });
        if entry.browser_session_id == chunk.browser_session_id && entry.chunks.len() == chunk.total
        {
            entry.chunks[chunk.index] = Some(chunk.payload);
        }
    }
    true
}

fn take_browser_capture_payload(token: &str) -> Option<String> {
    let mut bridge = browser_capture_bridge().lock().ok()?;
    let entry = bridge.get(token)?;
    if entry.chunks.iter().any(|chunk| chunk.is_none()) {
        return None;
    }
    let encoded = entry
        .chunks
        .iter()
        .filter_map(|chunk| chunk.as_deref())
        .collect::<String>();
    bridge.remove(token);
    let decoded = URL_SAFE_NO_PAD.decode(encoded.as_bytes()).ok()?;
    String::from_utf8(decoded).ok()
}

fn cleanup_browser_capture_payload(token: &str) {
    if let Ok(mut bridge) = browser_capture_bridge().lock() {
        bridge.remove(token);
    }
}

fn escape_js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn browser_capture_bridge_script(browser_session_id: &str, token: &str) -> String {
    let capture_script = capture_script::READ_ONLY_CAPTURE_SCRIPT;
    let session = escape_js_string(browser_session_id);
    let capture_token = escape_js_string(token);
    format!(
        r#"
(() => {{
  const sessionId = {session};
  const token = {capture_token};
  const chunkSize = {BROWSER_CAPTURE_CHUNK_SIZE};
  const bridgeBase = "https://{BROWSER_CAPTURE_BRIDGE_HOST}{BROWSER_CAPTURE_BRIDGE_PATH}";
  const toBase64Url = (value) => {{
    const bytes = typeof TextEncoder === "function"
      ? new TextEncoder().encode(value)
      : Array.from(unescape(encodeURIComponent(value))).map((char) => char.charCodeAt(0));
    let binary = "";
    bytes.forEach((byte) => {{
      binary += String.fromCharCode(byte);
    }});
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }};
  try {{
    const facts = {capture_script};
    const encoded = toBase64Url(JSON.stringify(facts || {{}}));
    const chunks = encoded.match(new RegExp(".{{1," + chunkSize + "}}", "g")) || [""];
    chunks.forEach((chunk, index) => {{
      window.setTimeout(() => {{
        const url = bridgeBase
          + "?token=" + encodeURIComponent(token)
          + "&session=" + encodeURIComponent(sessionId)
          + "&index=" + index
          + "&total=" + chunks.length
          + "&payload=" + chunk;
        window.location.href = url;
      }}, index * 35);
    }});
  }} catch (error) {{
    const fallback = toBase64Url(JSON.stringify({{
      title: document.title || null,
      url: location.href,
      visibleText: "",
      captureError: error && error.message ? String(error.message) : "capture_failed"
    }}));
    window.location.href = bridgeBase
      + "?token=" + encodeURIComponent(token)
      + "&session=" + encodeURIComponent(sessionId)
      + "&index=0&total=1&payload=" + fallback;
  }}
}})();
"#
    )
}

async fn capture_browser_webview_dom(
    app: &AppHandle,
    browser_session_id: &str,
) -> Result<BrowserRawCapture, String> {
    let token = format!("browser-capture-{}", uuid::Uuid::new_v4());
    let script = browser_capture_bridge_script(browser_session_id, token.as_str());
    eval_browser_renderer_script(app, browser_session_id, script).map_err(|error| {
        format!("failed to run Browser Agent read-only capture script: {error}")
    })?;
    for _ in 0..BROWSER_CAPTURE_WAIT_ATTEMPTS {
        if let Some(payload) = take_browser_capture_payload(token.as_str()) {
            return serde_json::from_str::<BrowserRawCapture>(payload.as_str()).map_err(|error| {
                format!("failed to parse Browser Agent capture payload: {error}")
            });
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    cleanup_browser_capture_payload(token.as_str());
    Err("Browser Agent read-only capture timed out.".to_string())
}

fn browser_snapshot_budget(settings: &BrowserAgentSettings) -> BrowserSnapshotBudget {
    BrowserSnapshotBudget {
        char_limit: settings.default_snapshot_budget_chars as usize,
        visible_text_limit: 8_000,
        element_limit: 120,
        form_field_limit: 80,
        diagnostic_limit: 50,
        token_estimate: None,
        truncated: false,
        omitted_element_count: 0,
    }
}

fn is_workspace_local_snapshot(session: &BrowserSession) -> bool {
    host_from_normalized_url(session.normalized_url.as_str())
        .map(|host| is_workspace_local_development_host(host.as_str()))
        .unwrap_or(false)
}

fn browser_code_candidates_for_session(session: &BrowserSession) -> Vec<BrowserCodeCandidate> {
    if !is_workspace_local_snapshot(session) {
        return Vec::new();
    }
    let route = session
        .normalized_url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').skip(1).next())
        .unwrap_or_default();
    let route_path = session
        .normalized_url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split_once('/').map(|(_, path)| path))
        .map(|path| format!("/{path}"))
        .unwrap_or_else(|| "/".to_string());
    let leaf = route
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .next_back()
        .unwrap_or("index");
    vec![BrowserCodeCandidate {
        candidate_id: format!("route_match:src/routes/{leaf}.tsx"),
        file_path: format!("src/routes/{leaf}.tsx"),
        symbol_name: None,
        reason: "route_match".to_string(),
        confidence: "low".to_string(),
        matched_text: Some(route_path),
    }]
}

fn compact_browser_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn mark_redaction(privacy: &mut BrowserPrivacyReport, kind: &str) {
    privacy.redaction_applied = true;
    if !privacy.redacted_kinds.iter().any(|entry| entry == kind) {
        privacy.redacted_kinds.push(kind.to_string());
    }
}

fn looks_sensitive(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("password")
        || lower.contains("passwd")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("authorization")
        || lower.contains("cookie")
        || lower.contains("api_key")
        || lower.contains("apikey")
}

fn redact_sensitive_assignments(value: &str, privacy: &mut BrowserPrivacyReport) -> String {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    let mut redacted = Vec::with_capacity(parts.len());
    let mut redact_next = false;
    for part in parts {
        let lower = part.to_ascii_lowercase();
        if redact_next {
            redacted.push("[redacted-sensitive]".to_string());
            mark_redaction(privacy, "secret_like");
            redact_next = false;
            continue;
        }
        if let Some((key, _)) = part.split_once('=') {
            if looks_sensitive(key) {
                redacted.push(format!("{key}=[redacted]"));
                mark_redaction(privacy, "secret_like");
                continue;
            }
        }
        if let Some((key, _)) = part.split_once(':') {
            if looks_sensitive(key) {
                redacted.push(format!("{key}:[redacted]"));
                mark_redaction(privacy, "secret_like");
                continue;
            }
        }
        if lower == "authorization" || lower == "authorization:" || lower == "bearer" {
            redacted.push(part.to_string());
            redact_next = true;
            continue;
        }
        redacted.push(part.to_string());
    }
    redacted.join(" ")
}

fn sanitize_browser_string(
    value: Option<String>,
    limit: usize,
    privacy: &mut BrowserPrivacyReport,
) -> Option<String> {
    let raw = value?;
    if raw.trim().is_empty() {
        return None;
    }
    let mut sanitized =
        redact_sensitive_assignments(compact_browser_text(raw.as_str()).as_str(), privacy);
    if sanitized.contains('@') && sanitized.contains('.') {
        mark_redaction(privacy, "email");
        sanitized = sanitized
            .split_whitespace()
            .map(|part| {
                if part.contains('@') && part.contains('.') {
                    "[redacted-email]"
                } else {
                    part
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
    }
    Some(sanitized.chars().take(limit).collect::<String>())
}

fn sanitize_browser_target(
    mut target: BrowserActionTarget,
    privacy: &mut BrowserPrivacyReport,
) -> BrowserActionTarget {
    let sensitive_identity = [
        Some(target.label.as_str()),
        target.accessible_name.as_deref(),
        target.placeholder.as_deref(),
        target.href.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(looks_sensitive);
    target.sensitive = target.sensitive || sensitive_identity;
    target.label = sanitize_browser_string(Some(target.label), 320, privacy).unwrap_or_default();
    target.accessible_name = sanitize_browser_string(target.accessible_name, 320, privacy);
    target.text = sanitize_browser_string(target.text, 640, privacy);
    target.href = sanitize_browser_string(target.href, 640, privacy);
    target.placeholder = sanitize_browser_string(target.placeholder, 320, privacy);
    if target.sensitive {
        mark_redaction(privacy, "hidden_input");
        target.value_preview = None;
    } else {
        target.value_preview = sanitize_browser_string(target.value_preview, 320, privacy);
    }
    target
}

fn browser_element_landmarks_from_targets(
    links: &[BrowserActionTarget],
    buttons: &[BrowserActionTarget],
    forms: &[BrowserFormSummary],
) -> Vec<BrowserElementLandmark> {
    let link_landmarks = links.iter().take(40).map(|target| BrowserElementLandmark {
        landmark_id: target.target_id.clone(),
        role: "link".to_string(),
        label: target.label.clone(),
        text_preview: target.text.clone(),
        selector_hint: None,
        href: target.href.clone(),
        placeholder: target.placeholder.clone(),
        enabled: !target.disabled,
        visible: target.visible,
        sensitive: target.sensitive,
        bounds: target.bounds.clone(),
    });
    let button_landmarks = buttons
        .iter()
        .take(40)
        .map(|target| BrowserElementLandmark {
            landmark_id: target.target_id.clone(),
            role: "button".to_string(),
            label: target.label.clone(),
            text_preview: target.text.clone(),
            selector_hint: None,
            href: None,
            placeholder: target.placeholder.clone(),
            enabled: !target.disabled,
            visible: target.visible,
            sensitive: target.sensitive,
            bounds: target.bounds.clone(),
        });
    let field_landmarks = forms.iter().flat_map(|form| {
        form.fields
            .iter()
            .take(12)
            .map(|target| BrowserElementLandmark {
                landmark_id: target.target_id.clone(),
                role: target.kind.clone(),
                label: target.label.clone(),
                text_preview: target.text.clone(),
                selector_hint: None,
                href: None,
                placeholder: target.placeholder.clone(),
                enabled: !target.disabled,
                visible: target.visible,
                sensitive: target.sensitive,
                bounds: target.bounds.clone(),
            })
    });
    link_landmarks
        .chain(button_landmarks)
        .chain(field_landmarks)
        .take(120)
        .collect()
}

fn page_from_raw_capture(
    raw: BrowserRawCapture,
    budget: &mut BrowserSnapshotBudget,
    privacy: &mut BrowserPrivacyReport,
) -> BrowserContextSnapshotPage {
    let visible_text =
        sanitize_browser_string(raw.visible_text, budget.visible_text_limit, privacy)
            .unwrap_or_default();
    let text_truncated = visible_text.chars().count() >= budget.visible_text_limit;
    let headings = raw
        .headings
        .into_iter()
        .take(80)
        .map(|mut heading| {
            heading.text =
                sanitize_browser_string(Some(heading.text), 320, privacy).unwrap_or_default();
            heading
        })
        .collect::<Vec<_>>();
    let links = raw
        .links
        .into_iter()
        .take(80)
        .map(|target| sanitize_browser_target(target, privacy))
        .collect::<Vec<_>>();
    let buttons = raw
        .buttons
        .into_iter()
        .take(80)
        .map(|target| sanitize_browser_target(target, privacy))
        .collect::<Vec<_>>();
    let forms = raw
        .forms
        .into_iter()
        .take(20)
        .map(|mut form| {
            form.label =
                sanitize_browser_string(Some(form.label), 320, privacy).unwrap_or_default();
            form.action_origin = sanitize_browser_string(form.action_origin, 320, privacy);
            form.fields = form
                .fields
                .into_iter()
                .take(budget.form_field_limit)
                .map(|target| sanitize_browser_target(target, privacy))
                .collect();
            form.submit_targets = form
                .submit_targets
                .into_iter()
                .take(20)
                .map(|target| sanitize_browser_target(target, privacy))
                .collect();
            form
        })
        .collect::<Vec<_>>();
    let content_regions = raw
        .content_regions
        .into_iter()
        .take(8)
        .map(|mut region| {
            region.label =
                sanitize_browser_string(Some(region.label), 240, privacy).unwrap_or_default();
            region.text_preview =
                sanitize_browser_string(Some(region.text_preview), 1_200, privacy)
                    .unwrap_or_default();
            region
        })
        .collect::<Vec<_>>();
    let primary_content = raw.primary_content.map(|mut content| {
        content.text =
            sanitize_browser_string(Some(content.text), budget.visible_text_limit, privacy)
                .unwrap_or_default();
        content.truncated =
            content.truncated || content.text.chars().count() >= budget.visible_text_limit;
        content
    });
    let readable_blocks = raw
        .readable_blocks
        .into_iter()
        .take(12)
        .map(|mut block| {
            block.text =
                sanitize_browser_string(Some(block.text), 1_200, privacy).unwrap_or_default();
            block
        })
        .collect::<Vec<_>>();
    let noise_diagnostics = raw
        .noise_diagnostics
        .into_iter()
        .take(budget.diagnostic_limit)
        .map(|mut diagnostic| {
            diagnostic.message =
                sanitize_browser_string(Some(diagnostic.message), 320, privacy).unwrap_or_default();
            diagnostic
        })
        .collect::<Vec<_>>();
    let visual_evidence = raw
        .visual_evidence
        .into_iter()
        .take(20)
        .map(|mut item| {
            item.label =
                sanitize_browser_string(Some(item.label), 320, privacy).unwrap_or_default();
            item.alt_text = sanitize_browser_string(item.alt_text, 320, privacy);
            item.src_origin = sanitize_browser_string(item.src_origin, 320, privacy);
            item.nearby_text = if item.sensitive {
                None
            } else {
                sanitize_browser_string(item.nearby_text, 640, privacy)
            };
            item
        })
        .collect::<Vec<_>>();
    let element_landmarks = browser_element_landmarks_from_targets(&links, &buttons, &forms);
    let selected_text = sanitize_browser_string(raw.selected_text, 1_000, privacy);
    let used_elements =
        headings.len() + links.len() + buttons.len() + forms.len() + element_landmarks.len();
    budget.truncated = text_truncated || used_elements >= budget.element_limit;
    budget.omitted_element_count = used_elements.saturating_sub(budget.element_limit);
    BrowserContextSnapshotPage {
        visible_text,
        page_type: raw.page_type.unwrap_or(BrowserPageType::Unknown),
        primary_content,
        readable_blocks,
        noise_diagnostics,
        visual_evidence,
        text_truncated,
        headings,
        landmarks: Vec::new(),
        element_landmarks,
        content_regions,
        links,
        buttons,
        forms,
        selected_text,
        language_hint: raw
            .language_hint
            .and_then(|value| sanitize_browser_string(Some(value), 64, privacy)),
    }
}

async fn persist_snapshot_evidence(
    state: &State<'_, AppState>,
    snapshot: &BrowserContextSnapshot,
) -> BrowserContextSnapshotEvidence {
    let settings = current_settings(state).await;
    let retention_ms =
        u64::from(settings.evidence_retention_days).saturating_mul(24 * 60 * 60 * 1000);
    let evidence_id = browser_evidence_id(snapshot.snapshot_id.as_str());
    let record = BrowserEvidenceRecord {
        evidence_id: evidence_id.clone(),
        browser_session_id: snapshot.browser_session_id.clone(),
        snapshot_id: snapshot.snapshot_id.clone(),
        workspace_id: snapshot.workspace_id.clone(),
        url: snapshot.source.normalized_url.clone(),
        title: snapshot.source.title.clone(),
        captured_at: snapshot.captured_at,
        expires_at: snapshot.captured_at.saturating_add(retention_ms),
        state: "available".to_string(),
        summary: snapshot_summary(snapshot),
        privacy: snapshot.privacy.clone(),
        freshness: snapshot.freshness.clone(),
        diagnostics: snapshot.diagnostics.capture_warnings.clone(),
        code_candidates: snapshot.code_candidates.clone(),
    };
    state
        .browser_evidence
        .lock()
        .await
        .insert(evidence_id.clone(), record);
    BrowserContextSnapshotEvidence {
        screenshot_ref: Some(format!("browser-screenshot-ref-{}", snapshot.snapshot_id)),
        html_excerpt_ref: Some(evidence_id),
    }
}

fn close_legacy_browser_child_webviews(app: &AppHandle) {
    // 旧版曾为每个 tab 建 child WebView；升级后的 renderer 固定为单实例。热更新场景
    // 下先清理遗留实例，避免它们继续盖住当前 Browser Dock surface。
    let legacy_labels: Vec<String> = app
        .webviews()
        .into_keys()
        .filter(|label| {
            label.starts_with("browser-agent-webview-")
                && label.as_str() != BROWSER_RENDERER_WEBVIEW_LABEL
        })
        .collect();
    for label in legacy_labels {
        if let Some(webview) = app.get_webview(label.as_str()) {
            let _ = webview.close();
        }
    }
}

fn valid_webview_bounds(bounds: &BrowserWebviewBounds) -> bool {
    bounds.x.is_finite()
        && bounds.y.is_finite()
        && bounds.width.is_finite()
        && bounds.height.is_finite()
        && bounds.width >= 40.0
        && bounds.height >= 40.0
}

fn browser_webview_rect(bounds: &BrowserWebviewBounds) -> tauri::Rect {
    tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(bounds.x, bounds.y)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(bounds.width, bounds.height)),
    }
}

struct BrowserTabContextMenuLabels {
    close_current: &'static str,
    close_others: &'static str,
    close_right: &'static str,
    close_all: &'static str,
}

fn browser_tab_context_menu_overlay_script(
    browser_session_id: &str,
    nonce: &str,
    x: f64,
    locale: Option<&str>,
    disabled_actions: &[String],
    theme: &BrowserTabContextMenuTheme,
) -> Result<String, String> {
    let labels = browser_tab_context_menu_labels(locale);
    let session_id =
        serde_json::to_string(browser_session_id).map_err(|error| error.to_string())?;
    let nonce = serde_json::to_string(nonce).map_err(|error| error.to_string())?;
    let theme = serde_json::to_string(theme).map_err(|error| error.to_string())?;
    let items = serde_json::to_string(&[
        (
            "current",
            labels.close_current,
            disabled_actions.iter().any(|action| action == "current"),
        ),
        (
            "others",
            labels.close_others,
            disabled_actions.iter().any(|action| action == "others"),
        ),
        (
            "right",
            labels.close_right,
            disabled_actions.iter().any(|action| action == "right"),
        ),
        (
            "all",
            labels.close_all,
            disabled_actions.iter().any(|action| action == "all"),
        ),
    ])
    .map_err(|error| error.to_string())?;
    let x = x.max(12.0);

    Ok(format!(
        r#"(() => {{
  const cleanupKey = "__mossxBrowserTabMenuCleanup";
  if (typeof window[cleanupKey] === "function") {{
    window[cleanupKey]();
  }}
  const host = document.createElement("div");
  host.id = "mossx-browser-tab-context-menu";
  host.setAttribute("data-mossx-browser-tab-menu", "true");
  const setHostStyle = (property, value) => host.style.setProperty(property, value, "important");
  setHostStyle("all", "initial");
  setHostStyle("position", "fixed");
  setHostStyle("inset", "0");
  setHostStyle("z-index", "2147483647");
  setHostStyle("display", "block");
  setHostStyle("visibility", "visible");
  setHostStyle("opacity", "1");
  setHostStyle("transform", "none");
  setHostStyle("pointer-events", "none");
  const shadow = host.attachShadow({{ mode: "closed" }});
  const root = document.createElement("div");
  root.id = "mossx-browser-tab-context-menu-root";
  root.setAttribute("role", "menu");
  root.setAttribute("aria-label", "Browser tab actions");
  root.style.cssText = [
    "position:fixed", "z-index:2147483647", "left:min({x}px, calc(100vw - 272px))",
    "top:{BROWSER_TAB_CONTEXT_MENU_TOP_OFFSET}px", "width:248px", "box-sizing:border-box",
    "padding:8px", "border:1px solid var(--mossx-tab-menu-border)", "border-radius:16px",
    "background:var(--mossx-tab-menu-surface)",
    "font:500 16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", "color:var(--mossx-tab-menu-foreground)",
    "pointer-events:auto", "isolation:isolate"
  ].join(";");
  const theme = {theme};
  root.style.colorScheme = theme.colorScheme;
  root.style.setProperty("--mossx-tab-menu-surface", theme.surface);
  root.style.setProperty("--mossx-tab-menu-foreground", theme.foreground);
  root.style.setProperty("--mossx-tab-menu-border", theme.border);
  root.style.setProperty("--mossx-tab-menu-hover", theme.hoverSurface);
  root.style.setProperty("--mossx-tab-menu-disabled-foreground", theme.disabledForeground);
  if (theme.shadow !== "none") root.style.boxShadow = "0 18px 48px " + theme.shadow;
  const close = () => {{
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    host.remove();
    delete window[cleanupKey];
  }};
  const onPointerDown = (event) => {{
    if (!event.composedPath().includes(host)) close();
  }};
  const onKeyDown = (event) => {{
    if (event.key === "Escape") close();
  }};
  const sessionId = {session_id};
  const menuNonce = {nonce};
  const actions = {items};
  for (const [action, label, disabled] of actions) {{
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.setAttribute("role", "menuitem");
    button.disabled = disabled;
    button.setAttribute("aria-disabled", String(disabled));
    button.textContent = label;
    button.style.cssText = "display:block;width:100%;min-height:42px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:" + (disabled ? "var(--mossx-tab-menu-disabled-foreground)" : "var(--mossx-tab-menu-foreground)") + ";text-align:left;font:inherit;cursor:" + (disabled ? "not-allowed" : "pointer");
    button.onmouseenter = () => {{ if (!disabled) button.style.background = "var(--mossx-tab-menu-hover)"; }};
    button.onmouseleave = () => {{ if (!disabled) button.style.background = "transparent"; }};
    button.onclick = () => {{
      if (disabled) return;
      close();
      window.location.assign("https://{BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST}{BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH}?action=" + encodeURIComponent(action) + "&browserSessionId=" + encodeURIComponent(sessionId) + "&nonce=" + encodeURIComponent(menuNonce));
    }};
    root.appendChild(button);
  }}
  shadow.appendChild(root);
  (document.body || document.documentElement).appendChild(host);
  window[cleanupKey] = close;
  setTimeout(() => document.addEventListener("pointerdown", onPointerDown, true), 0);
  window.addEventListener("keydown", onKeyDown, true);
}})();"#,
    ))
}

fn handle_browser_tab_context_menu_navigation(app: &AppHandle, target_url: &str) -> bool {
    let Ok(url) = target_url.parse::<tauri::Url>() else {
        return false;
    };
    if url.host_str() != Some(BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST)
        || url.path() != BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH
    {
        return false;
    }
    let mut action = None;
    let mut browser_session_id = None;
    let mut nonce = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "action" => action = Some(value.into_owned()),
            "browserSessionId" => browser_session_id = Some(value.into_owned()),
            "nonce" => nonce = Some(value.into_owned()),
            _ => {}
        }
    }
    let (Some(action), Some(browser_session_id), Some(nonce)) = (action, browser_session_id, nonce)
    else {
        return true;
    };
    let Some(renderer_browser_session_id) = current_browser_embedded_webview_session_id() else {
        return true;
    };
    if matches!(action.as_str(), "current" | "others" | "right" | "all")
        && consume_browser_tab_context_menu_invocation(
            nonce.as_str(),
            browser_session_id.as_str(),
            renderer_browser_session_id.as_str(),
            unix_time_ms(),
        )
    {
        let _ = app.emit(
            BROWSER_TAB_CONTEXT_MENU_EVENT,
            BrowserTabContextMenuAction {
                browser_session_id,
                action,
            },
        );
    }
    true
}

fn browser_tab_context_menu_labels(locale: Option<&str>) -> BrowserTabContextMenuLabels {
    if locale.unwrap_or_default().starts_with("zh") {
        return BrowserTabContextMenuLabels {
            close_current: "关闭标签页",
            close_others: "关闭其他标签页",
            close_right: "关闭右侧标签页",
            close_all: "关闭全部标签页",
        };
    }
    BrowserTabContextMenuLabels {
        close_current: "Close tab",
        close_others: "Close other tabs",
        close_right: "Close tabs to the right",
        close_all: "Close all tabs",
    }
}

fn emit_browser_webview_event(app: &AppHandle, event: BrowserWebviewEvent) {
    let _ = app.emit(BROWSER_WEBVIEW_EVENT, event);
}

fn eval_browser_renderer_script(
    app: &AppHandle,
    browser_session_id: &str,
    script: impl Into<String>,
) -> Result<(), String> {
    let script = script.into();
    let renderer_matches = current_browser_renderer_session_id()
        .as_deref()
        .map(|session_id| session_id == browser_session_id)
        .unwrap_or(false);
    if renderer_matches {
        if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
            return window.eval(script).map_err(|error| error.to_string());
        }
    }

    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id) {
        return Err(format!(
            "Browser Agent embedded renderer is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent renderer not found: {browser_session_id}"))?;
    webview.eval(script).map_err(|error| error.to_string())
}

fn navigate_browser_renderer(
    app: &AppHandle,
    browser_session_id: &str,
    url: tauri::Url,
) -> Result<(), String> {
    let renderer_matches = current_browser_renderer_session_id()
        .as_deref()
        .map(|session_id| session_id == browser_session_id)
        .unwrap_or(false);
    if renderer_matches {
        if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
            return window.navigate(url).map_err(|error| error.to_string());
        }
    }

    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id) {
        return Err(format!(
            "Browser Agent embedded renderer is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent renderer not found: {browser_session_id}"))?;
    webview.navigate(url).map_err(|error| error.to_string())
}

fn resolve_browser_parent_window(
    app: &AppHandle,
) -> Result<tauri::WebviewWindow<tauri::Wry>, String> {
    let windows = app.webview_windows();
    let labels = windows
        .keys()
        .map(|label| label.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    if let Some(window) = windows
        .values()
        .find(|window| {
            window.label() != "about"
                && window.label() != BROWSER_RENDERER_WEBVIEW_LABEL
                && window.is_focused().unwrap_or(false)
        })
        .cloned()
    {
        return Ok(window);
    }
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }
    if let Some(window) = windows.into_values().find(|window| {
        window.label() != "about" && window.label() != BROWSER_RENDERER_WEBVIEW_LABEL
    }) {
        return Ok(window);
    }
    if labels.is_empty() {
        return Err(
            "Main window not found for Browser Agent WebView. No webview windows are registered."
                .to_string(),
        );
    }
    Err(format!(
        "Main window not found for Browser Agent WebView. Registered windows: {labels}"
    ))
}

fn spawn_browser_webview_session_patch(
    app: AppHandle,
    browser_session_id: String,
    status: Option<BrowserSessionStatus>,
    url: Option<String>,
    title: Option<String>,
    error_code: Option<String>,
    diagnostic_message: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        let now = unix_time_ms();
        let label = BROWSER_RENDERER_WEBVIEW_LABEL.to_string();
        let event = {
            let state = app.state::<AppState>();
            let mut sessions = state.browser_sessions.lock().await;
            let Some(session) = sessions.get_mut(browser_session_id.as_str()) else {
                return;
            };

            if let Some(next_url) = url.as_ref() {
                session.url = next_url.clone();
                session.normalized_url = next_url.clone();
                session.origin = origin_from_normalized_url(next_url.as_str());
            }
            if let Some(next_title) = title.as_ref() {
                session.title = if next_title.trim().is_empty() {
                    None
                } else {
                    Some(next_title.clone())
                };
            }
            if let Some(next_status) = status.as_ref() {
                session.status = next_status.clone();
            }
            if error_code.is_some() {
                session.error_code = error_code.clone();
            }
            if diagnostic_message.is_some() {
                session.diagnostic_message = diagnostic_message.clone();
            }
            session.updated_at = now;
            session.last_activated_at = now;

            BrowserWebviewEvent {
                browser_session_id: browser_session_id.clone(),
                label,
                url,
                title,
                status: session.status.clone(),
                occurred_at: now,
                error_code,
                diagnostic_message,
            }
        };
        emit_browser_webview_event(&app, event);
    });
}

fn create_browser_child_webview(
    app: &AppHandle,
    session: &BrowserSession,
    bounds: &BrowserWebviewBounds,
) -> Result<(), String> {
    if !valid_webview_bounds(bounds) {
        return Err("Browser Agent WebView bounds are too small.".to_string());
    }

    let label = BROWSER_RENDERER_WEBVIEW_LABEL;
    let url: tauri::Url = session
        .normalized_url
        .parse()
        .map_err(|error| format!("Invalid Browser Agent URL: {error}"))?;
    close_legacy_browser_child_webviews(app);
    if let Some(webview) = app.get_webview(label) {
        webview
            .navigate(url)
            .map_err(|error| format!("Failed to navigate Browser Agent WebView: {error}"))?;
        let _ = webview.set_auto_resize(false);
        webview
            .set_bounds(browser_webview_rect(bounds))
            .map_err(|error| error.to_string())?;
        webview.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window = resolve_browser_parent_window(app)?;
    let workspace_id_for_navigation = session.workspace_id.clone();
    let app_for_navigation = app.clone();
    let app_for_load = app.clone();
    let app_for_title = app.clone();

    let webview_builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .on_navigation(move |target_url| {
            // renderer 已隐藏或被关闭后仍可能收到迟到的 navigation 回调；无 active
            // binding 时不能回退到首次创建该 WebView 的 tab。
            let Some(active_session_id) = current_browser_embedded_webview_session_id() else {
                return false;
            };
            if handle_browser_tab_context_menu_navigation(&app_for_navigation, target_url.as_str())
            {
                return false;
            }
            // 元素选择器完成时通过 bridge URL 回传选中元素证据（与浮动窗同一通道）
            if handle_browser_toolbar_navigation(
                &app_for_navigation,
                target_url.as_str(),
                active_session_id.as_str(),
                workspace_id_for_navigation.as_str(),
            ) {
                return false;
            }
            if handle_browser_capture_navigation(target_url.as_str()) {
                return false;
            }
            let validation = validate_browser_url_for_workspace(
                target_url.as_str(),
                Some(workspace_id_for_navigation.as_str()),
            );
            if validation.allowed {
                update_browser_embedded_webview_navigation_target(
                    active_session_id.as_str(),
                    target_url.as_str(),
                );
                return true;
            }
            spawn_browser_webview_session_patch(
                app_for_navigation.clone(),
                active_session_id,
                Some(BrowserSessionStatus::Blocked),
                Some(target_url.to_string()),
                None,
                validation.blocked_reason,
                validation.diagnostic.map(|diagnostic| diagnostic.message),
            );
            false
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(move |_, payload| {
            let Some(active_session_id) = browser_embedded_webview_page_load_session_id(
                payload.url().as_str(),
                payload.event(),
            ) else {
                return;
            };
            let status = match payload.event() {
                tauri::webview::PageLoadEvent::Started => BrowserSessionStatus::Loading,
                tauri::webview::PageLoadEvent::Finished => BrowserSessionStatus::Ready,
            };
            spawn_browser_webview_session_patch(
                app_for_load.clone(),
                active_session_id,
                Some(status),
                Some(payload.url().to_string()),
                None,
                None,
                None,
            );
        })
        .on_document_title_changed(move |webview, title| {
            let Ok(current_url) = webview.url() else {
                return;
            };
            let Some(active_session_id) =
                browser_embedded_webview_title_session_id(current_url.as_str())
            else {
                return;
            };
            spawn_browser_webview_session_patch(
                app_for_title.clone(),
                active_session_id,
                None,
                None,
                Some(title),
                None,
                None,
            );
        });

    let parent_window = window.as_ref().window();
    let webview = parent_window
        .add_child(
            webview_builder,
            tauri::LogicalPosition::new(bounds.x, bounds.y),
            tauri::LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| error.to_string())?;
    let _ = webview.set_auto_resize(false);
    webview
        .set_bounds(browser_webview_rect(bounds))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn create_browser_agent_window(
    app: &AppHandle,
    session: &BrowserSession,
    locale: Option<String>,
) -> Result<(), String> {
    let renderer_url: tauri::Url = session
        .normalized_url
        .parse()
        .map_err(|error| format!("Invalid Browser Agent URL: {error}"))?;
    bind_browser_renderer_session(session.browser_session_id.as_str());

    if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
        window
            .close()
            .map_err(|error| format!("Failed to reset Browser Agent window: {error}"))?;
    }
    if current_browser_embedded_webview_session_id().as_deref()
        == Some(session.browser_session_id.as_str())
    {
        if let Some(webview) = app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL) {
            let _ = webview.close();
        }
        clear_browser_embedded_webview_session(session.browser_session_id.as_str());
    }

    let session_id_for_navigation = session.browser_session_id.clone();
    let workspace_id_for_navigation = session.workspace_id.clone();
    let session_id_for_load = session.browser_session_id.clone();
    let session_id_for_title = session.browser_session_id.clone();
    let app_for_navigation = app.clone();
    let app_for_load = app.clone();
    let app_for_title = app.clone();
    let locale_for_load = locale.clone();
    let locale_for_title = locale.clone();

    let renderer_window = WebviewWindowBuilder::new(
        app,
        BROWSER_RENDERER_WINDOW_LABEL,
        WebviewUrl::External(renderer_url),
    )
    .title("Browser Dock")
    .inner_size(1280.0, 900.0)
    .min_inner_size(760.0, 520.0)
    .resizable(true)
    .center()
    .on_navigation(move |target_url| {
        if handle_browser_toolbar_navigation(
            &app_for_navigation,
            target_url.as_str(),
            session_id_for_navigation.as_str(),
            workspace_id_for_navigation.as_str(),
        ) {
            return false;
        }
        if handle_browser_capture_navigation(target_url.as_str()) {
            return false;
        }
        let validation = validate_browser_url_for_workspace(
            target_url.as_str(),
            Some(workspace_id_for_navigation.as_str()),
        );
        if validation.allowed {
            return true;
        }
        spawn_browser_webview_session_patch(
            app_for_navigation.clone(),
            current_browser_renderer_session(session_id_for_navigation.as_str()),
            Some(BrowserSessionStatus::Blocked),
            Some(target_url.to_string()),
            None,
            validation.blocked_reason,
            validation.diagnostic.map(|diagnostic| diagnostic.message),
        );
        false
    })
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_page_load(move |window, payload| {
        let status = match payload.event() {
            tauri::webview::PageLoadEvent::Started => BrowserSessionStatus::Loading,
            tauri::webview::PageLoadEvent::Finished => BrowserSessionStatus::Ready,
        };
        let active_session_id = current_browser_renderer_session(session_id_for_load.as_str());
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            spawn_browser_toolbar_injection(
                app_for_load.clone(),
                window.clone(),
                active_session_id.clone(),
                Some(payload.url().to_string()),
                None,
                locale_for_load.clone(),
            );
        }
        spawn_browser_webview_session_patch(
            app_for_load.clone(),
            active_session_id,
            Some(status),
            Some(payload.url().to_string()),
            None,
            None,
            None,
        );
    })
    .on_document_title_changed(move |window, title| {
        let window_title = if title.trim().is_empty() {
            "Browser Dock".to_string()
        } else {
            title.clone()
        };
        let _ = window.set_title(window_title.as_str());
        let active_session_id = current_browser_renderer_session(session_id_for_title.as_str());
        spawn_browser_toolbar_injection(
            app_for_title.clone(),
            window.clone(),
            active_session_id.clone(),
            None,
            Some(title.clone()),
            locale_for_title.clone(),
        );
        spawn_browser_webview_session_patch(
            app_for_title.clone(),
            active_session_id,
            None,
            None,
            Some(title),
            None,
            None,
        );
    })
    .build()
    .map_err(|error| format!("Failed to open Browser Agent window: {error}"))?;
    spawn_browser_toolbar_injection(
        app.clone(),
        renderer_window.clone(),
        session.browser_session_id.clone(),
        Some(session.normalized_url.clone()),
        session.title.clone(),
        locale,
    );
    if let Some(dock_window) = app.get_webview_window(BROWSER_DOCK_WINDOW_LABEL) {
        let _ = dock_window.close();
    }
    let _ = renderer_window.set_focus();
    Ok(())
}

fn is_local_html_file_url(url: &str) -> bool {
    let without_fragment = url.split(['?', '#']).next().unwrap_or(url);
    let lower = without_fragment.to_ascii_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
}

fn validate_browser_url_for_workspace(
    raw_url: &str,
    workspace_id: Option<&str>,
) -> BrowserUrlValidationResult {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return blocked_url(raw_url, "empty_url", "Browser Agent URL cannot be empty.");
    }

    let lower = trimmed.to_ascii_lowercase();
    let scheme = match lower.split_once("://") {
        Some((scheme, _)) => scheme,
        None => {
            return blocked_url(
                raw_url,
                "missing_scheme",
                "Browser Agent URL must include an http://, https://, or file:// scheme.",
            );
        }
    };

    // Local HTML preview: allow file:// only for .html / .htm (relative assets keep working).
    if scheme == "file" {
        if !is_local_html_file_url(trimmed) {
            return blocked_url(
                raw_url,
                "blocked_file_type",
                "Browser Agent only opens local .html / .htm files via file://.",
            );
        }
        return BrowserUrlValidationResult {
            raw_url: raw_url.to_string(),
            normalized_url: Some(trimmed.to_string()),
            allowed: true,
            blocked_reason: None,
            diagnostic: None,
            workspace_local_allowed: true,
        };
    }

    if scheme != "http" && scheme != "https" {
        return blocked_url(
            raw_url,
            "blocked_scheme",
            "Browser Agent only allows http://, https://, and local file:// HTML pages.",
        );
    }

    let Some(host) = host_from_normalized_url(trimmed) else {
        return blocked_url(
            raw_url,
            "missing_host",
            "Browser Agent URL must include a host.",
        );
    };
    let workspace_local_allowed = workspace_id
        .map(|id| !id.trim().is_empty())
        .unwrap_or(false)
        && is_workspace_local_development_host(host.as_str());
    if is_blocked_local_host(&host) && !workspace_local_allowed {
        return blocked_url(
            raw_url,
            "blocked_local_host",
            "Browser Agent MVP blocks localhost and private network targets.",
        );
    }

    BrowserUrlValidationResult {
        raw_url: raw_url.to_string(),
        normalized_url: Some(trimmed.to_string()),
        allowed: true,
        blocked_reason: None,
        diagnostic: None,
        workspace_local_allowed,
    }
}

#[tauri::command]
pub(crate) async fn get_browser_agent_settings(
    state: State<'_, AppState>,
) -> Result<BrowserAgentSettings, String> {
    Ok(current_settings(&state).await)
}

#[tauri::command]
pub(crate) async fn get_browser_agent_platform_capability(
) -> Result<BrowserPlatformCapability, String> {
    Ok(platform::current_platform_capability())
}

#[tauri::command]
pub(crate) async fn validate_browser_agent_url(
    url: String,
    workspace_id: Option<String>,
) -> Result<BrowserUrlValidationResult, String> {
    Ok(validate_browser_url_for_workspace(
        url.as_str(),
        workspace_id.as_deref(),
    ))
}

#[tauri::command]
pub(crate) async fn create_browser_agent_session(
    request: CreateBrowserSessionRequest,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let settings = current_settings(&state).await;
    if !settings.enabled {
        return Err("Browser Agent is disabled in settings.".to_string());
    }

    let validation = validate_browser_url_for_workspace(
        request.url.as_str(),
        Some(request.workspace_id.as_str()),
    );
    let Some(normalized_url) = validation.normalized_url else {
        return Err(validation
            .diagnostic
            .map(|diagnostic| diagnostic.message)
            .unwrap_or_else(|| "Browser Agent URL is blocked.".to_string()));
    };

    let now = unix_time_ms();
    let browser_session_id = format!("browser-session-{}", uuid::Uuid::new_v4());
    let owner_surface = request.owner_surface.trim();
    let label = if owner_surface.is_empty() {
        "Browser Agent".to_string()
    } else {
        format!("Browser Agent · {owner_surface}")
    };
    let session = BrowserSession {
        browser_session_id: browser_session_id.clone(),
        workspace_id: request.workspace_id,
        label,
        url: normalized_url.clone(),
        normalized_url: normalized_url.clone(),
        origin: origin_from_normalized_url(normalized_url.as_str()),
        title: None,
        favicon_ref: None,
        status: BrowserSessionStatus::Loading,
        feature_phase: BrowserAgentFeaturePhase::ReadOnlySnapshot,
        platform_capability: platform::current_platform_capability(),
        linked_thread_id: None,
        linked_task_run_id: None,
        linked_orchestration_task_id: None,
        last_snapshot_id: None,
        last_action_id: None,
        error_code: None,
        diagnostic_message: None,
        created_at: now,
        updated_at: now,
        last_activated_at: now,
        closed_at: None,
    };

    state
        .browser_sessions
        .lock()
        .await
        .insert(browser_session_id, session.clone());
    Ok(session)
}

#[tauri::command]
pub(crate) async fn list_browser_agent_sessions(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BrowserSession>, String> {
    let sessions = state.browser_sessions.lock().await;
    let mut list = sessions
        .values()
        .filter(|session| {
            workspace_id
                .as_deref()
                .map(|id| session.workspace_id == id)
                .unwrap_or(true)
        })
        .cloned()
        .collect::<Vec<_>>();
    list.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(list)
}

#[tauri::command]
pub(crate) async fn update_browser_agent_session(
    request: UpdateBrowserSessionRequest,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let now = unix_time_ms();
    let mut sessions = state.browser_sessions.lock().await;
    let session = sessions
        .get_mut(request.browser_session_id.as_str())
        .ok_or_else(|| format!("Browser session not found: {}", request.browser_session_id))?;

    if let Some(next_url) = request.url {
        let validation =
            validate_browser_url_for_workspace(next_url.as_str(), request.workspace_id.as_deref());
        let Some(normalized_url) = validation.normalized_url else {
            return Err(validation
                .diagnostic
                .map(|diagnostic| diagnostic.message)
                .unwrap_or_else(|| "Browser Agent URL is blocked.".to_string()));
        };
        session.url = normalized_url.clone();
        session.normalized_url = normalized_url.clone();
        session.origin = origin_from_normalized_url(normalized_url.as_str());
    }
    if let Some(status) = request.status {
        session.status = status;
    }
    if request.title.is_some() {
        session.title = request.title;
    }
    if request.last_snapshot_id.is_some() {
        session.last_snapshot_id = request.last_snapshot_id;
    }
    if request.last_action_id.is_some() {
        session.last_action_id = request.last_action_id;
    }
    if request.error_code.is_some() {
        session.error_code = request.error_code;
    }
    if request.diagnostic_message.is_some() {
        session.diagnostic_message = request.diagnostic_message;
    }
    session.updated_at = now;
    session.last_activated_at = now;
    Ok(session.clone())
}

#[tauri::command]
pub(crate) async fn close_browser_agent_session(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let now = unix_time_ms();
    let mut sessions = state.browser_sessions.lock().await;
    let session = sessions
        .get_mut(browser_session_id.as_str())
        .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?;
    session.status = BrowserSessionStatus::Closed;
    session.updated_at = now;
    session.closed_at = Some(now);
    let should_close_floating_window = browser_renderer_session_binding()
        .lock()
        .map(|binding| binding.as_deref() == Some(browser_session_id.as_str()))
        .unwrap_or(false);
    let should_close_embedded_renderer = current_browser_embedded_webview_session_id().as_deref()
        == Some(browser_session_id.as_str());
    clear_browser_renderer_session(browser_session_id.as_str());
    clear_browser_embedded_webview_session(browser_session_id.as_str());
    if should_close_floating_window {
        if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
            let _ = window.close();
        }
    }
    if should_close_embedded_renderer {
        if let Some(webview) = app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL) {
            let _ = webview.close();
        }
    }
    Ok(session.clone())
}

#[tauri::command]
pub(crate) async fn cleanup_browser_agent_sessions(
    max_closed_age_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<BrowserSessionCleanupResult, String> {
    let now = unix_time_ms();
    let max_closed_age_ms = max_closed_age_ms.unwrap_or(30 * 60 * 1000);
    let mut sessions = state.browser_sessions.lock().await;
    let removed_session_ids = sessions
        .values()
        .filter(|session| is_cleanup_candidate(session, now, max_closed_age_ms))
        .map(|session| session.browser_session_id.clone())
        .collect::<Vec<_>>();

    for session_id in &removed_session_ids {
        sessions.remove(session_id);
    }

    Ok(BrowserSessionCleanupResult {
        removed_session_ids,
        retained_session_count: sessions.len(),
    })
}

#[tauri::command]
pub(crate) async fn list_browser_agent_evidence(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BrowserEvidenceRecord>, String> {
    let now = unix_time_ms();
    let evidence = state.browser_evidence.lock().await;
    let mut records = evidence
        .values()
        .filter(|record| {
            workspace_id
                .as_deref()
                .map(|id| record.workspace_id == id)
                .unwrap_or(true)
        })
        .cloned()
        .map(|mut record| {
            if record.expires_at <= now && record.state == "available" {
                record.state = "expired".to_string();
            }
            record
        })
        .collect::<Vec<_>>();
    records.sort_by(|left, right| right.captured_at.cmp(&left.captured_at));
    Ok(records)
}

#[tauri::command]
pub(crate) async fn cleanup_browser_agent_evidence(
    now: Option<u64>,
    state: State<'_, AppState>,
) -> Result<BrowserEvidenceCleanupResult, String> {
    let now = now.unwrap_or_else(unix_time_ms);
    let mut evidence = state.browser_evidence.lock().await;
    let removed_evidence_ids = evidence
        .values()
        .filter(|record| record.expires_at <= now)
        .map(|record| record.evidence_id.clone())
        .collect::<Vec<_>>();
    for evidence_id in &removed_evidence_ids {
        evidence.remove(evidence_id);
    }
    Ok(BrowserEvidenceCleanupResult {
        removed_evidence_ids,
        retained_evidence_count: evidence.len(),
    })
}

#[tauri::command]
pub(crate) async fn mount_browser_agent_webview(
    request: BrowserWebviewMountRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let settings = current_settings(&state).await;
    if !settings.enabled {
        return Err("Browser Agent is disabled in settings.".to_string());
    }

    let capability = platform::current_platform_capability();
    if capability.browser_dock == BrowserCapabilityState::Unsupported {
        return Err(capability
            .unsupported_reasons
            .first()
            .cloned()
            .unwrap_or_else(|| {
                "Browser Agent WebView is unsupported on this platform.".to_string()
            }));
    }

    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(request.browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {}", request.browser_session_id))?
    };
    if session.status == BrowserSessionStatus::Closed {
        return Err(format!(
            "Browser session is closed: {}",
            session.browser_session_id
        ));
    }

    // PageLoad / title callback 可能紧随 navigate 触发，必须先把唯一 renderer 绑定到
    // 目标 tab；否则回调会把新页面标题和 URL 写回前一个 tab。
    let previous_embedded_binding = current_browser_embedded_webview_binding();
    begin_browser_embedded_webview_navigation(
        session.browser_session_id.as_str(),
        session.normalized_url.as_str(),
    );
    if let Err(error) = create_browser_child_webview(&app, &session, &request.bounds) {
        restore_browser_embedded_webview_binding(previous_embedded_binding);
        return Err(error);
    }
    spawn_browser_webview_session_patch(
        app,
        session.browser_session_id.clone(),
        Some(BrowserSessionStatus::Loading),
        Some(session.normalized_url.clone()),
        None,
        None,
        None,
    );

    let sessions = state.browser_sessions.lock().await;
    sessions
        .get(session.browser_session_id.as_str())
        .cloned()
        .ok_or_else(|| format!("Browser session not found: {}", session.browser_session_id))
}

#[tauri::command]
pub(crate) async fn open_browser_agent_window(
    browser_session_id: String,
    locale: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserSession, String> {
    let settings = current_settings(&state).await;
    if !settings.enabled {
        return Err("Browser Agent is disabled in settings.".to_string());
    }

    let capability = platform::current_platform_capability();
    if capability.browser_dock == BrowserCapabilityState::Unsupported {
        return Err(capability
            .unsupported_reasons
            .first()
            .cloned()
            .unwrap_or_else(|| {
                "Browser Agent window is unsupported on this platform.".to_string()
            }));
    }

    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?
    };
    if session.status == BrowserSessionStatus::Closed {
        return Err(format!(
            "Browser session is closed: {}",
            session.browser_session_id
        ));
    }

    create_browser_agent_window(&app, &session, locale)?;
    spawn_browser_webview_session_patch(
        app,
        session.browser_session_id.clone(),
        Some(BrowserSessionStatus::Loading),
        Some(session.normalized_url.clone()),
        None,
        None,
        None,
    );

    let sessions = state.browser_sessions.lock().await;
    sessions
        .get(session.browser_session_id.as_str())
        .cloned()
        .ok_or_else(|| format!("Browser session not found: {}", session.browser_session_id))
}

#[tauri::command]
pub(crate) async fn sync_browser_agent_webview_bounds(
    browser_session_id: String,
    bounds: BrowserWebviewBounds,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .filter(|session| session.status != BrowserSessionStatus::Closed)
            .cloned()
    };
    let Some(session) = session else {
        return Ok(());
    };

    if let Some(binding) = current_browser_embedded_webview_binding() {
        if binding.browser_session_id != browser_session_id {
            // 旧 effect cleanup / ResizeObserver 可能晚到；它们不得改写当前 tab 的 renderer。
            return Ok(());
        }
    }

    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent WebView not found: {browser_session_id}"))?;
    if !valid_webview_bounds(&bounds) {
        // binding 为空代表 renderer 已被临时隐藏，无需重复 hide。
        if current_browser_embedded_webview_session_id().as_deref()
            == Some(browser_session_id.as_str())
        {
            webview.hide().map_err(|error| error.to_string())?;
            clear_browser_embedded_webview_session(browser_session_id.as_str());
        }
        return Ok(());
    }

    // dock 恢复可见时只同步 bounds；不 navigate，页面状态不丢失。
    webview
        .set_bounds(browser_webview_rect(&bounds))
        .map_err(|error| error.to_string())?;
    if current_browser_embedded_webview_binding().is_none() {
        restore_browser_embedded_webview_session(
            session.browser_session_id.as_str(),
            session.normalized_url.as_str(),
        );
    }
    webview.show().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn hide_browser_agent_webview(
    browser_session_id: String,
    app: AppHandle,
) -> Result<(), String> {
    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id.as_str())
    {
        return Ok(());
    }
    if let Some(webview) = app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL) {
        webview.hide().map_err(|error| error.to_string())?;
    }
    clear_browser_embedded_webview_session(browser_session_id.as_str());
    Ok(())
}

/// 菜单注入当前 child WebView，和网页处于同一渲染层，不需要 hide 页面。
#[tauri::command]
pub(crate) async fn show_browser_agent_tab_context_menu_overlay(
    request: BrowserTabContextMenuRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !request.x.is_finite() {
        return Err("Invalid Browser Agent tab menu position.".to_string());
    }

    let target_is_live = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(request.browser_session_id.as_str())
            .map(|session| session.status != BrowserSessionStatus::Closed)
            .unwrap_or(false)
    };
    if !target_is_live {
        return Err(format!(
            "Browser session is not available: {}",
            request.browser_session_id
        ));
    }

    let renderer_browser_session_id = current_browser_embedded_webview_session_id()
        .ok_or_else(|| "Browser Agent WebView is not embedded.".to_string())?;
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| "Browser Agent WebView is not available.".to_string())?;
    let invocation = BrowserTabContextMenuInvocation::new(
        request.browser_session_id.as_str(),
        renderer_browser_session_id.as_str(),
        unix_time_ms(),
    );
    let script = browser_tab_context_menu_overlay_script(
        request.browser_session_id.as_str(),
        invocation.nonce.as_str(),
        request.x,
        request.locale.as_deref(),
        request.disabled_actions.as_slice(),
        &request.theme,
    )?;
    register_browser_tab_context_menu_invocation(invocation.clone());
    if let Err(error) = webview.eval(script) {
        clear_browser_tab_context_menu_invocation(invocation.nonce.as_str());
        return Err(error.to_string());
    }
    Ok(())
}

/// 在内嵌子 webview 中启动元素选择器（浮动窗由注入工具条自行 eval，内嵌无注入工具条）。
/// 选中结果经 bridge URL 由子 webview 的 on_navigation 拦截后回传主窗口。
#[tauri::command]
pub(crate) async fn start_browser_agent_element_select(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?
    };
    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id.as_str())
    {
        return Err(format!(
            "Browser Agent WebView is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent WebView is not embedded: {browser_session_id}"))?;
    let script = browser_element_selector_script(
        session.browser_session_id.as_str(),
        session.workspace_id.as_str(),
        None,
    );
    webview.eval(&script).map_err(|error| error.to_string())
}

/// 退出内嵌元素选择器：只跑页面内 cleanup，不再重新注入选择脚本。
#[tauri::command]
pub(crate) async fn stop_browser_agent_element_select(
    browser_session_id: String,
    app: AppHandle,
) -> Result<(), String> {
    if current_browser_embedded_webview_session_id().as_deref() != Some(browser_session_id.as_str())
    {
        return Err(format!(
            "Browser Agent WebView is not active for session: {browser_session_id}"
        ));
    }
    let webview = app
        .get_webview(BROWSER_RENDERER_WEBVIEW_LABEL)
        .ok_or_else(|| format!("Browser Agent WebView is not embedded: {browser_session_id}"))?;
    webview
        .eval(&browser_element_selector_stop_script())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn capture_browser_agent_snapshot(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserContextSnapshot, String> {
    let now = unix_time_ms();
    let settings = current_settings(&state).await;
    let session = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(browser_session_id.as_str())
            .cloned()
            .ok_or_else(|| format!("Browser session not found: {browser_session_id}"))?
    };
    if session.status == BrowserSessionStatus::Closed {
        return Err(format!("Browser session is closed: {browser_session_id}"));
    }
    let floating_renderer_matches = current_browser_renderer_session_id()
        .as_deref()
        .map(|bound_session_id| bound_session_id == browser_session_id)
        .unwrap_or(false)
        && app
            .get_webview_window(BROWSER_RENDERER_WINDOW_LABEL)
            .is_some();
    let embedded_renderer_matches = current_browser_embedded_webview_session_id()
        .as_deref()
        .map(|bound_session_id| bound_session_id == browser_session_id)
        .unwrap_or(false)
        && app.get_webview(BROWSER_RENDERER_WEBVIEW_LABEL).is_some();
    let renderer_matches = floating_renderer_matches || embedded_renderer_matches;

    let mut capture_warnings = Vec::new();
    if !renderer_matches {
        capture_warnings.push(browser_diagnostic(
            "browser-renderer-mismatch",
            "capture_warning",
            "warning",
            "Requested browser session is not bound to the active Browser Dock renderer; returning degraded metadata snapshot.",
        ));
    }
    let raw_capture = if renderer_matches && session.status == BrowserSessionStatus::Ready {
        match capture_browser_webview_dom(&app, browser_session_id.as_str()).await {
            Ok(raw) => Some(raw),
            Err(error) => {
                capture_warnings.push(browser_diagnostic(
                    "browser-capture-degraded",
                    "capture_warning",
                    "warning",
                    format!(
                        "Read-only WebView DOM transport failed; snapshot contains bounded session facts. {error}"
                    )
                    .as_str(),
                ));
                None
            }
        }
    } else {
        None
    };
    if raw_capture.is_none() && renderer_matches {
        capture_warnings.push(browser_diagnostic(
            "browser-capture-metadata-fallback",
            "capture_warning",
            "warning",
            "Browser Agent returned a metadata-only fallback snapshot.",
        ));
    }
    let has_live_capture = raw_capture.is_some();
    let code_candidates = browser_code_candidates_for_session(&session);
    let freshness = if has_live_capture {
        BrowserSnapshotFreshness::Fresh
    } else if renderer_matches && session.status == BrowserSessionStatus::Ready {
        BrowserSnapshotFreshness::Degraded
    } else {
        BrowserSnapshotFreshness::Stale
    };
    let mut budget = browser_snapshot_budget(&settings);
    let mut privacy = BrowserPrivacyReport {
        redaction_applied: false,
        redacted_kinds: Vec::new(),
        omitted_kinds: vec![
            "raw_dom".to_string(),
            "cookies".to_string(),
            "headers".to_string(),
            "scripts".to_string(),
            "styles".to_string(),
            "hidden_nodes".to_string(),
        ],
    };
    let mut omitted_capabilities = Vec::new();
    let (source_url, source_title, viewport, page) = if let Some(raw) = raw_capture {
        let raw_url = raw
            .url
            .clone()
            .unwrap_or_else(|| session.normalized_url.clone());
        let raw_title = raw.title.clone().or_else(|| session.title.clone());
        let viewport = raw
            .viewport
            .clone()
            .unwrap_or_else(default_browser_viewport);
        omitted_capabilities = raw.omitted_capabilities.clone();
        let page = page_from_raw_capture(raw, &mut budget, &mut privacy);
        (raw_url, raw_title, viewport, page)
    } else {
        let visible_text = session
            .title
            .as_ref()
            .map(|title| format!("{title}\n{}", session.normalized_url))
            .unwrap_or_else(|| session.normalized_url.clone());
        (
            session.normalized_url.clone(),
            session.title.clone(),
            default_browser_viewport(),
            BrowserContextSnapshotPage {
                visible_text,
                page_type: BrowserPageType::Unknown,
                primary_content: None,
                readable_blocks: Vec::new(),
                noise_diagnostics: Vec::new(),
                visual_evidence: Vec::new(),
                text_truncated: false,
                headings: Vec::new(),
                landmarks: Vec::new(),
                element_landmarks: Vec::new(),
                content_regions: Vec::new(),
                links: Vec::new(),
                buttons: Vec::new(),
                forms: Vec::new(),
                selected_text: None,
                language_hint: None,
            },
        )
    };
    let mut snapshot = BrowserContextSnapshot {
        snapshot_id: format!("browser-snapshot-{now}"),
        browser_session_id: session.browser_session_id.clone(),
        workspace_id: session.workspace_id.clone(),
        captured_at: now,
        freshness,
        source: BrowserSnapshotSource {
            url: source_url.clone(),
            normalized_url: source_url.clone(),
            origin: origin_from_normalized_url(source_url.as_str())
                .or_else(|| session.origin.clone()),
            title: source_title,
            tab_label: session.label.clone(),
            capture_reason: "manual_attach".to_string(),
            workspace_local_allowed: is_workspace_local_snapshot(&session),
        },
        viewport,
        page,
        code_candidates,
        diagnostics: BrowserContextSnapshotDiagnostics {
            console: Vec::new(),
            network: None,
            capture_warnings,
        },
        evidence: BrowserContextSnapshotEvidence {
            screenshot_ref: None,
            html_excerpt_ref: None,
        },
        omitted_capabilities,
        privacy,
        budget,
        availability: if has_live_capture {
            "available"
        } else {
            "partial"
        }
        .to_string(),
    };
    snapshot.evidence = persist_snapshot_evidence(&state, &snapshot).await;
    {
        let mut sessions = state.browser_sessions.lock().await;
        if let Some(session) = sessions.get_mut(browser_session_id.as_str()) {
            session.last_snapshot_id = Some(snapshot.snapshot_id.clone());
            session.updated_at = now;
        }
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn capture_browser_agent_snapshot_v2(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserContextSnapshot, String> {
    capture_browser_agent_snapshot(browser_session_id, app, state).await
}

#[tauri::command]
pub(crate) async fn refresh_browser_agent_snapshot(
    browser_session_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserContextSnapshot, String> {
    capture_browser_agent_snapshot(browser_session_id, app, state).await
}

#[tauri::command]
pub(crate) async fn generate_browser_agent_code_candidates(
    snapshot: BrowserContextSnapshot,
) -> Result<Vec<BrowserCodeCandidate>, String> {
    Ok(snapshot.code_candidates)
}

#[tauri::command]
pub(crate) async fn route_browser_agent_provider(
    requested_capability: String,
    user_override: bool,
    state: State<'_, AppState>,
) -> Result<BrowserProviderRouteDecision, String> {
    let settings = current_settings(&state).await;
    Ok(default_route_decision(
        requested_capability.as_str(),
        &settings,
        user_override,
        &platform::current_platform_capability(),
    ))
}

#[tauri::command]
pub(crate) async fn get_browser_agent_status(
    state: State<'_, AppState>,
) -> Result<BrowserAgentStatus, String> {
    let settings = current_settings(&state).await;
    Ok(BrowserAgentStatus {
        feature_phase: if settings.enabled {
            BrowserAgentFeaturePhase::ReadOnlySnapshot
        } else {
            BrowserAgentFeaturePhase::Disabled
        },
        platform_capability: platform::current_platform_capability(),
        provider_preference: default_route_decision(
            "read_snapshot",
            &settings,
            false,
            &platform::current_platform_capability(),
        ),
        settings,
    })
}

#[tauri::command]
pub(crate) async fn run_browser_agent_action(
    request: BrowserActionRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BrowserActionResult, String> {
    let now = unix_time_ms();
    let settings = current_settings(&state).await;
    let action = request.action.clone();
    let is_safe_navigation = matches!(action.as_str(), "navigate" | "reload" | "scroll");
    let is_element_action = matches!(action.as_str(), "click" | "type" | "select" | "submit");
    let feature_allowed = if is_safe_navigation {
        settings.allow_navigation_actions
    } else if action == "submit" {
        settings.allow_form_submit_actions
    } else if is_element_action {
        settings.allow_element_actions
    } else {
        false
    };
    let action_id = format!("browser-action-{now}");
    let before_snapshot_id = {
        let sessions = state.browser_sessions.lock().await;
        sessions
            .get(request.browser_session_id.as_str())
            .and_then(|session| session.last_snapshot_id.clone())
    };
    let mut blocked_reasons = Vec::new();
    if !request.confirmed {
        blocked_reasons.push("not_confirmed".to_string());
    }
    if !feature_allowed {
        blocked_reasons.push("settings_disabled".to_string());
    }
    if is_element_action {
        blocked_reasons.push("mutating_action_blocked_by_default".to_string());
    }
    let gate = BrowserActionGateResolution {
        allowed: settings.enabled && request.confirmed && is_safe_navigation && feature_allowed,
        blocked_reasons: if blocked_reasons.is_empty() {
            vec!["requires_user_confirmation".to_string()]
        } else {
            blocked_reasons.clone()
        },
    };
    let preview = BrowserActionPreview {
        action_id: action_id.clone(),
        browser_session_id: request.browser_session_id.clone(),
        action: action.clone(),
        target_id: request.target_id.clone(),
        target_description: request.target_id.clone(),
        value_preview: request.value.as_ref().map(|value| {
            if action == "type" || action == "submit" {
                "[redacted-preview]".to_string()
            } else {
                value.chars().take(80).collect::<String>()
            }
        }),
        reason: request.reason.clone(),
        risk_level: if is_safe_navigation { "low" } else if is_element_action { "medium" } else { "high" }.to_string(),
        requires_user_confirmation: true,
        blocked_by_default: !is_safe_navigation,
        before_snapshot_id: before_snapshot_id.clone(),
        after_snapshot_id: None,
        expected_effect: match action.as_str() {
            "navigate" => "Load the requested page in the active Browser Dock session.",
            "reload" => "Reload the active Browser Dock page.",
            "scroll" => "Scroll the active Browser Dock page.",
            _ => "Preview only; mutating actions remain blocked by default.",
        }.to_string(),
        privacy_notice: "Browser actions require explicit confirmation; secret-like values are redacted in previews.".to_string(),
        gate: gate.clone(),
    };
    let mut outcome = "blocked".to_string();
    let mut diagnostic_message = if !settings.enabled {
        Some("Browser Agent is disabled in settings.".to_string())
    } else if !request.confirmed {
        Some("Browser action was not confirmed; no operation was executed.".to_string())
    } else if !is_safe_navigation {
        Some("Browser Agent mutating actions remain blocked by default.".to_string())
    } else if !feature_allowed {
        Some("Browser Agent safe navigation actions are disabled in settings.".to_string())
    } else {
        None
    };
    let mut after_snapshot_id = None;

    if gate.allowed {
        let execution_result = match action.as_str() {
            "navigate" => {
                let target_url = request
                    .value
                    .as_deref()
                    .or(request.target_id.as_deref())
                    .ok_or_else(|| "navigate action requires a target URL.".to_string())
                    .and_then(|target| {
                        let validation = validate_browser_url_for_workspace(target, None);
                        validation.normalized_url.ok_or_else(|| {
                            validation
                                .diagnostic
                                .map(|diagnostic| diagnostic.message)
                                .unwrap_or_else(|| "Browser Agent URL is blocked.".to_string())
                        })
                    });
                match target_url {
                    Ok(url) => {
                        let parsed_url = url
                            .parse()
                            .map_err(|error| format!("Invalid Browser Agent URL: {error}"));
                        match parsed_url {
                            Ok(parsed_url) => navigate_browser_renderer(
                                &app,
                                request.browser_session_id.as_str(),
                                parsed_url,
                            ),
                            Err(error) => Err(error),
                        }
                    }
                    Err(error) => Err(error),
                }
            }
            "reload" => eval_browser_renderer_script(
                &app,
                request.browser_session_id.as_str(),
                "window.location.reload()",
            ),
            "scroll" => {
                let scroll_value = request.value.as_deref().unwrap_or("window.innerHeight");
                let script = format!(
                    "window.scrollBy(0, Number({}) || window.innerHeight)",
                    escape_js_string(scroll_value)
                );
                eval_browser_renderer_script(&app, request.browser_session_id.as_str(), script)
            }
            _ => Err("Unsupported Browser Agent action.".to_string()),
        };
        match execution_result {
            Ok(()) => {
                outcome = "completed".to_string();
                after_snapshot_id = Some(format!("browser-snapshot-after-{now}"));
                diagnostic_message = None;
            }
            Err(error) => {
                outcome = "failed".to_string();
                diagnostic_message = Some(error);
            }
        }
    }

    let audit_entry = BrowserActionAuditEntry {
        action_id,
        browser_session_id: request.browser_session_id,
        requested_at: now,
        completed_at: Some(now),
        action,
        target_description: request.target_id,
        outcome: outcome.clone(),
        diagnostic_message,
        before_snapshot_id: before_snapshot_id.clone(),
        after_snapshot_id: after_snapshot_id.clone(),
        comparison: Some(BrowserActionSnapshotComparison {
            before_snapshot_id,
            after_snapshot_id,
            state: (if outcome == "completed" {
                "available"
            } else {
                "failed"
            })
            .to_string(),
            diagnostics: if outcome == "completed" {
                Vec::new()
            } else {
                gate.blocked_reasons.clone()
            },
        }),
    };

    Ok(BrowserActionResult {
        outcome,
        audit_entry,
        preview: Some(preview),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_settings_do_not_select_builtin_provider() {
        let settings = BrowserAgentSettings {
            enabled: false,
            ..BrowserAgentSettings::default()
        };
        let decision = default_route_decision(
            "read_snapshot",
            &settings,
            false,
            &platform::current_platform_capability(),
        );
        assert_eq!(decision.selected_provider, "browser_skill");
        assert!(decision.fallback_used);
        assert_eq!(
            decision.fallback_reason.as_deref(),
            Some("browser_agent_disabled")
        );
    }

    #[test]
    fn enabled_settings_select_builtin_provider() {
        let settings = BrowserAgentSettings {
            enabled: true,
            ..BrowserAgentSettings::default()
        };
        let decision = default_route_decision(
            "read_snapshot",
            &settings,
            false,
            &platform::current_platform_capability(),
        );
        assert_eq!(decision.selected_provider, "built_in_browser_agent");
        assert!(!decision.fallback_used);
    }

    #[test]
    fn embedded_renderer_uses_a_stable_singleton_label() {
        assert_eq!(BROWSER_RENDERER_WEBVIEW_LABEL, "browser-agent-webview-main",);
    }

    #[test]
    fn embedded_renderer_binding_does_not_replace_floating_renderer_binding() {
        const FLOATING_SESSION_ID: &str = "test-floating-session";
        const EMBEDDED_SESSION_ID: &str = "test-embedded-session";

        clear_browser_renderer_session(FLOATING_SESSION_ID);
        clear_browser_embedded_webview_session(EMBEDDED_SESSION_ID);
        bind_browser_renderer_session(FLOATING_SESSION_ID);
        begin_browser_embedded_webview_navigation(EMBEDDED_SESSION_ID, "https://embedded.example/");

        assert_eq!(
            current_browser_renderer_session_id().as_deref(),
            Some(FLOATING_SESSION_ID),
        );
        assert_eq!(
            current_browser_embedded_webview_session_id().as_deref(),
            Some(EMBEDDED_SESSION_ID),
        );

        clear_browser_embedded_webview_session(EMBEDDED_SESSION_ID);
        assert_eq!(
            current_browser_renderer_session_id().as_deref(),
            Some(FLOATING_SESSION_ID),
        );
        clear_browser_renderer_session(FLOATING_SESSION_ID);
    }

    #[test]
    fn embedded_renderer_binding_rejects_late_page_and_title_callbacks() {
        let mut binding =
            EmbeddedBrowserWebviewBinding::navigating_to("session-b", "https://b.example/page");

        assert_eq!(
            binding.accepts_page_load(
                "https://a.example/page",
                tauri::webview::PageLoadEvent::Started,
            ),
            None,
        );
        assert_eq!(binding.accepts_title("https://a.example/page"), None);
        assert_eq!(
            binding.accepts_page_load(
                "https://b.example/page",
                tauri::webview::PageLoadEvent::Finished,
            ),
            None,
        );

        assert_eq!(
            binding.accepts_page_load(
                "https://b.example/page#section",
                tauri::webview::PageLoadEvent::Started,
            ),
            Some("session-b".to_string()),
        );
        assert_eq!(binding.accepts_title("https://a.example/page"), None);
        assert_eq!(
            binding.accepts_title("https://b.example/page"),
            Some("session-b".to_string()),
        );
        assert_eq!(
            binding.accepts_page_load(
                "https://b.example/page",
                tauri::webview::PageLoadEvent::Finished,
            ),
            Some("session-b".to_string()),
        );
    }

    #[test]
    fn tab_context_menu_overlay_uses_private_bridge_and_preserves_disabled_items() {
        let theme = BrowserTabContextMenuTheme {
            color_scheme: "light".to_string(),
            surface: "theme-surface".to_string(),
            foreground: "theme-foreground".to_string(),
            border: "theme-border".to_string(),
            hover_surface: "theme-hover".to_string(),
            disabled_foreground: "theme-disabled".to_string(),
            shadow: "theme-shadow".to_string(),
        };
        let script = browser_tab_context_menu_overlay_script(
            "session-42",
            "menu-nonce-42",
            88.0,
            Some("zh-CN"),
            &["right".to_string()],
            &theme,
        )
        .expect("overlay script should serialize");

        assert!(script.contains(BROWSER_TAB_CONTEXT_MENU_BRIDGE_HOST));
        assert!(script.contains(BROWSER_TAB_CONTEXT_MENU_BRIDGE_PATH));
        assert!(script.contains("关闭标签页"));
        assert!(script.contains("left:min(88px"));
        assert!(script.contains("top:16px"));
        assert!(script.contains("button.disabled = disabled"));
        assert!(script.contains("[\"right\",\"关闭右侧标签页\",true]"));
        assert!(script.contains("\"surface\":\"theme-surface\""));
        assert!(script.contains("--mossx-tab-menu-surface"));
        assert!(script.contains("attachShadow({ mode: \"closed\" })"));
        assert!(script.contains("event.composedPath().includes(host)"));
        assert!(script.contains("&nonce="));
        assert!(script.contains("menu-nonce-42"));
        assert!(!script.contains("#111318"));
    }

    #[test]
    fn tab_context_menu_invocation_is_scoped_expiring_and_one_time() {
        let issued_at = 100_u64;
        let invocation = BrowserTabContextMenuInvocation::new("target-b", "renderer-a", issued_at);
        let nonce = invocation.nonce.clone();

        assert!(invocation.authorizes(
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS,
        ));
        assert!(!invocation.authorizes(nonce.as_str(), "target-c", "renderer-a", issued_at + 1,));
        assert!(!invocation.authorizes(nonce.as_str(), "target-b", "renderer-c", issued_at + 1,));
        assert!(!invocation.authorizes(
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + BROWSER_TAB_CONTEXT_MENU_BRIDGE_TTL_MS + 1,
        ));
        assert!(!invocation.authorizes(nonce.as_str(), "target-b", "renderer-a", issued_at - 1,));

        let mut active_invocation = Some(invocation);
        assert!(consume_tab_context_menu_invocation(
            &mut active_invocation,
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + 1,
        ));
        assert!(active_invocation.is_none());
        assert!(!consume_tab_context_menu_invocation(
            &mut active_invocation,
            nonce.as_str(),
            "target-b",
            "renderer-a",
            issued_at + 2,
        ));
    }

    #[test]
    fn user_override_blocks_builtin_provider() {
        let settings = BrowserAgentSettings {
            enabled: true,
            ..BrowserAgentSettings::default()
        };
        let decision = default_route_decision(
            "read_snapshot",
            &settings,
            true,
            &platform::current_platform_capability(),
        );
        assert_eq!(decision.selected_provider, "browser_skill");
        assert!(decision.fallback_used);
        assert_eq!(decision.fallback_reason.as_deref(), Some("user_override"));
    }

    #[test]
    fn snapshot_summary_uses_bounded_visible_text() {
        let snapshot = BrowserContextSnapshot {
            snapshot_id: "snapshot-1".to_string(),
            browser_session_id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            captured_at: 100,
            freshness: BrowserSnapshotFreshness::Fresh,
            source: BrowserSnapshotSource {
                url: "https://example.com".to_string(),
                normalized_url: "https://example.com".to_string(),
                origin: Some("https://example.com".to_string()),
                title: Some("Example".to_string()),
                tab_label: "Example".to_string(),
                capture_reason: "manual_attach".to_string(),
                workspace_local_allowed: false,
            },
            viewport: default_browser_viewport(),
            page: BrowserContextSnapshotPage {
                visible_text: "first line\nsecond line".to_string(),
                page_type: BrowserPageType::Unknown,
                primary_content: None,
                readable_blocks: Vec::new(),
                noise_diagnostics: Vec::new(),
                visual_evidence: Vec::new(),
                text_truncated: false,
                headings: Vec::new(),
                landmarks: Vec::new(),
                element_landmarks: Vec::new(),
                content_regions: Vec::new(),
                links: Vec::new(),
                buttons: Vec::new(),
                forms: Vec::new(),
                selected_text: None,
                language_hint: None,
            },
            code_candidates: Vec::new(),
            diagnostics: BrowserContextSnapshotDiagnostics {
                console: Vec::new(),
                network: None,
                capture_warnings: Vec::new(),
            },
            evidence: BrowserContextSnapshotEvidence {
                screenshot_ref: None,
                html_excerpt_ref: None,
            },
            omitted_capabilities: Vec::new(),
            privacy: BrowserPrivacyReport {
                redaction_applied: false,
                redacted_kinds: Vec::new(),
                omitted_kinds: Vec::new(),
            },
            budget: BrowserSnapshotBudget {
                char_limit: 12_000,
                visible_text_limit: 8_000,
                element_limit: 120,
                form_field_limit: 80,
                diagnostic_limit: 50,
                token_estimate: None,
                truncated: false,
                omitted_element_count: 0,
            },
            availability: "available".to_string(),
        };

        assert_eq!(
            snapshot_summary(&snapshot),
            "Example\nfirst line second line"
        );
    }
}
