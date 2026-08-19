// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
} from "../threads/constants/codexProviderProfiles";
import {
  forgetDeletedLastProviderProfile,
  readLastProviderProfileId,
  writeLastProviderProfileId,
} from "./lastProviderProfileMemory";

describe("forgetDeletedLastProviderProfile", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("falls back to the local Claude profile when the remembered id was deleted", () => {
    writeLastProviderProfileId("claude", "dead-provider");

    expect(forgetDeletedLastProviderProfile("claude", "dead-provider")).toBe(
      true,
    );
    expect(readLastProviderProfileId("claude")).toBe(
      CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
    );
  });

  it("leaves a different remembered provider untouched", () => {
    writeLastProviderProfileId("kimi", "still-alive");

    expect(forgetDeletedLastProviderProfile("kimi", "deleted")).toBe(false);
    expect(readLastProviderProfileId("kimi")).toBe("still-alive");
  });

  it("ignores empty deleted ids", () => {
    writeLastProviderProfileId("claude", "dead-provider");

    expect(forgetDeletedLastProviderProfile("claude", "   ")).toBe(false);
    expect(readLastProviderProfileId("claude")).toBe("dead-provider");
  });

  it("falls back to the local Kimi profile for the matching engine only", () => {
    writeLastProviderProfileId("claude", "shared-id");
    writeLastProviderProfileId("kimi", "shared-id");

    expect(forgetDeletedLastProviderProfile("kimi", "shared-id")).toBe(true);
    expect(readLastProviderProfileId("kimi")).toBe(KIMI_LOCAL_PROVIDER_PROFILE_ID);
    expect(readLastProviderProfileId("claude")).toBe("shared-id");
  });
});
