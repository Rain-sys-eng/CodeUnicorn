// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  codingPlanVendorFromModelOrProfile,
  isCodingPlanHostCatalogSentinel,
  resolveCodingPlanQuotaVendorId,
} from "./codingPlanQuotaVendor";

describe("codingPlanQuotaVendor", () => {
  it("treats mossx host catalog sentinels as no vendor", () => {
    expect(isCodingPlanHostCatalogSentinel("__dsh_host_catalog__")).toBe(true);
    expect(isCodingPlanHostCatalogSentinel("__local_pi__")).toBe(true);
    expect(isCodingPlanHostCatalogSentinel("deepseek-official")).toBe(false);
    expect(codingPlanVendorFromModelOrProfile("__dsh_host_catalog__")).toBeNull();
    expect(codingPlanVendorFromModelOrProfile("__local_pi__")).toBeNull();
  });

  it("takes the first provider/model segment", () => {
    expect(
      codingPlanVendorFromModelOrProfile("deepseek-official/deepseek-v4-flash"),
    ).toBe("deepseek-official");
    expect(codingPlanVendorFromModelOrProfile("deepseek/deepseek-chat")).toBe(
      "deepseek",
    );
    expect(
      codingPlanVendorFromModelOrProfile("vision-http/ovh/Qwen2.5"),
    ).toBe("vision-http");
  });

  it("does not treat Qoder Native as a coding-plan vendor", () => {
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "qoder",
        providerProfileId: "__local_qoder__",
        selectedModel: "qoder/qwen3-coder",
      }),
    ).toBeNull();
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "qoder",
        providerProfileId: null,
        selectedModel: null,
      }),
    ).toBeNull();
  });

  it("does not treat a bare model name as a vendor", () => {
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "pi",
        providerProfileId: null,
        selectedModel: "composer-2",
      }),
    ).toBeNull();
  });

  it("extracts dsh vendor from selected model, not the host catalog sentinel", () => {
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "dsh",
        providerProfileId: "__dsh_host_catalog__",
        selectedModel: "deepseek-official/deepseek-v4-flash",
      }),
    ).toBe("deepseek-official");
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "dsh",
        providerProfileId: "__dsh_host_catalog__",
        selectedModel: "minimax-cn/MiniMax-M2.7",
      }),
    ).toBe("minimax-cn");
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "dsh",
        providerProfileId: "__dsh_host_catalog__",
        selectedModel: "kimi-coding/k3",
      }),
    ).toBe("kimi-coding");
  });

  it("does not fall back to another dsh vendor when model is missing", () => {
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "dsh",
        providerProfileId: "__dsh_host_catalog__",
        selectedModel: "",
      }),
    ).toBeNull();
  });

  it("extracts pi vendor from selected model", () => {
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "pi",
        providerProfileId: "__local_pi__",
        selectedModel: "kimi-coding/k2",
      }),
    ).toBe("kimi-coding");
  });

  it("passes through claude/codex profile ids unchanged", () => {
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "claude",
        providerProfileId: "provider-minimax",
        selectedModel: "MiniMax-M3",
      }),
    ).toBe("provider-minimax");
    expect(
      resolveCodingPlanQuotaVendorId({
        engine: "codex",
        providerProfileId: "__disk__",
        selectedModel: "gpt-5.5",
      }),
    ).toBe("__disk__");
  });
});
