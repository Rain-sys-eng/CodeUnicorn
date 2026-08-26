import { useState } from "react";
import { copyTextToClipboard } from "../../../utils/clipboard";
import type { LspLocationLike } from "../utils/fileViewNavigationUtils";
import type { CodeNavigationQueryStatus } from "../utils/fileViewNavigationUtils";
import {
  detectLanguageServerInstallPlatform,
  getLanguageServerInstallHint,
  relativePathFromFileUri,
} from "../utils/fileViewNavigationUtils";

type FileViewNavigationPanelProps = {
  workspacePath: string;
  navigationError: string | null;
  navigationStatus: CodeNavigationQueryStatus | null;
  onRetryNavigation: () => void;
  definitionCandidates: LspLocationLike[];
  onCloseDefinitionCandidates: () => void;
  implementationCandidates: LspLocationLike[];
  onCloseImplementationCandidates: () => void;
  referenceResults: LspLocationLike[] | null;
  onCloseReferenceResults: () => void;
  onNavigateToLocation: (location: LspLocationLike) => void;
  t: (key: string) => string;
};

export function FileViewNavigationPanel({
  workspacePath,
  navigationError,
  navigationStatus,
  onRetryNavigation,
  definitionCandidates,
  onCloseDefinitionCandidates,
  implementationCandidates,
  onCloseImplementationCandidates,
  referenceResults,
  onCloseReferenceResults,
  onNavigateToLocation,
  t,
}: FileViewNavigationPanelProps) {
  const [copiedInstallCommand, setCopiedInstallCommand] = useState<string | null>(null);
  const hasDefinitionCandidates = definitionCandidates.length > 0;
  const hasImplementationCandidates = implementationCandidates.length > 0;
  const hasReferenceResults = referenceResults !== null;
  const shouldShowTransientStatus = navigationStatus?.phase === "loading"
    || navigationStatus?.phase === "indexing"
    || navigationStatus?.phase === "error";
  if (
    !navigationError
    && !hasDefinitionCandidates
    && !hasImplementationCandidates
    && !hasReferenceResults
    && !shouldShowTransientStatus
  ) {
    return null;
  }

  const renderCandidates = (
    title: string,
    locations: LspLocationLike[],
    onClose: () => void,
  ) => locations.length > 0 ? (
    <div className="fvp-navigation-section">
      <div className="fvp-navigation-header">
        <span>{title}</span>
        <button
          type="button"
          className="ghost fvp-navigation-close"
          onClick={onClose}
        >
          {t("common.close")}
        </button>
      </div>
      <ul className="fvp-navigation-list">
        {locations.map((location, index) => {
          const relativePath = relativePathFromFileUri(location.uri, workspacePath);
          const path = relativePath || location.uri;
          return (
            <li key={`${location.uri}-${location.line}-${location.character}-${index}`}>
              <button
                type="button"
                className="fvp-navigation-item"
                onClick={() => onNavigateToLocation(location)}
              >
                <span className="fvp-navigation-path" title={path}>{path}</span>
                <span className="fvp-navigation-line">
                  L{location.line + 1}:C{location.character + 1}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  const actionLabel = navigationStatus?.action === "references"
    ? t("files.findReferences")
    : navigationStatus?.action === "implementation"
      ? t("files.gotoImplementations")
      : t("files.gotoDefinition");
  const modeLabel = navigationStatus?.phase === "loading"
    ? t("files.navigationPreparing")
    : navigationStatus?.phase === "indexing"
      ? navigationStatus.lifecycle === "indexing"
        ? t("files.navigationIndexing")
        : t("files.navigationTemporarilyDegraded")
    : navigationStatus?.mode === "semantic"
      ? t("files.navigationModeSemantic")
      : navigationStatus?.fallbackReasonCode
        ? t("files.navigationModeFastSearchFallback")
        : t("files.navigationModeFastSearch");
  const navigationLanguageLabel = navigationStatus?.language?.toLowerCase() === "java"
    ? "Java"
    : navigationStatus?.language;
  const installHint = navigationStatus?.fallbackReasonCode === "provider-unavailable"
    ? getLanguageServerInstallHint(
      navigationStatus.language,
      detectLanguageServerInstallPlatform(),
    )
    : null;
  const canCopyInstallCommand = typeof navigator !== "undefined"
    && typeof navigator.clipboard?.writeText === "function";
  const installPlatformLabel = installHint?.platform === "macos"
    ? "macOS"
    : installHint?.platform === "windows"
      ? "Windows"
      : "Linux";

  const copyInstallCommand = async () => {
    if (!installHint || !canCopyInstallCommand) {
      return;
    }
    if (await copyTextToClipboard(installHint.command)) {
      setCopiedInstallCommand(installHint.command);
    } else {
      setCopiedInstallCommand(null);
    }
  };

  return (
    <div className="fvp-navigation-panel">
      {navigationStatus ? (
        <div className={`fvp-navigation-status is-${navigationStatus.phase}`}>
          <span className="fvp-navigation-status-action">{actionLabel}</span>
          <span className="fvp-navigation-status-detail">
            {modeLabel}
            {navigationLanguageLabel ? ` · ${navigationLanguageLabel}` : ""}
            {navigationStatus.phase !== "loading" && navigationStatus.provider !== "heuristic"
              ? ` · ${navigationStatus.provider}`
              : ""}
            {navigationStatus.phase !== "loading"
              ? ` · ${navigationStatus.locations.length} ${t("files.navigationResults")}`
              : ""}
          </span>
          {navigationStatus.phase === "error" || navigationStatus.phase === "indexing" ? (
            <button
              type="button"
              className="ghost fvp-navigation-retry"
              onClick={onRetryNavigation}
            >
              {t("common.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {navigationStatus?.phase === "fallback" && navigationStatus.fallbackReasonCode ? (
        <div className="fvp-navigation-fallback-note">
          {installHint ? (
            <div className="fvp-navigation-install-hint">
              <div className="fvp-navigation-install-provider">
                {t("files.navigationLanguageServerMissing")}
                {navigationLanguageLabel ? ` · ${navigationLanguageLabel}` : ""}
              </div>
              <span className="fvp-navigation-install-label">
                {installHint.kind === "install"
                  ? t("files.navigationInstallCommand")
                  : t("files.navigationOpenInstallGuide")}
                {` · ${installPlatformLabel}`}
              </span>
              <div className="fvp-navigation-install-command-row">
                <code className="fvp-navigation-install-command">
                  {installHint.command}
                </code>
                {canCopyInstallCommand ? (
                  <button
                    type="button"
                    className="ghost fvp-navigation-install-copy"
                    onClick={() => void copyInstallCommand()}
                  >
                    {copiedInstallCommand === installHint.command
                      ? t("files.navigationInstallCommandCopied")
                      : t("files.navigationCopyInstallCommand")}
                  </button>
                ) : null}
              </div>
              <div className="fvp-navigation-install-actions">
                <button
                  type="button"
                  className="ghost fvp-navigation-install-retry"
                  onClick={onRetryNavigation}
                >
                  {t("files.navigationRetryAfterInstall")}
                </button>
              </div>
            </div>
          ) : (
            <div>{t("files.navigationFallbackNotice")}</div>
          )}
        </div>
      ) : null}
      {navigationError ? (
        <div
          className={navigationStatus?.phase === "error"
            ? "fvp-navigation-error"
            : "fvp-navigation-empty"}
        >
          {navigationError}
        </div>
      ) : null}
      {renderCandidates(
        t("files.definitionCandidates"),
        definitionCandidates,
        onCloseDefinitionCandidates,
      )}
      {renderCandidates(
        t("files.implementationCandidates"),
        implementationCandidates,
        onCloseImplementationCandidates,
      )}
      {hasReferenceResults ? (
        <div className="fvp-navigation-section">
          <div className="fvp-navigation-header">
            <span>{t("files.referenceResults")}</span>
            <button
              type="button"
              className="ghost fvp-navigation-close"
              onClick={onCloseReferenceResults}
            >
              {t("common.close")}
            </button>
          </div>
          {referenceResults && referenceResults.length > 0 ? (
            <ul className="fvp-navigation-list">
              {referenceResults.map((location, index) => {
                const relativePath = relativePathFromFileUri(location.uri, workspacePath);
                const path = relativePath || location.uri;
                return (
                  <li key={`${location.uri}-${location.line}-${location.character}-${index}`}>
                    <button
                      type="button"
                      className="fvp-navigation-item"
                      onClick={() => onNavigateToLocation(location)}
                    >
                      <span className="fvp-navigation-path" title={path}>
                        {path}
                      </span>
                      <span className="fvp-navigation-line">
                        L{location.line + 1}:C{location.character + 1}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="fvp-navigation-empty">{t("files.noReferencesFound")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
