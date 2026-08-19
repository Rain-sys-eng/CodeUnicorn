import { describe, expect, it, beforeEach } from "vitest";

import { SHARED_PROVIDER_RETRY_DEFAULTS } from "./providerRetryPolicy";
import {
  getSharedProviderRetrySettings,
  resetSharedProviderRetrySettingsStoreForTests,
  setSharedProviderRetrySettings,
} from "./providerRetrySettingsStore";

describe("providerRetrySettingsStore", () => {
  beforeEach(() => {
    resetSharedProviderRetrySettingsStoreForTests();
  });

  it("keeps Claude and Codex overrides on the same session independent", () => {
    setSharedProviderRetrySettings("ws", "shared:a", "claude", { maxAttempts: 5 });
    expect(getSharedProviderRetrySettings("ws", "shared:a", "codex")).toEqual(
      SHARED_PROVIDER_RETRY_DEFAULTS,
    );
    expect(getSharedProviderRetrySettings("ws", "shared:a", "claude").maxAttempts).toBe(5);
  });

  it("does not leak one session override into another", () => {
    setSharedProviderRetrySettings("ws", "shared:a", "codex", {
      resumePrompt: "接着做",
    });
    expect(getSharedProviderRetrySettings("ws", "shared:b", "codex")).toEqual(
      SHARED_PROVIDER_RETRY_DEFAULTS,
    );
  });
});
