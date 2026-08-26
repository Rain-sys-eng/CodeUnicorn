use serde_json::Value;

use super::providers::*;
use super::snapshot::*;
use super::types::*;

pub(crate) async fn query_by_base_url_and_key(
    base_url: &str,
    api_key: &str,
) -> CodingPlanQuotaSnapshot {
    if api_key.trim().is_empty() {
        return empty_snapshot("empty_credentials", Some(relay_user_error("empty_key")));
    }
    if let Some(provider) = detect_provider(base_url) {
        return match provider {
            CodingPlanProvider::Kimi => query_kimi(api_key).await,
            CodingPlanProvider::MiniMaxCn => query_minimax(api_key, true).await,
            CodingPlanProvider::MiniMaxEn => query_minimax(api_key, false).await,
            CodingPlanProvider::ZhipuCn | CodingPlanProvider::ZhipuEn => {
                query_zhipu(base_url, api_key).await
            }
            CodingPlanProvider::DeepSeek => query_deepseek(api_key).await,
        };
    }
    if is_dashscope_coding_plan_host(base_url) {
        return empty_snapshot(
            "unsupported",
            Some(
                "Aliyun Bailian Coding Plan (Qwen/dashscope) has no public quota HTTP API \
                 (same gap in CC Switch coding_plan); check usage in Bailian console"
                    .into(),
            ),
        );
    }
    // 非主流官方 / 非已接入 Coding Plan host：
    // 1) Sub2API GET /v1/usage
    // 2) 失败（404/其它）→ New API / One API GET /api/user/self（同级回退）
    query_relay_balance(base_url, api_key).await
}

/// 中转站额度探测：Sub2API 优先（短超时），失败后 New API / One API（更短超时）。
/// 最坏串行耗时 ≈ PRIMARY + FALLBACK，避免双 15s。
pub(crate) async fn query_relay_balance(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let origin = relay_origin(base_url).ok();
    let sub2 = query_sub2api(base_url, api_key).await;
    if sub2.success {
        return sub2;
    }
    // 鉴权失败仍尝试 New API：可能 sk 只对一侧有效
    let new_api = query_new_api(base_url, api_key).await;
    if new_api.success {
        return new_api;
    }
    // 两者都失败：选信息更具体的 error，并保证带 site_origin
    let mut failed = pick_better_relay_error(sub2, new_api);
    if failed.site_origin.is_none() {
        failed.site_origin = origin;
    }
    failed
}

/// 优先保留「更可操作」的错误（鉴权/限流 > 暂不支持 > 网络）。
pub(crate) fn pick_better_relay_error(
    sub2: CodingPlanQuotaSnapshot,
    new_api: CodingPlanQuotaSnapshot,
) -> CodingPlanQuotaSnapshot {
    let rank = |err: Option<&str>| -> u8 {
        let e = err.unwrap_or("");
        if e.contains("系统访问令牌") || e.contains("权限不足") {
            0
        } else if e.contains("密钥无效") {
            1
        } else if e.contains("过于频繁") {
            2
        } else if e.contains("暂不支持") {
            3
        } else if e.contains("网络") {
            4
        } else {
            5
        }
    };
    if rank(new_api.error.as_deref()) < rank(sub2.error.as_deref()) {
        new_api
    } else {
        sub2
    }
}

/// 从 base_url 提取 scheme://host[:port]
pub(crate) fn relay_origin(base_url: &str) -> Result<String, String> {
    let raw = base_url.trim();
    if raw.is_empty() {
        return Err("base_url is empty".into());
    }
    let without_query = raw
        .split_once('?')
        .map(|(head, _)| head)
        .unwrap_or(raw)
        .trim()
        .trim_end_matches('/');
    let (scheme, rest) = if let Some(rest) = without_query
        .strip_prefix("https://")
        .or_else(|| without_query.strip_prefix("http://"))
    {
        let scheme = if without_query.starts_with("https://") {
            "https"
        } else {
            "http"
        };
        (scheme, rest)
    } else {
        return Err(format!("base_url must be absolute http(s) URL: {base_url}"));
    };
    let authority = match rest.find('/') {
        Some(idx) => &rest[..idx],
        None => rest,
    };
    if authority.is_empty() {
        return Err(format!("base_url missing host: {base_url}"));
    }
    Ok(format!("{scheme}://{authority}"))
}

