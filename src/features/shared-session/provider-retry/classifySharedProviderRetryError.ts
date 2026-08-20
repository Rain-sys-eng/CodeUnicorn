import { classifyNetworkError } from "../../threads/utils/networkErrors";
import { isExplicitTargetUnavailableMessage } from "../runtime/recoveryErrorMap";

export type SharedProviderRetryKind =
  | "pool"
  | "rate"
  | "timeout"
  | "overload"
  | "server"
  | "soft-cancel"
  | "config"
  | "overflow"
  | "permission"
  | "user-stop"
  | "recovery"
  | "unknown";

export type SharedProviderRetryDisposition =
  | "retryable"
  | "permanent"
  | "abort"
  | "ignore";

export type SharedProviderRetryReason =
  | "号池"
  | "请求过多"
  | "超时"
  | "过载"
  | "服务错误"
  | "暂时中断"
  | "配置错误"
  | "上下文过长"
  | "权限拒绝"
  | "已停止";

export type SharedProviderRetryClassification = {
  disposition: SharedProviderRetryDisposition;
  kind: SharedProviderRetryKind;
  reason: SharedProviderRetryReason | null;
};

export type ClassifySharedProviderRetryInput = {
  message?: string | null;
  outcome?: "completed" | "failed" | "cancelled" | null;
  wasLocalInterrupt?: boolean;
  sendState?: string | null;
};

const RECOVERY_SEND_STATES = new Set([
  "recovery-required",
  "target-unavailable",
  "blocked",
]);

function normalizeMessage(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function classifyPermanent(text: string): SharedProviderRetryClassification | null {
  if (
    /unknown model|model not found|missing[- ]?key|missing api key|no api key|api key (?:is )?(?:missing|not (?:set|configured))/.test(
      text,
    ) ||
    isExplicitTargetUnavailableMessage(text)
  ) {
    return { disposition: "permanent", kind: "config", reason: "配置错误" };
  }
  if (/prompt too long|context overflow|context[_ ]length|maximum context/.test(text)) {
    return { disposition: "permanent", kind: "overflow", reason: "上下文过长" };
  }
  if (
    /permission denied/.test(text) &&
    !/retry later|try again/.test(text) &&
    !/\b(?:tool|edit|write|bash|read)\b/.test(text)
  ) {
    return { disposition: "permanent", kind: "permission", reason: "权限拒绝" };
  }
  return null;
}

function hasStatusOrCode(text: string, code: number): boolean {
  const token = String(code);
  return (
    new RegExp(`\\b${token}\\b`).test(text) ||
    new RegExp(`["']code["']\\s*[:=]\\s*["']?${token}\\b`).test(text)
  );
}

function classifyRetryable(text: string): SharedProviderRetryClassification | null {
  if (
    /not assigned to any group/.test(text) ||
    /api key is not assigned/.test(text) ||
    (/failed to authenticate/.test(text) && /403/.test(text)) ||
    hasStatusOrCode(text, 401) ||
    /invalid[_ -]?api[_ -]?key/.test(text)
  ) {
    return { disposition: "retryable", kind: "pool", reason: "号池" };
  }
  if (hasStatusOrCode(text, 405) || hasStatusOrCode(text, 424)) {
    return { disposition: "retryable", kind: "pool", reason: "号池" };
  }
  if (
    hasStatusOrCode(text, 429) ||
    /too many requests/.test(text) ||
    /rate[-_ ]?limit(?:ed|s)?/.test(text)
  ) {
    return { disposition: "retryable", kind: "rate", reason: "请求过多" };
  }
  if (
    classifyNetworkError(text) === "timeout" ||
    /first_packet_timeout:/.test(text) ||
    /deadline exceeded/.test(text) ||
    /no initial response within/.test(text) ||
    /超时/.test(text) ||
    /超時/.test(text)
  ) {
    return { disposition: "retryable", kind: "timeout", reason: "超时" };
  }
  if (
    /overloaded/.test(text) ||
    /(?:at|no|out of|without)\s+capacity/.test(text) ||
    /capacity[- ](?:exceeded|exhausted|limit)/.test(text) ||
    /busy, please retry/.test(text)
  ) {
    return { disposition: "retryable", kind: "overload", reason: "过载" };
  }
  if (
    hasStatusOrCode(text, 502) ||
    /(?:\bhttp(?:\s*status)?(?:\s*code)?[:\s-]*)\b5\d\d\b/.test(text) ||
    (/\b5\d\d\b/.test(text) &&
      /(?:error|status|upstream|gateway|unavailable|bad gateway)/.test(text))
  ) {
    return { disposition: "retryable", kind: "server", reason: "服务错误" };
  }
  if (
    /bad gateway/.test(text) ||
    /service unavailable/.test(text) ||
    (/upstream/.test(text) && /(?:retry|error|fail|unavailable)/.test(text))
  ) {
    return { disposition: "retryable", kind: "server", reason: "服务错误" };
  }
  if (/turn cancell?ed/.test(text)) {
    return { disposition: "retryable", kind: "soft-cancel", reason: "暂时中断" };
  }
  return null;
}

export function classifySharedProviderRetryError(
  input: ClassifySharedProviderRetryInput,
): SharedProviderRetryClassification {
  if (RECOVERY_SEND_STATES.has(input.sendState ?? "")) {
    return { disposition: "ignore", kind: "recovery", reason: null };
  }
  if (input.wasLocalInterrupt) {
    return { disposition: "abort", kind: "user-stop", reason: "已停止" };
  }

  const text = normalizeMessage(input.message);
  const permanent = classifyPermanent(text);
  if (permanent) {
    return permanent;
  }

  const retryable = classifyRetryable(text);
  if (retryable) {
    if (retryable.kind === "soft-cancel" && input.wasLocalInterrupt) {
      return { disposition: "abort", kind: "user-stop", reason: "已停止" };
    }
    return retryable;
  }

  if (/session stopped/.test(text)) {
    return { disposition: "abort", kind: "user-stop", reason: "已停止" };
  }

  if (input.outcome === "completed" && !text) {
    return { disposition: "ignore", kind: "unknown", reason: null };
  }

  return { disposition: "ignore", kind: "unknown", reason: null };
}
