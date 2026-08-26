import { describe, expect, it } from "vitest";

import {
  clampSharedProviderRetrySettings,
  isSharedProviderRetryAutoSendEnabled,
  resolveSharedProviderRetryDelaySec,
  resolveSharedProviderRetryResumePrompt,
  SHARED_PROVIDER_RETRY_DEFAULTS,
  SHARED_PROVIDER_RETRY_FALLBACK_RESUME_PROMPT,
} from "./providerRetryPolicy";

describe("providerRetryPolicy", () => {
  it("clamps out-of-range fields back into the published bounds", () => {
    expect(
      clampSharedProviderRetrySettings({
        maxAttempts: 5000,
        baseDelaySec: 0,
        maxDelaySec: 4000,
        backoff: "linear" as never,
        resumePrompt: undefined,
      }),
    ).toEqual({
      ...SHARED_PROVIDER_RETRY_DEFAULTS,
      maxAttempts: 999,
      baseDelaySec: 1,
      maxDelaySec: 1200,
    });
  });

  it("uses exponential 3 / 6 / 12 capped at 20", () => {
    const settings = SHARED_PROVIDER_RETRY_DEFAULTS;
    expect(resolveSharedProviderRetryDelaySec(settings, 1)).toBe(3);
    expect(resolveSharedProviderRetryDelaySec(settings, 2)).toBe(6);
    expect(resolveSharedProviderRetryDelaySec(settings, 3)).toBe(12);
    expect(resolveSharedProviderRetryDelaySec(settings, 4)).toBe(20);
  });

  it("keeps a fixed interval at the base delay", () => {
    expect(
      resolveSharedProviderRetryDelaySec(
        { ...SHARED_PROVIDER_RETRY_DEFAULTS, backoff: "fixed", baseDelaySec: 5 },
        3,
      ),
    ).toBe(5);
  });

  it("falls back to 继续 when the resume prompt is blank", () => {
    expect(resolveSharedProviderRetryResumePrompt("   ")).toBe(
      SHARED_PROVIDER_RETRY_FALLBACK_RESUME_PROMPT,
    );
  });

  it("treats maxAttempts 0 as auto-send off", () => {
    expect(
      isSharedProviderRetryAutoSendEnabled({
        ...SHARED_PROVIDER_RETRY_DEFAULTS,
        maxAttempts: 0,
      }),
    ).toBe(false);
  });
});
