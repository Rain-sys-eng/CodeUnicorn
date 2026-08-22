import { useState, useCallback, useEffect } from "react";
import type { KimiCurrentConfig, KimiProviderConfig } from "../types";
import {
  getKimiProviders,
  getCurrentKimiConfig,
  addKimiProvider,
  updateKimiProvider,
  deleteKimiProvider,
  switchKimiProvider,
} from "../../../services/tauri";
import { applyOptimisticActiveProvider } from "../applyOptimisticActiveProvider";
import { VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT } from "../vendorActiveProviderEvents";
import { notifyProviderTargetCatalogChanged } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import { forgetDeletedLastProviderProfile } from "../lastProviderProfileMemory";

/** List load options. `silent` skips list-level loading UI (switch / external events). */
export type KimiProviderLoadOptions = {
  silent?: boolean;
};

export interface KimiProviderDialogState {
  isOpen: boolean;
  provider: KimiProviderConfig | null;
}

export interface DeleteKimiConfirmState {
  isOpen: boolean;
  provider: KimiProviderConfig | null;
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

export function useKimiProviderManagement() {
  const [kimiProviders, setKimiProviders] = useState<KimiProviderConfig[]>([]);
  // Start true so first paint shows a loading placeholder instead of an empty list.
  const [kimiLoading, setKimiLoading] = useState(true);
  const [kimiProviderError, setKimiProviderError] = useState<string | null>(
    null,
  );
  const [currentKimiConfig, setCurrentKimiConfig] =
    useState<KimiCurrentConfig | null>(null);

  const [kimiProviderDialog, setKimiProviderDialog] =
    useState<KimiProviderDialogState>({
      isOpen: false,
      provider: null,
    });

  const [deleteKimiConfirm, setDeleteKimiConfirm] =
    useState<DeleteKimiConfirmState>({
      isOpen: false,
      provider: null,
    });

  const loadKimiProviders = useCallback(
    async (options?: KimiProviderLoadOptions) => {
      const silent = Boolean(options?.silent);
      if (!silent) {
        setKimiLoading(true);
      }
      try {
        const list = await getKimiProviders();
        setKimiProviders(list);
        setKimiProviderError(null);
      } catch (error) {
        setKimiProviderError(
          getErrorMessage(error, "Failed to load Kimi providers."),
        );
      } finally {
        if (!silent) {
          setKimiLoading(false);
        }
      }
      // 当前配置刷新失败不阻塞 provider 列表。
      try {
        const config = await getCurrentKimiConfig();
        setCurrentKimiConfig(config);
        if (
          config.configStatus === "malformed" ||
          config.configStatus === "io-error"
        ) {
          setKimiProviderError(
            config.diagnostic ?? `Kimi config is ${config.configStatus}.`,
          );
        }
      } catch (error) {
        setCurrentKimiConfig(null);
        setKimiProviderError(
          getErrorMessage(error, "Failed to inspect Kimi config."),
        );
      }
    },
    [],
  );

  useEffect(() => {
    void loadKimiProviders();
  }, [loadKimiProviders]);

  useEffect(() => {
    const onActiveProviderChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: string }>).detail;
      if (detail?.engine && detail.engine !== "kimi") {
        return;
      }
      void loadKimiProviders({ silent: true });
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
  }, [loadKimiProviders]);

  const handleAddKimiProvider = useCallback(() => {
    setKimiProviderDialog({ isOpen: true, provider: null });
  }, []);

  const handleEditKimiProvider = useCallback(
    (provider: KimiProviderConfig) => {
      setKimiProviderDialog({ isOpen: true, provider });
    },
    [],
  );

  const handleCloseKimiProviderDialog = useCallback(() => {
    setKimiProviderDialog({ isOpen: false, provider: null });
  }, []);

  const handleSaveKimiProvider = useCallback(
    async (providerData: KimiProviderConfig) => {
      const isAdding = !kimiProviderDialog.provider;

      try {
        if (isAdding) {
          await addKimiProvider(providerData);
        } else {
          await updateKimiProvider(providerData.id, providerData);
        }

        setKimiProviderDialog({ isOpen: false, provider: null });
        setKimiProviderError(null);
        await loadKimiProviders();
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setKimiProviderError(
          getErrorMessage(error, "Failed to save Kimi provider."),
        );
      }
    },
    [kimiProviderDialog.provider, loadKimiProviders],
  );

  const handleSwitchKimiProvider = useCallback(
    async (id: string) => {
      const previous = kimiProviders;
      setKimiProviders(applyOptimisticActiveProvider(previous, id));
      try {
        await switchKimiProvider(id);
        // Soft-reconcile current config without list loading flicker.
        try {
          const config = await getCurrentKimiConfig();
          setCurrentKimiConfig(config);
        } catch {
          // Keep optimistic list; current-config inspect failure is non-fatal.
        }
        setKimiProviderError(null);
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setKimiProviders(previous);
        setKimiProviderError(
          getErrorMessage(error, "Failed to switch Kimi provider."),
        );
      }
    },
    [kimiProviders],
  );

  const handleDeleteKimiProvider = useCallback(
    (provider: KimiProviderConfig) => {
      setDeleteKimiConfirm({ isOpen: true, provider });
    },
    [],
  );

  const confirmDeleteKimiProvider = useCallback(async () => {
    const provider = deleteKimiConfirm.provider;
    if (!provider) return;

    try {
      const result = await deleteKimiProvider(provider.id);
      forgetDeletedLastProviderProfile("kimi", provider.id);
      await loadKimiProviders();
      notifyProviderTargetCatalogChanged();
      setKimiProviderError(
        result.status === "partial-warning"
          ? result.warning ?? "Kimi provider deleted with residual config."
          : null,
      );
    } catch (error) {
      setKimiProviderError(
        getErrorMessage(error, "Failed to delete Kimi provider."),
      );
    }
    setDeleteKimiConfirm({ isOpen: false, provider: null });
  }, [deleteKimiConfirm.provider, loadKimiProviders]);

  const cancelDeleteKimiProvider = useCallback(() => {
    setDeleteKimiConfirm({ isOpen: false, provider: null });
  }, []);

  return {
    kimiProviders,
    kimiLoading,
    kimiProviderError,
    kimiProviderDialog,
    deleteKimiConfirm,
    currentKimiConfig,
    loadKimiProviders,
    handleAddKimiProvider,
    handleEditKimiProvider,
    handleCloseKimiProviderDialog,
    handleSaveKimiProvider,
    handleSwitchKimiProvider,
    handleDeleteKimiProvider,
    confirmDeleteKimiProvider,
    cancelDeleteKimiProvider,
  };
}

export type UseKimiProviderManagementReturn = ReturnType<
  typeof useKimiProviderManagement
>;
