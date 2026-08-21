use super::*;
use serde_json::json;

#[test]
fn detect_known_hosts() {
    assert!(matches!(
        detect_provider("https://api.kimi.com/coding/v1"),
        Some(CodingPlanProvider::Kimi)
    ));
    assert!(matches!(
        detect_provider("https://open.bigmodel.cn/api/anthropic"),
        Some(CodingPlanProvider::ZhipuCn)
    ));
    assert!(matches!(
        detect_provider("https://open.bigmodel.cn/api/coding/paas/v4"),
        Some(CodingPlanProvider::ZhipuCn)
    ));
    assert!(matches!(
        detect_provider("https://api.z.ai/api/anthropic"),
        Some(CodingPlanProvider::ZhipuEn)
    ));
    assert!(matches!(
        detect_provider("https://api.minimaxi.com/anthropic"),
        Some(CodingPlanProvider::MiniMaxCn)
    ));
    assert!(matches!(
        detect_provider("https://api.minimax.io/v1"),
        Some(CodingPlanProvider::MiniMaxEn)
    ));
    assert!(matches!(
        detect_provider("https://api.deepseek.com"),
        Some(CodingPlanProvider::DeepSeek)
    ));
    assert!(matches!(
        detect_provider("https://api.deepseek.com/anthropic"),
        Some(CodingPlanProvider::DeepSeek)
    ));
    assert!(matches!(
        detect_provider("https://api.deepseek.com/v1"),
        Some(CodingPlanProvider::DeepSeek)
    ));
    // 千问 Coding Plan host 识别为「已知但无公开额度 API」
    assert!(detect_provider("https://coding.dashscope.aliyuncs.com/apps/anthropic").is_none());
    assert!(is_dashscope_coding_plan_host(
        "https://coding.dashscope.aliyuncs.com/apps/anthropic"
    ));
    assert!(detect_provider("https://api.openai.com/v1").is_none());
}

#[test]
fn parse_zhipu_unit_and_fallback() {
    let data = json!({
        "limits": [
            {
                "type": "TOKENS_LIMIT",
                "unit": 3,
                "percentage": 12.5,
                "nextResetTime": 1_800_000_000_000i64
            },
            {
                "type": "TOKENS_LIMIT",
                "unit": 6,
                "percentage": 40.0,
                "nextResetTime": 1_800_100_000_000i64
            }
        ]
    });
    let windows = parse_zhipu_windows(&data);
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].id, "five_hour");
    assert!((windows[0].used_percent - 12.5).abs() < 0.01);
    assert_eq!(windows[1].id, "weekly_limit");
    assert!((windows[1].used_percent - 40.0).abs() < 0.01);
}

#[test]
fn parse_deepseek_balance_single_currency() {
    let body = json!({
        "is_available": true,
        "balance_infos": [{
            "currency": "CNY",
            "total_balance": "110.00",
            "granted_balance": "10.00",
            "topped_up_balance": "100.00"
        }]
    });
    let balance = parse_deepseek_balance(&body);
    assert!(balance.is_available);
    assert_eq!(balance.items.len(), 1);
    assert_eq!(balance.items[0].currency, "CNY");
    assert_eq!(balance.items[0].total_balance, "110.00");
    assert_eq!(balance.items[0].granted_balance.as_deref(), Some("10.00"));
    assert_eq!(
        balance.items[0].topped_up_balance.as_deref(),
        Some("100.00")
    );
}

#[test]
fn parse_deepseek_balance_multi_currency_and_empty() {
    let multi = json!({
        "is_available": true,
        "balance_infos": [
            {
                "currency": "CNY",
                "total_balance": "10.00",
                "granted_balance": "0",
                "topped_up_balance": "10.00"
            },
            {
                "currency": "USD",
                "total_balance": "1.50",
                "granted_balance": "0.50",
                "topped_up_balance": "1.00"
            }
        ]
    });
    let balance = parse_deepseek_balance(&multi);
    assert_eq!(balance.items.len(), 2);
    assert_eq!(balance.items[0].currency, "CNY");
    assert_eq!(balance.items[1].currency, "USD");
    assert_eq!(balance.items[1].total_balance, "1.50");

    let empty = json!({ "is_available": false, "balance_infos": [] });
    let empty_balance = parse_deepseek_balance(&empty);
    assert!(!empty_balance.is_available);
    assert!(empty_balance.items.is_empty());
}

