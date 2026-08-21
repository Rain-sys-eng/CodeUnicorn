use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use super::providers::{http_client, is_official_anthropic_base, is_official_openai_base, query_kimi};
use super::snapshot::*;
use super::types::*;

pub(crate) fn read_app_config_root() -> Value {
    let Ok(path) = crate::app_paths::config_file_path() else {
        return Value::Object(Default::default());
    };
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    if content.trim().is_empty() {
        return Value::Object(Default::default());
    }
    serde_json::from_str(&content).unwrap_or(Value::Object(Default::default()))
}

pub(crate) fn pick_base_url_api_key(value: &Value) -> (String, String) {
    let base_url = value
        .get("baseUrl")
        .or_else(|| value.get("base_url"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let api_key = value
        .get("apiKey")
        .or_else(|| value.get("api_key"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    (base_url, api_key)
}

/// 官方 Grok / xAI HTTP base（不走 Sub2API）。
pub(crate) fn is_official_grok_base(base_url: &str) -> bool {
    let url = base_url.trim().to_ascii_lowercase();
    if url.is_empty() {
        return true;
    }
    url.contains("api.x.ai") || url.contains("grok.x.ai")
}

/// 解析 Grok managed provider 的 base_url + api_key。
/// - `__local_config_toml__` / 空 id → 官方本地 CLI，返回空凭据（不查 Sub2API）
/// - 其它 id → 读 `config.json` 的 `grok.providers[id]`；未命中则回退 active / 首个
pub(crate) fn resolve_grok_base_url_and_key(
    provider_profile_id: Option<&str>,
) -> Result<(String, String), String> {
    use crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID;

    let profile_id = provider_profile_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(GROK_LOCAL_PROVIDER_PROFILE_ID);

    if profile_id == GROK_LOCAL_PROVIDER_PROFILE_ID {
        // Local 指向 ~/.grok/config.toml：用户可能把 base_url 改成中转站
        // （实测常见：current=__local_config_toml__ 但 toml 内是 fufei 等 Sub2API）
        return crate::vendors::read_local_grok_base_url_and_key();
    }

    let root = read_app_config_root();
    let Some(providers) = root
        .get("grok")
        .and_then(|k| k.get("providers"))
        .and_then(|p| p.as_object())
    else {
        return Err(relay_user_error("missing_creds"));
    };

    if let Some(value) = providers.get(profile_id) {
        return Ok(pick_base_url_api_key(value));
    }

    // profile id 漂移时回退 active / 首个 managed
    if let Some(pair) = pick_from_providers_map(providers, None) {
        return Ok(pair);
    }

    Err(relay_user_error("missing_creds"))
}

pub(crate) fn pick_from_providers_map(
    providers: &serde_json::Map<String, Value>,
    profile_id: Option<&str>,
) -> Option<(String, String)> {
    if let Some(id) = profile_id {
        if let Some(value) = providers.get(id) {
            return Some(pick_base_url_api_key(value));
        }
    }
    for (_, value) in providers {
        if value
            .get("isActive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            return Some(pick_base_url_api_key(value));
        }
    }
    providers.values().next().map(pick_base_url_api_key)
}

pub(crate) fn resolve_claude_settings_env() -> (String, String) {
    // Claude 当前生效 settings.json 的 env（active provider 已写回）
    let path = dirs::home_dir().map(|home| home.join(".claude").join("settings.json"));
    let content = path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    let settings: Value =
        serde_json::from_str(&content).unwrap_or(Value::Object(Default::default()));
    let env = settings
        .get("env")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let base_url = env
        .get("ANTHROPIC_BASE_URL")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .or_else(|| env.get("ANTHROPIC_API_KEY"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    (base_url, api_key)
}

pub(crate) fn extract_codex_base_url_and_key(
    config_toml: &str,
    auth_json: Option<&str>,
) -> Option<(String, String)> {
    let value: toml::Value = config_toml.parse().ok()?;
    let providers = value.get("model_providers")?.as_table()?;
    let mut base_url = String::new();
    for (_name, provider) in providers {
        if let Some(url) = provider
            .get("base_url")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            base_url = url.to_string();
            break;
        }
    }
    if base_url.is_empty() {
        return None;
    }
    let mut api_key = String::new();
    if let Some(auth) = auth_json {
        if let Ok(auth_value) = serde_json::from_str::<Value>(auth) {
            for key in [
                "OPENAI_API_KEY",
                "openai_api_key",
                "api_key",
                "apiKey",
                "token",
            ] {
                if let Some(v) = auth_value
                    .get(key)
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                {
                    api_key = v.to_string();
                    break;
                }
            }
            // nested tokens
            if api_key.is_empty() {
                if let Some(tokens) = auth_value.get("tokens").and_then(|v| v.as_object()) {
                    for key in ["access_token", "api_key", "token"] {
                        if let Some(v) = tokens
                            .get(key)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|v| !v.is_empty())
                        {
                            api_key = v.to_string();
                            break;
                        }
                    }
                }
            }
        }
    }
    Some((base_url, api_key))
}

#[derive(Debug, Clone)]
pub(crate) struct KimiCliCredentials {
    pub(crate) access_token: String,
    pub(crate) refresh_token: String,
    pub(crate) expires_at: Option<i64>,
    /// 原始 JSON，用于写回时保留其它字段。
    pub(crate) raw: Value,
}

pub(crate) fn kimi_cli_credentials_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".kimi-code/credentials/kimi-code.json"))
}

pub(crate) fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// 读取 Kimi CLI 登录态（~/.kimi-code/credentials/kimi-code.json）。
pub(crate) fn load_kimi_cli_credentials() -> Result<KimiCliCredentials, String> {
    let path = kimi_cli_credentials_path()
        .ok_or_else(|| "Cannot resolve home dir for Kimi CLI credentials".to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "Kimi CLI credentials missing (run `kimi login`): {}: {error}",
            path.display()
        )
    })?;
    let raw: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid Kimi CLI credentials JSON: {error}"))?;
    let access_token = raw
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Kimi CLI credentials missing access_token; run `kimi login`".to_string())?
        .to_string();
    let refresh_token = raw
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let expires_at = raw
        .get("expires_at")
        .and_then(|v| v.as_i64())
        .or_else(|| {
            raw.get("expires_at")
                .and_then(|v| v.as_f64())
                .map(|n| n as i64)
        });
    Ok(KimiCliCredentials {
        access_token,
        refresh_token,
        expires_at,
        raw,
    })
}

