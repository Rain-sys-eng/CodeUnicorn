import { useEffect, useMemo } from "react";

import type { ExecutionTarget } from "../../shared-session/target/types";
import { resolveAtomicReasoningOptions } from "../../models/atomicModelReasoning";
import { ModelSelect } from "../../composer/components/ChatInputBox/selectors/ModelSelect";
import { ReasoningSelect } from "../../composer/components/ChatInputBox/selectors/ReasoningSelect";
import { useAtomicProviderTargetCatalog } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import type { ReasoningEffort } from "../../composer/components/ChatInputBox/types";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
  OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
  PI_LOCAL_PROVIDER_PROFILE_ID,
  QODER_GLOBAL_PROVIDER_PROFILE_ID,
} from "../../threads/constants/codexProviderProfiles";
import type { AgentExecutionTarget } from "../types";

const LOCAL_PROFILE: Record<string, string> = {
  claude: CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  codex: CODEX_DISK_PROVIDER_PROFILE_ID,
  kimi: KIMI_LOCAL_PROVIDER_PROFILE_ID,
  grok: GROK_LOCAL_PROVIDER_PROFILE_ID,
  opencode: OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
  pi: PI_LOCAL_PROVIDER_PROFILE_ID,
  qoder: QODER_GLOBAL_PROVIDER_PROFILE_ID,
};

type StageTargetPickerProps = {
  value: AgentExecutionTarget;
  disabled?: boolean;
  onChange: (next: AgentExecutionTarget) => void;
};

function toExecutionTarget(value: AgentExecutionTarget): ExecutionTarget {
  return {
    engine: value.engine,
    providerProfileId: value.providerProfileId ?? null,
    modelCatalogEntryId: value.modelCatalogEntryId ?? null,
    model: value.model ?? null,
    reasoning: value.reasoningEffort
      ? { effort: value.reasoningEffort }
      : null,
    providerProfileNameSnapshot: value.providerProfileNameSnapshot ?? null,
    providerProfileSource:
      (value.providerProfileSource as ExecutionTarget["providerProfileSource"]) ??
      null,
  };
}

function fromExecutionTarget(
  target: ExecutionTarget,
  prev: AgentExecutionTarget,
): AgentExecutionTarget {
  return {
    engine: target.engine,
    providerProfileId: target.providerProfileId ?? null,
    modelCatalogEntryId: target.modelCatalogEntryId ?? null,
    model: target.model ?? null,
    reasoningEffort:
      target.reasoning?.effort ?? prev.reasoningEffort ?? null,
    providerProfileNameSnapshot: target.providerProfileNameSnapshot ?? null,
    providerProfileSource: target.providerProfileSource ?? null,
    runtimeCapabilityFingerprint: prev.runtimeCapabilityFingerprint ?? null,
  };
}

/**
 * 模板编辑器用：复用对话内 ModelSelect + ReasoningSelect，
 * 选项随引擎/模型动态变化，不写死 low/medium/high。
 */
export function StageTargetPicker({
  value,
  disabled,
  onChange,
}: StageTargetPickerProps) {
  const providerId = (
    ["claude", "codex", "kimi", "grok", "opencode", "pi", "qoder"].includes(value.engine)
      ? value.engine
      : "claude"
  ) as "claude" | "codex" | "kimi" | "grok" | "opencode" | "pi" | "qoder";

  const catalog = useAtomicProviderTargetCatalog({
    enabled: true,
    mode: "shared",
    currentProvider: providerId,
    currentProviderProfileId: value.providerProfileId ?? null,
    resolveProviderLabel: (id) => id,
    kimiDisabledReason: "",
  });
  const executionTarget = useMemo(() => toExecutionTarget(value), [value]);

  useEffect(() => {
    void catalog.ensureProfiles();
  }, [catalog.ensureProfiles]);

  useEffect(() => {
    const profileId =
      value.providerProfileId?.trim() || LOCAL_PROFILE[providerId] || "";
    if (!profileId) return;
    void catalog.ensureModels(providerId, profileId);
  }, [catalog.ensureModels, providerId, value.providerProfileId]);

  const reasoningOptions = useMemo(() => {
    return resolveAtomicReasoningOptions(value.engine, {
      id: value.modelCatalogEntryId ?? value.model ?? undefined,
      model: value.model ?? value.modelCatalogEntryId ?? undefined,
    }) as ReasoningEffort[];
  }, [value.engine, value.model, value.modelCatalogEntryId]);

  const modelValue =
    value.modelCatalogEntryId?.trim() ||
    value.model?.trim() ||
    "";

  return (
    <div
      className={`ma-stage-target-picker${disabled ? " is-disabled" : ""}`}
      aria-disabled={disabled || undefined}
    >
      <ModelSelect
        value={modelValue}
        onChange={() => undefined}
        currentProvider={providerId}
        targetGroups={catalog.groups}
        executionTarget={executionTarget}
        onExecutionTargetChange={(next) => {
          if (disabled) return;
          onChange(fromExecutionTarget(next, value));
        }}
        onOpenTargetCatalog={() => {
          void catalog.ensureProfiles();
        }}
        onOpenProviderProfile={(engine, profileId) =>
          catalog.ensureModels(engine, profileId)
        }
        onReloadProviderConfig={(engine, profileId) =>
          catalog.reloadConfig(engine, profileId)
        }
        targetCatalogError={catalog.profileLoadError}
        triggerVariant="default"
      />
      {reasoningOptions.length > 0 ? (
        <ReasoningSelect
          value={(value.reasoningEffort as ReasoningEffort | null) ?? null}
          options={reasoningOptions}
          disabled={disabled}
          onChange={(effort) => {
            if (disabled) return;
            onChange({
              ...value,
              reasoningEffort: effort,
            });
          }}
        />
      ) : null}
    </div>
  );
}
