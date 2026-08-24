import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OpenCodeProviderConfig } from "../types";
import { LOCAL_OPENCODE_PROVIDER_ID } from "../types";
import { EngineProviderList } from "./EngineProviderList";

interface OpenCodeProviderListProps {
  providers: OpenCodeProviderConfig[];
  loading: boolean;
  headerActions?: ReactNode;
  /** 渲染在「+ 添加」按钮之后 */
  trailingActions?: ReactNode;
  onAdd: () => void;
  onEdit: (provider: OpenCodeProviderConfig) => void;
  onDelete: (provider: OpenCodeProviderConfig) => void;
  onSwitch: (id: string) => void;
}

function resolveOpenCodeDetailLeft(provider: OpenCodeProviderConfig): string {
  return (provider.models ?? []).join(", ");
}

export function OpenCodeProviderList(props: OpenCodeProviderListProps) {
  const { t } = useTranslation();
  return (
    <EngineProviderList
      {...props}
      localProviderId={LOCAL_OPENCODE_PROVIDER_ID}
      emptyText={t("settings.vendor.emptyOpenCodeState")}
      resolveDetailLeft={resolveOpenCodeDetailLeft}
    />
  );
}
