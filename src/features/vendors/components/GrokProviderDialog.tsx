import { fetchGrokProviderModels } from "../../../services/tauri";
import type { GrokApiBackend, GrokProviderConfig } from "../types";
import { GROK_PROVIDER_PRESETS } from "../types";
import {
  ChannelProviderDialog,
  type ChannelProviderDialogEngine,
} from "./ChannelProviderDialog";

interface GrokProviderDialogProps {
  isOpen: boolean;
  provider: GrokProviderConfig | null;
  onClose: () => void;
  onSave: (provider: GrokProviderConfig) => void;
}

const GROK_API_BACKENDS = [
  "chat_completions",
  "responses",
  "messages",
] as const;

const GROK_API_BACKEND_OPTION_KEYS: Record<GrokApiBackend, string> = {
  chat_completions: "chatCompletions",
  responses: "responses",
  messages: "messages",
};

function normalizeApiBackend(value: string | undefined): GrokApiBackend {
  return (GROK_API_BACKENDS as readonly string[]).includes(value ?? "")
    ? (value as GrokApiBackend)
    : "chat_completions";
}

const GROK_DIALOG_ENGINE: ChannelProviderDialogEngine<GrokProviderConfig> = {
  keyPrefix: "grokDialog",
  datalistId: "grok-vendor-fetched-models",
  presets: GROK_PROVIDER_PRESETS.map((preset) => ({
    id: preset.id,
    nameKey: preset.nameKey,
    baseUrl: preset.baseUrl,
    model: preset.model,
    maxContextSize: preset.maxContextSize,
    selectValue: preset.apiBackend,
  })),
  fetchModels: fetchGrokProviderModels,
  select: {
    labelSuffix: "apiBackend",
    options: GROK_API_BACKENDS.map((backend) => ({
      value: backend,
      labelSuffix: `apiBackendOptions.${GROK_API_BACKEND_OPTION_KEYS[backend]}`,
    })),
    defaultValue: "chat_completions",
    readStored: (provider) => provider.apiBackend,
    normalizeStored: normalizeApiBackend,
    normalizeInput: normalizeApiBackend,
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
    providerType: input.editing?.providerType,
    apiBackend: input.selectValue as GrokApiBackend,
    maxContextSize: input.maxContextSize,
    displayName: input.displayName,
  }),
};

export function GrokProviderDialog(props: GrokProviderDialogProps) {
  return <ChannelProviderDialog {...props} engine={GROK_DIALOG_ENGINE} />;
}
