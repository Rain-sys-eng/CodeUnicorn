import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { pushErrorToast } from "../../../services/toasts";
import { loadSubagentStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";
import { formatTokenCount } from "../../messages/utils/messagesRenderUtils";
import { useAgentBridgeRuns } from "../hooks/useAgentBridgeRuns";
import { requestAgentBridgeThreadOpen } from "../store/navigationStore";
import { isDelegationTerminal, type DelegationRunStatus } from "../types";
import { formatDelegationElapsed } from "../utils/delegationProjection";
import type { DelegationToolStatus } from "../utils/liveActivity";
import {
  AgentBridgeRunDetailsDialog,
  type AgentBridgeDetailsMode,
} from "./AgentBridgeRunDetailsDialog";

type AgentBridgeConversationSurfaceProps = {
  workspaceId: string | null | undefined;
  threadId: string | null | undefined;
  nativeThreadIds: readonly string[];
};

const STATUS_KEYS: Record<DelegationRunStatus, string> = {
  queued: "multiAgent.status.planning",
  running: "multiAgent.status.implementing",
  waitingApproval: "multiAgent.status.awaiting-approval",
  completed: "multiAgent.status.succeeded",
  failed: "multiAgent.status.failed",
  cancelled: "multiAgent.status.cancelled",
};

const TOOL_STATUS_KEYS: Record<DelegationToolStatus, string> = {
  running: "multiAgent.stageStatus.running",
  completed: "multiAgent.stageStatus.done",
  failed: "multiAgent.stageStatus.failed",
};

function statusTone(status: DelegationRunStatus): string {
  if (status === "completed") return "is-done";
  if (status === "failed" || status === "cancelled") return "is-fail";
  if (status === "waitingApproval") return "is-waiting";
  return "is-run";
}

export function AgentBridgeConversationSurface({
  workspaceId,
  threadId,
  nativeThreadIds,
}: AgentBridgeConversationSurfaceProps) {
  const { t } = useTranslation();
  const stylesReady = useFeatureStylesReady(loadSubagentStyles);
  const {
    runs,
    error,
    cancellingRunIds,
    retryingRunIds,
    activityByRunId,
    cancelRun,
    retryRun,
  } = useAgentBridgeRuns({
    workspaceId,
    threadId,
    nativeThreadIds,
  });
  const hasActiveRun = runs.some((run) => !isDelegationTerminal(run.status));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const activeRun = useMemo(
    () => runs.find((run) => !isDelegationTerminal(run.status)) ?? null,
    [runs],
  );
  const displayRun = activeRun ?? runs[runs.length - 1] ?? null;
  const [details, setDetails] = useState<{
    mode: AgentBridgeDetailsMode;
    runId: string;
  } | null>(null);
  const detailsRun = details
    ? (runs.find((run) => run.id === details.runId) ?? null)
    : null;

  useEffect(() => {
    if (!hasActiveRun) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveRun]);

  useEffect(() => {
    if (!error) {
      return;
    }
    pushErrorToast({
      id: `agent-bridge-ui:${workspaceId ?? "unknown"}:${error}`,
      title: t("multiAgent.card.runTitle"),
      message: error,
    });
  }, [error, t, workspaceId]);

  if (!stylesReady || !displayRun) {
    return null;
  }

  return (
    <section
      className={`ma-surface ab-surface${
        hasActiveRun ? " ma-surface--sticky" : " ab-surface--terminal"
      }`}
      aria-live="polite"
    >
      <div className="ma-msg">
        <div className="ma-who">{t("multiAgent.card.runTitle")}</div>
        <div className="ma-meta-line">
          {displayRun.source.engineId} → {displayRun.target.engineId} ·{" "}
          {runs.length}
        </div>
        <div className={`ma-orch ab-card${hasActiveRun ? " is-live" : ""}`}>
          <div className="ma-orch-head">
            <span className="ma-orch-t">{displayRun.task}</span>
            <span className="ma-orch-tpl">{displayRun.target.engineId}</span>
            <span className={`ma-orch-st ${statusTone(displayRun.status)}`}>
              {t(STATUS_KEYS[displayRun.status])}
            </span>
          </div>
          <div className="ab-run-list">
            {runs.map((run) => {
              const cancelling = cancellingRunIds.has(run.id);
              const retrying = retryingRunIds.has(run.id);
              const terminal = isDelegationTerminal(run.status);
              const activity = activityByRunId[run.id];
              const dispatchBinding = run.dispatchBinding;
              const style = {
                "--ab-indent": `${Math.min(run.depth, 6) * 14}px`,
              } as CSSProperties;
              return (
                <div
                  className={`ab-run-row is-${run.status}`}
                  key={run.id}
                  style={style}
                >
                  <span
                    className={`ma-dot ${statusTone(run.status)}`}
                    aria-hidden
                  />
                  <span className="ab-run-engine">{run.target.engineId}</span>
                  <span className="ab-run-main">
                    <span className="ab-run-task" title={run.task}>
                      {run.task}
                    </span>
                    {activity?.toolName && activity.toolStatus ? (
                      <span className="ab-run-activity">
                        {activity.toolName}
                        {" · "}
                        {t(TOOL_STATUS_KEYS[activity.toolStatus])}
                      </span>
                    ) : null}
                  </span>
                  <span className={`ab-run-status ${statusTone(run.status)}`}>
                    {t(STATUS_KEYS[run.status])}
                  </span>
                  {activity?.totalTokens != null ? (
                    <span className="ab-run-tokens">
                      {t("messages.liveTokenUsage", {
                        tokens: formatTokenCount(activity.totalTokens),
                      })}
                    </span>
                  ) : (
                    <span className="ab-run-tokens" aria-hidden />
                  )}
                  <span className="ab-run-elapsed">
                    {formatDelegationElapsed(run, nowMs)}
                  </span>
                  <span className="ab-run-actions">
                    {!terminal ? (
                      <button
                        type="button"
                        className="ma-stop ab-run-action"
                        aria-label={`${t("multiAgent.actions.stop")}: ${run.task}`}
                        disabled={cancelling}
                        onClick={() => {
                          void cancelRun(run.id).catch((cancelError) => {
                            pushErrorToast({
                              title: t("multiAgent.errors.stopFailedTitle"),
                              message:
                                cancelError instanceof Error
                                  ? cancelError.message
                                  : String(cancelError),
                            });
                          });
                        }}
                      >
                        {t(
                          cancelling
                            ? "multiAgent.actions.stopping"
                            : "multiAgent.actions.stop",
                        )}
                      </button>
                    ) : null}
                    {run.status === "failed" || run.status === "cancelled" ? (
                      <button
                        type="button"
                        className="ma-stop ab-run-action"
                        disabled={retrying}
                        onClick={() => {
                          void retryRun(run.id).catch((retryError) => {
                            pushErrorToast({
                              title: t("multiAgent.bridge.retryFailed"),
                              message:
                                retryError instanceof Error
                                  ? retryError.message
                                  : String(retryError),
                            });
                          });
                        }}
                      >
                        {t(
                          retrying
                            ? "multiAgent.bridge.retrying"
                            : "multiAgent.bridge.retry",
                        )}
                      </button>
                    ) : null}
                    {dispatchBinding?.backingThreadId ? (
                      <button
                        type="button"
                        className="ma-stop ab-run-action"
                        onClick={() =>
                          requestAgentBridgeThreadOpen(
                            dispatchBinding.runtimeWorkspaceId ??
                              run.workspaceId,
                            dispatchBinding.backingThreadId,
                          )
                        }
                      >
                        {t("multiAgent.bridge.openSession")}
                      </button>
                    ) : null}
                    {terminal ? (
                      <button
                        type="button"
                        className="ma-stop ab-run-action"
                        onClick={() =>
                          setDetails({ mode: "result", runId: run.id })
                        }
                      >
                        {t("multiAgent.bridge.viewResult")}
                      </button>
                    ) : null}
                    {run.result?.diff ? (
                      <button
                        type="button"
                        className="ma-stop ab-run-action"
                        onClick={() =>
                          setDetails({ mode: "diff", runId: run.id })
                        }
                      >
                        {t("multiAgent.bridge.viewDiff")}
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {details && detailsRun ? (
        <AgentBridgeRunDetailsDialog
          mode={details.mode}
          run={detailsRun}
          onClose={() => setDetails(null)}
        />
      ) : null}
    </section>
  );
}
