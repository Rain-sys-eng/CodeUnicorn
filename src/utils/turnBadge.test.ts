import { describe, expect, it } from "vitest";
import {
  buildRuntimeReceiptPanelRows,
  buildTurnTargetBadgeKey,
  buildTurnTargetBadgeVisibleItemIds,
  formatRuntimeReceiptWindowLabel,
  resolveTurnRuntimeReceipt,
  sanitizeRuntimeReceiptModel,
  type TurnBadgeSnapshot,
} from "./turnBadge";

function assistant(
  id: string,
  snapshot: TurnBadgeSnapshot | null,
) {
  return {
    id,
    kind: "message" as const,
    role: "assistant" as const,
    executionTargetSnapshot: snapshot,
  };
}

function user(id: string) {
  return {
    id,
    kind: "message" as const,
    role: "user" as const,
  };
}

const grokLocal: TurnBadgeSnapshot = {
  engine: "grok",
  providerProfileId: null,
  providerProfileNameSnapshot: "本地配置",
  providerProfileSource: "local",
  model: "grok",
};

const claudeA: TurnBadgeSnapshot = {
  engine: "claude",
  providerProfileId: "provider-a",
  providerProfileNameSnapshot: "Provider A",
  providerProfileSource: "managed",
  model: "sonnet-a",
  reasoning: { effort: "high" },
};

const claudeB: TurnBadgeSnapshot = {
  engine: "claude",
  providerProfileId: "provider-b",
  providerProfileNameSnapshot: "Provider B",
  providerProfileSource: "managed",
  model: "sonnet-b",
};

describe("buildTurnTargetBadgeKey", () => {
  it("stable for identical identity fields", () => {
    expect(buildTurnTargetBadgeKey(grokLocal)).toBe(
      buildTurnTargetBadgeKey({ ...grokLocal }),
    );
  });

  it("differs when model changes", () => {
    expect(buildTurnTargetBadgeKey(grokLocal)).not.toBe(
      buildTurnTargetBadgeKey({ ...grokLocal, model: "grok-2" }),
    );
  });
});

describe("buildTurnTargetBadgeVisibleItemIds", () => {
  it("shows only the first consecutive same-target assistant within a turn", () => {
    const visible = buildTurnTargetBadgeVisibleItemIds([
      assistant("a1", grokLocal),
      assistant("a2", grokLocal),
      assistant("a3", grokLocal),
    ]);
    expect([...visible]).toEqual(["a1"]);
  });

  it("re-shows badge after each user message even when target is unchanged (policy B)", () => {
    const visible = buildTurnTargetBadgeVisibleItemIds([
      user("u1"),
      assistant("a1", grokLocal),
      assistant("a1b", grokLocal),
      user("u2"),
      assistant("a2", grokLocal),
      assistant("a2b", grokLocal),
    ]);
    expect([...visible]).toEqual(["a1", "a2"]);
  });

  it("re-shows badge when target changes mid-turn", () => {
    const visible = buildTurnTargetBadgeVisibleItemIds([
      user("u1"),
      assistant("a1", claudeA),
      assistant("a2", claudeA),
      assistant("a3", claudeB),
      assistant("a4", claudeB),
    ]);
    expect([...visible]).toEqual(["a1", "a3"]);
  });

  it("ignores non-message rows and assistants without snapshot", () => {
    const visible = buildTurnTargetBadgeVisibleItemIds([
      { id: "tool-1", kind: "tool" },
      assistant("no-snap", null),
      assistant("with-snap", grokLocal),
      assistant("dup", grokLocal),
    ]);
    expect([...visible]).toEqual(["with-snap"]);
  });

  it("resets first-of-turn on user even when tools sit between user and assistant", () => {
    const visible = buildTurnTargetBadgeVisibleItemIds([
      user("u1"),
      assistant("a1", grokLocal),
      user("u2"),
      { id: "tool-2", kind: "tool" },
      assistant("a2", grokLocal),
    ]);
    expect([...visible]).toEqual(["a1", "a2"]);
  });
});

