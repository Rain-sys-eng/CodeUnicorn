import { describe, expect, it } from "vitest";

import type { ExecutionTarget } from "../../shared-session/target/types";
import { resolveComposerAtomicSelectedModelId } from "./resolveComposerAtomicSelectedModelId";

const grokLocalTarget: ExecutionTarget = {
  engine: "grok",
  providerProfileId: null,
  modelCatalogEntryId: "grok",
  model: "grok",
  reasoning: null,
  providerProfileNameSnapshot: "本地配置",
  providerProfileSource: "disk",
};

const claudeManagedTarget: ExecutionTarget = {
  engine: "claude",
  providerProfileId: "kimi-k3",
  modelCatalogEntryId: "claude-sonnet-4-6",
  model: "kimi-k2.5",
  reasoning: null,
  providerProfileNameSnapshot: "kimi-k3",
  providerProfileSource: "managed",
};

describe("resolveComposerAtomicSelectedModelId", () => {
  describe("Shared Session", () => {
    it("uses complete next target model identity", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: true,
          executionTarget: grokLocalTarget,
          globalSelectedModelId: "claude-sonnet-4-6",
        }),
      ).toBe("grok");
    });

    it("prefers modelCatalogEntryId over runtime model", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: true,
          executionTarget: claudeManagedTarget,
          globalSelectedModelId: "other",
        }),
      ).toBe("claude-sonnet-4-6");
    });

    it("returns empty when next target is null even if global model exists", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: true,
          executionTarget: null,
          globalSelectedModelId: "claude-sonnet-4-6",
        }),
      ).toBe("");
    });

    it("returns empty when next target has engine only (no model identity)", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: true,
          executionTarget: {
            engine: "grok",
            providerProfileId: null,
            modelCatalogEntryId: null,
            model: null,
            reasoning: null,
            providerProfileNameSnapshot: "本地配置",
            providerProfileSource: "disk",
          },
          globalSelectedModelId: "grok",
        }),
      ).toBe("");
    });

    it("falls back to runtime model when catalog entry id is absent", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: true,
          executionTarget: {
            ...grokLocalTarget,
            modelCatalogEntryId: null,
            model: "grok-3",
          },
          globalSelectedModelId: "ignored",
        }),
      ).toBe("grok-3");
    });
  });

  describe("Native / create-session", () => {
    it("uses atomic target identity when present", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: false,
          executionTarget: {
            engine: "codex",
            providerProfileId: null,
            modelCatalogEntryId: "gpt-5.5",
            model: "gpt-5.5",
            reasoning: null,
            providerProfileNameSnapshot: "本地配置",
            providerProfileSource: "disk",
          },
          globalSelectedModelId: "stale-global",
        }),
      ).toBe("gpt-5.5");
    });

    it("does not inherit a global native model on a DSH target without identity", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: false,
          executionTarget: {
            engine: "dsh",
            providerProfileId: null,
            modelCatalogEntryId: null,
            model: null,
            reasoning: null,
            providerProfileNameSnapshot: "本地配置",
            providerProfileSource: "disk",
          },
          globalSelectedModelId: "gpt-5.5",
        }),
      ).toBe("");
    });

    it("falls back to global selectedModelId when atomic target lacks model", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: false,
          executionTarget: {
            engine: "claude",
            providerProfileId: null,
            modelCatalogEntryId: null,
            model: null,
            reasoning: null,
            providerProfileNameSnapshot: "本地配置",
            providerProfileSource: "disk",
          },
          globalSelectedModelId: "claude-sonnet-4-6",
        }),
      ).toBe("claude-sonnet-4-6");
    });

    it("falls back to global when executionTarget is null", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: false,
          executionTarget: null,
          globalSelectedModelId: "claude-opus-4-6",
        }),
      ).toBe("claude-opus-4-6");
    });

    it("returns empty when native has neither target model nor global", () => {
      expect(
        resolveComposerAtomicSelectedModelId({
          isSharedSession: false,
          executionTarget: null,
          globalSelectedModelId: null,
        }),
      ).toBe("");
    });
  });
});
