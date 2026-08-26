import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { KimiProviderConfig } from "../types";
import { LOCAL_KIMI_PROVIDER_ID } from "../types";
import { EngineProviderList } from "./EngineProviderList";

interface KimiProviderListProps {
  providers: KimiProviderConfig[];
  loading: boolean;
  headerActions?: ReactNode;
  /** 渲染在「+ 添加」按钮之后 */
  trailingActions?: ReactNode;
  onAdd: () => void;
  onEdit: (provider: KimiProviderConfig) => void;
  onDelete: (provider: KimiProviderConfig) => void;
  onSwitch: (id: string) => void;
}

function resolveKimiDetailLeft(provider: KimiProviderConfig): string {
  return provider.model || "";
}

export function KimiProviderList(props: KimiProviderListProps) {
  const { t } = useTranslation();
  return (
    <EngineProviderList
      {...props}
      localProviderId={LOCAL_KIMI_PROVIDER_ID}
      emptyText={t("settings.vendor.emptyKimiState")}
      resolveDetailLeft={resolveKimiDetailLeft}
    />
  );
}