describe("resolveTurnRuntimeReceipt", () => {
  it("hides synthetic and empty models", () => {
    expect(sanitizeRuntimeReceiptModel("<synthetic>")).toBeNull();
    expect(sanitizeRuntimeReceiptModel("  ")).toBeNull();
    expect(resolveTurnRuntimeReceipt({ model: "<synthetic>" }).show).toBe(false);
  });

  it("formats live 1M windows and keeps unknown as question mark", () => {
    expect(formatRuntimeReceiptWindowLabel(1_000_000)).toBe("1M");
    expect(formatRuntimeReceiptWindowLabel(128_400)).toBe("128K");
    expect(formatRuntimeReceiptWindowLabel(null, "haiku")).toBe("?");
    expect(
      formatRuntimeReceiptWindowLabel(null, "deepseek-v4-pro-0813[1m]"),
    ).toBeNull();
  });

  it("shows runtime model without faking 200K", () => {
    expect(
      resolveTurnRuntimeReceipt({
        model: "deepseek-v4-pro-0813[1m]",
        contextWindowTokens: 1_000_000,
      }),
    ).toEqual({
      model: "deepseek-v4-pro-0813[1m]",
      windowLabel: "1M",
      show: true,
    });
    expect(
      resolveTurnRuntimeReceipt({
        model: "gateway/custom-77",
        contextWindowTokens: null,
      }),
    ).toEqual({
      model: "gateway/custom-77",
      windowLabel: "?",
      show: true,
    });
  });
});

describe("buildRuntimeReceiptPanelRows", () => {
  it("explains matching request/runtime and missing window instead of repeating ?", () => {
    const rows = buildRuntimeReceiptPanelRows({
      engineLabel: "Claude Code",
      providerLabel: "dpsk",
      providerSource: "managed",
      requestModel: "deepseek-v4-flash",
      runtimeModel: "deepseek-v4-flash",
      modelSource: "system.init.model",
      windowLabel: "?",
      windowTokens: null,
      windowSource: null,
    });
    expect(rows.map((row) => row.label)).toEqual([
      "CLI",
      "供应商",
      "请求模型",
      "实际模型",
      "回执来源",
      "上下文窗口",
    ]);
    expect(rows.find((row) => row.label === "实际模型")).toMatchObject({
      value: "deepseek-v4-flash",
      note: "与请求名一致",
    });
    expect(rows.find((row) => row.label === "回执来源")).toMatchObject({
      value: "CLI 初始化事件",
    });
    expect(rows.find((row) => row.label === "上下文窗口")).toMatchObject({
      value: "未上报",
      note: "CLI 没给 model_context_window，不按 picker 估 200K",
    });
  });

  it("shows mapped runtime, live window tokens, and turn usage", () => {
    const rows = buildRuntimeReceiptPanelRows({
      engineLabel: "Claude Code",
      providerLabel: "DeepSeek",
      requestModel: "sonnet",
      catalogId: "catalog-sonnet",
      reasoning: "high",
      runtimeModel: "deepseek-v4-pro-0813[1m]",
      modelSource: "assistant.message.model",
      windowLabel: "1M",
      windowTokens: 1_000_000,
      windowSource: "live",
      durationMs: 4200,
      inputTokens: 12840,
      outputTokens: 910,
    });
    expect(rows.find((row) => row.label === "实际模型")?.note).toContain("sonnet");
    expect(rows.find((row) => row.label === "上下文窗口")).toMatchObject({
      value: "1,000,000 tokens",
      note: "占用环 / live tokenUsage 上报",
    });
    expect(rows.find((row) => row.label === "本轮用量")?.value).toContain("4.2s");
    expect(rows.find((row) => row.label === "本轮用量")?.value).toContain("入 12,840");
    expect(rows.find((row) => row.label === "思考档位")?.value).toBe("high");
  });
});
