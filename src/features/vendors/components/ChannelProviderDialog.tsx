import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import { createId } from "@/utils/id";

/**
 * Grok / Kimi 等「baseUrl + apiKey + 单模型」渠道型引擎共用的 provider 编辑对话框。
 * 引擎差异（i18n 前缀、presets、拉模型接口、引擎特有下拉字段、payload 构造）
 * 全部经 ChannelProviderDialogEngine 注入；请勿再为新引擎复制整份对话框。
 */

export type ChannelProviderDialogPreset = {
  id: string;
  nameKey: string;
  baseUrl: string;
  model: string;
  maxContextSize?: number;
  /** 该 preset 应用到引擎特有下拉字段的值 */
  selectValue: string;
};

export interface ChannelProviderDialogSaveInput<P> {
  editing: P | null;
  id: string;
  name: string;
  remark: string | undefined;
  baseUrl: string;
  apiKey: string;
  model: string;
  selectValue: string;
  maxContextSize: number | undefined;
  displayName: string | undefined;
}

export interface ChannelProviderDialogEngine<P> {
  /** i18n 片段：settings.vendor.<keyPrefix>.* */
  keyPrefix: string;
  datalistId: string;
  presets: readonly ChannelProviderDialogPreset[];
  fetchModels: (
    baseUrl: string,
    apiKey: string,
  ) => Promise<{ models: string[] }>;
  select: {
    /** label 的 i18n key 片段（相对 keyPrefix），如 "apiBackend" */
    labelSuffix: string;
    /** value + 选项文案 key 片段（相对 keyPrefix） */
    options: readonly { value: string; labelSuffix: string }[];
    defaultValue: string;
    /** 从存量 provider 读取该字段 */
    readStored: (provider: P) => string | undefined;
    /** 初始化存量值时的归一化 */
    normalizeStored: (value: string | undefined) => string;
    /** onChange 时的归一化（不需要则原样返回） */
    normalizeInput: (value: string) => string;
  };
  buildProvider: (input: ChannelProviderDialogSaveInput<P>) => P;
}

interface ChannelProviderDialogProps<
  P extends {
    id: string;
    name: string;
    remark?: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    maxContextSize?: number;
    displayName?: string;
  },
> {
  isOpen: boolean;
  provider: P | null;
  engine: ChannelProviderDialogEngine<P>;
  onClose: () => void;
  onSave: (provider: P) => void;
}

function detectMatchingPreset(
  presets: readonly ChannelProviderDialogPreset[],
  baseUrl: string,
): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "custom";
  }
  const matched = presets.find(
    (preset) => preset.id !== "custom" && preset.baseUrl === trimmed,
  );
  return matched?.id ?? "custom";
}

export function ChannelProviderDialog<
  P extends {
    id: string;
    name: string;
    remark?: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    maxContextSize?: number;
    displayName?: string;
  },
