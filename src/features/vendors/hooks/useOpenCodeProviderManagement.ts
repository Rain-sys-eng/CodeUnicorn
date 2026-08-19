import { useState, useCallback, useEffect } from "react";
import type { OpenCodeCurrentConfig, OpenCodeProviderConfig } from "../types";
import {
  getOpenCodeProviders,
  getCurrentOpenCodeConfig,
  addOpenCodeProvider,
  updateOpenCodeProvider,
  deleteOpenCodeProvider,
  switchOpenCodeProvider,
} from "../../../services/tauri";
import { applyOptimisticActiveProvider } from "../applyOptimisticActiveProvider";
import { VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT } from "../vendorActiveProviderEvents";
import { notifyProviderTargetCatalogChanged } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import { forgetDeletedLastProviderProfile } from "../lastProviderProfileMemory";

/** List load options. `silent` skips list-level loading UI (switch / external events). */
export type OpenCodeProviderLoadOptions = {
  silent?: boolean;
};

export interface OpenCodeProviderDialogState {
  isOpen: boolean;
  provider: OpenCodeProviderConfig | null;
}

export interface DeleteOpenCodeConfirmState {
  isOpen: boolean;
  provider: OpenCodeProviderConfig | null;
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

export function useOpenCodeProviderManagement() {
  const [openCodeProviders, setOpenCodeProviders] = useState<
    OpenCodeProviderConfig[]
  >([]);
  // Start true so first paint shows a loading placeholder instead of an empty list.
  const [openCodeLoading, setOpenCodeLoading] = useState(true);
  const [openCodeProviderError, setOpenCodeProviderError] = useState<
    string | null
  >(null);
  const [currentOpenCodeConfig, setCurrentOpenCodeConfig] =
    useState<OpenCodeCurrentConfig | null>(null);

  const [openCodeProviderDialog, setOpenCodeProviderDialog] =
    useState<OpenCodeProviderDialogState>({
      isOpen: false,
      provider: null,
    });

  const [deleteOpenCodeConfirm, setDeleteOpenCodeConfirm] =
    useState<DeleteOpenCodeConfirmState>({
      isOpen: false,
      provider: null,
    });

  const loadOpenCodeProviders = useCallback(
    async (options?: OpenCodeProviderLoadOptions) => {
      const silent = Boolean(options?.silent);
      if (!silent) {
        setOpenCodeLoading(true);
      }
      try {
        const list = await getOpenCodeProviders();
        setOpenCodeProviders(list);
        setOpenCodeProviderError(null);
      } catch (error) {
        setOpenCodeProviderError(
          getErrorMessage(error, "Failed to load OpenCode providers."),
        );
      } finally {
        if (!silent) {
          setOpenCodeLoading(false);
        }
      }
      // 当前配置刷新失败不阻塞 provider 列表。
      try {
        const config = await getCurrentOpenCodeConfig();
        setCurrentOpenCodeConfig(config);
        if (
          config.configStatus === "malformed" ||
          config.configStatus === "io-error"
        ) {
          setOpenCodeProviderError(
            config.diagnostic ?? `OpenCode config is ${config.configStatus}.`,
          );
        }
      } catch (error) {
        setCurrentOpenCodeConfig(null);
        setOpenCodeProviderError(
          getErrorMessage(error, "Failed to inspect OpenCode config."),
        );
      }
    },
    [],
  );

  useEffect(() => {
    void loadOpenCodeProviders();
  }, [loadOpenCodeProviders]);

  useEffect(() => {
    const onActiveProviderChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: string }>).detail;
      if (detail?.engine && detail.engine !== "opencode") {
        return;
      }
      void loadOpenCodeProviders({ silent: true });
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
  }, [loadOpenCodeProviders]);

  const handleAddOpenCodeProvider = useCallback(() => {
    setOpenCodeProviderDialog({ isOpen: true, provider: null });
  }, []);

  const handleEditOpenCodeProvider = useCallback(
    (provider: OpenCodeProviderConfig) => {
      setOpenCodeProviderDialog({ isOpen: true, provider });
    },
    [],
  );

  const handleCloseOpenCodeProviderDialog = useCallback(() => {
    setOpenCodeProviderDialog({ isOpen: false, provider: null });
  }, []);

  const handleSaveOpenCodeProvider = useCallback(
    async (providerData: OpenCodeProviderConfig) => {
      const isAdding = !openCodeProviderDialog.provider;

      try {
        if (isAdding) {
          await addOpenCodeProvider(providerData);
        } else {
          await updateOpenCodeProvider(providerData.id, providerData);
        }

        setOpenCodeProviderDialog({ isOpen: false, provider: null });
        setOpenCodeProviderError(null);
        await loadOpenCodeProviders();
      } catch (error) {
        setOpenCodeProviderError(
          getErrorMessage(error, "Failed to save OpenCode provider."),
        );
      }
    },
    [openCodeProviderDialog.provider, loadOpenCodeProviders],
  );

  const handleSwitchOpenCodeProvider = useCallback(
    async (id: string) => {
      const previous = openCodeProviders;
      setOpenCodeProviders(applyOptimisticActiveProvider(previous, id));
      try {
        await switchOpenCodeProvider(id);
        try {
          const config = await getCurrentOpenCodeConfig();
          setCurrentOpenCodeConfig(config);
        } catch {
          // Keep optimistic list; current-config inspect failure is non-fatal.
        }
        setOpenCodeProviderError(null);
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setOpenCodeProviders(previous);
        setOpenCodeProviderError(
          getErrorMessage(error, "Failed to switch OpenCode provider."),
        );
      }
    },
    [openCodeProviders],
  );

  const handleDeleteOpenCodeProvider = useCallback(
    (provider: OpenCodeProviderConfig) => {
      setDeleteOpenCodeConfirm({ isOpen: true, provider });
    },
    [],
  );

  const confirmDeleteOpenCodeProvider = useCallback(async () => {
    const provider = deleteOpenCodeConfirm.provider;
    if (!provider) return;

    try {
      await deleteOpenCodeProvider(provider.id);
      forgetDeletedLastProviderProfile("opencode", provider.id);
      await loadOpenCodeProviders();
      setOpenCodeProviderError(null);
      notifyProviderTargetCatalogChanged();
    } catch (error) {
      setOpenCodeProviderError(
        getErrorMessage(error, "Failed to delete OpenCode provider."),
      );
    }
    setDeleteOpenCodeConfirm({ isOpen: false, provider: null });
  }, [deleteOpenCodeConfirm.provider, loadOpenCodeProviders]);

  const cancelDeleteOpenCodeProvider = useCallback(() => {
    setDeleteOpenCodeConfirm({ isOpen: false, provider: null });
  }, []);

  return {
    openCodeProviders,
    openCodeLoading,
    openCodeProviderError,
    openCodeProviderDialog,
    deleteOpenCodeConfirm,
    currentOpenCodeConfig,
    loadOpenCodeProviders,
    handleAddOpenCodeProvider,
    handleEditOpenCodeProvider,
    handleCloseOpenCodeProviderDialog,
    handleSaveOpenCodeProvider,
    handleSwitchOpenCodeProvider,
    handleDeleteOpenCodeProvider,
    confirmDeleteOpenCodeProvider,
    cancelDeleteOpenCodeProvider,
  };
}

export type UseOpenCodeProviderManagementReturn = ReturnType<
  typeof useOpenCodeProviderManagement
>;
