use serde_json::Value;
use std::time::Duration;

use super::snapshot::*;
use super::types::*;

/// 解析 DeepSeek GET /user/balance 响应 body。
pub(crate) fn parse_deepseek_balance(body: &Value) -> CodingPlanBalanceSnapshot {
    let is_available = body
        .get("is_available")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut items = Vec::new();
    if let Some(infos) = body.get("balance_infos").and_then(|v| v.as_array()) {
        for info in infos {
            let currency = info
                .get("currency")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("UNKNOWN")
                .to_string();
            let total_balance = info
                .get("total_balance")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("0")
                .to_string();
            items.push(CodingPlanBalanceItem {
                currency,
                total_balance,
                granted_balance: optional_balance_string(info.get("granted_balance")),
                topped_up_balance: optional_balance_string(info.get("topped_up_balance")),
            });
        }
    }
    CodingPlanBalanceSnapshot {
        is_available,
        items,
    }
}

pub(crate) async fn query_deepseek(api_key: &str) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("deepseek", Some(error)),
    };
    let resp = match client
        .get(DEEPSEEK_BALANCE_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("deepseek", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "deepseek",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let truncated = if body.len() > 240 {
            format!("{}…", &body[..240])
        } else {
            body
        };
        return empty_snapshot(
            "deepseek",
            Some(format!("API error (HTTP {status}): {truncated}")),
        );
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot(
                "deepseek",
                Some(format!("Failed to read response: {error}")),
            );
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot(
                "deepseek",
                Some(format!("Failed to parse response: {error}")),
            );
        }
    };
    let balance = parse_deepseek_balance(&body);
    let plan_label = if balance.is_available {
        Some("available".to_string())
    } else {
        Some("unavailable".to_string())
    };
    success_balance_snapshot("deepseek", "api", balance, plan_label)
}

pub(crate) fn is_official_anthropic_base(base_url: &str) -> bool {
    let url = base_url.trim().to_ascii_lowercase();
    url.is_empty() || url.contains("api.anthropic.com") || url.contains("anthropic.com/claude")
}

pub(crate) fn is_official_openai_base(base_url: &str) -> bool {
    let url = base_url.trim().to_ascii_lowercase();
    url.is_empty()
        || url.contains("api.openai.com")
        || url.contains("chatgpt.com")
        || url.contains("openai.com/v1")
}

pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    http_client_with_timeout(HTTP_TIMEOUT)
}

pub(crate) fn http_client_with_timeout(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("http client: {error}"))
}

pub(crate) async fn query_kimi(api_key: &str) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("kimi", Some(error)),
    };
    let resp = match client
        .get(format!("{KIMI_CODE_USAGE_BASE}/usages"))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("kimi", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "kimi",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return empty_snapshot("kimi", Some(format!("API error (HTTP {status}): {body}")));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot("kimi", Some(format!("Failed to read response: {error}")));
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot("kimi", Some(format!("Failed to parse response: {error}")));
        }
    };

    let mut windows = Vec::new();
    if let Some(limits) = body.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            if let Some(detail) = limit_item.get("detail") {
                let limit = detail.get("limit").and_then(parse_f64).unwrap_or(1.0);
                let remaining = detail.get("remaining").and_then(parse_f64).unwrap_or(0.0);
                let resets_at = detail.get("resetTime").and_then(extract_reset_time);
                let used = (limit - remaining).max(0.0);
                let used_percent = if limit > 0.0 {
                    (used / limit) * 100.0
                } else {
                    0.0
                };
                windows.push(window_from_used("five_hour", used_percent, resets_at));
                break;
            }
        }
    }
    if let Some(usage) = body.get("usage") {
        let limit = usage.get("limit").and_then(parse_f64).unwrap_or(1.0);
        let remaining = usage.get("remaining").and_then(parse_f64).unwrap_or(0.0);
        let resets_at = usage.get("resetTime").and_then(extract_reset_time);
        let used = (limit - remaining).max(0.0);
        let used_percent = if limit > 0.0 {
            (used / limit) * 100.0
        } else {
            0.0
        };
        windows.push(window_from_used("weekly_limit", used_percent, resets_at));
    }

    success_snapshot("kimi", "api", windows, None)
}

pub(crate) fn parse_minimax_windows(body: &Value) -> Vec<CodingPlanQuotaWindow> {
    let mut windows = Vec::new();
    let Some(model_remains) = body.get("model_remains").and_then(|v| v.as_array()) else {
        return windows;
    };
    let Some(item) = model_remains.iter().find(|item| {
        item.get("model_name")
            .and_then(|v| v.as_str())
            .map(|s| s == "general")
            .unwrap_or(false)
    }) else {
        return windows;
    };

    if let Some(remain_pct) = item
        .get("current_interval_remaining_percent")
        .and_then(|v| v.as_f64())
    {
        let resets_at = item
            .get("end_time")
            .and_then(|v| v.as_i64())
            .and_then(millis_to_iso8601);
        windows.push(window_from_used("five_hour", 100.0 - remain_pct, resets_at));
    }

    if item.get("current_weekly_status").and_then(|v| v.as_i64()) == Some(1) {
        if let Some(remain_pct) = item
            .get("current_weekly_remaining_percent")
            .and_then(|v| v.as_f64())
        {
            let resets_at = item
                .get("weekly_end_time")
                .and_then(|v| v.as_i64())
                .and_then(millis_to_iso8601);
            windows.push(window_from_used(
                "weekly_limit",
                100.0 - remain_pct,
                resets_at,
            ));
        }
    }
    windows
}

