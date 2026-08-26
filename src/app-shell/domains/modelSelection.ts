import type { ComposerSessionSelection } from "./selectedComposerSession";
import type { EngineType, ModelOption } from "../../types";

type GetEffectiveSelectedModelIdOptions = {
  activeEngine: EngineType;
  selectedModelId: string | null;
  activeThreadSelectedModelId: string | null;
  hasActiveThread: boolean;
  allowUnknownActiveThreadModel?: boolean;
  codexModels: ModelOption[];
  engineModelsAsOptions: ModelOption[];
  engineSelectedModelIdByType: Partial<Record<EngineType, string | null>>;
};

type GetNextEngineSelectedModelIdOptions = {
  activeEngine: EngineType;
  engineModelsAsOptions: ModelOption[];
  currentSelection: string | null;
};

type UpsertEngineSelectedModelIdOptions = {
  activeEngine: EngineType;
  nextModelId: string | null;
  previousSelectionByEngine: Partial<Record<EngineType, string | null>>;
};

type GetEffectiveSelectedEffortOptions = {
  activeEngine: EngineType;
  hasActiveThread: boolean;
  selectedEffort: string | null;
  activeThreadSelection: ComposerSessionSelection | null;
  reasoningOptions: string[];
};

export const CLAUDE_REASONING_OPTIONS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Grok CLI composer allowlist — keep aligned with `GROK_REASONING_EFFORTS` in grok.rs. */
export const GROK_REASONING_OPTIONS = ["low", "medium", "high"];

export function findModelById(models: ModelOption[], id: string | null) {
  if (!id) {
    return null;
  }
  return (
    models.find((model) => model.id === id) ??
    models.find((model) => model.model === id) ??
    null
  );
}

/**
 * catalog 降级为全静态兜底（如 PI 探测失败只剩合成的 auto，全部 source=fallback）
 * 时，把会话账本里的 modelId 合成一个临时选项追加进列表：切历史会话不再被
 * 静默修成兜底默认（auto），chip 显示真实模型 id；catalog 痊愈后账本 id 正常
 * 命中，该合成选项自动消失。非降级场景返回原数组引用，保证 memo 稳定。
 */
export function preserveLedgerModelOnFallbackCatalog(
  engineModelsAsOptions: ModelOption[],
  threadLedgerModelId: string | null,
): ModelOption[] {
  const ledgerId = threadLedgerModelId?.trim() ?? "";
  if (
    !ledgerId ||
    engineModelsAsOptions.length === 0 ||
    !engineModelsAsOptions.every(
      (model) => (model.source ?? "") === "fallback",
    ) ||
    findModelById(engineModelsAsOptions, ledgerId)
  ) {
    return engineModelsAsOptions;
  }
  const ledgerOption: ModelOption = {
    id: ledgerId,
    model: ledgerId,
    displayName: ledgerId,
    description: "",
    source: "ledger",
    provider: null,
    protocol: null,
    provenance: null,
    observedAt: null,
    lastVerifiedAt: null,
    lifecycle: null,
    providerProfileId: null,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    isDefault: false,
  };
  return [...engineModelsAsOptions, ledgerOption];
}

