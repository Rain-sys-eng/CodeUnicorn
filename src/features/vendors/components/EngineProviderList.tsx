import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Network from "lucide-react/dist/esm/icons/network";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  renderVendorProviderDisplayName,
  VendorProviderTable,
} from "./VendorProviderTable";
import { VendorProviderActiveSwitch } from "./VendorProviderActiveSwitch";

/** Grok / Kimi / OpenCode 等「渠道型」引擎共用的 provider 列表行数据面。 */
export interface EngineProviderListItem {
  id: string;
  name: string;
  remark?: string;
  baseUrl: string;
  isActive?: boolean;
  isLocalProvider?: boolean;
}

export interface EngineProviderListProps<P extends EngineProviderListItem> {
  providers: P[];
  loading: boolean;
  headerActions?: ReactNode;
  /** 渲染在「+ 添加」按钮之后 */
  trailingActions?: ReactNode;
  /** 本地官方 provider 在引擎卡片渲染，不进此表格 */
  localProviderId: string;
  emptyText: string;
  /** 第二行摘要左侧内容（model / models join），为空则只显示 baseUrl */
  resolveDetailLeft: (provider: P) => string;
  onAdd: () => void;
  onEdit: (provider: P) => void;
  onDelete: (provider: P) => void;
  onSwitch: (id: string) => void;
}

/**
 * 多引擎 provider 渠道列表的单一实现。
 * Grok / Kimi / OpenCode 的 *ProviderList 均为本组件的薄 wrapper，
 * 请勿再为新引擎复制整份列表组件。
 */
export function EngineProviderList<P extends EngineProviderListItem>({
  providers,
  loading,
  headerActions,
  trailingActions,
  localProviderId,
  emptyText,
  resolveDetailLeft,
  onAdd,
  onEdit,
  onDelete,
  onSwitch,
}: EngineProviderListProps<P>) {
  const { t } = useTranslation();
  // Local official provider is rendered in the engine card, not this table.
  const providerList = (Array.isArray(providers) ? providers : []).filter(
    (provider) =>
      provider.id !== localProviderId && !provider.isLocalProvider,
  );

  return (
    <div className="vendor-provider-list">
      <div className="vendor-list-header">
        <span className="vendor-list-title">
          <Network
            className="vendor-section-label-icon"
            size={15}
            strokeWidth={2}
            aria-hidden
          />
          {t("settings.vendor.providerChannels", {
            defaultValue: t("settings.vendor.thirdPartyConfig"),
          })}
        </span>
        <div className="vendor-list-actions">
          {headerActions}
          <Button size="xs" className="rounded-[4px]" onClick={onAdd}>
            + {t("settings.vendor.add")}
          </Button>
          {trailingActions}
        </div>
      </div>

      <VendorProviderTable
        loading={loading}
        empty={providerList.length === 0}
        emptyText={emptyText}
        renderRows={() => (
          <tbody className="vendor-provider-table-body" data-slot="table-body">
            {providerList.map((provider) => {
              const detailLeft = resolveDetailLeft(provider);
              return (
                <tr
                  key={provider.id}
                  data-slot="table-row"
                  className={cn(
                    "vendor-provider-table-row",
                    provider.isActive && "active",
                  )}
                >
                  <td
                    data-slot="table-cell"
                    className="vendor-provider-table-main-cell"
                  >
                    <div className="vendor-card-info">
                      <div className="vendor-card-name">
                        {renderVendorProviderDisplayName(provider.name)}
                      </div>
                      {provider.remark ? (
                        <div
                          className="vendor-card-remark"
                          title={provider.remark}
                        >
                          {provider.remark}
                        </div>
                      ) : null}
                      {(detailLeft || provider.baseUrl) && (
                        <div
                          className="vendor-card-remark"
                          title={`${detailLeft} · ${provider.baseUrl}`}
                        >
                          {detailLeft}
                          {detailLeft && provider.baseUrl ? " · " : ""}
                          {provider.baseUrl}
                        </div>
                      )}
                    </div>
                  </td>
                  <td
                    data-slot="table-cell"
                    className="vendor-provider-table-status-cell"
                  >
                    <VendorProviderActiveSwitch
                      active={Boolean(provider.isActive)}
                      providerId={provider.id}
                      providerName={provider.name}
                      onSwitch={onSwitch}
                    />
                  </td>
                  <td
                    data-slot="table-cell"
                    className="vendor-provider-table-actions-cell"
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onEdit(provider)}
                      title={t("settings.vendor.edit")}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="hover:text-destructive"
                      onClick={() => onDelete(provider)}
                      title={t("settings.vendor.delete")}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        )}
      />
    </div>
  );
}