pub(crate) fn new_api_user_self_url(base_url: &str) -> Result<String, String> {
    Ok(format!("{}/api/user/self", relay_origin(base_url)?))
}

/// 解析 New API / One API `GET /api/user/self` body。
/// `data.quota` 为内部额度单位，余额美元 ≈ quota / 500000。
pub(crate) fn parse_new_api_user_self(body: &Value) -> Result<CodingPlanQuotaSnapshot, String> {
    // 错误信封
    if let Some(success) = body.get("success").and_then(|v| v.as_bool()) {
        if !success && body.get("data").is_none() {
            return Err(sub2api_user_error("auth"));
        }
    }
    if let Some(code) = body.get("code") {
        // 部分实现 code=0/200 成功
        let ok = code.as_i64() == Some(0)
            || code.as_i64() == Some(200)
            || code.as_str() == Some("ok")
            || code.as_str() == Some("success");
        if !ok && body.get("data").is_none() && body.get("quota").is_none() {
            return Err(sub2api_user_error("auth"));
        }
    }

    let data = body.get("data").filter(|d| d.is_object()).unwrap_or(body);

    let quota = data
        .get("quota")
        .and_then(parse_f64)
        .or_else(|| data.get("remain_quota").and_then(parse_f64))
        .or_else(|| data.get("remaining_quota").and_then(parse_f64));

    let used_quota = data
        .get("used_quota")
        .and_then(parse_f64)
        .or_else(|| data.get("usedQuota").and_then(parse_f64));

    let request_count = data
        .get("request_count")
        .or_else(|| data.get("requestCount"))
        .and_then(parse_u64_loose);

    let Some(quota_raw) = quota else {
        return Err(sub2api_user_error("empty"));
    };

    let balance_usd = (quota_raw / NEW_API_QUOTA_PER_USD).max(0.0);
    let used_usd = used_quota
        .map(|u| (u / NEW_API_QUOTA_PER_USD).max(0.0))
        .map(format_quota_amount);

    // 余额为 0 仍视为「查询成功、账户可用」，耗尽用数值表达
    let balance = CodingPlanBalanceSnapshot {
        is_available: true,
        items: vec![CodingPlanBalanceItem {
            currency: "USD".to_string(),
            total_balance: format_quota_amount(balance_usd),
            granted_balance: None,
            topped_up_balance: None,
        }],
    };

    let usage_summary = CodingPlanUsageSummary {
        total_requests: request_count,
        total_actual_cost: used_usd,
        total_input_tokens: None,
        total_output_tokens: None,
        total_tokens: None,
        average_duration_ms: None,
    };
    let has_usage =
        usage_summary.total_requests.is_some() || usage_summary.total_actual_cost.is_some();

    let group = data
        .get("group")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    Ok(CodingPlanQuotaSnapshot {
        source: "new_api".to_string(),
        via: Some("api".to_string()),
        success: true,
        error: None,
        plan_label: group,
        windows: vec![],
        balance: Some(balance),
        usage_summary: has_usage.then_some(usage_summary),
        site_origin: None, // 由 query_new_api 填入真实 origin
        queried_at: now_millis(),
    })
}

pub(crate) async fn query_new_api(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let origin = relay_origin(base_url).ok();
    let fail =
        |kind: &str| empty_snapshot_ex("new_api", Some(relay_user_error(kind)), origin.clone());
    let self_url = match new_api_user_self_url(base_url) {
        Ok(u) => u,
        Err(_) => return fail("unsupported_format"),
    };
    let client = match http_client_with_timeout(RELAY_FALLBACK_TIMEOUT) {
        Ok(c) => c,
        Err(_) => return fail("network"),
    };
    let resp = match client
        .get(&self_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return fail("network"),
    };
    let status = resp.status();
    if !status.is_success() {
        return fail(status_to_relay_error_kind(status, true));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return fail("network"),
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(_) => return fail("unsupported_format"),
    };
    match parse_new_api_user_self(&body) {
        Ok(mut snapshot) => {
            snapshot.site_origin = origin;
            snapshot
        }
        Err(error) => empty_snapshot_ex("new_api", Some(error), origin),
    }
}

