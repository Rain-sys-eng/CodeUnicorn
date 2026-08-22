/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineType, ThreadTokenUsage } from "../../../types";
import { Composer } from "./Composer";

afterEach(() => {
  cleanup();
});

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
  invoke: vi.fn(async () => null),
}));


vi.mock("./ChatInputBox/ChatInputBoxAdapter", () => ({
  ChatInputBoxAdapter: ({
    text,
    contextUsage,
    claudeContextUsage,
    onTextChange,
  }: {
    text?: string;
    onTextChange?: (next: string, cursor: number | null) => void;
    contextUsage?: { used: number; total: number } | null;
    claudeContextUsage?: {
      usedTokens: number | null;
      contextWindow: number | null;
      totalTokens: number | null;
      inputTokens: number | null;
      cachedInputTokens: number | null;
      outputTokens: number | null;
      usedPercent: number | null;
      remainingPercent: number | null;
      freshness: string;
      source: string | null;
      hasUsage: boolean;
    } | null;
  }) => (
    <div
      data-testid="chat-input-box-adapter"
      data-legacy-used={String(contextUsage?.used ?? "")}
      data-legacy-total={String(contextUsage?.total ?? "")}
      data-claude-used={String(claudeContextUsage?.usedTokens ?? "")}
      data-claude-total={String(claudeContextUsage?.contextWindow ?? "")}
      data-claude-total-tokens={String(claudeContextUsage?.totalTokens ?? "")}
      data-claude-input={String(claudeContextUsage?.inputTokens ?? "")}
      data-claude-cached={String(claudeContextUsage?.cachedInputTokens ?? "")}
      data-claude-output={String(claudeContextUsage?.outputTokens ?? "")}
      data-claude-used-percent={String(claudeContextUsage?.usedPercent ?? "")}
      data-claude-remaining-percent={String(claudeContextUsage?.remainingPercent ?? "")}
      data-claude-freshness={String(claudeContextUsage?.freshness ?? "")}
      data-claude-source={String(claudeContextUsage?.source ?? "")}
      data-claude-has-usage={String(claudeContextUsage?.hasUsage ?? "")}
      data-text={text ?? ""}
    >
      <button
        type="button"
        data-testid="type-draft"
        onClick={() => onTextChange?.("typing", 6)}
      >
        type
      </button>
    </div>
  ),
}));

vi.mock("./ChatInputBox/ContextBar", () => ({
  ContextBar: ({
    contextDualViewEnabled,
    dualContextUsage,
    onRequestContextCompaction,
  }: {
    contextDualViewEnabled?: boolean;
    dualContextUsage?: {
      usedTokens: number;
      contextWindow: number;
      percent: number;
      hasUsage: boolean;
      compactionState: string;
      compactionSource: string | null;
      usageSyncPendingAfterCompaction: boolean;
    } | null;
    onRequestContextCompaction?: () => Promise<void> | void;
  }) => (
    <div
      data-testid="codex-context-footer"
      data-dual-enabled={String(contextDualViewEnabled)}
      data-dual-used={String(dualContextUsage?.usedTokens ?? "")}
      data-dual-total={String(dualContextUsage?.contextWindow ?? "")}
      data-dual-percent={String(dualContextUsage?.percent ?? "")}
      data-dual-has-usage={String(dualContextUsage?.hasUsage ?? "")}
      data-dual-state={String(dualContextUsage?.compactionState ?? "")}
      data-dual-source={String(dualContextUsage?.compactionSource ?? "")}
      data-dual-pending-sync={String(dualContextUsage?.usageSyncPendingAfterCompaction ?? "")}
    >
      <button
        type="button"
        data-testid="compact-now"
        onClick={() => {
          void onRequestContextCompaction?.();
        }}
      >
        compact
      </button>
    </div>
  ),
}));

