import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { GrokProviderConfig } from "../types";
import { LOCAL_GROK_PROVIDER_ID } from "../types";
import { EngineProviderList } from "./EngineProviderList";

interface GrokProviderListProps {
  providers: GrokProviderConfig[];
  loading: boolean;
  headerActions?: ReactNode;
  /** 渲染在「+ 添加」按钮之后 */
  trailingActions?: ReactNode;
  onAdd: () => void;
  onEdit: (provider: GrokProviderConfig) => void;
  onDelete: (provider: GrokProviderConfig) => void;
  onSwitch: (id: string) => void;
}

function resolveGrokDetailLeft(provider: GrokProviderConfig): string {
  return provider.model || "";
}

export function GrokProviderList(props: GrokProviderListProps) {
  const { t } = useTranslation();
  return (
    <EngineProviderList
      {...props}
      localProviderId={LOCAL_GROK_PROVIDER_ID}
      emptyText={t("settings.vendor.emptyGrokState")}
      resolveDetailLeft={resolveGrokDetailLeft}
    />
  );
}
