export const SHARED_PROVIDER_RETRY_DEFAULT_RESUME_PROMPT =
  "继续。上一轮因供应商暂时失败中断，请从已完成进度接着做，不要重复已完成的步骤。";

export const SHARED_PROVIDER_RETRY_FALLBACK_RESUME_PROMPT = "继续";

export type SharedProviderRetryBackoff = "exponential" | "fixed";

export type SharedProviderRetrySettings = {
  enabled: boolean;
  maxAttempts: number;
  baseDelaySec: number;
  maxDelaySec: number;
  backoff: SharedProviderRetryBackoff;
  resumePrompt: string;
};

export const SHARED_PROVIDER_RETRY_DEFAULTS: SharedProviderRetrySettings = {
  enabled: true,
  maxAttempts: 3,
  baseDelaySec: 3,
  maxDelaySec: 20,
  backoff: "exponential",
  resumePrompt: SHARED_PROVIDER_RETRY_DEFAULT_RESUME_PROMPT,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

export function clampSharedProviderRetrySettings(
  patch: Partial<SharedProviderRetrySettings> | null | undefined,
  base: SharedProviderRetrySettings = SHARED_PROVIDER_RETRY_DEFAULTS,
): SharedProviderRetrySettings {
  const backoff =
    patch?.backoff === "fixed" || patch?.backoff === "exponential"
      ? patch.backoff
      : base.backoff;
  const resumePrompt =
    typeof patch?.resumePrompt === "string" ? patch.resumePrompt : base.resumePrompt;
  return {
    enabled: typeof patch?.enabled === "boolean" ? patch.enabled : base.enabled,
    maxAttempts: clampInt(patch?.maxAttempts, 0, 10, base.maxAttempts),
    baseDelaySec: clampInt(patch?.baseDelaySec, 1, 1200, base.baseDelaySec),
    maxDelaySec: clampInt(patch?.maxDelaySec, 1, 1200, base.maxDelaySec),
    backoff,
    resumePrompt,
  };
}

export function resolveSharedProviderRetryResumePrompt(prompt: string | null | undefined): string {
  const trimmed = prompt?.trim() ?? "";
  return trimmed.length > 0
    ? trimmed
    : SHARED_PROVIDER_RETRY_FALLBACK_RESUME_PROMPT;
}

export function resolveSharedProviderRetryDelaySec(
  settings: SharedProviderRetrySettings,
  attempt: number,
): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  if (settings.backoff === "fixed") {
    return Math.min(settings.baseDelaySec, settings.maxDelaySec);
  }
  return Math.min(
    settings.baseDelaySec * 2 ** (safeAttempt - 1),
    settings.maxDelaySec,
  );
}

export function isSharedProviderRetryAutoSendEnabled(
  settings: SharedProviderRetrySettings,
): boolean {
  return settings.enabled && settings.maxAttempts > 0;
}