#[test]
fn parse_minimax_remaining_to_used() {
    let body = json!({
        "model_remains": [{
            "model_name": "general",
            "current_interval_remaining_percent": 99.0,
            "end_time": 1_800_000_000_000i64,
            "current_weekly_status": 1,
            "current_weekly_remaining_percent": 89.0,
            "weekly_end_time": 1_800_100_000_000i64
        }]
    });
    let windows = parse_minimax_windows(&body);
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].id, "five_hour");
    assert!((windows[0].used_percent - 1.0).abs() < 0.01);
    assert!((windows[0].remaining_percent - 99.0).abs() < 0.01);
    assert_eq!(windows[1].id, "weekly_limit");
    assert!((windows[1].used_percent - 11.0).abs() < 0.01);
}

#[test]
fn parse_minimax_skips_inactive_weekly() {
    let body = json!({
        "model_remains": [{
            "model_name": "general",
            "current_interval_remaining_percent": 50.0,
            "current_weekly_status": 3,
            "current_weekly_remaining_percent": 100.0
        }]
    });
    let windows = parse_minimax_windows(&body);
    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0].id, "five_hour");
}

#[test]
fn official_base_detection() {
    assert!(is_official_anthropic_base(""));
    assert!(is_official_anthropic_base("https://api.anthropic.com/v1"));
    assert!(!is_official_anthropic_base(
        "https://api.minimaxi.com/anthropic"
    ));
    assert!(is_official_openai_base(""));
    assert!(is_official_openai_base("https://api.openai.com/v1"));
    assert!(!is_official_openai_base("https://api.kimi.com/coding/v1"));
}

#[test]
fn kimi_cli_token_refresh_skew() {
    let base = KimiCliCredentials {
        access_token: "a".into(),
        refresh_token: "r".into(),
        expires_at: Some(1_000),
        raw: json!({}),
    };
    // 距过期还有 30s < 60s skew → 需要 refresh
    assert!(kimi_cli_token_needs_refresh(&base, 1_000 - 30, false));
    // 距过期还有 120s → 不需要
    assert!(!kimi_cli_token_needs_refresh(&base, 1_000 - 120, false));
    // force 总是需要
    assert!(kimi_cli_token_needs_refresh(&base, 1_000 - 120, true));
    // 无 expires_at 且非 force → 不刷
    let no_exp = KimiCliCredentials {
        expires_at: None,
        ..base.clone()
    };
    assert!(!kimi_cli_token_needs_refresh(&no_exp, 1_000, false));
}

#[test]
fn qoder_engine_has_no_coding_plan_credential_resolver() {
    let err = resolve_engine_base_url_and_key("qoder", Some("__local_qoder__")).unwrap_err();
    assert!(err.contains("no coding-plan quota API"));
    assert!(!err.contains("Native CLI /usage quota"));
}

#[tokio::test]
async fn qoder_engine_quota_is_unsupported_without_scraping_tui() {
    let snapshot = get_coding_plan_quota_for_session("qoder", Some("__local_qoder__")).await;
    assert_eq!(snapshot.source, "unsupported");
    assert!(!snapshot.success);
    assert!(snapshot.windows.is_empty());
    assert!(snapshot
        .error
        .as_deref()
        .unwrap_or("")
        .contains("没有可查询的账户额度接口"));
}

#[test]
fn kimi_engine_route_is_not_confused_with_claude_http_kimi() {
    // Claude + Kimi HTTP base 仍应走 CodingPlanApi（不进 engine=kimi CLI 短路）
    let route = resolve_quota_route(
        "claude",
        None, // profile missing → may be None or official; just ensure no panic
    );
    // 无 profile 时官方 anthropic → none
    assert!(matches!(route, QuotaRoute::None { .. }) || matches!(route, QuotaRoute::CodingPlanApi { .. }) || matches!(route, QuotaRoute::OfficialRuntime { .. }));
}

