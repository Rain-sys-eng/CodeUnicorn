import { describe, expect, it } from "vitest";
import {
  formatDshModelDisplayLabel,
  groupDshModelsByVendor,
  isSlashCatalogEngine,
  resolveDshVendorSectionLabel,
} from "./dshModelDisplayLabel";

describe("formatDshModelDisplayLabel", () => {
  it("shows the runtime model when the catalog label still has a provider prefix", () => {
    expect(
      formatDshModelDisplayLabel({
        id: "deepseek/DeepSeek-V4-Flash",
        model: "DeepSeek-V4-Flash",
        label: "DeepSeek / DeepSeek-V4-Flash",
      }),
    ).toBe("DeepSeek-V4-Flash");
    expect(
      formatDshModelDisplayLabel({
        id: "grok-4.6/Grok 4.5",
        model: "Grok 4.5",
        label: "grok-4.6 / Grok 4.5",
      }),
    ).toBe("Grok 4.5");
  });

  it("keeps only the last path segment of routed model ids", () => {
    expect(
      formatDshModelDisplayLabel({
        id: "vision-http/ovh/Qwen2.5-VL-72B-Instruct",
        model: "ovh/Qwen2.5-VL-72B-Instruct",
        label: "Vision HTTP / ovh/Qwen2.5-VL-72B-Instruct",
      }),
    ).toBe("Qwen2.5-VL-72B-Instruct");
  });

  it("falls back from composite label or catalog id when runtime is missing", () => {
    expect(
      formatDshModelDisplayLabel({
        id: "deepseek/DeepSeek-V4-Pro",
        label: "DeepSeek / DeepSeek-V4-Pro",
      }),
    ).toBe("DeepSeek-V4-Pro");
    expect(
      formatDshModelDisplayLabel({
        id: "grok-4.6/Grok 4.6",
      }),
    ).toBe("Grok 4.6");
  });

  it("keeps the provider on the closed trigger so native CLI names cannot collide", () => {
    expect(
      formatDshModelDisplayLabel(
        {
          id: "ggggg/grok-4.6",
          model: "grok-4.6",
        },
        { closed: true },
      ),
    ).toBe("ggggg / grok-4.6");
    expect(
      formatDshModelDisplayLabel(
        {
          id: "acme/claude-sonnet-4-6",
          model: "claude-sonnet-4-6",
        },
        { closed: true },
      ),
    ).toBe("acme / claude-sonnet-4-6");
    expect(
      formatDshModelDisplayLabel(
        {
          id: "vision-http/ovh/Qwen2.5-VL-72B-Instruct",
          model: "ovh/Qwen2.5-VL-72B-Instruct",
        },
        { closed: true },
      ),
    ).toBe("vision-http / Qwen2.5-VL-72B-Instruct");
  });

  it("does not prefix a provider when the catalog id has no slash", () => {
    expect(
      formatDshModelDisplayLabel({ id: "grok-4.6" }, { closed: true }),
    ).toBe("grok-4.6");
  });

  it("keeps the middle path on colliding rows (PI custom providers)", () => {
    // cpa 自定义供应商下 cline / fb2api 两个上游的同名模型
    expect(
      formatDshModelDisplayLabel(
        {
          id: "cpa/cline/deepseek-v4-flash-0731",
          label: "cline/deepseek-v4-flash-0731",
        },
        { disambiguate: true },
      ),
    ).toBe("cline/deepseek-v4-flash-0731");
    // 两段 id 去掉首段没有新增信息时,保留完整 catalog id
    expect(
      formatDshModelDisplayLabel(
        { id: "fb2api/deepseek-v4-flash-0731" },
        { disambiguate: true },
      ),
    ).toBe("fb2api/deepseek-v4-flash-0731");
    // 无斜杠 id 没有更多信息可展示
    expect(
      formatDshModelDisplayLabel({ id: "grok-4.6" }, { disambiguate: true }),
    ).toBe("grok-4.6");
    // 不带 disambiguate 时保持 last-segment 简洁展示
    expect(
      formatDshModelDisplayLabel({ id: "cpa/cline/deepseek-v4-flash-0731" }),
    ).toBe("deepseek-v4-flash-0731");
    // closed trigger 不受 disambiguate 影响
    expect(
      formatDshModelDisplayLabel(
        { id: "cpa/cline/deepseek-v4-flash-0731" },
        { closed: true, disambiguate: true },
      ),
    ).toBe("cpa / deepseek-v4-flash-0731");
  });
});