function ComposerHarness({
  selectedEngine = "claude",
  contextUsage = null,
  contextDualViewEnabled = false,
  isProcessing = false,
  isContextCompacting = false,
  createSessionTargetPicker = false,
  footerUsageIndicatorEnabled = true,
  codexCompactionLifecycleState = "idle",
  codexCompactionSource = null,
  codexCompactionCompletedAt = null,
  lastTokenUsageUpdatedAt = null,
  items = [],
  onRequestContextCompaction,
}: {
  selectedEngine?: EngineType;
  contextUsage?: ThreadTokenUsage | null;
  contextDualViewEnabled?: boolean;
  isProcessing?: boolean;
  isContextCompacting?: boolean;
  createSessionTargetPicker?: boolean;
  footerUsageIndicatorEnabled?: boolean;
  codexCompactionLifecycleState?: "idle" | "compacting" | "completed";
  codexCompactionSource?: "auto" | "manual" | null;
  codexCompactionCompletedAt?: number | null;
  lastTokenUsageUpdatedAt?: number | null;
  items?: Array<{ id: string; kind: "message"; role: "assistant" | "user"; text: string }>;
  onRequestContextCompaction?: () => Promise<void> | void;
}) {
  return (
    <Composer
      items={items}
      onSend={() => {}}
      onQueue={() => {}}
      onRequestContextCompaction={onRequestContextCompaction}
      onStop={() => {}}
      canStop={false}
      isProcessing={isProcessing}
      steerEnabled={false}
      collaborationModes={[]}
      collaborationModesEnabled={true}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={() => {}}
      createSessionTargetPicker={createSessionTargetPicker}
      footerUsageIndicatorEnabled={footerUsageIndicatorEnabled}
      selectedEngine={selectedEngine}
      models={[]}
      selectedModelId={null}
      onSelectModel={() => {}}
      reasoningOptions={[]}
      selectedEffort={null}
      onSelectEffort={() => {}}
      reasoningSupported={false}
      accessMode="current"
      onSelectAccessMode={() => {}}
      skills={[]}
      prompts={[]}
      commands={[]}
      files={[]}
      onDraftChange={() => {}}
      activeWorkspaceId="ws-1"
      activeThreadId="thread-1"
      contextUsage={contextUsage}
      contextDualViewEnabled={contextDualViewEnabled}
      isContextCompacting={isContextCompacting}
      codexCompactionLifecycleState={codexCompactionLifecycleState}
      codexCompactionSource={codexCompactionSource}
      codexCompactionCompletedAt={codexCompactionCompletedAt}
      lastTokenUsageUpdatedAt={lastTokenUsageUpdatedAt}
    />
  );
}