/// 从 provider base_url 推导 Sub2API `GET /v1/usage` 完整 URL。
///
/// - path 以 `/v1` 结尾 → `{scheme}://{host}{path}/usage`
/// - 否则 → `{scheme}://{host}/v1/usage`（忽略 chat 子路径）
pub(crate) fn sub2api_usage_url(base_url: &str) -> Result<String, String> {
    let raw = base_url.trim();
    if raw.is_empty() {
        return Err("base_url is empty".into());
    }
    let without_query = raw
        .split_once('?')
        .map(|(head, _)| head)
        .unwrap_or(raw)
        .trim()
        .trim_end_matches('/');
    let (scheme, rest) = if let Some(rest) = without_query
        .strip_prefix("https://")
        .or_else(|| without_query.strip_prefix("http://"))
    {
        let scheme = if without_query.starts_with("https://") {
            "https"
        } else {
            "http"
        };
        (scheme, rest)
    } else {
        return Err(format!("base_url must be absolute http(s) URL: {base_url}"));
    };
    let (authority, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };
    if authority.is_empty() {
        return Err(format!("base_url missing host: {base_url}"));
    }
    let path_trimmed = path.trim_end_matches('/');
    // 去掉常见 chat 尾缀，保留到 /v1（若有）
    let path_norm = {
        let lower = path_trimmed.to_ascii_lowercase();
        let mut p = path_trimmed.to_string();
        for suffix in [
            "/chat/completions",
            "/messages",
            "/responses",
            "/completions",
        ] {
            if lower.ends_with(suffix) {
                p = path_trimmed[..path_trimmed.len() - suffix.len()].to_string();
                break;
            }
        }
        p.trim_end_matches('/').to_string()
    };
    if path_norm.to_ascii_lowercase().ends_with("/v1") || path_norm.eq_ignore_ascii_case("/v1") {
        Ok(format!("{scheme}://{authority}{path_norm}/usage"))
    } else {
        Ok(format!("{scheme}://{authority}/v1/usage"))
    }
}

pub(crate) fn format_quota_amount(value: f64) -> String {
    if !value.is_finite() {
        return "0.00".to_string();
    }
    // HUD 统一保留 2 位小数
    format!("{value:.2}")
}

/// New API / One API 内部额度单位：多数部署 500_000 ≈ $1。
pub(crate) const NEW_API_QUOTA_PER_USD: f64 = 500_000.0;

