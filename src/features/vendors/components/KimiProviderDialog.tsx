import { fetchKimiProviderModels } from "../../../services/tauri";
import type { KimiProviderConfig } from "../types";
import { KIMI_PROVIDER_PRESETS } from "../types";
import {
  ChannelProviderDialog,
  type ChannelProviderDialogEngine,
} from "./ChannelProviderDialog";

interface KimiProviderDialogProps {
  isOpen: boolean;
  provider: KimiProviderConfig | null;
  onClose: () => void;
  onSave: (provider: KimiProviderConfig) => void;
}

const KIMI_PROVIDER_TYPES = ["kimi", "openai", "anthropic"] as const;

const KIMI_DIALOG_ENGINE: ChannelProviderDialogEngine<KimiProviderConfig> = {
  keyPrefix: "kimiDialog",
  datalistId: "kimi-vendor-fetched-models",
  presets: KIMI_PROVIDER_PRESETS.map((preset) => ({
    id: preset.id,
    nameKey: preset.nameKey,
    baseUrl: preset.baseUrl,
    model: preset.model,
    maxContextSize: preset.maxContextSize,
    selectValue: preset.providerType,
  })),
  fetchModels: fetchKimiProviderModels,
  select: {
    labelSuffix: "providerType",
    options: KIMI_PROVIDER_TYPES.map((type) => ({
      value: type,
      labelSuffix: `providerTypeOptions.${type}`,
    })),
    defaultValue: "openai",
    readStored: (provider) => provider.providerType,
    normalizeStored: (value) => value || "openai",
    normalizeInput: (value) => value,
  },
  buildProvider: (input) => ({
    id: input.id,
    name: input.name,
    remark: input.remark,
    websiteUrl: input.editing?.websiteUrl,
    createdAt: input.editing?.createdAt,
    sortOrder: input.editing?.sortOrder,
    isActive: input.editing?.isActive,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    providerType: input.selectValue,
    maxContextSize: input.maxContextSize,
    displayName: input.displayName,
  }),
};

export function KimiProviderDialog(props: KimiProviderDialogProps) {
  return <ChannelProviderDialog {...props} engine={KIMI_DIALOG_ENGINE} />;
}