describe("Composer dual context usage model", () => {
  it("does not reserve an empty homepage branch row when DSH has no session stats", () => {
    const { container } = render(
      <ComposerHarness
        selectedEngine="dsh"
        createSessionTargetPicker
        footerUsageIndicatorEnabled={false}
      />,
    );

    expect(container.querySelector(".composer-branch-row")).toBeNull();
    expect(container.querySelector(".composer-dsh-stats-line")).toBeNull();
  });

  it("keeps the DSH stats line once session telemetry is available", () => {
    const { container } = render(
      <ComposerHarness
        selectedEngine="dsh"
        footerUsageIndicatorEnabled={false}
        contextUsage={{
          total: {
            totalTokens: 100,
            inputTokens: 4,
            cachedInputTokens: 96,
            outputTokens: 20,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 100,
            inputTokens: 4,
            cachedInputTokens: 96,
            outputTokens: 20,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: null,
          sessionStats: {
            turns: 1,
            steps: 1,
            llmMs: 9500,
            toolMs: 0,
            ttftMs: 8500,
            ttftSteps: 1,
            decodeMs: 1000,
            decodeTokens: 72,
          },
        }}
      />,
    );

    expect(container.querySelector(".composer-branch-row")).toBeTruthy();
    expect(container.querySelector(".composer-dsh-stats-line")).toBeTruthy();
  });

  it("disables dual view on non-codex engines", () => {
    render(
      <ComposerHarness
        selectedEngine="claude"
        contextDualViewEnabled={true}
      />,
    );
    expect(screen.queryByTestId("codex-context-footer")).toBeNull();
  });

  it("passes Claude context-window telemetry without falling back to cumulative totals", () => {
    render(
      <ComposerHarness
        selectedEngine="claude"
        contextUsage={{
          total: {
            totalTokens: 570_400,
            inputTokens: 400_000,
            cachedInputTokens: 20_000,
            outputTokens: 150_400,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 167_800,
            inputTokens: 120_000,
            cachedInputTokens: 47_800,
            outputTokens: 0,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 258_400,
          contextUsageSource: "context_window",
          contextUsageFreshness: "live",
          contextUsedTokens: 167_800,
          contextUsedPercent: 65,
          contextRemainingPercent: 35,
        }}
      />,
    );

    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-legacy-used")).toBe("167800");
    expect(adapter.getAttribute("data-legacy-total")).toBe("258400");
    expect(adapter.getAttribute("data-claude-used")).toBe("167800");
    expect(adapter.getAttribute("data-claude-total")).toBe("258400");
    expect(adapter.getAttribute("data-claude-total-tokens")).toBe("570400");
    expect(adapter.getAttribute("data-claude-input")).toBe("400000");
    expect(adapter.getAttribute("data-claude-cached")).toBe("20000");
    expect(adapter.getAttribute("data-claude-output")).toBe("150400");
    expect(adapter.getAttribute("data-claude-used-percent")).toBe("65");
    expect(adapter.getAttribute("data-claude-remaining-percent")).toBe("35");
    expect(adapter.getAttribute("data-claude-freshness")).toBe("live");
    expect(adapter.getAttribute("data-claude-source")).toBe("context_window");
  });

  it("keeps Claude context usage unknown when no window telemetry is available", () => {
    render(
      <ComposerHarness
        selectedEngine="claude"
        contextUsage={{
          total: {
            totalTokens: 570_400,
            inputTokens: 400_000,
            cachedInputTokens: 20_000,
            outputTokens: 150_400,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: null,
          contextUsageSource: "claude_history",
          contextUsageFreshness: "estimated",
        }}
      />,
    );

    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-legacy-used")).toBe("");
    expect(adapter.getAttribute("data-legacy-total")).toBe("");
    expect(adapter.getAttribute("data-claude-used")).toBe("");
    expect(adapter.getAttribute("data-claude-total")).toBe("");
    expect(adapter.getAttribute("data-claude-total-tokens")).toBe("570400");
    expect(adapter.getAttribute("data-claude-has-usage")).toBe("true");
  });

  it("keeps legacy usage and computes dual usage from input+cached tokens", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        contextUsage={{
          total: {
            totalTokens: 220_000,
            inputTokens: 140_000,
            cachedInputTokens: 40_000,
            outputTokens: 40_000,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 80_000,
            inputTokens: 50_000,
            cachedInputTokens: 10_000,
            outputTokens: 20_000,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 200_000,
        }}
      />,
    );

    const adapter = screen.getByTestId("chat-input-box-adapter");
    const footer = screen.getByTestId("codex-context-footer");
    expect(footer.closest(".composer-branch-row-usage")).toBeTruthy();
    expect(footer.getAttribute("data-dual-enabled")).toBe("true");
    expect(adapter.getAttribute("data-legacy-used")).toBe("220000");
    expect(adapter.getAttribute("data-legacy-total")).toBe("200000");
    expect(footer.getAttribute("data-dual-used")).toBe("60000");
    expect(footer.getAttribute("data-dual-total")).toBe("200000");
    expect(footer.getAttribute("data-dual-percent")).toBe("30");
    expect(footer.getAttribute("data-dual-has-usage")).toBe("true");
    expect(footer.getAttribute("data-dual-state")).toBe("idle");
  });

  it("converges deferred advisory context usage after typing becomes idle without changing draft text", async () => {
    vi.useFakeTimers();
    const initialContextUsage: ThreadTokenUsage = {
      total: {
        totalTokens: 220_000,
        inputTokens: 140_000,
        cachedInputTokens: 40_000,
        outputTokens: 40_000,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 80_000,
        inputTokens: 50_000,
        cachedInputTokens: 10_000,
        outputTokens: 20_000,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: 200_000,
    };
    const latestContextUsage: ThreadTokenUsage = {
      total: {
        totalTokens: 260_000,
        inputTokens: 170_000,
        cachedInputTokens: 50_000,
        outputTokens: 40_000,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 110_000,
        inputTokens: 70_000,
        cachedInputTokens: 20_000,
        outputTokens: 20_000,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: 200_000,
    };

    try {
      const view = render(
        <ComposerHarness
          selectedEngine="codex"
          contextDualViewEnabled={true}
          isProcessing={true}
          contextUsage={initialContextUsage}
        />,
      );

      let adapter = screen.getByTestId("chat-input-box-adapter");
      let footer = screen.getByTestId("codex-context-footer");
      expect(adapter.getAttribute("data-text")).toBe("");
      expect(adapter.getAttribute("data-legacy-used")).toBe("220000");
      expect(footer.getAttribute("data-dual-used")).toBe("60000");

      fireEvent.click(screen.getByTestId("type-draft"));

      adapter = screen.getByTestId("chat-input-box-adapter");
      expect(adapter.getAttribute("data-text")).toBe("typing");

      view.rerender(
        <ComposerHarness
          selectedEngine="codex"
          contextDualViewEnabled={true}
          isProcessing={true}
          contextUsage={latestContextUsage}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(321);
      });

      adapter = screen.getByTestId("chat-input-box-adapter");
      footer = screen.getByTestId("codex-context-footer");
      expect(adapter.getAttribute("data-text")).toBe("typing");
      expect(adapter.getAttribute("data-legacy-used")).toBe("260000");
      expect(footer.getAttribute("data-dual-used")).toBe("90000");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fallback dual usage to cumulative totals when last snapshot is empty", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        contextUsage={{
          total: {
            totalTokens: 900000,
            inputTokens: 600000,
            cachedInputTokens: 100000,
            outputTokens: 200000,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 258400,
        }}
      />,
    );

    const footer = screen.getByTestId("codex-context-footer");
    expect(footer.getAttribute("data-dual-used")).toBe("0");
    expect(footer.getAttribute("data-dual-percent")).toBe("0");
    expect(footer.getAttribute("data-dual-has-usage")).toBe("false");
  });

  it("keeps dual usage state idle during regular processing and shows compacted marker when present", () => {
    const { rerender } = render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        isProcessing={true}
      />,
    );

    let footer = screen.getByTestId("codex-context-footer");
    expect(footer.getAttribute("data-dual-state")).toBe("idle");

    rerender(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        isProcessing={false}
        codexCompactionLifecycleState="completed"
        codexCompactionCompletedAt={2_222}
      />,
    );

    footer = screen.getByTestId("codex-context-footer");
    expect(footer.getAttribute("data-dual-state")).toBe("compacted");
    expect(footer.getAttribute("data-dual-pending-sync")).toBe("true");
  });

  it("does not treat preserved historical compaction messages as current completed state", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        items={[
          {
            id: "context-compacted-turn-1",
            kind: "message",
            role: "assistant",
            text: "Context compacted.",
          },
        ]}
      />,
    );

    const footer = screen.getByTestId("codex-context-footer");
    expect(footer.getAttribute("data-dual-state")).toBe("idle");
  });

  it("keeps compacting state when context compaction event is in progress", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        isContextCompacting={true}
        codexCompactionLifecycleState="compacting"
        codexCompactionSource="auto"
      />,
    );

    const footer = screen.getByTestId("codex-context-footer");
    expect(footer.getAttribute("data-dual-state")).toBe("compacting");
    expect(footer.getAttribute("data-dual-source")).toBe("auto");
  });

  it("clears pending-sync state after a newer usage snapshot arrives", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        codexCompactionLifecycleState="completed"
        codexCompactionCompletedAt={1_000}
        lastTokenUsageUpdatedAt={2_000}
      />,
    );

    const footer = screen.getByTestId("codex-context-footer");
    expect(footer.getAttribute("data-dual-pending-sync")).toBe("false");
  });

  it("forwards manual compaction requests to the external handler when provided", () => {
    const onRequestContextCompaction = vi.fn();
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        onRequestContextCompaction={onRequestContextCompaction}
      />,
    );

    fireEvent.click(screen.getByTestId("compact-now"));

    expect(onRequestContextCompaction).toHaveBeenCalledTimes(1);
  });
});
