import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "@/types";
import {
  getDaemonStatus,
  getWebAssetsStatus,
  getWebServerStatus,
  installWebAssets,
  installWebAssetsFromFile,
  pickWebAssetsArchive,
  startDaemon,
  startWebServer,
  stopDaemon,
  stopWebServer,
  type DaemonStatus,
  type WebServerStatus,
  type WebAssetsStatus,
} from "@/services/tauri";
import { copyTextToClipboard } from "@/utils/clipboard";
import { WebAssetsPackageSection } from "./WebAssetsPackageSection";

type WebServiceSettingsProps = {
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  generateFixedToken?: () => string;
};

type WebServiceAction =
  | "start"
  | "stop"
  | "refresh"
  | "save-token"
  | "clear-token"
  | "generate-token"
  | "daemon-start"
  | "daemon-stop"
  | "daemon-refresh"
  | null;

type WebAssetsAction = "checking" | "installing" | "selecting-local" | "installing-local" | null;

function parseWebServicePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function maskToken(token: string) {
  if (token.length <= 8) {
    return "•".repeat(Math.max(token.length, 6));
  }
  return `${token.slice(0, 4)}${"•".repeat(20)}${token.slice(-4)}`;
}

function normalizeFixedWebServiceToken(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function isLoopbackRpcEndpoint(endpoint: string): boolean {
  const host = endpoint
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .split("/", 1)[0]
    ?.toLowerCase();
  return Boolean(
    host === "localhost" ||
      host?.startsWith("localhost:") ||
      host === "::1" ||
      host?.startsWith("[::1]:") ||
      host?.startsWith("127."),
  );
}

export function generateFixedWebServiceToken(
  getRandomValues: Crypto["getRandomValues"] = globalThis.crypto.getRandomValues.bind(
    globalThis.crypto,
  ),
): string {
  const bytes = new Uint8Array(24);
  getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function humanizeWebServiceError(
  t: (key: string) => string,
  raw: string,
): string {
  if (!raw) {
    return raw;
  }
  if (raw.startsWith("WEB_SERVICE_ALREADY_RUNNING")) {
    return t("settings.webServiceErrorAlreadyRunning");
  }
  if (raw.startsWith("WEB_SERVICE_PORT_INVALID")) {
    return t("settings.webServiceErrorPortInvalid");
  }
  if (raw.startsWith("WEB_SERVICE_PORT_IN_USE")) {
    return t("settings.webServiceErrorPortInUse");
  }
  if (raw.startsWith("WEB_SERVICE_BIND_FAILED")) {
    return t("settings.webServiceErrorBindFailed");
  }
  if (raw.startsWith("WEB_SERVICE_STOP_TIMEOUT")) {
    return t("settings.webServiceErrorStopTimeout");
  }
  if (raw.startsWith("WEB_ASSETS_NOT_READY")) {
    return t("settings.webServiceErrorAssetsNotReady");
  }
  if (raw.includes("Failed to connect to remote backend")) {
    return t("settings.webServiceErrorDaemonUnavailable");
  }
  if (raw.includes("unauthorized") || raw.includes("invalid token")) {
    return t("settings.webServiceErrorDaemonAuth");
  }
  return raw;
}

export function WebServiceSettings({
  t,
  appSettings,
  onUpdateAppSettings,
  generateFixedToken = generateFixedWebServiceToken,
}: WebServiceSettingsProps) {
  const [portDraft, setPortDraft] = useState(String(appSettings.webServicePort ?? 3080));
  const [fixedTokenDraft, setFixedTokenDraft] = useState(appSettings.webServiceToken ?? "");
  const [status, setStatus] = useState<WebServerStatus | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [webAssetsStatus, setWebAssetsStatus] = useState<WebAssetsStatus | null>(null);
  const [webAssetsAction, setWebAssetsAction] = useState<WebAssetsAction>("checking");
  const [webAssetsError, setWebAssetsError] = useState<string | null>(null);
  const [webAssetsNotice, setWebAssetsNotice] = useState<string | null>(null);
  const [action, setAction] = useState<WebServiceAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);

  const parsedPort = useMemo(() => parseWebServicePort(portDraft), [portDraft]);
  const running = Boolean(status?.running);
  const rpcEndpoint =
    status?.rpcEndpoint || daemonStatus?.host || appSettings.remoteBackendHost;
  const daemonRunning = Boolean(daemonStatus?.running);
  const webAssetsReady = webAssetsStatus?.state === "ready";
  const webAssetsRequired =
    isLoopbackRpcEndpoint(rpcEndpoint) &&
    webAssetsStatus?.installationRequired !== false;
  const webAssetsAvailable = !webAssetsRequired || webAssetsReady;
  const webPort = status?.webPort ?? parsedPort ?? appSettings.webServicePort;
  const addresses = status?.addresses ?? [];
  const rawToken = status?.webAccessToken ?? null;
  const tokenToDisplay = rawToken
    ? showToken
      ? rawToken
      : maskToken(rawToken)
    : "";
  const normalizedFixedToken = normalizeFixedWebServiceToken(
    appSettings.webServiceToken,
  );
  const fixedTokenDraftNormalized =
    normalizeFixedWebServiceToken(fixedTokenDraft);
  const hasFixedTokenDraftChange =
    fixedTokenDraftNormalized !== normalizedFixedToken;

  const refreshDaemonStatus = useCallback(async () => {
    setAction("daemon-refresh");
    try {
      const next = await getDaemonStatus();
      setDaemonStatus(next);
      if (next.lastError) {
        setError(humanizeWebServiceError(t, next.lastError));
      }
    } catch (daemonError) {
      setError(
        humanizeWebServiceError(
          t,
          daemonError instanceof Error
            ? daemonError.message
            : String(daemonError),
        ),
      );
    } finally {
      setAction(null);
    }
  }, [t]);

  const refreshStatus = useCallback(async () => {
    setAction("refresh");
    try {
      const next = await getWebServerStatus();
      setStatus(next);
      setError(
        next.lastError ? humanizeWebServiceError(t, next.lastError) : null,
      );
    } catch (refreshError) {
      setError(
        humanizeWebServiceError(
          t,
          refreshError instanceof Error
            ? refreshError.message
            : String(refreshError),
        ),
      );
    } finally {
      setAction(null);
    }
  }, [t]);

  const refreshWebAssetsStatus = useCallback(async (announce = false) => {
    setWebAssetsAction("checking");
    setWebAssetsError(null);
    if (announce) {
      setWebAssetsNotice(t("settings.webServiceAssetsRecheckProgress"));
    }
    try {
      const next = await getWebAssetsStatus();
      setWebAssetsStatus(next);
      setWebAssetsError(next.lastError);
      if (announce) {
        setWebAssetsNotice(
          next.lastError
            ? null
            : next.state === "ready"
              ? t("settings.webServiceAssetsRecheckSuccess").replace(
                  "{{version}}",
                  next.installedVersion ?? next.requiredVersion,
                )
              : t("settings.webServiceAssetsRecheckComplete"),
        );
      }
    } catch (assetsError) {
      setWebAssetsNotice(null);
      setWebAssetsError(
        assetsError instanceof Error ? assetsError.message : String(assetsError),
      );
    } finally {
      setWebAssetsAction(null);
    }
  }, [t]);

  useEffect(() => {
    void refreshStatus();
    void refreshDaemonStatus();
    void refreshWebAssetsStatus();
  }, [refreshDaemonStatus, refreshStatus, refreshWebAssetsStatus]);

  useEffect(() => {
    setPortDraft(String(appSettings.webServicePort ?? 3080));
  }, [appSettings.webServicePort]);

  useEffect(() => {
    setFixedTokenDraft(appSettings.webServiceToken ?? "");
  }, [appSettings.webServiceToken]);

  useEffect(() => {
    if (!copiedMessage) {
      return;
    }
    const timer = window.setTimeout(() => setCopiedMessage(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedMessage]);

  const savePort = useCallback(async () => {
    if (parsedPort == null) {
      setError(t("settings.webServicePortInvalid"));
      return false;
    }
    if (parsedPort === appSettings.webServicePort) {
      return true;
    }
    await onUpdateAppSettings({
      ...appSettings,
      webServicePort: parsedPort,
    });
    return true;
  }, [appSettings, onUpdateAppSettings, parsedPort, t]);

  const saveFixedToken = useCallback(
    async (token: string | null) => {
      const normalizedToken = normalizeFixedWebServiceToken(token);
      setAction("save-token");
      setError(null);
      try {
        await onUpdateAppSettings({
          ...appSettings,
          webServiceToken: normalizedToken,
        });
        setFixedTokenDraft(normalizedToken ?? "");
      } catch (tokenError) {
        setError(
          tokenError instanceof Error ? tokenError.message : String(tokenError),
        );
      } finally {
        setAction(null);
      }
    },
    [appSettings, onUpdateAppSettings],
  );

  const clearFixedToken = useCallback(async () => {
    setAction("clear-token");
    setError(null);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        webServiceToken: null,
      });
      setFixedTokenDraft("");
    } catch (tokenError) {
      setError(
        tokenError instanceof Error ? tokenError.message : String(tokenError),
      );
    } finally {
      setAction(null);
    }
  }, [appSettings, onUpdateAppSettings]);

  const generateAndSaveFixedToken = useCallback(async () => {
    setAction("generate-token");
    setError(null);
    try {
      const nextToken = generateFixedToken();
      await onUpdateAppSettings({
        ...appSettings,
        webServiceToken: nextToken,
      });
      setFixedTokenDraft(nextToken);
    } catch (tokenError) {
      setError(
        tokenError instanceof Error ? tokenError.message : String(tokenError),
      );
    } finally {
      setAction(null);
    }
  }, [appSettings, generateFixedToken, onUpdateAppSettings]);

  const handleStart = useCallback(async () => {
    if (!webAssetsAvailable) {
      setError(t("settings.webServiceAssetsRequired"));
      return;
    }
    if (parsedPort == null) {
      setError(t("settings.webServicePortInvalid"));
      return;
    }
    setAction("start");
    setError(null);
    try {
      await savePort();
      const next = await startWebServer({
        port: parsedPort,
        token: fixedTokenDraftNormalized,
      });
      setStatus(next);
      setError(
        next.lastError ? humanizeWebServiceError(t, next.lastError) : null,
      );
    } catch (startError) {
      setError(
        humanizeWebServiceError(
          t,
          startError instanceof Error ? startError.message : String(startError),
        ),
      );
    } finally {
      setAction(null);
    }
  }, [fixedTokenDraftNormalized, parsedPort, savePort, t, webAssetsAvailable]);

  const handleInstallWebAssets = useCallback(async () => {
    setWebAssetsAction("installing");
    setWebAssetsError(null);
    setWebAssetsNotice(t("settings.webServiceAssetsInstallProgress"));
    try {
      const next = await installWebAssets();
      setWebAssetsStatus(next);
      setWebAssetsError(next.lastError);
      setWebAssetsNotice(
        next.lastError || next.state !== "ready"
          ? null
          : t("settings.webServiceAssetsInstallSuccess").replace(
              "{{version}}",
              next.installedVersion ?? next.requiredVersion,
            ),
      );
    } catch (assetsError) {
      setWebAssetsNotice(null);
      setWebAssetsError(
        assetsError instanceof Error ? assetsError.message : String(assetsError),
      );
    } finally {
      setWebAssetsAction(null);
    }
  }, [t]);

  const handleInstallLocalWebAssets = useCallback(async () => {
    setWebAssetsAction("selecting-local");
    setWebAssetsError(null);
    setWebAssetsNotice(t("settings.webServiceAssetsSelectLocalProgress"));
    try {
      const archivePath = await pickWebAssetsArchive();
      if (!archivePath) {
        setWebAssetsNotice(null);
        return;
      }
      setWebAssetsAction("installing-local");
      setWebAssetsNotice(t("settings.webServiceAssetsInstallLocalProgress"));
      const next = await installWebAssetsFromFile(archivePath);
      setWebAssetsStatus(next);
      setWebAssetsError(next.lastError);
      setWebAssetsNotice(
        next.lastError || next.state !== "ready"
          ? null
          : t("settings.webServiceAssetsInstallLocalSuccess").replace(
              "{{version}}",
              next.installedVersion ?? next.requiredVersion,
            ),
      );
    } catch (assetsError) {
      setWebAssetsNotice(null);
      setWebAssetsError(
        assetsError instanceof Error ? assetsError.message : String(assetsError),
      );
    } finally {
      setWebAssetsAction(null);
    }
  }, [t]);

  const handleStop = useCallback(async () => {
    setAction("stop");
    setError(null);
    try {
      const next = await stopWebServer();
      setStatus(next);
      setError(
        next.lastError ? humanizeWebServiceError(t, next.lastError) : null,
      );
      setShowToken(false);
    } catch (stopError) {
      setError(
        humanizeWebServiceError(
          t,
          stopError instanceof Error ? stopError.message : String(stopError),
        ),
      );
    } finally {
      setAction(null);
    }
  }, [t]);

  const handleStartDaemon = useCallback(async () => {
    setAction("daemon-start");
    setError(null);
    try {
      const next = await startDaemon();
      setDaemonStatus(next);
      if (next.lastError) {
        setError(humanizeWebServiceError(t, next.lastError));
      } else {
        await refreshStatus();
      }
    } catch (daemonError) {
      setError(
        humanizeWebServiceError(
          t,
          daemonError instanceof Error
            ? daemonError.message
            : String(daemonError),
        ),
      );
    } finally {
      setAction(null);
    }
  }, [refreshStatus, t]);

  const handleStopDaemon = useCallback(async () => {
    setAction("daemon-stop");
    setError(null);
    try {
      const next = await stopDaemon();
      setDaemonStatus(next);
      if (next.lastError) {
        setError(humanizeWebServiceError(t, next.lastError));
      } else {
        await refreshStatus();
      }
    } catch (daemonError) {
      setError(
        humanizeWebServiceError(
          t,
          daemonError instanceof Error
            ? daemonError.message
            : String(daemonError),
        ),
      );
    } finally {
      setAction(null);
    }
  }, [refreshStatus, t]);

  const handleCopy = useCallback(
    async (value: string) => {
      if (await copyTextToClipboard(value)) {
        setCopiedMessage(t("settings.webServiceCopied"));
      } else {
        setError(t("settings.webServiceCopyFailed"));
      }
    },
    [t],
  );

  const isBusy = action != null;
  const portDirty =
    parsedPort != null && parsedPort !== appSettings.webServicePort;

  return (
    <div className="settings-basic-web-service settings-basic-surface">
      <div className="settings-pref-card-head settings-web-page-head">
        <div className="settings-pref-title">{t("settings.webServiceTitle")}</div>
        <div className="settings-pref-desc">
          {t("settings.webServiceDescription")}
        </div>
      </div>

      {/* 1. 运行状态 */}
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card">
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.webServiceStatus")}
            </div>
            <div className="settings-pref-desc settings-web-status-line">
              <span
                className={`settings-web-status-dot${running ? " is-ready" : ""}`}
                aria-hidden
              />
              {running
                ? t("settings.webServiceRunning")
                : t("settings.webServiceStopped")}
            </div>
          </div>
          <div className="settings-pref-control settings-web-actions">
            <button
              type="button"
              className="settings-web-btn"
              onClick={() => {
                void refreshStatus();
              }}
              disabled={isBusy}
            >
              {t("settings.refresh")}
            </button>
            {running ? (
              <button
                type="button"
                className="settings-web-btn"
                onClick={() => {
                  void handleStop();
                }}
                disabled={isBusy}
              >
                {action === "stop"
                  ? t("settings.running")
                  : t("settings.webServiceStop")}
              </button>
            ) : (
              <button
                type="button"
                className="settings-web-btn settings-web-btn--primary"
                onClick={() => {
                  void handleStart();
                }}
                disabled={isBusy || parsedPort == null || !webAssetsAvailable}
              >
                {action === "start"
                  ? t("settings.running")
                  : t("settings.webServiceStart")}
              </button>
            )}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.webServiceDaemonStatus")}
            </div>
            <div className="settings-pref-desc settings-web-status-line">
              <span
                className={`settings-web-status-dot${
                  daemonRunning ? " is-ready" : ""
                }`}
                aria-hidden
              />
              {daemonRunning
                ? t("settings.webServiceDaemonRunning")
                : t("settings.webServiceDaemonStopped")}
            </div>
          </div>
          <div className="settings-pref-control settings-web-actions">
            <button
              type="button"
              className="settings-web-btn"
              onClick={() => {
                void refreshDaemonStatus();
              }}
              disabled={isBusy}
            >
              {t("settings.refresh")}
            </button>
            {daemonRunning ? (
              <button
                type="button"
                className="settings-web-btn"
                onClick={() => {
                  void handleStopDaemon();
                }}
                disabled={isBusy}
              >
                {action === "daemon-stop"
                  ? t("settings.running")
                  : t("settings.webServiceDaemonStop")}
              </button>
            ) : (
              <button
                type="button"
                className="settings-web-btn settings-web-btn--primary"
                onClick={() => {
                  void handleStartDaemon();
                }}
                disabled={isBusy}
              >
                {action === "daemon-start"
                  ? t("settings.running")
                  : t("settings.webServiceDaemonStart")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. 配置 */}
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card">
        <div className="settings-pref-card-head settings-web-group-head">
          <div className="settings-pref-title">
            {t("settings.webServiceConfigGroup")}
          </div>
        </div>

        <WebAssetsPackageSection
          t={t}
          status={webAssetsStatus}
          action={webAssetsAction}
          error={webAssetsError}
          notice={webAssetsNotice}
          onInstall={() => {
            void handleInstallWebAssets();
          }}
          onInstallLocal={() => {
            void handleInstallLocalWebAssets();
          }}
          onRefresh={() => {
            void refreshWebAssetsStatus(true);
          }}
        />

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor="web-service-port">
              {t("settings.webServicePort")}
            </label>
            <div className="settings-pref-desc">
              {t("settings.webServicePortHint")}
            </div>
          </div>
          <div className="settings-pref-control settings-web-field-control">
            <input
              id="web-service-port"
              className="settings-web-input settings-web-input--port"
              value={portDraft}
              onChange={(event) => setPortDraft(event.target.value)}
              onBlur={() => {
                void savePort();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void savePort();
                }
              }}
              aria-label={t("settings.webServicePortAriaLabel")}
              disabled={isBusy}
            />
            {portDirty ? (
              <button
                type="button"
                className="settings-web-btn settings-web-btn--primary"
                onClick={() => {
                  void savePort();
                }}
                disabled={isBusy || parsedPort == null}
              >
                {t("settings.webServiceSavePort")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-pref-row settings-pref-row--stack">
          <div className="settings-pref-row-main">
            <div className="settings-pref-meta">
              <label
                className="settings-pref-title"
                htmlFor="web-service-fixed-token"
              >
                {t("settings.webServiceFixedToken")}
              </label>
              <div className="settings-pref-desc">
                {t("settings.webServiceFixedTokenHint")}
              </div>
            </div>
            <div className="settings-pref-control settings-web-actions">
              <button
                type="button"
                className="settings-web-btn"
                onClick={() => {
                  void generateAndSaveFixedToken();
                }}
                disabled={isBusy}
              >
                {t("settings.webServiceGenerateToken")}
              </button>
              {hasFixedTokenDraftChange ? (
                <button
                  type="button"
                  className="settings-web-btn settings-web-btn--primary"
                  onClick={() => {
                    void saveFixedToken(fixedTokenDraft);
                  }}
                  disabled={isBusy}
                >
                  {t("settings.webServiceSaveToken")}
                </button>
              ) : null}
              {fixedTokenDraft || appSettings.webServiceToken ? (
                <button
                  type="button"
                  className="settings-web-btn"
                  onClick={() => {
                    void clearFixedToken();
                  }}
                  disabled={isBusy}
                >
                  {t("settings.webServiceClearToken")}
                </button>
              ) : null}
            </div>
          </div>
          <div className="settings-pref-field-row">
            <input
              id="web-service-fixed-token"
              className="settings-web-input"
              type="password"
              value={fixedTokenDraft}
              onChange={(event) => setFixedTokenDraft(event.target.value)}
              placeholder={t("settings.webServiceFixedTokenAuto")}
              aria-label={t("settings.webServiceFixedTokenAriaLabel")}
              disabled={isBusy}
            />
          </div>
          <div className="settings-pref-hint">
            <span className="settings-pref-hint-copy">
              {running
                ? t("settings.webServiceFixedTokenRunningHint")
                : t("settings.webServiceFixedTokenStoppedHint")}
            </span>
          </div>
        </div>
      </div>

      {/* 3. 访问信息 */}
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card">
        <div className="settings-pref-card-head settings-web-group-head">
          <div className="settings-pref-title">
            {t("settings.webServiceAccessGroup")}
          </div>
          <div className="settings-pref-desc">
            {t("settings.webServiceControlPlaneHint")
              .replace("{{rpc}}", rpcEndpoint)
              .replace("{{port}}", String(webPort))}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.webServiceRpcEndpoint")}
            </div>
          </div>
          <div className="settings-pref-control settings-web-field-control">
            <input
              className="settings-web-input settings-web-input--mono"
              value={rpcEndpoint}
              readOnly
            />
            <button
              type="button"
              className="settings-web-btn"
              onClick={() => {
                void handleCopy(rpcEndpoint);
              }}
            >
              {t("settings.copy")}
            </button>
          </div>
        </div>

        <div className="settings-pref-row settings-pref-row--stack">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.webServiceAddresses")}
            </div>
            {addresses.length === 0 ? (
              <div className="settings-pref-desc">
                {t("settings.webServiceNoAddress")}
              </div>
            ) : null}
          </div>
          {addresses.map((address) => (
            <div className="settings-pref-field-row" key={address}>
              <input
                className="settings-web-input settings-web-input--mono"
                value={address}
                readOnly
              />
              <button
                type="button"
                className="settings-web-btn"
                onClick={() => {
                  void handleCopy(address);
                }}
              >
                {t("settings.copy")}
              </button>
            </div>
          ))}
        </div>

        <div className="settings-pref-row settings-pref-row--stack">
          <div className="settings-pref-row-main">
            <div className="settings-pref-meta">
              <div className="settings-pref-title">
                {t("settings.webServiceRuntimeToken")}
              </div>
              <div className="settings-pref-desc">
                {t("settings.webServiceTokenHint")}
              </div>
            </div>
            <div className="settings-pref-control settings-web-actions">
              <button
                type="button"
                className="settings-web-btn"
                onClick={() => setShowToken((value) => !value)}
                disabled={!rawToken}
              >
                {showToken
                  ? t("settings.webServiceHideToken")
                  : t("settings.webServiceShowToken")}
              </button>
              <button
                type="button"
                className="settings-web-btn"
                onClick={() => {
                  if (rawToken) {
                    void handleCopy(rawToken);
                  }
                }}
                disabled={!rawToken}
              >
                {t("settings.copy")}
              </button>
            </div>
          </div>
          <div className="settings-pref-field-row">
            <input
              className="settings-web-input settings-web-input--mono"
              value={tokenToDisplay}
              readOnly
              placeholder={t("settings.webServiceTokenEmpty")}
            />
          </div>
        </div>

        {copiedMessage ? (
          <div className="settings-pref-row settings-pref-row--hint">
            <div className="settings-pref-hint">
              <span className="settings-pref-hint-copy">{copiedMessage}</span>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="settings-pref-row settings-pref-row--hint">
            <div className="settings-pref-hint settings-web-log is-error" role="alert">
              <span className="settings-pref-hint-copy">{error}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