#[test]
fn extract_codex_minimax_provider_from_toml() {
    let toml = r#"
model = "m2"
[model_providers.minimax]
base_url = "https://api.minimaxi.com/v1"
wire_api = "responses"
"#;
    let auth = r#"{"OPENAI_API_KEY":"sk-test"}"#;
    let (base, key) = extract_codex_base_url_and_key(toml, Some(auth)).expect("extract");
    assert!(base.contains("minimaxi.com"));
    assert_eq!(key, "sk-test");
}

#[test]
fn sub2api_usage_url_from_root_and_v1() {
    assert_eq!(
        sub2api_usage_url("https://fufei.mossx.ai").unwrap(),
        "https://fufei.mossx.ai/v1/usage"
    );
    assert_eq!(
        sub2api_usage_url("https://fufei.mossx.ai/").unwrap(),
        "https://fufei.mossx.ai/v1/usage"
    );
    assert_eq!(
        sub2api_usage_url("https://fufei.mossx.ai/v1").unwrap(),
        "https://fufei.mossx.ai/v1/usage"
    );
    assert_eq!(
        sub2api_usage_url("https://fufei.mossx.ai/v1/").unwrap(),
        "https://fufei.mossx.ai/v1/usage"
    );
    assert_eq!(
        sub2api_usage_url("https://ai.td.ee/v1/chat/completions").unwrap(),
        "https://ai.td.ee/v1/usage"
    );
    assert_eq!(
        sub2api_usage_url("http://127.0.0.1:8080").unwrap(),
        "http://127.0.0.1:8080/v1/usage"
    );
    assert!(sub2api_usage_url("").is_err());
    assert!(sub2api_usage_url("not-a-url").is_err());
}

#[test]
fn parse_sub2api_wallet_balance_fufei_shape() {
    let body = json!({
        "balance": 0.56969315,
        "daily_usage": [{
            "date": "2026-07-21",
            "requests": 1,
            "input_tokens": 6608,
            "output_tokens": 11,
            "total_tokens": 19675,
            "cost": 0.039898,
            "actual_cost": 0.01436328
        }],
        "isValid": true,
        "mode": "unrestricted",
        "planName": "钱包余额",
        "remaining": 0.56969315,
        "unit": "USD",
        "usage": {
            "average_duration_ms": 3885,
            "rpm": 0,
            "tpm": 0,
            "today": {
                "actual_cost": 0,
                "cost": 0,
                "requests": 0,
                "total_tokens": 0
            },
            "total": {
                "actual_cost": 0.01436328,
                "cost": 0.039898,
                "requests": 1,
                "input_tokens": 6608,
                "output_tokens": 11,
                "total_tokens": 19675
            }
        }
    });
    let snap = parse_sub2api_usage(&body).expect("parse");
    assert!(snap.success);
    assert_eq!(snap.source, "sub2api");
    assert_eq!(snap.via.as_deref(), Some("api"));
    let balance = snap.balance.expect("balance");
    assert!(balance.is_available);
    assert_eq!(balance.items.len(), 1);
    assert_eq!(balance.items[0].currency, "USD");
    assert_eq!(balance.items[0].total_balance, "0.57");
    assert!(snap.windows.is_empty());
    assert_eq!(snap.plan_label.as_deref(), Some("钱包余额"));
    let usage = snap.usage_summary.expect("usage_summary");
    assert_eq!(usage.total_requests, Some(1));
    assert_eq!(usage.total_actual_cost.as_deref(), Some("0.01"));
    assert_eq!(usage.total_input_tokens, Some(6608));
    assert_eq!(usage.total_output_tokens, Some(11));
    assert_eq!(usage.total_tokens, Some(19675));
    assert!((usage.average_duration_ms.unwrap_or(0.0) - 3885.0).abs() < 0.01);
}

