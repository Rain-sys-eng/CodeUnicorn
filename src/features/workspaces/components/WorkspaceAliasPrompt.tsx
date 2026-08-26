import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { loadWorkspaceAliasModalStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";

type WorkspaceAliasPromptProps = {
  workspaceName: string;
  alias: string;
  error: string | null;
  isBusy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WorkspaceAliasPrompt({
  workspaceName,
  alias,
  error,
  isBusy,
  onChange,
  onCancel,
  onConfirm,
}: WorkspaceAliasPromptProps) {
  const stylesReady = useFeatureStylesReady(loadWorkspaceAliasModalStyles);
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (!stylesReady) {
    return null;
  }

  return (
    <div
      className="alias-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.workspaceAliasDialogTitle")}
    >
      <div className="alias-modal-backdrop" onClick={isBusy ? undefined : onCancel} />
      <div className="alias-modal-card">
        <div className="alias-modal-title">
          {t("sidebar.workspaceAliasDialogTitle")}
        </div>
        <div className="alias-modal-subtitle">
          <Trans
            i18nKey="sidebar.workspaceAliasDialogSubtitle"
            values={{ name: workspaceName }}
            components={{ code: <code className="alias-modal-subtitle-name" /> }}
          />
        </div>
        <label className="alias-modal-label" htmlFor="workspace-alias">
          {t("sidebar.workspaceAliasLabel")}
        </label>
        <input
          id="workspace-alias"
          ref={inputRef}
          className="alias-modal-input"
          value={alias}
          placeholder={t("sidebar.workspaceAliasPlaceholder")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              if (!isBusy) {
                onCancel();
              }
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (!isBusy) {
                onConfirm();
              }
            }
          }}
          disabled={isBusy}
        />
        <div className="alias-modal-hint">
          {t("sidebar.workspaceAliasEmptyHint")}
        </div>
        {error ? <div className="alias-modal-error">{error}</div> : null}
        <div className="alias-modal-actions">
          <button
            className="ghost"
            onClick={onCancel}
            type="button"
            disabled={isBusy}
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary"
            onClick={onConfirm}
            type="button"
            disabled={isBusy}
          >
            {isBusy ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