describe("groupDshModelsByVendor", () => {
  it("keeps host catalog order and uses group.name from the flattened label", () => {
    const sections = groupDshModelsByVendor([
      {
        id: "deepseek-official/deepseek-v4-flash",
        model: "deepseek-v4-flash",
        label: "DeepSeek / DeepSeek-V4-Flash",
        provider: "deepseek-official",
      },
      {
        id: "deepseek-official/deepseek-v4-pro",
        model: "deepseek-v4-pro",
        label: "DeepSeek / DeepSeek-V4-Pro",
        provider: "deepseek-official",
      },
      {
        id: "gork-zhu/grok-4.6",
        model: "grok-4.6",
        label: "gork-zhu / Grok 4.6",
        provider: "gork-zhu",
      },
      {
        id: "kimi-coding/k3",
        model: "k3",
        label: "kimi-coding / Kimi K3",
        provider: "kimi-coding",
      },
      {
        id: "minimax-cn/MiniMax-M2.7",
        model: "MiniMax-M2.7",
        label: "minimax-cn / MiniMax-M2.7",
        provider: "minimax-cn",
      },
      {
        id: "mmm3/MiniMax-M3",
        model: "MiniMax-M3",
        label: "mmm3 / MiniMax-M3",
        provider: "mmm3",
      },
    ]);

    expect(sections.map((section) => section.label)).toEqual([
      "DeepSeek",
      "gork-zhu",
      "kimi-coding",
      "minimax-cn",
      "mmm3",
    ]);
    expect(sections[0]?.models.map((model) => model.id)).toEqual([
      "deepseek-official/deepseek-v4-flash",
      "deepseek-official/deepseek-v4-pro",
    ]);
  });

  it("falls back to provider id, then the catalog id prefix", () => {
    expect(
      resolveDshVendorSectionLabel({
        id: "gork-zhu/grok-4.6",
        label: "Grok 4.6",
        provider: "gork-zhu",
      }),
    ).toBe("gork-zhu");
    expect(
      resolveDshVendorSectionLabel({
        id: "kimi-coding/k3",
        label: "Kimi K3",
      }),
    ).toBe("kimi-coding");
  });

  it("groups PI list-models rows by provider without inventing DSH display names", () => {
    const sections = groupDshModelsByVendor([
      {
        id: "deepseek/deepseek-v4-flash",
        label: "deepseek/deepseek-v4-flash",
        provider: "deepseek",
      },
      {
        id: "deepseek/deepseek-v4-pro",
        label: "deepseek/deepseek-v4-pro",
        provider: "deepseek",
      },
      {
        id: "kimi-coding/k3",
        label: "kimi-coding/k3",
        provider: "kimi-coding",
      },
      {
        id: "kimi-coding/k3-256k",
        label: "kimi-coding/k3-256k",
        provider: "kimi-coding",
      },
      {
        id: "minimax-cn/MiniMax-M2.7",
        label: "minimax-cn/MiniMax-M2.7",
        provider: "minimax-cn",
      },
      {
        id: "auto",
        label: "PI Auto",
        provider: "pi",
      },
    ]);

    expect(sections.map((section) => ({ key: section.key, label: section.label }))).toEqual([
      { key: "deepseek", label: "deepseek" },
      { key: "kimi-coding", label: "kimi-coding" },
      { key: "minimax-cn", label: "minimax-cn" },
      { key: "pi", label: "pi" },
    ]);
    expect(sections[0]?.models.map((model) => model.id)).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ]);
    expect(formatDshModelDisplayLabel(sections[1]!.models[0]!)).toBe("k3");
    expect(
      formatDshModelDisplayLabel(sections[1]!.models[0]!, { closed: true }),
    ).toBe("kimi-coding / k3");
    expect(formatDshModelDisplayLabel({ id: "auto", label: "PI Auto" })).toBe(
      "PI Auto",
    );
    expect(
      formatDshModelDisplayLabel({ id: "auto", label: "PI Auto" }, { closed: true }),
    ).toBe("PI Auto");
  });
});

describe("isSlashCatalogEngine", () => {
  it("only opens DSH and PI grouping", () => {
    expect(isSlashCatalogEngine("dsh")).toBe(true);
    expect(isSlashCatalogEngine("pi")).toBe(true);
    expect(isSlashCatalogEngine("claude")).toBe(false);
    expect(isSlashCatalogEngine("codex")).toBe(false);
    expect(isSlashCatalogEngine("kimi")).toBe(false);
    expect(isSlashCatalogEngine("grok")).toBe(false);
    expect(isSlashCatalogEngine(null)).toBe(false);
  });
});