>({ isOpen, provider, engine, onClose, onSave }: ChannelProviderDialogProps<P>) {
  const { t } = useTranslation();
  const isAdding = !provider;
  const tp = (suffix: string) => t(`settings.vendor.${engine.keyPrefix}.${suffix}`);

  const [providerName, setProviderName] = useState("");
  const [activePreset, setActivePreset] = useState("custom");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState("");
  const [selectValue, setSelectValue] = useState(engine.select.defaultValue);
  const [maxContextSize, setMaxContextSize] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [remark, setRemark] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (provider) {
      setProviderName(provider.name || "");
      setBaseUrl(provider.baseUrl || "");
      setApiKey(provider.apiKey || "");
      setModel(provider.model || "");
      setSelectValue(
        engine.select.normalizeStored(engine.select.readStored(provider)),
      );
      setMaxContextSize(
        provider.maxContextSize ? String(provider.maxContextSize) : "",
      );
      setDisplayName(provider.displayName || "");
      setRemark(provider.remark || "");
      setActivePreset(
        detectMatchingPreset(engine.presets, provider.baseUrl || ""),
      );
    } else {
      setProviderName("");
      setBaseUrl("");
      setApiKey("");
      setModel("");
      setSelectValue(engine.select.defaultValue);
      setMaxContextSize("");
      setDisplayName("");
      setRemark("");
      setActivePreset("custom");
    }
    setShowApiKey(false);
    setFetchedModels([]);
    setIsFetchingModels(false);
    setModelFetchError("");
  }, [isOpen, provider, engine]);

  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const handlePresetChange = (presetId: string) => {
    const preset = engine.presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setActivePreset(presetId);
    setFetchedModels([]);
    setModelFetchError("");
    setBaseUrl(preset.baseUrl);
    setSelectValue(preset.selectValue);
    setModel(preset.model);
    setMaxContextSize(
      preset.maxContextSize ? String(preset.maxContextSize) : "",
    );
  };

  const handleFetchModels = async () => {
    const trimmedBaseUrl = baseUrl.trim();
    if (!trimmedBaseUrl) {
      setModelFetchError(t("settings.vendor.dialog.fetchModelsNeedUrl"));
      return;
    }

    setIsFetchingModels(true);
    setModelFetchError("");
    try {
      const result = await engine.fetchModels(trimmedBaseUrl, apiKey);
      setFetchedModels(result.models);
      setModelFetchError(
        result.models.length === 0
          ? t("settings.vendor.dialog.fetchModelsEmpty")
          : "",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : t("settings.vendor.dialog.fetchModelsError");
      setModelFetchError(message || t("settings.vendor.dialog.fetchModelsError"));
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleSave = () => {
    if (!providerName.trim() || !baseUrl.trim() || !model.trim()) return;

    const parsedMaxContextSize = maxContextSize.trim()
      ? Number.parseInt(maxContextSize.trim(), 10)
      : NaN;

    onSave(
      engine.buildProvider({
        editing: provider,
        id: provider?.id || createId(),
        name: providerName.trim(),
        remark: remark.trim() || undefined,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        selectValue,
        maxContextSize: Number.isFinite(parsedMaxContextSize)
          ? parsedMaxContextSize
          : undefined,
        displayName: displayName.trim() || undefined,
      }),
    );
  };

  if (!isOpen) return null;

  return (
    <div className="vendor-dialog-overlay" onClick={onClose}>
      <div
        className="vendor-dialog vendor-dialog-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vendor-dialog-header">
          <h3>{isAdding ? tp("addTitle") : tp("editTitle")}</h3>
          <button type="button" className="vendor-dialog-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="vendor-dialog-body">
          <div className="vendor-form-group">
            <label>{tp("preset")}</label>
            <select
              className="vendor-input"
              value={activePreset}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {engine.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t(preset.nameKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="vendor-form-grid vendor-form-grid-provider-meta">
            <div className="vendor-form-group">
              <label>{t("settings.vendor.dialog.providerName")} *</label>
              <input
                type="text"
                className="vendor-input"
                placeholder={tp("namePlaceholder")}
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
              />
            </div>

            <div className="vendor-form-group">
              <label>{t("settings.vendor.dialog.remark")}</label>
              <input
                type="text"
                className="vendor-input"
                placeholder={t("settings.vendor.dialog.remarkPlaceholder")}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>
          </div>

          <div className="vendor-form-group">
            <label>{tp("baseUrl")} *</label>
            <input
              type="text"
              className="vendor-input"
              placeholder={tp("baseUrlPlaceholder")}
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setActivePreset(
                  detectMatchingPreset(engine.presets, e.target.value),
                );
              }}
            />
          </div>

          <div className="vendor-form-group">
            <label>{t("settings.vendor.dialog.apiKey")}</label>
            <div className="vendor-input-row">
              <input
                type={showApiKey ? "text" : "password"}
                className="vendor-input"
                placeholder={tp("apiKeyPlaceholder")}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="vendor-btn-icon"
                onClick={() => setShowApiKey((current) => !current)}
                title={
                  showApiKey
                    ? t("settings.vendor.hide")
                    : t("settings.vendor.show")
                }
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="vendor-form-group">
            <label>{tp("model")} *</label>
            <div className="vendor-model-fetch">
              <button
                type="button"
                onClick={handleFetchModels}
                disabled={isFetchingModels || !baseUrl.trim()}
              >
                {isFetchingModels
                  ? t("settings.vendor.dialog.fetchModelsLoading")
                  : t("settings.vendor.dialog.fetchModels")}
              </button>
              {modelFetchError ? (
                <span className="vendor-model-fetch-error">{modelFetchError}</span>
              ) : fetchedModels.length > 0 ? (
                <span className="vendor-hint">
                  {t("settings.vendor.dialog.fetchModelsCount", {
                    count: fetchedModels.length,
                  })}
                </span>
              ) : null}
            </div>
            <input
              type="text"
              list={engine.datalistId}
              className="vendor-input"
              placeholder={tp("modelPlaceholder")}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id={engine.datalistId}>
              {fetchedModels.map((fetchedModel) => (
                <option key={fetchedModel} value={fetchedModel} />
              ))}
            </datalist>
          </div>

          <div className="vendor-form-grid vendor-form-grid-provider-meta">
            <div className="vendor-form-group">
              <label>{tp(engine.select.labelSuffix)}</label>
              <select
                className="vendor-input"
                value={selectValue}
                onChange={(e) =>
                  setSelectValue(engine.select.normalizeInput(e.target.value))
                }
              >
                {engine.select.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {tp(option.labelSuffix)}
                  </option>
                ))}
              </select>
            </div>

            <div className="vendor-form-group">
              <label>
                {tp("maxContextSize")}{" "}
                <span className="vendor-optional">
                  ({t("settings.vendor.optional")})
                </span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="vendor-input"
                placeholder={tp("maxContextSizePlaceholder")}
                value={maxContextSize}
                onChange={(e) => setMaxContextSize(e.target.value)}
              />
            </div>
          </div>

          <div className="vendor-form-group">
            <label>
              {tp("displayName")}{" "}
              <span className="vendor-optional">
                ({t("settings.vendor.optional")})
              </span>
            </label>
            <input
              type="text"
              className="vendor-input"
              placeholder={tp("displayNamePlaceholder")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>

        <div className="vendor-dialog-footer">
          <button type="button" className="vendor-btn-cancel" onClick={onClose}>
            {t("settings.vendor.cancel")}
          </button>
          <button
            type="button"
            className="vendor-btn-save"
            onClick={handleSave}
            disabled={
              !providerName.trim() || !baseUrl.trim() || !model.trim()
            }
          >
            {isAdding
              ? t("settings.vendor.dialog.confirmAdd")
              : t("settings.vendor.dialog.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