pub(crate) fn kimi_cli_token_needs_refresh(creds: &KimiCliCredentials, now_secs: i64, force: bool) -> bool {
    if force {
        return true;
    }
    match creds.expires_at {
        Some(expires_at) => now_secs >= expires_at - KIMI_CLI_TOKEN_REFRESH_SKEW_SECS,
        // 无过期字段时不强刷；若 /usages 401 再 force。
        None => false,
    }
}

pub(crate) fn save_kimi_cli_credentials(creds: &KimiCliCredentials) -> Result<(), String> {
    let path = kimi_cli_credentials_path()
        .ok_or_else(|| "Cannot resolve home dir for Kimi CLI credentials".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create Kimi credentials dir: {error}"))?;
    }
    let mut raw = creds.raw.clone();
    if let Some(obj) = raw.as_object_mut() {
        obj.insert(
            "access_token".into(),
            Value::String(creds.access_token.clone()),
        );
        if !creds.refresh_token.is_empty() {
            obj.insert(
                "refresh_token".into(),
                Value::String(creds.refresh_token.clone()),
            );
        }
        if let Some(expires_at) = creds.expires_at {
            obj.insert("expires_at".into(), Value::from(expires_at));
        }
    }
    let content = serde_json::to_string_pretty(&raw)
        .map_err(|error| format!("serialize Kimi credentials: {error}"))?;
    std::fs::write(&path, content)
        .map_err(|error| format!("write Kimi credentials {}: {error}", path.display()))
}

/// 对齐 kimi-code `refreshAccessToken`：POST auth.kimi.com/api/oauth/token
pub(crate) async fn refresh_kimi_cli_access_token(
    refresh_token: &str,
    previous: &KimiCliCredentials,
) -> Result<KimiCliCredentials, String> {
    if refresh_token.trim().is_empty() {
        return Err(
            "Kimi CLI token expired and no refresh_token; run `kimi login`".to_string(),
        );
    }
    let client = http_client()?;
    let url = format!("{KIMI_CODE_OAUTH_HOST}/api/oauth/token");
    let resp = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", KIMI_CODE_OAUTH_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|error| format!("Kimi CLI token refresh network error: {error}"))?;
    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|error| format!("Kimi CLI token refresh parse error: {error}"))?;
    if !status.is_success() {
        let detail = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("token refresh failed");
        return Err(format!(
            "Kimi CLI token refresh failed (HTTP {status}): {detail}; run `kimi login`"
        ));
    }
    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Kimi CLI token refresh missing access_token".to_string())?
        .to_string();
    let new_refresh = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| previous.refresh_token.clone());
    let expires_in = body
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .or_else(|| body.get("expires_in").and_then(|v| v.as_f64()).map(|n| n as i64));
    let expires_at = expires_in.map(|secs| now_unix_secs() + secs.max(0));
    let mut raw = previous.raw.clone();
    if let Some(obj) = raw.as_object_mut() {
        obj.insert("access_token".into(), Value::String(access_token.clone()));
        obj.insert("refresh_token".into(), Value::String(new_refresh.clone()));
        if let Some(expires_at) = expires_at {
            obj.insert("expires_at".into(), Value::from(expires_at));
        }
        if let Some(expires_in) = expires_in {
            obj.insert("expires_in".into(), Value::from(expires_in));
        }
        if let Some(token_type) = body.get("token_type").and_then(|v| v.as_str()) {
            obj.insert("token_type".into(), Value::String(token_type.to_string()));
        }
    }
    Ok(KimiCliCredentials {
        access_token,
        refresh_token: new_refresh,
        expires_at,
        raw,
    })
}

