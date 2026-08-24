import { Suspense, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/utils/clipboard";

import { useTokenTrackerServer } from "../hooks/useTokenTrackerServer";
import { useTokenTrackerViewBridge } from "../hooks/useTokenTrackerViewBridge";

const TT_INSTALL_COMMAND = "npm i -g tokentracker-cli";

function GateStatus({ label }: { label: string }) {
  return (
    <div className="extensions-usage-status" role="status">
      <span
        className="codicon codicon-loading codicon-modifier-spin"
        aria-hidden
      />
      <p>{label}</p>
    </div>
  );
}

/** 门控状态文案集合（由各 section 用自己的 i18n key 组装后传入）。 */
export type TokenTrackerGateCopy = {
  checkingLabel: string;
  installingLabel: string;
  installingDesc: string;
  startingLabel: string;
  guideTitle: string;
  guideDesc: string;
  guideInstallLabel: string;
  guideCopy: string;
  guideCopied: string;
  guideInstallNow: string;
  guideNoteHooks: string;
  guideNoteTelemetry: string;
  errorTitle: string;
  errorRetry: string;
};

type TokenTrackerServerGateProps = {
  /** guide 卡片顶部图标（lucide）。 */
  icon: ComponentType<{ size?: number }>;
  copy: TokenTrackerGateCopy;
  /** ready 态包裹 children 的容器 class（决定内部 vendored 页边距覆写）。 */
  dashboardClassName: string;
  children: ReactNode;
};

/**
 * TokenTracker 本地服务门控：CLI 检测 / 一键安装 / server 启动 / 错误重试，
 * ready 后渲染 children（vendored 页面），并做 locale/theme 桥接与强制 remount。
 * 仅供需要 tokentracker-cli 的 section（usage）使用；skills 后端已内置
 * （src-tauri/src/skills_hub.rs），不走此门控。
 */
export function TokenTrackerServerGate({
  icon: GuideIcon,
  copy,
  dashboardClassName,
  children,
}: TokenTrackerServerGateProps) {
  const { state, retry, install } = useTokenTrackerServer();
  const { remountKey } = useTokenTrackerViewBridge();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopyInstallCommand = async () => {
    // 剪贴板被拒（权限 / 非安全上下文）时保持原状，不打断引导流程。
    if (await copyTextToClipboard(TT_INSTALL_COMMAND)) {
      setCopied(true);
    }
  };

  if (state.status === "checking") {
    return (
      <div className="extensions-usage-section">
        <GateStatus label={copy.checkingLabel} />
      </div>
    );
  }

  if (state.status === "installing") {
    return (
      <div className="extensions-usage-section">
        <div className="extensions-usage-card">
          <div className="extensions-usage-progress" role="status">
            <span
              className="codicon codicon-loading codicon-modifier-spin"
              aria-hidden
            />
            <strong>{copy.installingLabel}</strong>
          </div>
          <p>{copy.installingDesc}</p>
        </div>
      </div>
    );
  }

  if (state.status === "starting") {
    return (
      <div className="extensions-usage-section">
        <GateStatus label={copy.startingLabel} />
      </div>
    );
  }

  if (state.status === "guide") {
    return (
      <div className="extensions-usage-section">
        <div className="extensions-usage-card">
          <div className="extensions-usage-card-icon" aria-hidden>
            <GuideIcon size={20} />
          </div>
          <h2>{copy.guideTitle}</h2>
          <p>{copy.guideDesc}</p>
          <div className="extensions-usage-install">
            <span className="extensions-usage-install-label">
              {copy.guideInstallLabel}
            </span>
            <code>{TT_INSTALL_COMMAND}</code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleCopyInstallCommand()}
            >
              {copied ? copy.guideCopied : copy.guideCopy}
            </Button>
            <Button type="button" size="sm" onClick={install}>
              {copy.guideInstallNow}
            </Button>
          </div>
          <p className="extensions-usage-card-note">{copy.guideNoteHooks}</p>
          <p className="extensions-usage-card-note">{copy.guideNoteTelemetry}</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="extensions-usage-section">
        <div className="extensions-usage-card">
          <h2>{copy.errorTitle}</h2>
          <code className="extensions-usage-error-detail">{state.message}</code>
          <div className="extensions-usage-card-actions">
            <Button type="button" size="sm" onClick={retry}>
              {copy.errorRetry}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="extensions-usage-section">
      <div key={remountKey} className={dashboardClassName}>
        <Suspense fallback={<GateStatus label={copy.startingLabel} />}>
          {children}
        </Suspense>
      </div>
    </div>
  );
}
