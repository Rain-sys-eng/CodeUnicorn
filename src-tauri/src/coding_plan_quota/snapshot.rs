use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use super::types::*;

pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub(crate) fn millis_to_iso8601(ms: i64) -> Option<String> {
    if ms <= 0 {
        return None;
    }
    let secs = ms / 1000;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    chrono::DateTime::from_timestamp(secs, nsecs).map(|dt| dt.to_rfc3339())
}

pub(crate) fn extract_reset_time(value: &Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    if let Some(n) = value.as_i64() {
        if n <= 0 {
            return None;
        }
        let ms = if n < 1_000_000_000_000 { n * 1000 } else { n };
        return millis_to_iso8601(ms);
    }
    None
}

pub(crate) fn parse_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

pub(crate) fn clamp_percent(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, 100.0)
}

pub(crate) fn window_from_used(
    id: &str,
    used_percent: f64,
    resets_at: Option<String>,
) -> CodingPlanQuotaWindow {
    let used = clamp_percent(used_percent);
    CodingPlanQuotaWindow {
        id: id.to_string(),
        used_percent: used,
        remaining_percent: clamp_percent(100.0 - used),
        resets_at,
    }
}

pub(crate) fn detect_provider(base_url: &str) -> Option<CodingPlanProvider> {
    let url = base_url.to_lowercase();
    if url.contains("api.kimi.com/coding") {
        Some(CodingPlanProvider::Kimi)
    } else if url.contains("open.bigmodel.cn") || url.contains("bigmodel.cn") {
        // 含 Claude 预设 open.bigmodel.cn/api/anthropic 与 Codex /api/coding/paas/v4
        Some(CodingPlanProvider::ZhipuCn)
    } else if url.contains("api.z.ai") {
        Some(CodingPlanProvider::ZhipuEn)
    } else if url.contains("api.minimaxi.com") {
        Some(CodingPlanProvider::MiniMaxCn)
    } else if url.contains("api.minimax.io") {
        Some(CodingPlanProvider::MiniMaxEn)
    } else if url.contains("api.deepseek.com") || url.contains("deepseek.com") {
        Some(CodingPlanProvider::DeepSeek)
    } else if url.contains("coding.dashscope.aliyuncs.com")
        || url.contains("coding-intl.dashscope.aliyuncs.com")
    {
        // 阿里云百炼 Coding Plan（千问等）：官方目前仅控制台展示额度，无公开 HTTP
        // 查询接口；CC Switch coding_plan.rs 同样未接入。此处识别 host 便于返回明确错误。
        None
    } else {
        None
    }
}

/// 是否阿里云 Coding Plan（千问）host —— 用于更明确的 empty/unsupported 文案。
pub(crate) fn is_dashscope_coding_plan_host(base_url: &str) -> bool {
    let url = base_url.to_lowercase();
    url.contains("coding.dashscope.aliyuncs.com")
        || url.contains("coding-intl.dashscope.aliyuncs.com")
}

pub(crate) fn source_name(provider: CodingPlanProvider) -> &'static str {
    match provider {
        CodingPlanProvider::Kimi => "kimi",
        CodingPlanProvider::ZhipuCn | CodingPlanProvider::ZhipuEn => "zhipu",
        CodingPlanProvider::MiniMaxCn | CodingPlanProvider::MiniMaxEn => "minimax",
        CodingPlanProvider::DeepSeek => "deepseek",
    }
}

pub(crate) fn empty_snapshot(source: &str, error: Option<String>) -> CodingPlanQuotaSnapshot {
    empty_snapshot_ex(source, error, None)
}

/// 失败快照；`site_origin` 用于 HUD 仍展示「{origin} {source}」。
pub(crate) fn empty_snapshot_ex(
    source: &str,
    error: Option<String>,
    site_origin: Option<String>,
) -> CodingPlanQuotaSnapshot {
    CodingPlanQuotaSnapshot {
        source: source.to_string(),
        via: None,
        success: false,
        error,
        plan_label: None,
        windows: vec![],
        balance: None,
        usage_summary: None,
        site_origin,
        queried_at: now_millis(),
    }
}

pub(crate) fn success_snapshot(
    source: &str,
    via: &str,
    windows: Vec<CodingPlanQuotaWindow>,
    plan_label: Option<String>,
) -> CodingPlanQuotaSnapshot {
    CodingPlanQuotaSnapshot {
        source: source.to_string(),
        via: Some(via.to_string()),
        success: true,
        error: None,
        plan_label,
        windows,
        balance: None,
        usage_summary: None,
        site_origin: None,
        queried_at: now_millis(),
    }
}

pub(crate) fn success_balance_snapshot(
    source: &str,
    via: &str,
    balance: CodingPlanBalanceSnapshot,
    plan_label: Option<String>,
) -> CodingPlanQuotaSnapshot {
    CodingPlanQuotaSnapshot {
        source: source.to_string(),
        via: Some(via.to_string()),
        success: true,
        error: None,
        plan_label,
        windows: vec![],
        balance: Some(balance),
        usage_summary: None,
        site_origin: None,
        queried_at: now_millis(),
    }
}

/// 中转站 / 路由失败时的用户可读文案（不暴露 URL、HTTP body、堆栈）。
pub(crate) fn relay_user_error(kind: &str) -> String {
    match kind {
        "not_found" | "404" => "该中转站暂不支持额度查询".to_string(),
        "auth" | "401" | "403" => "密钥无效或未授权".to_string(),
        // New API 的 /api/user/self 常要求系统访问令牌，sk 会 401
        "auth_new_api" => "密钥无效或权限不足（New API 可能需要系统访问令牌，而非 sk）".to_string(),
        "rate_limited" | "429" => "请求过于频繁，请稍后重试".to_string(),
        "network" => "网络异常，请稍后重试".to_string(),
        "parse" | "empty" => "暂无可用额度数据".to_string(),
        "unsupported_format" => "暂不支持该中转站的额度格式".to_string(),
        "empty_key" => "API 密钥为空".to_string(),
        "empty_base" => "未配置服务地址".to_string(),
        "missing_creds" => "未找到供应商凭据".to_string(),
        _ => "额度查询失败，请稍后重试".to_string(),
    }
}

/// 兼容旧名；统一走 relay_user_error。
pub(crate) fn sub2api_user_error(kind: &str) -> String {
    relay_user_error(kind)
}

pub(crate) fn status_to_relay_error_kind(
    status: reqwest::StatusCode,
    for_new_api: bool,
) -> &'static str {
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return "rate_limited";
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return if for_new_api { "auth_new_api" } else { "auth" };
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return "not_found";
    }
    if status.is_client_error() {
        return "not_found";
    }
    "network"
}

pub(crate) fn optional_balance_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}
