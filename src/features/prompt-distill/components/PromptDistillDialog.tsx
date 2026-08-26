import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { EngineType } from "../../../types";
import { EngineIcon } from "../../engine/components/EngineIcon";
import type { DistillPhase } from "../hooks/usePromptDistillation";

interface PromptDistillDialogProps {
  isOpen: boolean;
  phase: DistillPhase;
  name: string;
  content: string;
  error: string | null;
  distillingEngine: EngineType;
  onNameChange: (name: string) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/**
 * 对话沉淀预览对话框：AI 提炼出的命令模板（含 $ARGUMENTS 参数位）经
 * 名称 + 内容编辑后保存为 workspace managed 自定义命令。样式复用
 * prompt-enhancer 的 overlay/dialog 类，保持视觉一致。
 */
export function PromptDistillDialog({
  isOpen,
  phase,
  name,
  content,
  error,
  distillingEngine,
  onNameChange,
  onContentChange,
  onSave,
  onClose,
}: PromptDistillDialogProps) {
  const { t } = useTranslation();
  const isBusy = phase === "distilling" || phase === "saving";
  const canSave = phase === "preview" && content.trim().length > 0;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="prompt-enhancer-overlay" onClick={handleOverlayClick}>
      <div
        className="prompt-enhancer-dialog"
        role="dialog"
        aria-label={t("promptDistill.dialogTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="prompt-enhancer-header">
          <div className="prompt-enhancer-title">
            <span className="codicon codicon-sparkle" />
            <h3>{t("promptDistill.dialogTitle")}</h3>
          </div>
          <button className="prompt-enhancer-close" onClick={onClose}>
            <span className="codicon codicon-close" />
          </button>
        </div>

        <p className="prompt-distill-description">
          {t("promptDistill.dialogDescription")}
        </p>

        <div className="prompt-enhancer-content">
          {phase === "distilling" ? (
            <div className="prompt-loading">
              <EngineIcon
                engine={distillingEngine}
                size={16}
                className="prompt-loading-engine-icon"
              />
              <span>{t("promptDistill.distilling")}</span>
            </div>
          ) : (
            <>
              <label className="prompt-enhancer-field">
                <span>{t("promptDistill.nameLabel")}</span>
                <input
                  className="prompt-enhancer-timeout"
                  type="text"
                  value={name}
                  placeholder={t("promptDistill.namePlaceholder")}
                  onChange={(event) => onNameChange(event.target.value)}
                  disabled={isBusy}
                />
              </label>
              <div className="prompt-section">
                <div className="prompt-section-header">
                  <span className="codicon codicon-edit" />
                  <span>{t("promptDistill.contentLabel")}</span>
                </div>
                <textarea
                  className="prompt-text enhanced-prompt prompt-distill-content"
                  value={content}
                  onChange={(event) => onContentChange(event.target.value)}
                  disabled={isBusy}
                  rows={10}
                />
              </div>
              <div className="prompt-distill-hint">{t("promptDistill.argumentsHint")}</div>
            </>
          )}
          {error ? (
            <div className="prompt-distill-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className="prompt-enhancer-footer">
          <button
            className="prompt-enhancer-btn secondary"
            onClick={onClose}
            disabled={phase === "saving"}
          >
            <span className="codicon codicon-close" />
            {t("promptDistill.cancel")}
          </button>
          <button
            className="prompt-enhancer-btn primary"
            onClick={onSave}
            disabled={!canSave || isBusy}
          >
            <span className="codicon codicon-check" />
            {phase === "saving" ? t("promptDistill.saving") : t("promptDistill.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