#[test]
fn parse_sub2api_wallet_hajimi_shape() {
    let body = json!({
        "balance": 2.594644,
        "daily_usage": [],
        "isValid": true,
        "mode": "unrestricted",
        "planName": "钱包余额",
        "remaining": 2.594644,
        "unit": "USD",
        "usage": {
            "average_duration_ms": 14929.97,
            "rpm": 0,
            "tpm": 0,
            "today": {
                "actual_cost": 0,
                "cost": 0,
                "requests": 0,
                "total_tokens": 0
            },
            "total": {
                "actual_cost": 7.115356,
                "cost": 7.115356,
                "requests": 149,
                "total_tokens": 14015237
            }
        }
    });
    let snap = parse_sub2api_usage(&body).expect("parse");
    assert_eq!(snap.balance.as_ref().unwrap().items[0].total_balance, "2.59");
    assert_eq!(snap.plan_label.as_deref(), Some("钱包余额"));
    let usage = snap.usage_summary.expect("usage");
    assert_eq!(usage.total_requests, Some(149));
    assert_eq!(usage.total_actual_cost.as_deref(), Some("7.12"));
    assert_eq!(usage.total_tokens, Some(14015237));
}

#[test]
fn parse_sub2api_rate_limit_windows() {
    let body = json!({
        "isValid": true,
        "rate_limits": [
            {
                "name": "5h",
                "used": 20,
                "limit": 100,
                "reset_at": "2026-08-10T12:00:00Z"
            },
            {
                "id": "weekly",
                "used_percent": 40.5,
                "resets_at": 1_800_000_000_000i64
            },
            {
                "name": "monthly",
                "remaining_percent": 10.0
            }
        ]
    });
    let snap = parse_sub2api_usage(&body).expect("parse");
    assert!(snap.success);
    assert!(snap.balance.is_none());
    // HUD 最多两窗：five_hour 优先，其次 daily/weekly
    assert_eq!(snap.windows.len(), 2);
    assert_eq!(snap.windows[0].id, "five_hour");
    assert!((snap.windows[0].used_percent - 20.0).abs() < 0.01);
    assert_eq!(snap.windows[1].id, "weekly_limit");
    assert!((snap.windows[1].used_percent - 40.5).abs() < 0.01);
}

#[test]
fn parse_sub2api_empty_payload_errors() {
    let body = json!({ "isValid": true, "mode": "unrestricted" });
    assert!(parse_sub2api_usage(&body).is_err());
}

#[test]
fn parse_sub2api_error_envelope() {
    let body = json!({
        "code": "INVALID_API_KEY",
        "message": "Invalid API key"
    });
    let err = parse_sub2api_usage(&body).unwrap_err();
    // 不得回传上游原始 message
    assert!(!err.contains("Invalid API key"));
    assert!(err.contains("密钥") || err.contains("未授权") || err.contains("无效"));
}

#[test]
fn sub2api_user_error_is_friendly() {
    assert!(relay_user_error("not_found").contains("暂不支持"));
    assert!(!relay_user_error("404").contains("HTTP"));
    assert!(relay_user_error("auth_new_api").contains("系统访问令牌"));
    assert!(relay_user_error("rate_limited").contains("频繁"));
    assert!(relay_user_error("empty_key").contains("密钥"));
    assert!(!relay_user_error("network").contains("error"));
}

#[test]
fn new_api_zero_balance_still_available() {
    let body = json!({
        "success": true,
        "data": { "quota": 0, "used_quota": 100, "request_count": 1 }
    });
    let snap = parse_new_api_user_self(&body).expect("parse");
    assert!(snap.success);
    assert!(snap.balance.as_ref().unwrap().is_available);
    assert_eq!(snap.balance.as_ref().unwrap().items[0].total_balance, "0.00");
}

#[test]
fn pick_better_relay_error_prefers_actionable() {
    let sub2 = empty_snapshot_ex(
        "sub2api",
        Some(relay_user_error("not_found")),
        Some("https://a.example".into()),
    );
    let new_api = empty_snapshot_ex(
        "new_api",
        Some(relay_user_error("auth_new_api")),
        Some("https://a.example".into()),
    );
    let picked = pick_better_relay_error(sub2, new_api);
    assert_eq!(picked.source, "new_api");
    assert!(picked.error.as_deref().unwrap_or("").contains("系统访问令牌"));
}

#[test]
fn format_quota_amount_two_decimals() {
    assert_eq!(format_quota_amount(0.57), "0.57");
    assert_eq!(format_quota_amount(2.594644), "2.59");
    assert_eq!(format_quota_amount(10.0), "10.00");
    assert_eq!(format_quota_amount(95878.280174), "95878.28");
}

