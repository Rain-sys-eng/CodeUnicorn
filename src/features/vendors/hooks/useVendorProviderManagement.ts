import { useState, useCallback, useEffect } from "react";
import {
  applyOptimisticActiveProvider,
  type WithActiveFlag,
} from "../applyOptimisticActiveProvider";
import { VENDOR_ACTIVE_PROVIDER_CHANGED_EVENT } from "../vendorActiveProviderEvents";
import { notifyProviderTargetCatalogChanged } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import {
  forgetDeletedLastProviderProfile,
  type LastProviderEngine,
} from "../lastProviderProfileMemory";

/** List load options. `silent` skips list-level loading UI (switch / external events). */
export type VendorProviderLoadOptions = {
  silent?: boolean;
};

export interface VendorProviderDialogState<P> {
  isOpen: boolean;
  provider: P | null;
}

export interface VendorProviderDeleteConfirmState<P> {
  isOpen: boolean;
  provider: P | null;
}

type VendorCurrentConfigLike = {
  configStatus?: "missing" | "loaded" | "malformed" | "io-error";
  diagnostic?: string;
};

/**
 * 渠道型引擎（Grok / Kimi / OpenCode…）provider CRUD 的 per-engine 接线。
 * adapter 必须是模块级常量（保证 hook deps 稳定）。
 */
export interface VendorProviderManagementAdapter<
  P extends WithActiveFlag,
  C extends VendorCurrentConfigLike,
> {
  engine: LastProviderEngine;
  /** 用于错误文案的引擎显示名（"Grok" / "Kimi" / "OpenCode"） */
  displayName: string;
  getProviders: () => Promise<P[]>;
  getCurrentConfig: () => Promise<C>;
  addProvider: (provider: P) => Promise<unknown>;
  updateProvider: (id: string, provider: P) => Promise<unknown>;
  /** 返回 warning 文案表示 partial-warning 删除；null 表示干净删除 */
  deleteProvider: (id: string) => Promise<{ warning: string } | null>;
  switchProvider: (id: string) => Promise<unknown>;
  /** 保存成功后是否广播 provider catalog 变更（OpenCode 现状不广播） */
  notifyCatalogOnSave: boolean;
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

/**
 * 多引擎 provider 管理（加载 / 增删改 / 乐观切换 / 删除确认）的单一实现。
 * useGrok/Kimi/OpenCodeProviderManagement 均为本 hook 的薄 wrapper，
 * 新引擎接入请提供 adapter，不要再复制整份 hook。
 */
export function useVendorProviderManagement<
  P extends WithActiveFlag,
  C extends VendorCurrentConfigLike,
>(adapter: VendorProviderManagementAdapter<P, C>) {
  const [providers, setProviders] = useState<P[]>([]);
  // Start true so first paint shows a loading placeholder instead of an empty list.
  const [loading, setLoading] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<C | null>(null);

  const [providerDialog, setProviderDialog] = useState<
    VendorProviderDialogState<P>
  >({
    isOpen: false,
    provider: null,
  });

  const [deleteConfirm, setDeleteConfirm] = useState<
    VendorProviderDeleteConfirmState<P>
  >({
    isOpen: false,
    provider: null,
  });

  const loadProviders = useCallback(
    async (options?: VendorProviderLoadOptions) => {
      const silent = Boolean(options?.silent);
      if (!silent) {
        setLoading(true);
      }
      try {
        const list = await adapter.getProviders();
        setProviders(list);
        setProviderError(null);
      } catch (error) {
        setProviderError(
          getErrorMessage(
            error,
            `Failed to load ${adapter.displayName} providers.`,
          ),
        );
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
      // 当前配置刷新失败不阻塞 provider 列表。
      try {
        const config = await adapter.getCurrentConfig();
        setCurrentConfig(config);
        if (
          config.configStatus === "malformed" ||
          config.configStatus === "io-error"
        ) {
          setProviderError(
            config.diagnostic ??
              `${adapter.displayName} config is ${config.configStatus}.`,
          );
        }
      } catch (error) {
        setCurrentConfig(null);
        setProviderError(
          getErrorMessage(
            error,
            `Failed to inspect ${adapter.displayName} config.`,
          ),
        );
      }
    },
    [adapter],
  );

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    const onActiveProviderChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: string }>).detail;
      if (detail?.engine && detail.engine !== adapter.engine) {
        return;
      }
      void loadProviders({ silent: true });
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
  }, [adapter.engine, loadProviders]);

  const handleAddProvider = useCallback(() => {
    setProviderDialog({ isOpen: true, provider: null });
  }, []);

  const handleEditProvider = useCallback((provider: P) => {
    setProviderDialog({ isOpen: true, provider });
  }, []);

  const handleCloseProviderDialog = useCallback(() => {
    setProviderDialog({ isOpen: false, provider: null });
  }, []);

  const handleSaveProvider = useCallback(
    async (providerData: P) => {
      const isAdding = !providerDialog.provider;

      try {
        if (isAdding) {
          await adapter.addProvider(providerData);
        } else {
          await adapter.updateProvider(providerData.id, providerData);
        }

        setProviderDialog({ isOpen: false, provider: null });
        setProviderError(null);
        await loadProviders();
        if (adapter.notifyCatalogOnSave) {
          notifyProviderTargetCatalogChanged();
        }
      } catch (error) {
        setProviderError(
          getErrorMessage(
            error,
            `Failed to save ${adapter.displayName} provider.`,
          ),
        );
      }
    },
    [adapter, providerDialog.provider, loadProviders],
  );

  const handleSwitchProvider = useCallback(
    async (id: string) => {
      const previous = providers;
      setProviders(applyOptimisticActiveProvider(previous, id));
      try {
        await adapter.switchProvider(id);
        // Soft-reconcile current config without list loading flicker.
        try {
          const config = await adapter.getCurrentConfig();
          setCurrentConfig(config);
        } catch {
          // Keep optimistic list; current-config inspect failure is non-fatal.
        }
        setProviderError(null);
        notifyProviderTargetCatalogChanged();
      } catch (error) {
        setProviders(previous);
        setProviderError(
          getErrorMessage(
            error,
            `Failed to switch ${adapter.displayName} provider.`,
          ),
        );
      }
    },
    [adapter, providers],
  );

  const handleDeleteProvider = useCallback((provider: P) => {
    setDeleteConfirm({ isOpen: true, provider });
  }, []);

  const confirmDeleteProvider = useCallback(async () => {
    const provider = deleteConfirm.provider;
    if (!provider) return;

    try {
      const outcome = await adapter.deleteProvider(provider.id);
      forgetDeletedLastProviderProfile(adapter.engine, provider.id);
      await loadProviders();
      notifyProviderTargetCatalogChanged();
      setProviderError(outcome?.warning ?? null);
    } catch (error) {
      setProviderError(
        getErrorMessage(
          error,
          `Failed to delete ${adapter.displayName} provider.`,
        ),
      );
    }
    setDeleteConfirm({ isOpen: false, provider: null });
  }, [adapter, deleteConfirm.provider, loadProviders]);

  const cancelDeleteProvider = useCallback(() => {
    setDeleteConfirm({ isOpen: false, provider: null });
  }, []);

  return {
    providers,
    loading,
    providerError,
    providerDialog,
    deleteConfirm,
    currentConfig,
    loadProviders,
    handleAddProvider,
    handleEditProvider,
    handleCloseProviderDialog,
    handleSaveProvider,
    handleSwitchProvider,
    handleDeleteProvider,
    confirmDeleteProvider,
    cancelDeleteProvider,
  };
}
