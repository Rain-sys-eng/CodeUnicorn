import { describe, expect, it } from "vitest";

import { classifySharedProviderRetryError } from "./classifySharedProviderRetryError";

function classify(message: string, extra: {
  wasLocalInterrupt?: boolean;
  sendState?: string;
} = {}) {
  return classifySharedProviderRetryError({
    message,
    outcome: "failed",
    ...extra,
  });
}

describe("classifier collision: intended hits", () => {
  it.each([
    [
      "newapi pool 403",
      "Failed to authenticate. API Error: 403 API Key is not assigned to any group and cannot be used.",
      "pool",
    ],
    [
      "zh wrap around pool 403",
      "会话失败：Failed to authenticate. API Error: 403 API Key is not assigned to any group and cannot be used.",
      "pool",
    ],
    ["429", "API Error: 429 Too Many Requests", "rate"],
    ["zh timeout hint", "请求在收到响应前已超时。可能是网络抖动或上游服务繁忙导致，请稍后重试。", "timeout"],
    [
      "FIRST_PACKET_TIMEOUT prefix",
      "FIRST_PACKET_TIMEOUT:30:Timed out waiting for initial response. Please retry.",
      "timeout",
    ],
    ["claude overloaded", "API Error: provider overloaded", "overload"],
    ["upstream overloaded", "Upstream overloaded", "overload"],
    ["502", "502 bad gateway", "server"],
    ["soft cancel", "Turn cancelled", "soft-cancel"],
    ["zh wrap soft cancel", "会话失败：Turn cancelled", "soft-cancel"],
    ["HTTP 500 prose", "upstream returned HTTP 500", "server"],
  ] as const)("%s → %s", (_name, message, kind) => {
    expect(classify(message, { wasLocalInterrupt: false })).toMatchObject({
      disposition: "retryable",
      kind,
    });
  });

  it("keeps permanent / abort / recovery closed", () => {
    expect(classify("unknown model 'gpt-5.6-sol'")).toMatchObject({
      disposition: "permanent",
      kind: "config",
    });
    expect(classify("prompt too long")).toMatchObject({
      disposition: "permanent",
      kind: "overflow",
    });
    expect(classify("permission denied")).toMatchObject({
      disposition: "permanent",
      kind: "permission",
    });
    expect(
      classify("Turn cancelled: Session stopped.", { wasLocalInterrupt: true }),
    ).toMatchObject({ disposition: "abort", kind: "user-stop" });
    expect(
      classify("API Key is not assigned to any group", {
        sendState: "recovery-required",
      }),
    ).toMatchObject({ disposition: "ignore", kind: "recovery" });
  });
});

describe("classifier collision: known misses", () => {
  it("still fails closed when Claude only says provider request failed", () => {
    expect(classify("provider request failed")).toMatchObject({
      disposition: "ignore",
      kind: "unknown",
    });
    expect(classify("API Error: All providers unavailable")).toMatchObject({
      disposition: "ignore",
      kind: "unknown",
    });
  });

  it("does not treat bare 403 / invalid key / local network as retryable", () => {
    expect(classify("API Error: 403 Forbidden").disposition).toBe("ignore");
    expect(classify("invalid api key").disposition).toBe("ignore");
    expect(classify("connection refused").disposition).toBe("ignore");
    expect(classify("tls handshake failed").disposition).toBe("ignore");
    expect(classify("getaddrinfo ENOTFOUND api.anthropic.com").disposition).toBe(
      "ignore",
    );
    expect(classify("407 Proxy Authentication Required").disposition).toBe(
      "ignore",
    );
  });
});

describe("classifier collision: tightened false positives", () => {
  it("english first-packet copy is timeout, not server", () => {
    expect(
      classify(
        "No initial response within 30s. Network, proxy, or upstream service load may be causing delay. Please retry.",
      ),
    ).toMatchObject({ disposition: "retryable", kind: "timeout" });
  });

  it("bare capacity / filename 5xx / tool permission stay closed", () => {
    expect(classify("Waiting for CLI window capacity")).toMatchObject({
      disposition: "ignore",
      kind: "unknown",
    });
    expect(
      classify("Increase cluster capacity before retrying the deploy"),
    ).toMatchObject({ disposition: "ignore", kind: "unknown" });
    expect(classify("failed to read /tmp/job-503.log")).toMatchObject({
      disposition: "ignore",
      kind: "unknown",
    });
    expect(classify("Edit tool permission denied")).toMatchObject({
      disposition: "ignore",
      kind: "unknown",
    });
  });

  it("still retries underscored rate_limited and at-capacity overload", () => {
    expect(classify("rate_limited")).toMatchObject({
      disposition: "retryable",
      kind: "rate",
    });
    expect(classify("provider request failed: rate_limited")).toMatchObject({
      disposition: "retryable",
      kind: "rate",
    });
    expect(classify("upstream at capacity, please retry later")).toMatchObject({
      disposition: "retryable",
      kind: "overload",
    });
  });
});
