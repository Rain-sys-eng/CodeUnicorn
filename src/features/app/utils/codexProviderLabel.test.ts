import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "../../../types";
import {
  resolveCodexProviderLabel,
  resolveEngineProviderLabel,
} from "./codexProviderLabel";

const codexThread: ThreadSummary = {
  id: "codex:session-1",
  name: "Codex Session",
  updatedAt: 1,
  engineSource: "codex",
};

describe("resolveCodexProviderLabel", () => {
  it("prefers provider name then source label", () => {
    expect(
      resolveCodexProviderLabel({
        ...codexThread,
        providerProfileName: "OpenAI",
        sourceLabel: "custom/openai",
      }),
    ).toBe("OpenAI");
    expect(
      resolveCodexProviderLabel({
        ...codexThread,
        providerProfileName: " ",
        sourceLabel: "custom/openai",
      }),
    ).toBe("custom/openai");
  });

  it("uses managed provider id as fallback and labels disk config as local", () => {
    expect(
      resolveCodexProviderLabel({
        ...codexThread,
        providerProfileId: "provider-a",
      }),
    ).toBe("provider-a");
    expect(
      resolveCodexProviderLabel({
        ...codexThread,
        providerProfileId: "__disk__",
      }),
    ).toBe("local");
    expect(
      resolveCodexProviderLabel({
        ...codexThread,
        providerProfileId: " ",
        providerProfileName: " ",
        sourceLabel: " ",
      }),
    ).toBeNull();
  });

  it.each(["claude", "kimi"] as const)(
    "renders managed provider labels for %s threads",
    (engineSource) => {
      expect(
        resolveEngineProviderLabel({
          ...codexThread,
          engineSource,
          providerProfileId: "provider-a",
          providerProfileName: "Provider A",
        }),
      ).toBe("Provider A");
    },
  );

  it("labels Claude Code local settings as local", () => {
    expect(
      resolveEngineProviderLabel({
        ...codexThread,
        engineSource: "claude",
        providerProfileId: "__local_settings_json__",
        providerProfileName: "Local config",
      }),
    ).toBe("local");
  });

  it.each(["kimi", "grok", "opencode", "pi", "dsh", "qoder"] as const)(
    "labels %s local config as local",
    (engineSource) => {
      expect(
        resolveEngineProviderLabel({
          ...codexThread,
          engineSource,
          providerProfileId:
            engineSource === "opencode"
              ? "__local_opencode_json__"
              : engineSource === "pi"
                ? "__local_pi__"
                : engineSource === "dsh"
                  ? "__dsh_host_catalog__"
                  : engineSource === "qoder"
                    ? "__local_qoder__"
                    : "__local_config_toml__",
          providerProfileName: "Local config",
        }),
      ).toBe("local");
    },
  );

  it("falls back to local for PI / DSH / Grok rows with no binding", () => {
    expect(
      resolveEngineProviderLabel({
        ...codexThread,
        engineSource: "pi",
      }),
    ).toBe("local");
    expect(
      resolveEngineProviderLabel({
        ...codexThread,
        engineSource: "dsh",
      }),
    ).toBe("local");
    expect(
      resolveEngineProviderLabel({
        ...codexThread,
        engineSource: "grok",
      }),
    ).toBe("local");
  });

  it("renders managed provider labels for PI / DSH / Gemini", () => {
    expect(
      resolveEngineProviderLabel({
        ...codexThread,
        engineSource: "pi",
        providerProfileId: "pi-provider-a",
        providerProfileName: "PI A",
      }),
    ).toBe("PI A");
    expect(
      resolveEngineProviderLabel({
        ...codexThread,
        engineSource: "dsh",
        providerProfileId: "dsh-provider-a",
        providerProfileName: "DSH A",
      }),
    ).toBe("DSH A");
    expect(
      resolveEngineProviderLabel({
        ...codexThread,
        engineSource: "gemini",
        providerProfileId: "gemini-provider-a",
        providerProfileName: "Gemini A",
      }),
    ).toBe("Gemini A");
  });
});