pub(crate) async fn query_minimax(api_key: &str, is_cn: bool) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("minimax", Some(error)),
    };
    let domain = if is_cn {
        "api.minimaxi.com"
    } else {
        "api.minimax.io"
    };
    let url = format!("https://{domain}/v1/api/openplatform/coding_plan/remains");
    let resp = match client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("minimax", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "minimax",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return empty_snapshot(
            "minimax",
            Some(format!("API error (HTTP {status}): {body}")),
        );
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot("minimax", Some(format!("Failed to read response: {error}")));
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot(
                "minimax",
                Some(format!("Failed to parse response: {error}")),
            );
        }
    };
    if let Some(base_resp) = body.get("base_resp") {
        let status_code = base_resp
            .get("status_code")
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);
        if status_code != 0 {
            let msg = base_resp
                .get("status_msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return empty_snapshot(
                "minimax",
                Some(format!("API error (code {status_code}): {msg}")),
            );
        }
    }

    success_snapshot("minimax", "api", parse_minimax_windows(&body), None)
}

/// 对齐 CC Switch `classify_zhipu_window`：
/// - `unit: 3` → 5 小时
/// - `unit: 6` → 周窗口（不绑 number，兼容 7 天 / 1 周两种取值）
pub(crate) fn classify_zhipu_window(item: &Value) -> Option<&'static str> {
    match item.get("unit").and_then(|v| v.as_i64()) {
        Some(3) => Some("five_hour"),
        Some(6) => Some("weekly_limit"),
        _ => None,
    }
}

/// 对齐 CC Switch `parse_zhipu_token_tiers`：
/// 1) 优先 unit 字段；2) unit 缺失时用 nextResetTime 启发式（无 reset 优先 five_hour）。
pub(crate) fn parse_zhipu_windows(data: &Value) -> Vec<CodingPlanQuotaWindow> {
    pub(crate) type Entry = (Option<i64>, f64, Option<String>);
    let mut five_hour: Option<Entry> = None;
    let mut weekly: Option<Entry> = None;
    let mut unclassified: Vec<Entry> = Vec::new();

    let Some(limits) = data.get("limits").and_then(|v| v.as_array()) else {
        return vec![];
    };
    for item in limits {
        let limit_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        // 与 CC Switch 一致：只吃 TOKENS_LIMIT（大小写不敏感）
        if !limit_type.is_empty() && !limit_type.eq_ignore_ascii_case("TOKENS_LIMIT") {
            continue;
        }
        let percentage = item
            .get("percentage")
            .or_else(|| item.get("UsagePercent"))
            .or_else(|| item.get("usagePercent"))
            .and_then(parse_f64)
            .unwrap_or(0.0);
        let reset_ms = item
            .get("nextResetTime")
            .and_then(|v| v.as_i64())
            .or_else(|| {
                item.get("nextResetTime")
                    .and_then(|v| v.as_f64())
                    .map(|n| n as i64)
            });
        let resets_at = item
            .get("nextResetTime")
            .or_else(|| item.get("resetTime"))
            .and_then(extract_reset_time);
        let entry = (reset_ms, percentage, resets_at);
        match classify_zhipu_window(item) {
            Some("five_hour") if five_hour.is_none() => five_hour = Some(entry),
            Some("weekly_limit") if weekly.is_none() => weekly = Some(entry),
            _ => unclassified.push(entry),
        }
    }

    // 无 nextResetTime 的排前面（5h 桶在 0% 时常缺 reset）；其余按 reset 升序
    unclassified.sort_by_key(|(reset, _, _)| (reset.is_some(), reset.unwrap_or(i64::MIN)));
    for entry in unclassified {
        if five_hour.is_none() {
            five_hour = Some(entry);
        } else if weekly.is_none() {
            weekly = Some(entry);
        }
    }

    let mut windows = Vec::new();
    if let Some((_, pct, resets)) = five_hour {
        windows.push(window_from_used("five_hour", pct, resets));
    }
    if let Some((_, pct, resets)) = weekly {
        windows.push(window_from_used("weekly_limit", pct, resets));
    }
    windows
}

pub(crate) async fn query_zhipu(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let client = match http_client() {
        Ok(c) => c,
        Err(error) => return empty_snapshot("zhipu", Some(error)),
    };
    let host = if base_url.to_lowercase().contains("bigmodel.cn") {
        "https://open.bigmodel.cn"
    } else {
        "https://api.z.ai"
    };
    let url = format!("{host}/api/monitor/usage/quota/limit");
    // 智谱：Authorization 不加 Bearer 前缀
    let resp = match client
        .get(&url)
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .header("Accept-Language", "en-US,en")
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            return empty_snapshot("zhipu", Some(format!("Network error: {error}")));
        }
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return empty_snapshot(
            "zhipu",
            Some(format!("Authentication failed (HTTP {status})")),
        );
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return empty_snapshot("zhipu", Some(format!("API error (HTTP {status}): {body}")));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(error) => {
            return empty_snapshot("zhipu", Some(format!("Failed to read response: {error}")));
        }
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(error) => {
            return empty_snapshot("zhipu", Some(format!("Failed to parse response: {error}")));
        }
    };
    if body.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let msg = body
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return empty_snapshot("zhipu", Some(format!("API error: {msg}")));
    }
    let Some(data) = body.get("data") else {
        return empty_snapshot("zhipu", Some("Missing 'data' field in response".into()));
    };
    let plan_label = data
        .get("level")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    success_snapshot("zhipu", "api", parse_zhipu_windows(data), plan_label)
}