/// 确保 Kimi CLI OAuth access_token 可用（对齐 CLI `/status` → ensureFresh）。
pub(crate) async fn ensure_fresh_kimi_cli_access_token(force: bool) -> Result<String, String> {
    let mut creds = load_kimi_cli_credentials()?;
    let now = now_unix_secs();
    if kimi_cli_token_needs_refresh(&creds, now, force) {
        creds = refresh_kimi_cli_access_token(&creds.refresh_token, &creds).await?;
        save_kimi_cli_credentials(&creds)?;
    }
    Ok(creds.access_token)
}

/// `engine=kimi` 专用：CLI 登录态 + usages（与 `/status` 同源）。via 固定 cli。
pub(crate) async fn query_kimi_cli_status() -> CodingPlanQuotaSnapshot {
    let token = match ensure_fresh_kimi_cli_access_token(false).await {
        Ok(token) => token,
        Err(error) => {
            return empty_snapshot("empty_credentials", Some(error));
        }
    };

    let mut snapshot = query_kimi(&token).await;
    let auth_failed = snapshot.error.as_deref().is_some_and(|msg| {
        msg.contains("401")
            || msg.contains("403")
            || msg.contains("Authentication failed")
            || msg.contains("Unauthorized")
    });
    if !snapshot.success && auth_failed {
        // 强制 refresh 一次（对齐 CLI ensureFresh(force)）
        match ensure_fresh_kimi_cli_access_token(true).await {
            Ok(fresh) => {
                snapshot = query_kimi(&fresh).await;
            }
            Err(error) => {
                return empty_snapshot(
                    "empty_credentials",
                    Some(format!(
                        "Kimi CLI auth failed after refresh: {error}"
                    )),
                );
            }
        }
    }

    // engine=kimi 路径一律标记 via=cli（即使 query_kimi 默认写 api）
    snapshot.via = Some("cli".to_string());
    // 纠正 source：CLI 路径固定 kimi
    if snapshot.success || snapshot.source == "kimi" {
        snapshot.source = "kimi".to_string();
    }
    snapshot
}

pub(crate) fn resolve_engine_base_url_and_key(
    engine: &str,
    provider_profile_id: Option<&str>,
) -> Result<(String, String), String> {
    let engine = engine.trim().to_ascii_lowercase();
    let profile_id = provider_profile_id.map(str::trim).filter(|v| !v.is_empty());

    match engine.as_str() {
        "kimi" => {
            // engine=kimi 额度在 get_coding_plan_quota_for_session 走 query_kimi_cli_status。
            // 此处仅保留 mossx managed kimi provider 解析（其它调用方）；
            // 不得在此静默用过期 access_token 冒充 CLI /status。
            let root = read_app_config_root();
            let providers = root
                .get("kimi")
                .and_then(|k| k.get("providers"))
                .and_then(|p| p.as_object())
                .ok_or_else(|| "Kimi providers not found".to_string())?;
            pick_from_providers_map(providers, profile_id)
                .ok_or_else(|| "Kimi provider credentials not found".into())
        }
        "claude" => {
            if let Some(profile_id) = profile_id {
                if let Some(profile) =
                    crate::engine::claude::provider_profile::resolve_claude_provider_launch_profile(
                        Some(profile_id),
                    )?
                {
                    let base_url = profile
                        .env
                        .get("ANTHROPIC_BASE_URL")
                        .cloned()
                        .unwrap_or_default();
                    let api_key = profile
                        .env
                        .get("ANTHROPIC_AUTH_TOKEN")
                        .or_else(|| profile.env.get("ANTHROPIC_API_KEY"))
                        .cloned()
                        .unwrap_or_default();
                    return Ok((base_url, api_key));
                }
            }
            Ok(resolve_claude_settings_env())
        }
        "codex" => {
            let profile_id = profile_id
                .unwrap_or(crate::codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID);
            if profile_id == crate::codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID {
                // 官方 disk / ChatGPT：无第三方 base_url
                return Ok((String::new(), String::new()));
            }
            match crate::codex::provider_profile::resolve_codex_provider_profile(Some(profile_id)) {
                Ok(crate::codex::provider_profile::CodexProviderProfile::Disk) => {
                    Ok((String::new(), String::new()))
                }
                Ok(crate::codex::provider_profile::CodexProviderProfile::Managed {
                    config_toml,
                    auth_json,
                    ..
                }) => extract_codex_base_url_and_key(&config_toml, auth_json.as_deref())
                    .ok_or_else(|| {
                        "Codex provider has no model_providers.base_url / auth key".into()
                    }),
                Err(error) => Err(error),
            }
        }
        "grok" => resolve_grok_base_url_and_key(profile_id),
        "dsh" => super::host_cli::resolve_dsh_base_url_and_key(profile_id),
        "pi" => super::host_cli::resolve_pi_base_url_and_key(profile_id),
        "opencode" => {
            let root = read_app_config_root();
            let providers = root
                .get("opencode")
                .and_then(|k| k.get("providers"))
                .and_then(|p| p.as_object())
                .ok_or_else(|| "OpenCode providers not found".to_string())?;
            pick_from_providers_map(providers, profile_id)
                .ok_or_else(|| "OpenCode provider credentials not found".into())
        }
        "qoder" => Err(
            "engine qoder has no coding-plan quota API (account limits live in TUI /usage only)"
                .to_string(),
        ),
        other => Err(format!(
            "engine {other} has no coding-plan credential resolver"
        )),
    }
}

