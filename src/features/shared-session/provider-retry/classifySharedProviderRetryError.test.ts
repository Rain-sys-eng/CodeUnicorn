import { describe, expect, it } from "vitest";

import { classifySharedProviderRetryError } from "./classifySharedProviderRetryError";

describe("classifySharedProviderRetryError", () => {
  it("retries pool 403, 429, timeout, overload, and 5xx", () => {
    expect(
      classifySharedProviderRetryError({
        message:
          "Failed to authenticate. API Error: 403 API Key is not assigned to any group and cannot be used.",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool", reason: "号池" });
    expect(
      classifySharedProviderRetryError({
        message: "API Error: 429 Too Many Requests",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "rate" });
    expect(
      classifySharedProviderRetryError({
        message: "请求在收到响应前已超时。可能是网络抖动或上游服务繁忙导致，请稍后重试。",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "timeout" });
    expect(
      classifySharedProviderRetryError({
        message: "upstream overloaded, please retry later",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "overload" });
    expect(
      classifySharedProviderRetryError({
        message: "502 bad gateway",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "server" });
    expect(
      classifySharedProviderRetryError({
        message: "provider request failed: rate_limited",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "rate" });
    expect(
      classifySharedProviderRetryError({
        message:
          "No initial response within 30s. Network, proxy, or upstream service load may be causing delay. Please retry.",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "timeout" });
    expect(
      classifySharedProviderRetryError({
        message:
          '会话失败：unexpected status 401 Unauthorized: {"code":"INVALID_API_KEY","message":"Invalid API key"}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool", reason: "号池" });
    expect(
      classifySharedProviderRetryError({
        message: '会话失败：unexpected status 405: {"code":"405"}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool", reason: "号池" });
    expect(
      classifySharedProviderRetryError({
        message: '{"code":"424","message":"Failed Dependency"}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool", reason: "号池" });
    expect(
      classifySharedProviderRetryError({
        message: '{"code":429}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "rate" });
    expect(
      classifySharedProviderRetryError({
        message: '{"code":"502"}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "server" });
    // Cloudflare 524（Proxy Read Timeout）显式白名单：
    // 完整 JSON body 命中 timeout 分支；裸 code/status 由 524 规则兜底。
    expect(
      classifySharedProviderRetryError({
        message:
          'API Error: 524 {"type":"https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/","title":"Error 524: A timeout occurred","status":524,"detail":"The upstream server did not respond within the 120-second Proxy Read Timeout.","instance":"0000000000000000"}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "timeout", reason: "超时" });
    expect(
      classifySharedProviderRetryError({
        message: '{"code":524}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "server" });
    expect(
      classifySharedProviderRetryError({
        message: '{"status":524}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "server" });
    // 扩展状态码白名单：relay/网关可愈的 4xx 与纯 JSON body 的 5xx。
    expect(
      classifySharedProviderRetryError({
        message: '{"code":402}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool", reason: "号池" });
    expect(
      classifySharedProviderRetryError({
        message: '{"code":404,"message":"no available channel"}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool", reason: "号池" });
    expect(
      classifySharedProviderRetryError({
        message: "API Error: 408 Request Timeout",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "timeout", reason: "超时" });
    expect(
      classifySharedProviderRetryError({
        message: '{"code":409}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "soft-cancel", reason: "暂时中断" });
    expect(
      classifySharedProviderRetryError({
        message: "425 Too Early",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "soft-cancel" });
    expect(
      classifySharedProviderRetryError({
        message: 'API Error: 400 {"error":{"message":"bad request"}}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "soft-cancel" });
    expect(
      classifySharedProviderRetryError({
        message: '{"code":503}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "server" });
    expect(
      classifySharedProviderRetryError({
        message: '{"status":500}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "server" });
    expect(
      classifySharedProviderRetryError({
        message:
          "会话失败：Claude exited with status: exit code: 1. Diagnostics: input_format=stream-json, include_hook_events=true, permission_mode=full-access. No stdout/stderr diagnostics were observed.",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "soft-cancel", reason: "暂时中断" });
    expect(
      classifySharedProviderRetryError({
        message: "Kimi exited with status: exit status: 1",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "soft-cancel" });
  });

  it("does not treat tool permission, window capacity, or filename 5xx as retryable", () => {
    expect(
      classifySharedProviderRetryError({
        message: "Edit tool permission denied",
      }),
    ).toMatchObject({ disposition: "ignore", kind: "unknown" });
    expect(
      classifySharedProviderRetryError({
        message: "Waiting for CLI window capacity",
      }),
    ).toMatchObject({ disposition: "ignore", kind: "unknown" });
    expect(
      classifySharedProviderRetryError({
        message: "failed to read /tmp/job-503.log",
      }),
    ).toMatchObject({ disposition: "ignore", kind: "unknown" });
  });

  it("treats payload-size status codes as permanent overflow", () => {
    expect(
      classifySharedProviderRetryError({
        message: '{"code":413}',
      }),
    ).toMatchObject({ disposition: "permanent", kind: "overflow", reason: "上下文过长" });
    expect(
      classifySharedProviderRetryError({
        message: "API Error: 431 Request Header Fields Too Large",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "overflow" });
    // 402 带余额关键词仍由 quota permanent 优先拦截，不进 pool 空转。
    expect(
      classifySharedProviderRetryError({
        message: '{"code":402,"message":"insufficient balance"}',
      }),
    ).toMatchObject({ disposition: "permanent", kind: "quota", reason: "配额不足" });
  });

  it("retries a bare Turn cancelled only when the user did not stop", () => {
    expect(
      classifySharedProviderRetryError({
        message: "Turn cancelled",
        wasLocalInterrupt: false,
      }),
    ).toMatchObject({ disposition: "retryable", kind: "soft-cancel" });
    expect(
      classifySharedProviderRetryError({
        message: "Turn cancelled: Session stopped.",
        wasLocalInterrupt: true,
      }),
    ).toMatchObject({ disposition: "abort", kind: "user-stop" });
    expect(
      classifySharedProviderRetryError({
        message:
          "Claude exited with status: exit code: 1. Diagnostics: input_format=stream-json, include_hook_events=true, permission_mode=full-access. No stdout/stderr diagnostics were observed.",
        wasLocalInterrupt: true,
      }),
    ).toMatchObject({ disposition: "abort", kind: "user-stop" });
  });

  it("does not auto-retry config, overflow, or recovery states", () => {
    expect(
      classifySharedProviderRetryError({
        message:
          "invalid_request_error: Item 'msg_1' of type 'message' was provided without its required reasoning item: 'rs_1'",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "config" });
    expect(
      classifySharedProviderRetryError({
        message: "unknown model 'claude-opus-5'",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "config" });
    expect(
      classifySharedProviderRetryError({
        message: "prompt too long",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "overflow" });
    expect(
      classifySharedProviderRetryError({
        message: "API Key is not assigned to any group",
        sendState: "recovery-required",
      }),
    ).toMatchObject({ disposition: "ignore", kind: "recovery" });
  });

  it("classifies quota-insufficiency as permanent before pool rules", () => {
    // yuzu 实例：预扣费 403 必须判 permanent，不能进 pool retryable 空转烧余额
    expect(
      classifySharedProviderRetryError({
        message:
          "Failed to authenticate. API Error: 403 预扣费额度失败, 用户剩余额度: ＄0.378004, 需要预扣费额度: ＄0.800000 (request id: abc)",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "quota", reason: "配额不足" });
    expect(
      classifySharedProviderRetryError({
        message: "API Error: 403 insufficient balance for this request",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "quota" });
    expect(
      classifySharedProviderRetryError({
        message: "user quota exceeded, please top up",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "quota" });
    expect(
      classifySharedProviderRetryError({
        message: "余额不足，请充值后重试",
      }),
    ).toMatchObject({ disposition: "permanent", kind: "quota" });
    // 反例：无配额关键词的 401 / bare 403 仍走 pool retryable
    expect(
      classifySharedProviderRetryError({
        message:
          '会话失败：unexpected status 401 Unauthorized: {"code":"INVALID_API_KEY","message":"Invalid API key"}',
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool" });
    expect(
      classifySharedProviderRetryError({
        message: "Failed to authenticate. API Error: 403",
      }),
    ).toMatchObject({ disposition: "retryable", kind: "pool" });
  });

  it("fails closed on unrecognized errors", () => {
    expect(
      classifySharedProviderRetryError({
        message: "something completely unexpected exploded",
        outcome: "failed",
      }),
    ).toMatchObject({ disposition: "ignore", kind: "unknown" });
  });
});
