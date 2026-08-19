import { useState, useCallback, useEffect } from "react";
import type { GrokCurrentConfig, GrokProviderConfig } from "../types";
import {
  getGrokProviders,
  getCurrentGrokConfig,
  addGrokProvider,
  updateGrokProvider,
  deleteGrokProvider,
  switchGrokProvider,
} from "../../../services/tauri";
import { applyOptimisticActiveProvider } from "../applyOptimisticActiveProvider";
import { VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT } from "../vendorActiveProviderEvents";
import { notifyProviderTargetCatalogChanged } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import { forgetDeletedLastProviderProfile } from "../lastProviderProfileMemory";

/** List load options. `silent` skips list-level loading UI (switch / external events). */
export type GrokProviderLoadOptions = {
  silent?: boolean;
};

export interface GrokProviderDialogState {
  isOpen: boolean;
  provider: GrokProviderConfig | null;
}

export interface DeleteGrokConfirmState {
  isOpen: boolean;
  provider: GrokProviderConfig | null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return fallback;
}

export function useGrokProviderManagement() {
  const [grokProviders, setGrokProviders] = useState<GrokProviderConfig[]>([]);
  // Start true so first paint shows a loading placeholder instead of an empty list.
  const [grokLoading, setGrokLoading] = useState(true);
  const [grokProviderError, setGrokProviderError] = useState<string | null>(
    null,
  );
  const [currentGrokConfig, setCurrentGrokConfig] =
    useState<GrokCurrentConfig | null>(null);

  const [grokProviderDialog, setGrokProviderDialog] =
    useState<GrokProviderDialogState>({
      isOpen: false,
      provider: null,
    });

  const [deleteGrokConfirm, setDeleteGrokConfirm] =
    useState<DeleteGrokConfirmState>({
      isOpen: false,
      provider: null,
    });

  const loadGrokProviders = useCallback(
    async (options?: GrokProviderLoadOptions) => {
      const silent = Boolean(options?.silent);
      if (!silent) {
        setGrokLoading(true);
      }
      try {
        const list = await getGrokProviders();
        setGrokProviders(list);
        setGrokProviderError(null);
      } catch (error) {
        setGrokProviderError(
          getErrorMessage(error, "Failed to load Grok providers."),
        );
      } finally {
        if (!silent) {
          setGrokLoading(false);
        }
      }
      // 当前配置刷新失败不阻塞 provider 列表。
      try {
        const config = await getCurrentGrokConfig();
        setCurrentGrokConfig(config);
        if (
          config.configStatus === "malformed" ||
          config.configStatus === "io-error"
        ) {
          setGrokProviderError(
            config.diagnostic ?? `Grok config is ${config.configStatus}.`,
          );
        }
      } catch (error) {
        setCurrentGrokConfig(null);
        setGrokProviderError(
          getErrorMessage(error, "Failed to inspect Grok config."),
        );
      }
    },
    [],
  );

  useEffect(() => {
    void loadGrokProviders();
  }, [loadGrokProviders]);

  useEffect(() => {
    const onActiveProviderChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: string }>).detail;
      if (detail?.engine && detail.engine !== "grok") {
        return;
      }
      void loadGrokProviders({ silent: true });
    };
    window.addEventListener(
      VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT,
      onActiveProviderChanged,
    );
    return () => {
      window.removeEventListener(
        VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT,
        onActiveProviderChanged,
      );
    };
  }, [loadGrokProviders]);

  const handleAddGrokProvider = useCallback(() => {
    setGrokProviderDialog({ isOpen: true, provider: null });
  }, []);

  const handleEditGrokProvider = useCallback(
    (provider: GrokProviderConfig) => {
      setGrokProviderDialog({ isOpen: true, provider });
    },
    [],
  );

  const handleCloseGrokProviderDialog = useCallback(() => {
    setGrokProviderDialog({ isOpen: false, provider: null });
  }, []);

  const handleSaveGrokProvider = useCallback(
    async (providerData: GrokProviderConfig) => {
      const isAdding = !grokProviderDialog.provider;

      try {
        if (isAdding) {
          await addGrokProvider(providerData);
        } else {
          await updateGrokProvider(providerData.id, providerData);
        }

        setGrokProviderDialog({ isOpen: false, provider: null });
        setGrokProviderError(null);
        await loadGrokProviders();
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setGrokProviderError(
          getErrorMessage(error, "Failed to save Grok provider."),
        );
      }
    },
    [grokProviderDialog.provider, loadGrokProviders],
  );

  const handleSwitchGrokProvider = useCallback(
    async (id: string) => {
      const previous = grokProviders;
      setGrokProviders(applyOptimisticActiveProvider(previous, id));
      try {
        await switchGrokProvider(id);
        try {
          const config = await getCurrentGrokConfig();
          setCurrentGrokConfig(config);
        } catch {
          // Keep optimistic list; current-config inspect failure is non-fatal.
        }
        setGrokProviderError(null);
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setGrokProviders(previous);
        setGrokProviderError(
          getErrorMessage(error, "Failed to switch Grok provider."),
        );
      }
    },
    [grokProviders],
  );

  const handleDeleteGrokProvider = useCallback(
    (provider: GrokProviderConfig) => {
      setDeleteGrokConfirm({ isOpen: true, provider });
    },
    [],
  );

  const confirmDeleteGrokProvider = useCallback(async () => {
    const provider = deleteGrokConfirm.provider;
    if (!provider) return;

    try {
      const result = await deleteGrokProvider(provider.id);
      forgetDeletedLastProviderProfile("grok", provider.id);
      await loadGrokProviders();
      notifyProviderTargetCatalogChanged();
      setGrokProviderError(
        result.status === "partial-warning"
          ? result.warning ?? "Grok provider deleted with residual config."
          : null,
      );
    } catch (error) {
      setGrokProviderError(
        getErrorMessage(error, "Failed to delete Grok provider."),
      );
    }
    setDeleteGrokConfirm({ isOpen: false, provider: null });
  }, [deleteGrokConfirm.provider, loadGrokProviders]);

  const cancelDeleteGrokProvider = useCallback(() => {
    setDeleteGrokConfirm({ isOpen: false, provider: null });
  }, []);

  return {
    grokProviders,
    grokLoading,
    grokProviderError,
    grokProviderDialog,
    deleteGrokConfirm,
    currentGrokConfig,
    loadGrokProviders,
    handleAddGrokProvider,
    handleEditGrokProvider,
    handleCloseGrokProviderDialog,
    handleSaveGrokProvider,
    handleSwitchGrokProvider,
    handleDeleteGrokProvider,
    confirmDeleteGrokProvider,
    cancelDeleteGrokProvider,
  };
}

export type UseGrokProviderManagementReturn = ReturnType<
  typeof useGrokProviderManagement
>;