function getDefaultModelId(models: ModelOption[]) {
  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getNormalizedReasoningOptions(reasoningOptions: string[]) {
  return Array.from(
    new Set(reasoningOptions.map((option) => option.trim()).filter(Boolean)),
  );
}

function getModelRuntimeIdentity(model: ModelOption): string {
  const runtimeModel = model.model.trim();
  return (runtimeModel || model.id.trim()).toLowerCase();
}

export function enrichScopedCodexReasoningMetadata(
  scopedModels: ModelOption[],
  authoritativeModels: ModelOption[],
): ModelOption[] {
  const authoritativeByIdentity = new Map(
    authoritativeModels.flatMap((model) => {
      const identity = getModelRuntimeIdentity(model);
      return identity ? [[identity, model] as const] : [];
    }),
  );
  return scopedModels.map((scopedModel) => {
    const authoritativeModel = authoritativeByIdentity.get(
      getModelRuntimeIdentity(scopedModel),
    );
    if (!authoritativeModel) {
      return scopedModel;
    }
    const supportedReasoningEfforts =
      scopedModel.supportedReasoningEfforts.length > 0
        ? scopedModel.supportedReasoningEfforts
        : authoritativeModel.supportedReasoningEfforts;
    const defaultReasoningEffort =
      scopedModel.defaultReasoningEffort ??
      authoritativeModel.defaultReasoningEffort;
    if (
      supportedReasoningEfforts === scopedModel.supportedReasoningEfforts &&
      defaultReasoningEffort === scopedModel.defaultReasoningEffort
    ) {
      return scopedModel;
    }
    return {
      ...scopedModel,
      supportedReasoningEfforts,
      defaultReasoningEffort,
    };
  });
}

export function isReasoningEffortSupportedForEngine(
  activeEngine: EngineType,
  reasoningOptions: string[],
) {
  if (activeEngine === "claude" || activeEngine === "grok") {
    return true;
  }
  if (
    activeEngine === "codex" ||
    activeEngine === "dsh" ||
    activeEngine === "qoder" ||
    activeEngine === "pi"
  ) {
    // dsh / qoder / pi：只有选中模型在 catalog 声明了 reasoning efforts 才支持
    return getNormalizedReasoningOptions(reasoningOptions).length > 0;
  }
  return false;
}

export function getEffectiveModels(
  activeEngine: EngineType,
  codexModels: ModelOption[],
  engineModelsAsOptions: ModelOption[],
) {
  return activeEngine === "codex" ? codexModels : engineModelsAsOptions;
}

export function getNextEngineSelectedModelId({
  activeEngine,
  engineModelsAsOptions,
  currentSelection,
}: GetNextEngineSelectedModelIdOptions) {
  if (activeEngine === "codex" || engineModelsAsOptions.length === 0) {
    return null;
  }
  if (findModelById(engineModelsAsOptions, currentSelection)) {
    return null;
  }
  return getDefaultModelId(engineModelsAsOptions);
}

export function upsertEngineSelectedModelId({
  activeEngine,
  nextModelId,
  previousSelectionByEngine,
}: UpsertEngineSelectedModelIdOptions) {
  if (!nextModelId) {
    return previousSelectionByEngine;
  }
  const existing = previousSelectionByEngine[activeEngine] ?? null;
  if (nextModelId === existing) {
    return previousSelectionByEngine;
  }
  return { ...previousSelectionByEngine, [activeEngine]: nextModelId };
}

export function getEffectiveSelectedModelId({
  activeEngine,
  selectedModelId,
  activeThreadSelectedModelId,
  hasActiveThread,
  allowUnknownActiveThreadModel = false,
  codexModels,
  engineModelsAsOptions,
  engineSelectedModelIdByType,
}: GetEffectiveSelectedModelIdOptions) {
  const unrestrictedThreadModelId = normalizeNonEmptyString(
    activeThreadSelectedModelId,
  );
  if (
    hasActiveThread &&
    allowUnknownActiveThreadModel &&
    unrestrictedThreadModelId
  ) {
    return unrestrictedThreadModelId;
  }
  if (activeEngine === "codex") {
    const selectedCodexModelId =
      findModelById(codexModels, selectedModelId)?.id ?? null;
    const threadCodexModelId =
      findModelById(codexModels, activeThreadSelectedModelId)?.id ?? null;
    const defaultCodexModelId = getDefaultModelId(codexModels);
    if (hasActiveThread) {
      return threadCodexModelId ?? selectedCodexModelId ?? defaultCodexModelId;
    }
    return selectedCodexModelId ?? defaultCodexModelId;
  }
  const engineSelection = engineSelectedModelIdByType[activeEngine] ?? null;
  if (engineModelsAsOptions.length === 0) {
    if (hasActiveThread) {
      return activeEngine === "claude" ? null : activeThreadSelectedModelId;
    }
    return activeEngine === "claude" ? null : engineSelection;
  }
  if (hasActiveThread) {
    return (
      findModelById(engineModelsAsOptions, activeThreadSelectedModelId)?.id ??
      getDefaultModelId(engineModelsAsOptions)
    );
  }
  return (
    findModelById(engineModelsAsOptions, engineSelection)?.id ??
    getDefaultModelId(engineModelsAsOptions)
  );
}

export function getEffectiveSelectedEffort({
  activeEngine,
  hasActiveThread,
  selectedEffort,
  activeThreadSelection,
  reasoningOptions,
}: GetEffectiveSelectedEffortOptions) {
  const normalizedReasoningOptions =
    getNormalizedReasoningOptions(reasoningOptions);
  const normalizeEffort = (
    value: string | null,
    options?: { fallbackToFirst: boolean },
  ) => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (
      normalizedReasoningOptions.length > 0 &&
      !normalizedReasoningOptions.includes(trimmed)
    ) {
      return options?.fallbackToFirst
        ? (normalizedReasoningOptions[0] ?? null)
        : null;
    }
    return trimmed;
  };
  if (
    !isReasoningEffortSupportedForEngine(
      activeEngine,
      normalizedReasoningOptions,
    )
  ) {
    return null;
  }
  // Claude / Grok: fixed CLI allowlist; only surface thread/draft selection (no silent default).
  if (activeEngine === "claude" || activeEngine === "grok") {
    return normalizeEffort(activeThreadSelection?.effort ?? null, {
      fallbackToFirst: false,
    });
  }
  if (
    (activeEngine !== "codex" &&
      activeEngine !== "dsh" &&
      activeEngine !== "qoder" &&
      activeEngine !== "pi") ||
    !hasActiveThread
  ) {
    return normalizeEffort(selectedEffort, { fallbackToFirst: true });
  }
  if (!activeThreadSelection) {
    return normalizeEffort(selectedEffort, { fallbackToFirst: true });
  }
  return (
    normalizeEffort(activeThreadSelection.effort, { fallbackToFirst: true }) ??
    normalizeEffort(selectedEffort, { fallbackToFirst: true })
  );
}

export function getReasoningOptionsForModel(
  model: ModelOption | null,
): string[] {
  const supported =
    model?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort) ??
    [];
  if (supported.length > 0) {
    return supported;
  }
  const defaultEffort = normalizeNonEmptyString(model?.defaultReasoningEffort);
  return defaultEffort ? [defaultEffort] : [];
}

export function getEffectiveReasoningSupported(
  activeEngine: EngineType,
  codexReasoningSupported: boolean,
) {
  return (
    activeEngine === "claude" ||
    activeEngine === "grok" ||
    ((activeEngine === "codex" ||
      activeEngine === "dsh" ||
      activeEngine === "pi") &&
      codexReasoningSupported)
  );
}

export function getEffectiveReasoningOptions(
  activeEngine: EngineType,
  modelReasoningOptions: string[],
): string[] {
  if (activeEngine === "claude") {
    return CLAUDE_REASONING_OPTIONS;
  }
  if (activeEngine === "grok") {
    return GROK_REASONING_OPTIONS;
  }
  // codex / dsh / qoder / pi 都跟随选中模型的 catalog 档位
  return modelReasoningOptions;
}