pub(crate) fn truncate_plan_label(label: &str) -> String {
    let mut out = String::new();
    for (i, ch) in label.chars().enumerate() {
        if i >= SUB2API_PLAN_LABEL_MAX_CHARS {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

pub(crate) fn classify_sub2api_window_id(name: &str) -> String {
    let n = name.trim().to_ascii_lowercase();
    if n.is_empty() {
        return "window".to_string();
    }
    if n.contains("five")
        || n == "5h"
        || n.contains("5h")
        || n.contains("5_hour")
        || n.contains("5-hour")
        || n.contains("five_hour")
        || (n.contains('5') && n.contains("hour"))
    {
        return "five_hour".to_string();
    }
    if n.contains("week")
        || n.contains("seven")
        || n == "7d"
        || n.contains("7d")
        || n.contains("7_day")
        || n.contains("7-day")
        || n.contains("weekly")
    {
        return "weekly_limit".to_string();
    }
    if n.contains("month") {
        return "monthly".to_string();
    }
    if n.contains("day") || n.contains("daily") || n == "1d" || n.contains("1d") {
        return "daily".to_string();
    }
    // 保留原名供 HUD 回退展示
    name.trim().chars().take(24).collect()
}

pub(crate) fn window_priority(id: &str) -> u8 {
    match id {
        "five_hour" => 0,
        "daily" => 1,
        "weekly_limit" | "seven_day" => 2,
        "monthly" => 3,
        _ => 9,
    }
}

/// 从单个 window/limit 对象解析 used% / remaining% / reset。
pub(crate) fn parse_sub2api_window_object(item: &Value) -> Option<CodingPlanQuotaWindow> {
    let name = item
        .get("name")
        .or_else(|| item.get("id"))
        .or_else(|| item.get("window"))
        .or_else(|| item.get("type"))
        .or_else(|| item.get("label"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let id = classify_sub2api_window_id(name);

    let used_percent = item
        .get("used_percent")
        .or_else(|| item.get("usedPercent"))
        .or_else(|| item.get("percentage"))
        .and_then(parse_f64)
        .or_else(|| {
            let used = item
                .get("used")
                .or_else(|| item.get("usage"))
                .and_then(parse_f64);
            let limit = item
                .get("limit")
                .or_else(|| item.get("quota"))
                .or_else(|| item.get("total"))
                .and_then(parse_f64);
            match (used, limit) {
                (Some(u), Some(l)) if l > 0.0 => Some((u / l) * 100.0),
                _ => None,
            }
        })
        .or_else(|| {
            let remaining_pct = item
                .get("remaining_percent")
                .or_else(|| item.get("remainingPercent"))
                .and_then(parse_f64);
            remaining_pct.map(|r| 100.0 - r)
        })
        .or_else(|| {
            let remaining = item.get("remaining").and_then(parse_f64);
            let limit = item
                .get("limit")
                .or_else(|| item.get("quota"))
                .and_then(parse_f64);
            match (remaining, limit) {
                (Some(r), Some(l)) if l > 0.0 => Some(((l - r).max(0.0) / l) * 100.0),
                _ => None,
            }
        })?;

    let resets_at = item
        .get("reset_at")
        .or_else(|| item.get("resets_at"))
        .or_else(|| item.get("resetsAt"))
        .or_else(|| item.get("resetTime"))
        .or_else(|| item.get("reset_time"))
        .or_else(|| item.get("end_time"))
        .and_then(extract_reset_time);

    Some(window_from_used(&id, used_percent, resets_at))
}

pub(crate) fn parse_sub2api_windows(body: &Value) -> Vec<CodingPlanQuotaWindow> {
    let mut windows = Vec::new();

    for key in ["rate_limits", "rateLimits", "windows", "limits"] {
        if let Some(arr) = body.get(key).and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(w) = parse_sub2api_window_object(item) {
                    windows.push(w);
                }
            }
        }
    }

    // subscription 嵌套：daily / weekly / monthly 对象
    if let Some(sub) = body
        .get("subscription")
        .or_else(|| body.get("subscription_usage"))
    {
        for (name, child) in [
            ("daily", sub.get("daily")),
            ("weekly", sub.get("weekly")),
            ("monthly", sub.get("monthly")),
        ] {
            if let Some(obj) = child {
                let mut obj = obj.clone();
                if obj.get("name").is_none() && obj.get("id").is_none() {
                    if let Some(map) = obj.as_object_mut() {
                        map.insert("name".into(), Value::String(name.into()));
                    }
                }
                if let Some(w) = parse_sub2api_window_object(&obj) {
                    windows.push(w);
                }
            }
        }
    }

    // 去重：同 id 保留首次（通常更完整）
    let mut seen = std::collections::HashSet::new();
    windows.retain(|w| seen.insert(w.id.clone()));
    windows.sort_by_key(|w| window_priority(&w.id));
    // HUD 主+次最多两窗
    windows.truncate(2);
    windows
}

pub(crate) fn parse_sub2api_balance(body: &Value) -> Option<CodingPlanBalanceSnapshot> {
    let balance_num = body
        .get("balance")
        .or_else(|| body.get("remaining"))
        .and_then(parse_f64)
        .or_else(|| {
            body.get("wallet")
                .and_then(|w| w.get("balance").or_else(|| w.get("remaining")))
                .and_then(parse_f64)
        })?;
    let unit = body
        .get("unit")
        .or_else(|| body.get("currency"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("USD");
    let is_available = body
        .get("isValid")
        .or_else(|| body.get("is_available"))
        .or_else(|| body.get("isAvailable"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    Some(CodingPlanBalanceSnapshot {
        is_available,
        items: vec![CodingPlanBalanceItem {
            currency: unit.to_string(),
            total_balance: format_quota_amount(balance_num),
            granted_balance: None,
            topped_up_balance: None,
        }],
    })
}

pub(crate) fn build_sub2api_plan_label(body: &Value) -> Option<String> {
    // planName 单独展示；用量明细走 usage_summary，避免塞进单行 planLabel
    body.get("planName")
        .or_else(|| body.get("plan_name"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.chars().count() > SUB2API_PLAN_LABEL_MAX_CHARS {
                truncate_plan_label(s)
            } else {
                s.to_string()
            }
        })
}

pub(crate) fn parse_u64_loose(value: &Value) -> Option<u64> {
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    if let Some(n) = value.as_i64() {
        return u64::try_from(n).ok();
    }
    if let Some(f) = value.as_f64() {
        if f.is_finite() && f >= 0.0 {
            return Some(f.round() as u64);
        }
    }
    value.as_str().and_then(|s| s.trim().parse().ok())
}

pub(crate) fn parse_sub2api_usage_summary(body: &Value) -> Option<CodingPlanUsageSummary> {
    let usage = body.get("usage");
    let total = usage.and_then(|u| u.get("total"));
    let total_requests = total
        .and_then(|t| t.get("requests"))
        .and_then(parse_u64_loose)
        .or_else(|| body.get("requests").and_then(parse_u64_loose));
    let total_actual_cost = total
        .and_then(|t| {
            t.get("actual_cost")
                .or_else(|| t.get("cost"))
                .and_then(parse_f64)
        })
        .map(format_quota_amount);
    let total_input_tokens = total
        .and_then(|t| t.get("input_tokens"))
        .and_then(parse_u64_loose);
    let total_output_tokens = total
        .and_then(|t| t.get("output_tokens"))
        .and_then(parse_u64_loose);
    let total_tokens = total
        .and_then(|t| t.get("total_tokens"))
        .and_then(parse_u64_loose);
    let average_duration_ms = usage
        .and_then(|u| u.get("average_duration_ms"))
        .and_then(parse_f64)
        .or_else(|| body.get("average_duration_ms").and_then(parse_f64));

    let summary = CodingPlanUsageSummary {
        total_requests,
        total_actual_cost,
        total_input_tokens,
        total_output_tokens,
        total_tokens,
        average_duration_ms,
    };
    let has_any = summary.total_requests.is_some()
        || summary.total_actual_cost.is_some()
        || summary.total_input_tokens.is_some()
        || summary.total_output_tokens.is_some()
        || summary.total_tokens.is_some()
        || summary.average_duration_ms.is_some();
    has_any.then_some(summary)
}

/// 解析 Sub2API `GET /v1/usage` JSON → quota snapshot（纯函数，便于单测）。
pub(crate) fn parse_sub2api_usage(body: &Value) -> Result<CodingPlanQuotaSnapshot, String> {
    // 错误信封 → 友好文案（不回传上游 message）
    if let Some(code) = body.get("code").and_then(|v| v.as_str()) {
        if code != "ok" && code != "success" && body.get("balance").is_none() {
            let lower = code.to_ascii_lowercase();
            if lower.contains("invalid") || lower.contains("unauthorized") || lower.contains("key")
            {
                return Err(sub2api_user_error("auth"));
            }
            return Err(sub2api_user_error("unsupported_format"));
        }
    }

    let balance = parse_sub2api_balance(body);
    let windows = parse_sub2api_windows(body);
    let usage_summary = parse_sub2api_usage_summary(body);
    let plan_label = build_sub2api_plan_label(body);

    if balance.is_none() && windows.is_empty() && usage_summary.is_none() {
        return Err(sub2api_user_error("empty"));
    }

    Ok(CodingPlanQuotaSnapshot {
        source: "sub2api".to_string(),
        via: Some("api".to_string()),
        success: true,
        error: None,
        plan_label,
        windows,
        balance,
        usage_summary,
        site_origin: None, // 由 query_sub2api 填入真实 origin
        queried_at: now_millis(),
    })
}

pub(crate) async fn query_sub2api(base_url: &str, api_key: &str) -> CodingPlanQuotaSnapshot {
    let origin = relay_origin(base_url).ok();
    let fail =
        |kind: &str| empty_snapshot_ex("sub2api", Some(relay_user_error(kind)), origin.clone());
    let usage_url = match sub2api_usage_url(base_url) {
        Ok(u) => u,
        Err(_) => return fail("unsupported_format"),
    };
    let client = match http_client_with_timeout(RELAY_PRIMARY_TIMEOUT) {
        Ok(c) => c,
        Err(_) => return fail("network"),
    };
    let resp = match client
        .get(&usage_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return fail("network"),
    };
    let status = resp.status();
    if !status.is_success() {
        return fail(status_to_relay_error_kind(status, false));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return fail("network"),
    };
    let body: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(_) => return fail("unsupported_format"),
    };
    match parse_sub2api_usage(&body) {
        Ok(mut snapshot) => {
            snapshot.site_origin = origin;
            snapshot
        }
        Err(error) => empty_snapshot_ex("sub2api", Some(error), origin),
    }
}
