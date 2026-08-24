import {
  createContext,
  use,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import type { CliInstallEngine } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCliVersionStatus } from "../hooks/useCliVersionStatus";
import { useCliInstallLifecycle } from "@/features/settings/hooks/useCliInstallLifecycle";
import { CliInstallerPanel } from "@/features/settings/components/CliInstallerPanel";
import { resolveCliLifecycleButtons } from "./cliLifecycleButtons";

type CliLifecycleContextValue = {
  engine: CliInstallEngine;
  /** Null until the first successful status fetch (or cache hit) for this engine. */
  hasStatus: boolean;
  installed: boolean;
  localVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  loading: boolean;
  error: string | null;
  details: string | null;
  disableActions: boolean;
  isBusy: boolean;
  showInstall: boolean;
  showUpgrade: boolean;
  requestInstall: () => void;
  requestUpdate: () => void;
  refresh: () => void;
  installerState: ReturnType<typeof useCliInstallLifecycle>["installerState"];
  installerNowMs: number;
  confirmInstallRun: () => void;
  cancelInstaller: () => void;
};

const CliLifecycleContext = createContext<CliLifecycleContextValue | null>(
  null,
);

function normalizeLocalVersion(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function useCliLifecycleContext(): CliLifecycleContextValue {
  const value = use(CliLifecycleContext);
  if (!value) {
    throw new Error("CliLifecycle components require CliLifecycleProvider");
  }
  return value;
}

type CliLifecycleProviderProps = {
  engine: CliInstallEngine;
  active: boolean;
  children: ReactNode;
};

export function CliLifecycleProvider({
  engine,
  active,
  children,
}: CliLifecycleProviderProps) {
  const { status, loading, error, refresh } = useCliVersionStatus({
    engine,
    enabled: active,
  });
  const {
    installerState,
    installerNowMs,
    isBusy,
    requestInstallPlan,
    confirmInstallRun,
    cancelInstaller,
  } = useCliInstallLifecycle({
    onFinished: () => {
      void refresh();
    },
  });

  const statusForEngine = status?.engine && status.engine !== engine ? null : status;
  const installed = statusForEngine?.installed ?? false;
  const localVersion = normalizeLocalVersion(statusForEngine?.localVersion);
  const latestVersion = normalizeLocalVersion(statusForEngine?.latestVersion);
  const updateAvailable = statusForEngine?.updateAvailable === true;
  const nodeOk = statusForEngine?.nodeOk !== false;
  const visibility = statusForEngine
    ? resolveCliLifecycleButtons({
        installed: statusForEngine.installed,
        updateAvailable: statusForEngine.updateAvailable,
      })
    : {
        showInstall: false,
        showUpgrade: false,
        showUninstall: false,
      };

  const hasStatus = statusForEngine != null;
  const details = statusForEngine?.details ?? null;
  // Keep install/update actions disabled until we have a definitive status.
  const disableActions = isBusy || loading || !statusForEngine || !nodeOk;
  const { showInstall, showUpgrade } = visibility;

  const requestInstall = useCallback(() => {
    void requestInstallPlan(engine, "installLatest");
  }, [engine, requestInstallPlan]);
  const requestUpdate = useCallback(() => {
    void requestInstallPlan(engine, "updateLatest");
  }, [engine, requestInstallPlan]);
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const handleConfirmInstallRun = useCallback(() => {
    void confirmInstallRun();
  }, [confirmInstallRun]);

  const value = useMemo<CliLifecycleContextValue>(
    () => ({
      engine,
      hasStatus,
      installed,
      localVersion,
      latestVersion,
      updateAvailable,
      loading,
      error,
      details,
      disableActions,
      isBusy,
      showInstall,
      showUpgrade,
      requestInstall,
      requestUpdate,
      refresh: handleRefresh,
      installerState,
      installerNowMs,
      confirmInstallRun: handleConfirmInstallRun,
      cancelInstaller,
    }),
    [
      engine,
      hasStatus,
      installed,
      localVersion,
      latestVersion,
      updateAvailable,
      loading,
      error,
      details,
      disableActions,
      isBusy,
      showInstall,
      showUpgrade,
      requestInstall,
      requestUpdate,
      handleRefresh,
      installerState,
      installerNowMs,
      handleConfirmInstallRun,
      cancelInstaller,
    ],
  );

  return (
    <CliLifecycleContext value={value}>{children}</CliLifecycleContext>
  );
}

export function CliLifecycleHeaderActions() {
  const { t } = useTranslation();
  const {
    hasStatus,
    installed,
    localVersion,
    latestVersion,
    updateAvailable,
    loading,
    error,
    details,
    disableActions,
    isBusy,
    showInstall,
    showUpgrade,
    requestInstall,
    requestUpdate,
    refresh,
  } = useCliLifecycleContext();

  // Only treat "not installed" as definitive once we have a status payload.
  // While loading / cold, show a checking placeholder — never a wrong state.
  const showChecking = !hasStatus || (loading && !localVersion && !installed);
  const showInstalled = hasStatus && installed && Boolean(localVersion);
  const showNotInstalled = hasStatus && !installed && !loading;

  return (
    <>
      <div
        className="vendor-cli-version"
        title={error ?? details ?? undefined}
      >
        {showChecking ? (
          <Badge variant="outline">{t("settings.cliVersionChecking")}</Badge>
        ) : showInstalled ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">
              {t("settings.cliVersionLabel", { version: localVersion })}
            </Badge>
            {updateAvailable && latestVersion ? (
              <Badge variant="warning">→ {latestVersion}</Badge>
            ) : latestVersion ? (
              <Badge variant="success">
                {t("settings.cliVersionUpToDate", {
                  defaultValue: "Up to date",
                })}
              </Badge>
            ) : null}
          </div>
        ) : showNotInstalled ? (
          <Badge variant="outline">{t("settings.cliVersionNotInstalled")}</Badge>
        ) : (
          <Badge variant="outline">{t("settings.cliVersionChecking")}</Badge>
        )}
      </div>
      <div className="vendor-cli-lifecycle-buttons">
        {showInstall ? (
          <Button
            type="button"
            variant="default"
            size="xs"
            disabled={disableActions}
            onClick={requestInstall}
          >
            {t("settings.cliInstallLatest")}
          </Button>
        ) : null}
        {showUpgrade ? (
          <Button
            type="button"
            variant="default"
            size="xs"
            disabled={disableActions}
            onClick={requestUpdate}
          >
            {t("settings.cliUpdateLatest")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={loading || isBusy}
          onClick={refresh}
          aria-label={t("settings.cliVersionRefresh")}
          title={t("settings.cliVersionRefresh")}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
    </>
  );
}

export function CliLifecycleInstallerPanel() {
  const { t } = useTranslation();
  const {
    installerState,
    installerNowMs,
    confirmInstallRun,
    cancelInstaller,
  } = useCliLifecycleContext();

  return (
    <CliInstallerPanel
      t={t}
      installerState={installerState}
      installerNowMs={installerNowMs}
      onConfirm={confirmInstallRun}
      onCancel={cancelInstaller}
    />
  );
}