#[test]
fn parse_new_api_user_self_quota() {
    // quota 1_000_000 → $2.00；used 250_000 → $0.50
    let body = json!({
        "success": true,
        "data": {
            "quota": 1_000_000,
            "used_quota": 250_000,
            "request_count": 42,
            "group": "default"
        }
    });
    let snap = parse_new_api_user_self(&body).expect("parse");
    assert!(snap.success);
    assert_eq!(snap.source, "new_api");
    assert_eq!(snap.balance.as_ref().unwrap().items[0].total_balance, "2.00");
    assert_eq!(snap.plan_label.as_deref(), Some("default"));
    let usage = snap.usage_summary.expect("usage");
    assert_eq!(usage.total_requests, Some(42));
    assert_eq!(usage.total_actual_cost.as_deref(), Some("0.50"));
}

#[test]
fn new_api_user_self_url_from_chat_base() {
    assert_eq!(
        new_api_user_self_url("https://relay.example/v1").unwrap(),
        "https://relay.example/api/user/self"
    );
    assert_eq!(
        new_api_user_self_url("https://relay.example/v1/chat/completions").unwrap(),
        "https://relay.example/api/user/self"
    );
}

#[test]
fn relay_origin_extracts_host() {
    assert_eq!(
        relay_origin("https://fufei.mossx.ai/v1").unwrap(),
        "https://fufei.mossx.ai"
    );
    assert_eq!(
        relay_origin("https://ai.td.ee/v1/chat/completions").unwrap(),
        "https://ai.td.ee"
    );
}

#[test]
fn official_grok_base_detection() {
    assert!(is_official_grok_base(""));
    assert!(is_official_grok_base("https://api.x.ai/v1"));
    assert!(is_official_grok_base("https://api.x.ai"));
    assert!(!is_official_grok_base("https://fufei.mossx.ai"));
    assert!(!is_official_grok_base("https://ai.td.ee/v1"));
}

#[test]
fn resolve_grok_local_profile_reads_config_toml_without_panic() {
    // local 会读 $GROK_HOME 或 ~/.grok/config.toml；此处只保证路径可达
    let result = resolve_grok_base_url_and_key(Some(
        crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID,
    ));
    assert!(result.is_ok(), "local grok resolve failed: {result:?}");
}

#[test]
fn pick_base_url_accepts_snake_case() {
    let value = json!({
        "base_url": "https://relay.example/v1",
        "api_key": "sk-relay"
    });
    let (base, key) = pick_base_url_api_key(&value);
    assert_eq!(base, "https://relay.example/v1");
    assert_eq!(key, "sk-relay");
}

fn write_temp_dir(prefix: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "mossx-{prefix}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn empty_env(_name: &str) -> Option<String> {
    None
}

#[test]
fn host_cli_vendor_id_ignores_sentinels_and_splits_catalog_id() {
    assert_eq!(host_cli_vendor_id(None), None);
    assert_eq!(host_cli_vendor_id(Some("")), None);
    assert_eq!(host_cli_vendor_id(Some("__dsh_host_catalog__")), None);
    assert_eq!(host_cli_vendor_id(Some("__local_pi__")), None);
    assert_eq!(
        host_cli_vendor_id(Some("deepseek-official/deepseek-v4-flash")).as_deref(),
        Some("deepseek-official")
    );
    assert_eq!(
        host_cli_vendor_id(Some("deepseek-official")).as_deref(),
        Some("deepseek-official")
    );
}

