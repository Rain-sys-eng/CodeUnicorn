/**
 * @vitest-environment jsdom
 *
 * Shared PI reasoning：Composer 在 Shared Session 切到 PI 模型时把
 * `providerModelCatalogs["pi"]` 行的 `supportedReasoningEfforts` /
 * `defaultReasoningEffort` 注入 `atomicModelReasoningRef.model`，让
 * `atomicReasoningOptions` 与 `atomicSelectedEffort` 与 native PI composer
 * 对齐。
 *
 * OpenSpec change: expand-shared-atomic-reasoning-linkage-to-pi
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineType, ModelOption } from "../../../types";
import { Composer } from "./Composer";
import {
  hydrateSharedTargetState,
  resetSharedTargetStoreForTests,
} from "../../shared-session/target/targetStore";
import type { ExecutionTarget } from "../../shared-session/target/types";
import type { ReviewPromptState } from "../../threads/hooks/useReviewPrompt";

afterEach(() => {
  cleanup();
  resetSharedTargetStoreForTests();
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
    reasoningOptions,
    selectedEffort,
  }: {
    reasoningOptions?: string[];
    selectedEffort?: string | null;
  }) => (
    <div
      data-testid="chat-input-box-adapter"
      data-reasoning-options={(reasoningOptions ?? []).join(",")}
      data-selected-effort={selectedEffort ?? ""}
    />
  ),
}));

function makeCatalogModel(partial: {
  id: string;
  model?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string }>;
  defaultReasoningEffort?: string | null;
}): ModelOption {
  return {
    id: partial.id,
    model: partial.model ?? partial.id,
    displayName: partial.id,
    description: "",
    source: "test",
    supportedReasoningEfforts: (partial.supportedReasoningEfforts ?? []).map(
      (entry) => ({
        reasoningEffort: entry.reasoningEffort,
        description: entry.reasoningEffort,
      }),
    ),
    defaultReasoningEffort: partial.defaultReasoningEffort ?? null,
    isDefault: false,
  };
}

function makeReviewPrompt(): NonNullable<ReviewPromptState> {
  return {
    workspace: {
      id: "ws-1",
      name: "Workspace",
      path: "/tmp/workspace",
      connected: true,
      settings: { sidebarCollapsed: false },
    },
    threadIdSnapshot: "shared:thread-pi-1",
    step: "preset",
    branches: [],
    commits: [],
    isLoadingBranches: false,
    isLoadingCommits: false,
    selectedBranch: "",
    selectedCommitSha: "",
    selectedCommitTitle: "",
    customInstructions: "",
    error: null,
    isSubmitting: false,
  };
}

function ComposerSharedHarness({
  isSharedSession,
  activeThreadId,
  providerModelCatalogs,
  selectedSharedTarget,
}: {
  isSharedSession: boolean;
  activeThreadId: string;
  providerModelCatalogs?: Partial<Record<EngineType, ModelOption[]>>;
  selectedSharedTarget?: ExecutionTarget | null;
}) {
  const reviewPrompt = makeReviewPrompt();
  if (selectedSharedTarget !== undefined) {
    hydrateSharedTargetState("ws-1", activeThreadId, selectedSharedTarget);
  }
  return (
    <Composer
      onSend={() => {}}
      onQueue={() => {}}
      onStop={() => {}}
      canStop={false}
      isProcessing={false}
      steerEnabled={false}
      collaborationModes={[]}
      collaborationModesEnabled={true}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={() => {}}
      isSharedSession={isSharedSession}
      selectedEngine="pi"
      models={[]}
      providerModelCatalogs={providerModelCatalogs}
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
      activeThreadId={activeThreadId}
      runtimeLifecycleState={null}
      reviewPrompt={reviewPrompt}
      onReviewPromptClose={() => {}}
      onReviewPromptShowPreset={() => {}}
      onReviewPromptChoosePreset={() => {}}
      highlightedPresetIndex={0}
      onReviewPromptHighlightPreset={() => {}}
      highlightedBranchIndex={0}
      onReviewPromptHighlightBranch={() => {}}
      highlightedCommitIndex={0}
      onReviewPromptHighlightCommit={() => {}}
      onReviewPromptSelectBranch={() => {}}
      onReviewPromptSelectBranchAtIndex={() => {}}
      onReviewPromptConfirmBranch={async () => {}}
      onReviewPromptSelectCommit={() => {}}
      onReviewPromptSelectCommitAtIndex={() => {}}
      onReviewPromptConfirmCommit={async () => {}}
      onReviewPromptUpdateCustomInstructions={() => {}}
      onReviewPromptConfirmCustom={async () => {}}
    />
  );
}

describe("Composer shared PI reasoning projection", () => {
  beforeEach(() => {
    resetSharedTargetStoreForTests();
  });

  it("Shared PI target with catalog allowlist projects ReasoningSelect options", () => {
    render(
      <ComposerSharedHarness
        isSharedSession
        activeThreadId="shared:thread-pi-1"
        providerModelCatalogs={{
          pi: [
            makeCatalogModel({
              id: "claude-sonnet-4.5",
              supportedReasoningEfforts: [
                { reasoningEffort: "off" },
                { reasoningEffort: "low" },
                { reasoningEffort: "medium" },
                { reasoningEffort: "high" },
              ],
              defaultReasoningEffort: "low",
            }),
          ],
        }}
        selectedSharedTarget={{
          engine: "pi",
          providerProfileId: null,
          modelCatalogEntryId: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          reasoning: null,
        }}
      />,
    );
    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-reasoning-options")).toBe(
      "off,low,medium,high",
    );
    expect(adapter.getAttribute("data-selected-effort")).toBe("low");
  });

  it("Shared PI model with thinkingLevelMap subset projects subset options", () => {
    render(
      <ComposerSharedHarness
        isSharedSession
        activeThreadId="shared:thread-pi-2"
        providerModelCatalogs={{
          pi: [
            makeCatalogModel({
              id: "thinking-holes",
              supportedReasoningEfforts: [
                { reasoningEffort: "high" },
                { reasoningEffort: "max" },
              ],
              defaultReasoningEffort: "high",
            }),
          ],
        }}
        selectedSharedTarget={{
          engine: "pi",
          providerProfileId: null,
          modelCatalogEntryId: "thinking-holes",
          model: "thinking-holes",
          reasoning: { effort: "high" },
        }}
      />,
    );
    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-reasoning-options")).toBe("high,max");
    expect(adapter.getAttribute("data-selected-effort")).toBe("high");
  });

  it("Shared PI runtime-only model without metadata hides ReasoningSelect", () => {
    render(
      <ComposerSharedHarness
        isSharedSession
        activeThreadId="shared:thread-pi-3"
        providerModelCatalogs={{
          pi: [
            makeCatalogModel({
              id: "runtime-only-pi",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
            }),
          ],
        }}
        selectedSharedTarget={{
          engine: "pi",
          providerProfileId: null,
          modelCatalogEntryId: "runtime-only-pi",
          model: "runtime-only-pi",
          reasoning: null,
        }}
      />,
    );
    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-reasoning-options")).toBe("");
    expect(adapter.getAttribute("data-selected-effort")).toBe("");
  });

  it("Shared PI effort outside allowlist reconciles to model default", () => {
    render(
      <ComposerSharedHarness
        isSharedSession
        activeThreadId="shared:thread-pi-4"
        providerModelCatalogs={{
          pi: [
            makeCatalogModel({
              id: "claude-sonnet-4.5",
              supportedReasoningEfforts: [
                { reasoningEffort: "low" },
                { reasoningEffort: "medium" },
                { reasoningEffort: "high" },
              ],
              defaultReasoningEffort: "medium",
            }),
          ],
        }}
        selectedSharedTarget={{
          engine: "pi",
          providerProfileId: null,
          modelCatalogEntryId: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          // xhigh 不在 allowlist → reconcile to default (medium)
          reasoning: { effort: "xhigh" },
        }}
      />,
    );
    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-selected-effort")).toBe("medium");
  });

  it("Native PI does NOT consume providerModelCatalogs (atomic path early-returns)", () => {
    // 回归 native PI 不应走 atomicModelReasoningRef 链路：reasoningOptions
    // 走父层 prop（这里 reasoningOptions prop 是空数组），atomicSelectedEffort
    // 走父层 selectedEffort prop（null）。
    render(
      <ComposerSharedHarness
        isSharedSession={false}
        activeThreadId="native:thread-pi-1"
        providerModelCatalogs={{
          pi: [
            makeCatalogModel({
              id: "claude-sonnet-4.5",
              supportedReasoningEfforts: [
                { reasoningEffort: "off" },
                { reasoningEffort: "low" },
                { reasoningEffort: "medium" },
                { reasoningEffort: "high" },
              ],
              defaultReasoningEffort: "low",
            }),
          ],
        }}
      />,
    );
    const adapter = screen.getByTestId("chat-input-box-adapter");
    // native 路径不走 atomic → reasoningOptions prop（空数组）
    expect(adapter.getAttribute("data-reasoning-options")).toBe("");
    // selectedEffort prop = null
    expect(adapter.getAttribute("data-selected-effort")).toBe("");
  });
});
