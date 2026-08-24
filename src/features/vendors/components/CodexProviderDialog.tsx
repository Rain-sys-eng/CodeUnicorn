import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createId } from "@/utils/id";
import Shield from "lucide-react/dist/esm/icons/shield";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import type { CodexProviderConfig, CodexCustomModel } from "../types";
import {
  CODEX_PROVIDER_PRESETS,
  DEFAULT_CODEX_AUTH_JSON,
  OFFICIAL_CODEX_CONFIG_TOML,
  OFFICIAL_CODEX_PROVIDER_NAME,
  OFFICIAL_DIRECT_PRESET_ID,
} from "../types";
import {
  PROVIDER_BRAND_ICON_SRC,
  resolveProviderBrandIcon,
} from "../providerBrandIcon";
import { ProviderBrandIconImg } from "./ProviderBrandIconImg";

interface CodexProviderDialogProps {
  isOpen: boolean;
  provider: CodexProviderConfig | null;
  onClose: () => void;
  onSave: (provider: CodexProviderConfig) => void;
}

export function CodexProviderDialog({
  isOpen,
  provider,
  onClose,
  onSave,
}: CodexProviderDialogProps) {
  const { t } = useTranslation();
  const isAdding = !provider;

  const [providerName, setProviderName] = useState("");
  const [remark, setRemark] = useState("");
  const [configToml, setConfigToml] = useState("");
  const [authJson, setAuthJson] = useState("");
  const [customModels, setCustomModels] = useState<CodexCustomModel[]>([]);
  const [newModelId, setNewModelId] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");
  const [activePreset, setActivePreset] = useState("custom");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (isOpen) {
      if (provider) {
        setProviderName(provider.name || "");
        setRemark(provider.remark || "");
        setConfigToml(provider.configToml || "");
        setAuthJson(provider.authJson || "");
        setCustomModels(provider.customModels || []);
        setActivePreset("custom");
      } else {
        setProviderName(OFFICIAL_CODEX_PROVIDER_NAME);
        setRemark("");
        setConfigToml(OFFICIAL_CODEX_CONFIG_TOML);
        setAuthJson(DEFAULT_CODEX_AUTH_JSON);
        setCustomModels([]);
        setActivePreset(OFFICIAL_DIRECT_PRESET_ID);
      }
      setNewModelId("");
      setNewModelLabel("");
      setFormError("");
    }
  }, [isOpen, provider]);

  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const handlePresetClick = (presetId: string) => {
    setFormError("");
    if (presetId === OFFICIAL_DIRECT_PRESET_ID) {
      setActivePreset(OFFICIAL_DIRECT_PRESET_ID);
      setProviderName(OFFICIAL_CODEX_PROVIDER_NAME);
      setConfigToml(OFFICIAL_CODEX_CONFIG_TOML);
      setAuthJson(DEFAULT_CODEX_AUTH_JSON);
      return;
    }

    const preset = CODEX_PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setActivePreset(preset.id);
    setProviderName(preset.name);
    setConfigToml(preset.configToml);
    setAuthJson(preset.authJson);
  };

  // config.toml 不是 JSON,参考实现同样仅对合法 JSON 生效,失败提示 formatError
  const handleFormatConfigToml = () => {
    try {
      const parsed = JSON.parse(configToml);
      setConfigToml(JSON.stringify(parsed, null, 2));
      setFormError("");
    } catch {
      setFormError(t("settings.vendor.codexDialog.formatError"));
    }
  };

  const handleFormatAuthJson = () => {
    try {
      const parsed = JSON.parse(authJson);
      setAuthJson(JSON.stringify(parsed, null, 2));
      setFormError("");
    } catch {
      setFormError(t("settings.vendor.codexDialog.formatError"));
    }
  };

  const handleAddModel = () => {
    if (!newModelId.trim() || !newModelLabel.trim()) return;
    if (customModels.some((m) => m.id === newModelId.trim())) return;
    setCustomModels([
      ...customModels,
      { id: newModelId.trim(), label: newModelLabel.trim() },
    ]);
    setNewModelId("");
    setNewModelLabel("");
  };

  const handleRemoveModel = (id: string) => {
    setCustomModels(customModels.filter((m) => m.id !== id));
  };

  const handleSave = () => {
    if (!providerName.trim()) {
      setFormError(t("settings.vendor.codexDialog.nameRequired"));
      return;
    }

    if (authJson.trim()) {
      try {
        JSON.parse(authJson);
      } catch {
        setFormError(t("settings.vendor.codexDialog.authJsonError"));
        return;
      }
    }

    const providerData: CodexProviderConfig = {
      id: provider?.id || createId(),
      name: providerName.trim(),
      remark: remark.trim() || undefined,
      createdAt: provider?.createdAt,
      configToml: configToml.trim(),
      authJson: authJson.trim(),
      customModels: customModels.length > 0 ? customModels : undefined,
    };

    onSave(providerData);
  };

  if (!isOpen) return null;

  return (
    <div className="vendor-dialog-overlay" onClick={onClose}>
      <div
        className="vendor-dialog vendor-dialog-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vendor-dialog-header">
          <h3>
            {isAdding
              ? t("settings.vendor.codexDialog.addTitle")
              : t("settings.vendor.codexDialog.editTitle", {
                  name: provider?.name,
                })}
          </h3>
          <button type="button" className="vendor-dialog-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="vendor-dialog-body">
          {isAdding && (
            <>
              <div className="vendor-security-notice">
                <Shield size={14} />
                <span>{t("settings.vendor.dialog.securityNotice")}</span>
              </div>

              <div className="vendor-preset-group">
                <div className="vendor-preset-title">
                  {t("settings.vendor.dialog.officialSectionTitle")}
                </div>
                <div className="vendor-preset-buttons">
                  <button
                    type="button"
                    className={`vendor-preset-btn ${
                      activePreset === OFFICIAL_DIRECT_PRESET_ID ? "active" : ""
                    }`}
                    onClick={() => handlePresetClick(OFFICIAL_DIRECT_PRESET_ID)}
                  >
                    <span className="vendor-preset-btn-icon" aria-hidden>
                      <ProviderBrandIconImg
                        src={PROVIDER_BRAND_ICON_SRC.openai}
                      />
                    </span>
                    {t("settings.vendor.codexDialog.officialPreset")}
                  </button>
                </div>
                <small className="vendor-hint">
                  {t("settings.vendor.codexDialog.officialSectionHint")}
                </small>
              </div>

              <div className="vendor-preset-group">
                <div className="vendor-preset-title">
                  {t("settings.vendor.dialog.proxySectionTitle")}
                </div>
                <div className="vendor-preset-buttons">
                  {CODEX_PROVIDER_PRESETS.map((preset) => {
                    const brandIconSrc =
                      preset.id === "custom"
                        ? null
                        : resolveProviderBrandIcon({ presetId: preset.id });
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`vendor-preset-btn ${
                          activePreset === preset.id ? "active" : ""
                        }`}
                        onClick={() => handlePresetClick(preset.id)}
                      >
                        <span className="vendor-preset-btn-icon" aria-hidden>
                          {brandIconSrc ? (
                            <ProviderBrandIconImg src={brandIconSrc} />
                          ) : (
                            <SlidersHorizontal size={14} strokeWidth={2.1} />
                          )}
                        </span>
                        {t(preset.nameKey)}
                      </button>
                    );
                  })}
                </div>
                <small className="vendor-hint">
                  {t("settings.vendor.codexDialog.presetHint")}
                </small>
              </div>
            </>
          )}

          <div className="vendor-form-group">
            <label>{t("settings.vendor.dialog.providerName")} *</label>
            <input
              type="text"
              className="vendor-input"
              placeholder={t("settings.vendor.codexDialog.namePlaceholder")}
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

          <div className="vendor-form-group">
            <div className="vendor-form-label-row">
              <label>config.toml *</label>
              <button
                type="button"
                className="vendor-btn-format"
                onClick={handleFormatConfigToml}
                title={t("settings.vendor.codexDialog.formatJson")}
              >
                {t("settings.vendor.codexDialog.formatJson")}
              </button>
            </div>
            <textarea
              className="vendor-code-editor"
              value={configToml}
              onChange={(e) => setConfigToml(e.target.value)}
              rows={12}
            />
            <small className="vendor-hint">
              {t("settings.vendor.codexDialog.configHint")}
            </small>
          </div>

          <div className="vendor-form-group">
            <div className="vendor-form-label-row">
              <label>auth.json</label>
              <button
                type="button"
                className="vendor-btn-format"
                onClick={handleFormatAuthJson}
                title={t("settings.vendor.codexDialog.formatJson")}
              >
                {t("settings.vendor.codexDialog.formatJson")}
              </button>
            </div>
            <textarea
              className="vendor-code-editor"
              value={authJson}
              onChange={(e) => setAuthJson(e.target.value)}
              rows={5}
            />
            <small className="vendor-hint">
              {t("settings.vendor.codexDialog.authHint")}
            </small>
          </div>

          <div className="vendor-form-group">
            <label>
              {t("settings.vendor.codexDialog.customModels")}{" "}
              <span className="vendor-optional">
                ({t("settings.vendor.optional")})
              </span>
            </label>
            <div className="vendor-custom-models">
              {customModels.map((model) => (
                <div key={model.id} className="vendor-model-item">
                  <span className="vendor-model-id">{model.id}</span>
                  <span className="vendor-model-label">{model.label}</span>
                  <button
                    type="button"
                    className="vendor-btn-icon vendor-btn-danger"
                    onClick={() => handleRemoveModel(model.id)}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <div className="vendor-model-add">
                <input
                  type="text"
                  className="vendor-input vendor-input-sm"
                  placeholder="Model ID"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                />
                <input
                  type="text"
                  className="vendor-input vendor-input-sm"
                  placeholder="Label"
                  value={newModelLabel}
                  onChange={(e) => setNewModelLabel(e.target.value)}
                />
                <button
                  type="button"
                  className="vendor-btn-add-sm"
                  onClick={handleAddModel}
                  disabled={!newModelId.trim() || !newModelLabel.trim()}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {formError && (
            <div className="vendor-json-error" role="alert">
              {formError}
            </div>
          )}
        </div>

        <div className="vendor-dialog-footer">
          <button type="button" className="vendor-btn-cancel" onClick={onClose}>
            {t("settings.vendor.cancel")}
          </button>
          <button
            type="button"
            className="vendor-btn-save"
            onClick={handleSave}
            disabled={!providerName.trim()}
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