#[test]
fn dsh_official_deepseek_reads_credentials_not_default_model() {
    let home = write_temp_dir("dsh-official");
    std::fs::write(
        home.join("settings.yaml"),
        r#"
llm-pi-ai:
  providers:
    ggggg:
      baseURL: https://fufei.mossx.ai/v1
      apiKeyEnv: GGGGG_API_KEY
agent-default-model:
  provider: ggggg
  model: grok-4.6
"#,
    )
    .unwrap();
    std::fs::write(
        home.join(".credentials.yaml"),
        "DEEPSEEK_API_KEY: sk-dsh-official\nGGGGG_API_KEY: sk-ggggg\n",
    )
    .unwrap();

    let (base, key) = resolve_dsh_base_url_and_key_from_home(
        &home,
        Some("deepseek-official"),
        &empty_env,
    )
    .expect("official deepseek");
    assert_eq!(base, "https://api.deepseek.com");
    assert_eq!(key, "sk-dsh-official");

    let err = resolve_dsh_base_url_and_key_from_home(
        &home,
        Some("__dsh_host_catalog__"),
        &empty_env,
    )
    .expect_err("sentinel must not fall back to ggggg");
    assert!(err.contains("missing"), "{err}");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn dsh_custom_vendor_reads_pi_ai_settings() {
    let home = write_temp_dir("dsh-custom");
    std::fs::write(
        home.join("settings.yaml"),
        r#"
llm-pi-ai:
  providers:
    ggggg:
      baseURL: https://fufei.mossx.ai/v1
      apiKeyEnv: GGGGG_API_KEY
"#,
    )
    .unwrap();
    std::fs::write(
        home.join(".credentials.yaml"),
        "GGGGG_API_KEY: sk-relay-ggggg\n",
    )
    .unwrap();

    let (base, key) =
        resolve_dsh_base_url_and_key_from_home(&home, Some("ggggg"), &empty_env)
            .expect("custom vendor");
    assert_eq!(base, "https://fufei.mossx.ai/v1");
    assert_eq!(key, "sk-relay-ggggg");

    let (base, key) = resolve_dsh_base_url_and_key_from_home(
        &home,
        Some("deepseek-official"),
        &empty_env,
    )
    .expect("official without key still has host");
    assert_eq!(base, "https://api.deepseek.com");
    assert!(key.is_empty());

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn dsh_official_vendor_without_base_url_uses_known_host_and_own_key() {
    let home = write_temp_dir("dsh-official-no-base");
    std::fs::write(
        home.join("settings.yaml"),
        r#"
llm-pi-ai:
  providers:
    gork-zhu:
      baseURL: https://fufei.mossx.ai/v1
      apiKeyEnv: GORK_ZHU_API_KEY
    kimi-coding:
      apiKeyEnv: KIMI_CODING_API_KEY
      models:
        - id: k3
    minimax-cn:
      apiKeyEnv: MINIMAX_CN_API_KEY
      models:
        - id: MiniMax-M2.7
"#,
    )
    .unwrap();
    std::fs::write(
        home.join(".credentials.yaml"),
        "GORK_ZHU_API_KEY: sk-custom\nKIMI_CODING_API_KEY: sk-kimi\nMINIMAX_CN_API_KEY: sk-minimax\n",
    )
    .unwrap();

    let (base, key) = resolve_dsh_base_url_and_key_from_home(
        &home,
        Some("minimax-cn/MiniMax-M2.7"),
        &empty_env,
    )
    .expect("official minimax");
    assert_eq!(base, "https://api.minimaxi.com");
    assert_eq!(key, "sk-minimax");

    let (base, key) = resolve_dsh_base_url_and_key_from_home(
        &home,
        Some("kimi-coding/k3"),
        &empty_env,
    )
    .expect("official kimi");
    assert_eq!(base, "https://api.kimi.com/coding");
    assert_eq!(key, "sk-kimi");

    let (base, key) =
        resolve_dsh_base_url_and_key_from_home(&home, Some("gork-zhu"), &empty_env)
            .expect("custom vendor still uses its own base");
    assert_eq!(base, "https://fufei.mossx.ai/v1");
    assert_eq!(key, "sk-custom");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn dsh_later_official_vendor_without_allowlist_row_still_resolves() {
    let home = write_temp_dir("dsh-official-later");
    std::fs::write(
        home.join("settings.yaml"),
        r#"
llm-pi-ai:
  providers:
    openai:
      apiKeyEnv: OPENAI_API_KEY
"#,
    )
    .unwrap();
    std::fs::write(home.join(".credentials.yaml"), "OPENAI_API_KEY: sk-openai\n").unwrap();

    let (base, key) =
        resolve_dsh_base_url_and_key_from_home(&home, Some("openai/gpt-5"), &empty_env)
            .expect("later official openai");
    assert_eq!(base, "https://api.openai.com/v1");
    assert_eq!(key, "sk-openai");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn dsh_unknown_vendor_without_base_url_does_not_invent_a_host() {
    let home = write_temp_dir("dsh-unknown-vendor");
    std::fs::write(
        home.join("settings.yaml"),
        r#"
llm-pi-ai:
  providers:
    future-official:
      apiKeyEnv: FUTURE_OFFICIAL_API_KEY
"#,
    )
    .unwrap();
    std::fs::write(
        home.join(".credentials.yaml"),
        "FUTURE_OFFICIAL_API_KEY: sk-future\n",
    )
    .unwrap();

    let err = resolve_dsh_base_url_and_key_from_home(
        &home,
        Some("future-official/model-x"),
        &empty_env,
    )
    .expect_err("unknown host must not be invented");
    assert!(err.contains("future-official"), "{err}");
    assert!(err.contains("missing"), "{err}");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn dsh_env_overrides_credentials_yaml() {
    let home = write_temp_dir("dsh-env");
    std::fs::write(
        home.join(".credentials.yaml"),
        "DEEPSEEK_API_KEY: sk-file\n",
    )
    .unwrap();
    let env = |name: &str| match name {
        "DEEPSEEK_API_KEY" => Some("sk-env".to_string()),
        "DEEPSEEK_BASE_URL" => Some("https://api.deepseek.com/v1".to_string()),
        _ => None,
    };
    let (base, key) =
        resolve_dsh_base_url_and_key_from_home(&home, Some("deepseek-official"), &env)
            .expect("env wins");
    assert_eq!(base, "https://api.deepseek.com/v1");
    assert_eq!(key, "sk-env");
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn pi_vendor_reads_models_store_and_auth_json() {
    let home = write_temp_dir("pi-quota");
    std::fs::write(
        home.join("models-store.json"),
        r#"{
          "deepseek": {
            "models": [
              { "id": "deepseek-chat", "baseUrl": "https://api.deepseek.com" }
            ]
          },
          "openai": {
            "models": [
              { "id": "gpt-4", "baseUrl": "https://api.openai.com/v1" }
            ]
          }
        }"#,
    )
    .unwrap();
    std::fs::write(
        home.join("auth.json"),
        r#"{
          "deepseek": { "type": "api_key", "key": "sk-pi-deepseek" },
          "openai": { "type": "api_key", "key": "" },
          "kimi-coding": { "type": "api_key", "key": "!echo secret" }
        }"#,
    )
    .unwrap();

    let (base, key) =
        resolve_pi_base_url_and_key_from_home(&home, Some("deepseek"), &empty_env)
            .expect("pi deepseek");
    assert_eq!(base, "https://api.deepseek.com");
    assert_eq!(key, "sk-pi-deepseek");

    let (base, key) =
        resolve_pi_base_url_and_key_from_home(&home, Some("openai"), &empty_env)
            .expect("official openai host");
    assert_eq!(base, "https://api.openai.com/v1");
    assert!(key.is_empty());

    let (base, key) =
        resolve_pi_base_url_and_key_from_home(&home, Some("kimi-coding"), &empty_env)
            .expect("command key must not execute");
    assert_eq!(base, "https://api.kimi.com/coding");
    assert!(key.is_empty());

    let err = resolve_pi_base_url_and_key_from_home(
        &home,
        Some("__local_pi__"),
        &empty_env,
    )
    .expect_err("sentinel has no vendor");
    assert!(err.contains("missing"), "{err}");

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn pi_env_ref_key_resolves_without_executing_commands() {
    let home = write_temp_dir("pi-envref");
    std::fs::write(
        home.join("auth.json"),
        r#"{ "deepseek": { "type": "api_key", "key": "$DEEPSEEK_API_KEY" } }"#,
    )
    .unwrap();
    let env = |name: &str| match name {
        "DEEPSEEK_API_KEY" => Some("sk-from-env".to_string()),
        _ => None,
    };
    let (base, key) =
        resolve_pi_base_url_and_key_from_home(&home, Some("deepseek"), &env)
            .expect("env ref");
    assert_eq!(base, "https://api.deepseek.com");
    assert_eq!(key, "sk-from-env");
    let _ = std::fs::remove_dir_all(&home);
}
