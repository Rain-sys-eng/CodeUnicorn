import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";

/**
 * 与 first-paint 索引读取预算（2.5s 超时 + 0.8s 暖读重试）对齐：
 * 超过仍在 loading 即进入「二次强制同步 / 等 importer 填行」的长查询阶段，
 * 文案随之切换，让用户看到过程而不是干等。
 */
const INDEX_PHASE_LABEL_MS = 4_000;

type ThreadLoadingStateProps = {
  nested?: boolean;
};

export function ThreadLoadingState({
  nested = false,
}: ThreadLoadingStateProps) {
  const { t } = useTranslation();
  const [deepPhase, setDeepPhase] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDeepPhase(true), INDEX_PHASE_LABEL_MS);
    return () => clearTimeout(timer);
  }, []);
  const label = deepPhase
    ? t("sidebar.loadingWorkspaceSessionsDeep")
    : t("sidebar.loadingWorkspaceSessionsIndex");
  return (
    <div
      className={`thread-loading-state${nested ? " thread-loading-state-nested" : ""}`}
      aria-label={label}
    >
      <LoaderCircle className="animate-spin" size={13} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