/// 决策路由：官方 runtime vs 供应商 Coding Plan API。
pub(crate) fn resolve_quota_route(engine: &str, provider_profile_id: Option<&str>) -> QuotaRoute {
    let engine = engine.trim().to_ascii_lowercase();
    let (base_url, api_key) = match resolve_engine_base_url_and_key(&engine, provider_profile_id) {
        Ok(pair) => pair,
        Err(error) => {
            return QuotaRoute::None { reason: error };
        }
    };

    // Codex / Claude 官方：无第三方 base 或官方 host
    if engine == "codex" {
        if base_url.trim().is_empty() || is_official_openai_base(&base_url) {
            return QuotaRoute::OfficialRuntime { source: "codex" };
        }
        if api_key.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_key"),
            };
        }
        // 已知 Coding Plan host 或未知中转（Sub2API 回退）均走 HTTP 查询
        return QuotaRoute::CodingPlanApi { base_url, api_key };
    }

    if engine == "claude" {
        if is_official_anthropic_base(&base_url) {
            // 官方 Claude：无 Coding Plan 窗口（与 Kimi /status 不同）
            return QuotaRoute::None {
                reason: "official_anthropic_no_coding_plan".into(),
            };
        }
        if api_key.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_key"),
            };
        }
        return QuotaRoute::CodingPlanApi { base_url, api_key };
    }

    // Grok：官方 local / x.ai → 无 Sub2API；自定义中转 base+key → Sub2API
    if engine == "grok" {
        if is_official_grok_base(&base_url) {
            return QuotaRoute::None {
                reason: "official_grok_no_coding_plan".into(),
            };
        }
        if api_key.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_key"),
            };
        }
        return QuotaRoute::CodingPlanApi { base_url, api_key };
    }

    // DSH / PI：官方 Anthropic / OpenAI / xAI 无 coding-plan HTTP；
    // 其余已知 host 或自定义中转走现有 query_by_base_url_and_key。
    // 空 URL 必须先判，因为 is_official_* 把空串当成官方 host。
    if engine == "dsh" || engine == "pi" {
        if base_url.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_base"),
            };
        }
        if is_official_anthropic_base(&base_url) {
            return QuotaRoute::None {
                reason: "official_anthropic_no_coding_plan".into(),
            };
        }
        if is_official_openai_base(&base_url) {
            return QuotaRoute::None {
                reason: "official_openai_no_coding_plan".into(),
            };
        }
        if is_official_grok_base(&base_url) {
            return QuotaRoute::None {
                reason: "official_grok_no_coding_plan".into(),
            };
        }
        if api_key.trim().is_empty() {
            return QuotaRoute::None {
                reason: relay_user_error("empty_key"),
            };
        }
        return QuotaRoute::CodingPlanApi { base_url, api_key };
    }

    // OpenCode / 其它 engine 的 managed provider：
    // 已知 Coding Plan host 或任意第三方 base+key → HTTP（含 Sub2API 回退）。
    // engine=kimi 已在 get_coding_plan_quota_for_session 短路。
    if base_url.trim().is_empty() {
        return QuotaRoute::None {
            reason: relay_user_error("empty_base"),
        };
    }
    if api_key.trim().is_empty() {
        return QuotaRoute::None {
            reason: relay_user_error("empty_key"),
        };
    }
    QuotaRoute::CodingPlanApi { base_url, api_key }
}
