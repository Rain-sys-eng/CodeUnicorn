import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { DelegationRun } from "../types";

export type AgentBridgeDetailsMode = "result" | "diff";

type AgentBridgeRunDetailsDialogProps = {
  mode: AgentBridgeDetailsMode;
  run: DelegationRun;
  onClose: () => void;
};

export function AgentBridgeRunDetailsDialog({
  mode,
  run,
  onClose,
}: AgentBridgeRunDetailsDialogProps) {
  const { t } = useTranslation();
  const titleId = `agent-bridge-details-${run.id}`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const dialog = (
    <div
      className="ab-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="ab-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="ab-dialog-header">
          <div>
            <h2 id={titleId}>
              {t(
                mode === "diff"
                  ? "multiAgent.bridge.diffTitle"
                  : "multiAgent.bridge.resultTitle",
              )}
            </h2>
            <p>
              {run.target.engineId} · {run.task}
            </p>
          </div>
          <button
            type="button"
            className="ab-dialog-close"
            autoFocus
            onClick={onClose}
          >
            {t("multiAgent.bridge.close")}
          </button>
        </header>

        {mode === "diff" ? (
          <pre className="ab-dialog-diff">{run.result?.diff}</pre>
        ) : (
          <div className="ab-dialog-body">
            {run.result?.summary ? (
              <section>
                <h3>{t("multiAgent.bridge.summary")}</h3>
                <p className="ab-dialog-summary">{run.result.summary}</p>
              </section>
            ) : null}
            {run.error ? (
              <section>
                <h3>{t("multiAgent.bridge.error")}</h3>
                <pre className="ab-dialog-error">{run.error}</pre>
              </section>
            ) : null}
            {run.result?.branch ? (
              <section>
                <h3>{t("multiAgent.bridge.branch")}</h3>
                <code>{run.result.branch}</code>
              </section>
            ) : null}
            {run.result?.artifactPath ? (
              <section>
                <h3>{t("multiAgent.bridge.artifact")}</h3>
                <code>{run.result.artifactPath}</code>
              </section>
            ) : null}
            {run.result?.changedFiles.length ? (
              <section>
                <h3>{t("multiAgent.bridge.changedFiles")}</h3>
                <ul>
                  {run.result.changedFiles.map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {!run.result?.summary &&
            !run.error &&
            !run.result?.branch &&
            !run.result?.artifactPath &&
            !run.result?.changedFiles.length ? (
              <p className="ab-dialog-empty">
                {t("multiAgent.bridge.noResultDetails")}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );

  return createPortal(dialog, document.body);
}
