import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { pushErrorToast } from "../../../services/toasts";
import { isSharedSessionThreadId } from "../../shared-session/utils/sharedSessionIdentity";
import {
  approveAndExecuteAgent,
  forceStopAndUnlock,
  hydrateAgentProjection,
  rejectAndReplanAgent,
  retryAgentStage,
  retryCollabRun,
  stopAgent } from "../runtime/executor";
import { getAgentLivePhase } from "../runtime/livePhaseChannel";
import {
  claimAgentHydration,
  useAgentEvidenceRunId,
  useAgentProjection,
  useAgentRoundList } from "../store/agentStore";
import {
  useCollabUiState,
  type CollabUiState } from "../store/collabUiStore";
import {
  openAgentInspector,
  selectAgentRound,
  selectAgentStage } from "../store/inspectorStore";
import { getSelectedTemplate } from "../templates/templateStore";
import { templateFlowLabel } from "../templates/types";
import {
  isTerminalAgentStatus,
  type AgentProjectionV1,
  type AgentStageBinding,
  type AgentStageProjection } from "../types";
import {
  runProgressRatio,
  runStatusHeadline,
  stageStatusText,
  stageTargetLabel } from "../utils/format";

type ConversationSurfaceProps = {
  workspaceId: string | null | undefined;
  threadId: string | null | undefined;
};

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stageBindingsFromProjection(
  projection: AgentProjectionV1,
): AgentStageBinding[] {
  return (projection.stages ?? []).map((stage) => ({
    id: stage.id,
    title: stage.title,
    rolePrompt: stage.rolePrompt ?? null,
    accessMode: stage.accessMode,
    requiresApproval: stage.requiresApproval ?? false,
    upstreamFeedMode: stage.upstreamFeedMode ?? null,
    target: stage.target,
    personaAgentId: stage.personaAgentId ?? null,
    personaAgentName: stage.personaAgentName ?? null,
    personaAgentIcon: stage.personaAgentIcon ?? null,
    personaPrompt: stage.personaPrompt ?? null,
  }));
}

function userFacingDiagnostics(projection: AgentProjectionV1): string[] {
  return (projection.diagnostics ?? []).filter((item) => {
    const lower = item.toLowerCase();
    if (lower.startsWith("cancel requested")) return false;
    if (lower.includes("reject replan") || item.includes("打回重规划")) {
      return false;
    }
    return true;
  });
}

/** 节点无 live 更新超过此时长 → 展示卡死恢复条（不自动杀进程） */
const STAGE_HANG_HINT_MS = 90_000;

function OrchCard({
  projection,
  roundIndex,
  totalRounds,
  active,
  workspaceId,
  threadId,
  onOpenStage,
  onApprove,
  onRejectReplan,
  onStop,
  onForceUnlock,
  onRetryRun,
  onRetryStage,
  busy,
  onJumpRound,
  featureEnabled }: {
  projection: AgentProjectionV1;
  roundIndex: number;
  totalRounds: number;
  active: boolean;
  workspaceId: string;
  threadId: string;
  onOpenStage: (stage: AgentStageProjection) => void;
  /** note 为空则按规划执行；有内容则注入后续段 */
  onApprove: (note?: string) => void;
  /** note 为空则按原任务重规划；有内容则追加到原任务后 */
  onRejectReplan: (note?: string) => void;
  onStop: () => void;
  onForceUnlock: () => void;
  onRetryRun: (stuckStageId?: string) => void;
  onRetryStage: (stage: AgentStageProjection) => void;
  busy: "approve" | "stop" | "replan" | "retry" | null;
  onJumpRound: (roundIndex: number) => void;
  featureEnabled: boolean;
}) {
  const { t } = useTranslation();
  /** 待批准：批准 / 打回 二选一展开补充面板 */
  const [notePanel, setNotePanel] = useState<"approve" | "replan" | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [hangHint, setHangHint] = useState(false);
  // 进行中默认折叠阶段列表；loading 进度条始终露出
  const [stagesOpen, setStagesOpen] = useState(false);
  const stages = projection.stages ?? [];
  const progress = Math.round(runProgressRatio(projection) * 100);
  const headline = runStatusHeadline(projection);
  const flow =
    stages.map((stage) => stage.title || stage.id).join(" → ") ||
    templateFlowLabel(getSelectedTemplate());
  const terminal = isTerminalAgentStatus(projection.status);
  const anyStageLive = stages.some((stage) => stage.status === "running");
  const runningStage = stages.find((stage) => stage.status === "running");
  // 进度条「只升不降」：一旦进入 live 就不回退到确定态，避免阶段切换时动画闪烁。
  const wasEverLive = useRef(false);
  if (anyStageLive || (active && !terminal)) {
    wasEverLive.current = true;
  } else if (terminal) {
    wasEverLive.current = false;
  }
  const indeterminate = anyStageLive || (wasEverLive.current && !terminal);
  const diags = userFacingDiagnostics(projection);

  // 卡死探测：running 且 live 通道长时间无更新 → 提示恢复操作
  useEffect(() => {
    if (terminal || !runningStage) {
      setHangHint(false);
      return;
    }
    const tick = () => {
      // 后台窗口看不到卡死提示，跳过采样；阈值 90s，10s 粒度足够及时。
      if (document.visibilityState === "hidden") {
        return;
      }
      const live = getAgentLivePhase(workspaceId, threadId);
      const anchor =
        live?.updatedAt && live.phase === runningStage.id
          ? live.updatedAt
          : runningStage.startedAt ?? projection.updatedAt;
      const age = Date.now() - (anchor || 0);
      setHangHint(age >= STAGE_HANG_HINT_MS);
    };
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, [
    terminal,
    runningStage?.id,
    runningStage?.startedAt,
    workspaceId,
    threadId,
    projection.updatedAt,
  ]);
  const statusLabel =
    headline.kind === "done"
      ? t("multiAgent.status.succeeded")
      : headline.kind === "failed"
        ? t(`multiAgent.status.${projection.status}`)
        : headline.stageTitle
          ? t("multiAgent.card.runningStage", { stage: headline.stageTitle })
          : t(`multiAgent.status.${projection.status}`);

  // 离开待批准态时收起补充面板
  useEffect(() => {
    if (projection.status !== "awaiting-approval") {
      setNotePanel(null);
      setActionNote("");
    }
  }, [projection.status]);

  const awaitingApproval = projection.status === "awaiting-approval";
  const showHangBar = hangHint && !terminal && Boolean(runningStage);
  // 待批准 / 超时卡已自带停止类操作时，不再单独挂底部 stop 行
  const showStandaloneStop = !terminal && !awaitingApproval && !showHangBar;

  return (
    <div
      className={`ma-orch${active && !terminal ? " is-live" : ""}${stagesOpen ? "" : " is-stages-collapsed"}`}
    >
      <button
        type="button"
        className="ma-orch-head ma-orch-head--toggle"
        aria-expanded={stagesOpen}
        onClick={() => setStagesOpen((open) => !open)}
      >
        <span className={`ma-orch-chev${stagesOpen ? " is-open" : ""}`} aria-hidden>
          ›
        </span>
        <span className="ma-orch-t">
          {t("multiAgent.card.roundTitle", { n: roundIndex + 1 })}
        </span>
        <span className="ma-orch-tpl">{flow}</span>
        <span
          className={`ma-orch-st is-${headline.kind === "done" ? "done" : headline.kind === "failed" ? "fail" : "run"}`}
        >
          {statusLabel}
        </span>
      </button>
      {/* 进度条只升不降：live 期间保持不确定动画，终端后才显示比例；折叠时仍露出 */}
      <div
        className={`ma-prog${indeterminate ? " is-indeterminate" : ""}`}
        aria-hidden
      >
        <i
          style={
            indeterminate
              ? undefined
              : {
                  width: `${progress}%`,
                  background:
                    projection.status === "succeeded"
                      ? "var(--ma-green, #4ade80)"
                      : undefined }
          }
        />
      </div>
      {stagesOpen
        ? stages.map((stage) => {
        const live = stage.status === "running";
        const canRetryStage =
          !terminal &&
          (stage.status === "running" || stage.status === "failed");
        const approved =
          (stage.requiresApproval || stage.id === "plan") &&
          (projection.status === "implementing" ||
            projection.status === "reviewing" ||
            projection.status === "succeeded" ||
            Boolean(projection.approvedAt));
        return (
          <div
            key={stage.id}
            className={`ma-stage-row-wrap${live ? " is-running" : ""}`}
          >
            <button
              type="button"
              className={`ma-stage-row${live ? " is-running" : ""}`}
              onClick={() => onOpenStage(stage)}
            >
              <i
                className={`ma-dot${stage.status === "succeeded" ? " is-done" : ""}${live ? " is-live" : ""}`}
              />
              <span className="ma-stage-nm">{stage.title || stage.id}</span>
              <span className="ma-stage-tg">{stageTargetLabel(stage)}</span>
              <span className={`ma-stage-st${live ? " is-live" : ""}`}>
                {stageStatusText(stage, { approved, live })}
              </span>
            </button>
            {canRetryStage ? (
              <button
                type="button"
                className="ma-stage-retry"
                disabled={busy !== null}
                title={t("multiAgent.actions.retryStageHint")}
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryStage(stage);
                }}
              >
                {busy === "retry"
                  ? t("multiAgent.actions.retrying")
                  : t("multiAgent.actions.retryStageShort")}
              </button>
            ) : null}
          </div>
        );
      })
        : null}

      {awaitingApproval ? (
        <div className="ma-action-bar ma-action-bar--approve">
          {!featureEnabled ? (
            <p className="ma-approve-summary ma--feature-off-hint">
              {t("multiAgent.errors.featureDisabled")}
            </p>
          ) : null}
          {projection.plan?.summary ? (
            <p className="ma-approve-summary">{projection.plan.summary}</p>
          ) : null}
          <div className="ma-action-row">
            <div className="ma-action-row__primary">
              <button
                type="button"
                className={`ma-primary${notePanel === "approve" ? " is-on" : ""}`}
                disabled={busy !== null || !featureEnabled}
                aria-expanded={notePanel === "approve"}
                onClick={() => {
                  setNotePanel((prev) =>
                    prev === "approve" ? null : "approve",
                  );
                  if (notePanel !== "approve") setActionNote("");
                }}
              >
                {busy === "approve"
                  ? t("multiAgent.actions.approving")
                  : t("multiAgent.actions.confirmExecute")}
              </button>
              <button
                type="button"
                className={`ma-ghost${notePanel === "replan" ? " is-on" : ""}`}
                disabled={busy !== null || !featureEnabled}
                aria-expanded={notePanel === "replan"}
                onClick={() => {
                  setNotePanel((prev) =>
                    prev === "replan" ? null : "replan",
                  );
                  if (notePanel !== "replan") setActionNote("");
                }}
              >
                {busy === "replan"
                  ? t("multiAgent.actions.replanning")
                  : t("multiAgent.actions.rejectReplan")}
              </button>
            </div>
            <div className="ma-action-row__end">
              <button
                type="button"
                className="ma-stop"
                disabled={busy !== null || !featureEnabled}
                onClick={onStop}
              >
                {busy === "stop"
                  ? t("multiAgent.actions.stopping")
                  : t("multiAgent.actions.stop")}
              </button>
            </div>
          </div>
          {notePanel ? (
            <div
              className="ma-note-panel"
              role="region"
              aria-label={t("multiAgent.actions.noteLabel")}
            >
              <label
                className="ma-note-label"
                htmlFor={`ma-action-note-${projection.runId}`}
              >
                {t("multiAgent.actions.noteLabel")}
              </label>
              <textarea
                id={`ma-action-note-${projection.runId}`}
                className="ma-note-textarea"
                rows={3}
                value={actionNote}
                disabled={busy !== null || !featureEnabled}
                placeholder={
                  notePanel === "approve"
                    ? t("multiAgent.actions.approveNotePlaceholder")
                    : t("multiAgent.actions.replanNotePlaceholder")
                }
                onChange={(e) => setActionNote(e.target.value)}
              />
              <div className="ma-note-actions">
                <button
                  type="button"
                  className="ma-ghost"
                  disabled={busy !== null || !featureEnabled}
                  onClick={() => {
                    setNotePanel(null);
                    setActionNote("");
                  }}
                >
                  {t("multiAgent.actions.replanCancel")}
                </button>
                <button
                  type="button"
                  className="ma-primary"
                  disabled={busy !== null || !featureEnabled}
                  onClick={() => {
                    const note = actionNote.trim() || undefined;
                    if (notePanel === "approve") {
                      onApprove(note);
                    } else {
                      onRejectReplan(note);
                    }
                  }}
                >
                  {notePanel === "approve"
                    ? busy === "approve"
                      ? t("multiAgent.actions.approving")
                      : t("multiAgent.actions.approveConfirm")
                    : busy === "replan"
                      ? t("multiAgent.actions.replanning")
                      : t("multiAgent.actions.replanConfirm")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {diags.length > 0 ? (
        <div className="ma-diagnostics" role="alert">
          {diags.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      ) : null}

      {projection.status === "succeeded" && projection.finalSummary ? (
        <div className="ma-summary-card">
          <div className="ma-summary-t">
            {t("multiAgent.card.finalTitleRound", { n: roundIndex + 1 })}
          </div>
          <p>{projection.finalSummary}</p>
        </div>
      ) : null}

      {showHangBar && runningStage ? (
        <div className="ma-action-bar ma-action-bar--hang" role="status">
          <p className="ma-hang-text">
            {t("multiAgent.actions.hangHint", {
              stage: runningStage.title || runningStage.id,
            })}
          </p>
          <div className="ma-action-row">
            <div className="ma-action-row__primary">
              <button
                type="button"
                className="ma-primary"
                disabled={busy !== null}
                onClick={() => onRetryStage(runningStage)}
              >
                {busy === "retry"
                  ? t("multiAgent.actions.retrying")
                  : t("multiAgent.actions.retryStage")}
              </button>
              <button
                type="button"
                className="ma-ghost"
                disabled={busy !== null}
                onClick={() => onRetryRun(runningStage.id)}
              >
                {t("multiAgent.actions.retryRun")}
              </button>
            </div>
            <div className="ma-action-row__end">
              <button
                type="button"
                className="ma-ghost"
                disabled={busy !== null}
                onClick={onForceUnlock}
                title={t("multiAgent.actions.forceUnlockHint")}
              >
                {busy === "stop"
                  ? t("multiAgent.actions.stopping")
                  : t("multiAgent.actions.forceUnlock")}
              </button>
              <button
                type="button"
                className="ma-stop"
                disabled={busy !== null || !featureEnabled}
                onClick={onStop}
              >
                {busy === "stop"
                  ? t("multiAgent.actions.stopping")
                  : t("multiAgent.actions.stop")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showStandaloneStop ? (
        <div
          className={`ma-action-bar ma-action-bar--running${stagesOpen ? "" : " is-compact"}`}
        >
          <div className="ma-action-row">
            <div className="ma-action-row__primary" />
            <div className="ma-action-row__end">
              {anyStageLive ? (
                <button
                  type="button"
                  className="ma-ghost"
                  disabled={busy !== null}
                  onClick={onForceUnlock}
                  title={t("multiAgent.actions.forceUnlockHint")}
                >
                  {t("multiAgent.actions.forceUnlock")}
                </button>
              ) : null}
              <button
                type="button"
                className="ma-stop"
                disabled={busy !== null || !featureEnabled}
                onClick={onStop}
              >
                {busy === "stop"
                  ? t("multiAgent.actions.stopping")
                  : t("multiAgent.actions.stop")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 折叠态不放长 hint，避免大块空白；展开或有多轮时再露出 */}
      {stagesOpen && totalRounds > 1 ? (
        <div className="ma-orch-links">
          <button
            type="button"
            className="ma-lk"
            onClick={() => onJumpRound(roundIndex)}
          >
            {t("multiAgent.card.viewInPanel", { n: roundIndex + 1 })}
          </button>
        </div>
      ) : stagesOpen ? (
        <p className="ma-orch-hint">{t("multiAgent.card.orchestrationHint")}</p>
      ) : null}
    </div>
  );
}

function useSharedRoundActions(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
) {
  const openStage = (
    run: AgentProjectionV1,
    stage: AgentStageProjection,
    roundIndex: number,
  ) => {
    if (!workspaceId || !threadId) return;
    openAgentInspector({
      workspaceId,
      threadId,
      runId: run.runId,
      stageId: stage.id,
      roundIndex });
    selectAgentStage(stage.id);
  };

  const jumpRound = (
    rounds: AgentProjectionV1[],
    index: number,
  ) => {
    if (!workspaceId || !threadId) return;
    const run = rounds[index];
    if (!run) return;
    const stage =
      run.stages?.find((item) => item.status === "running") ??
      run.stages?.[0] ??
      null;
    openAgentInspector({
      workspaceId,
      threadId,
      runId: run.runId,
      stageId: stage?.id ?? null,
      roundIndex: index });
    selectAgentRound({
      runId: run.runId,
      roundIndex: index,
      stageId: stage?.id ?? null });
  };

  return { openStage, jumpRound };
}

/**
 * 相位卡：projection 尚未创建（调度对话/启动节点）或已终态（生成汇总）时，
 * sticky 窗保持可见并给出 loading，消除「误以为中断」的空窗期。
 */
function CollabPhaseCard({
  state,
  roundIndex }: {
  state: CollabUiState;
  roundIndex: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="ma-orch is-live">
      <div className="ma-orch-head">
        <span className="ma-orch-t">
          {t("multiAgent.card.roundTitle", { n: roundIndex + 1 })}
        </span>
        <span className="ma-orch-tpl">{state.flowLabel}</span>
        <span className="ma-orch-st is-run">{state.headline}</span>
      </div>
      <div className="ma-prog is-indeterminate" aria-hidden>
        <i />
      </div>
      <div className="ma-orch-pending">
        <span className="ma-orch-pending-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <p className="ma-orch-pending-detail">{state.detail}</p>
      </div>
    </div>
  );
}

/**
 * sticky 完整编排卡（对话框上方）。
 * 进行中由 projection 驱动；projection 空窗期（调度对话/启动/汇总）由 collabUi 相位驱动。
 * 终态 HistoryFold 作为时间线消息项（agent:runId:hist-fold）插入主幕布历史。
 */
export function MultiAgentConversationSurface({
  workspaceId,
  threadId }: ConversationSurfaceProps) {
  const { t } = useTranslation();
  const projection = useAgentProjection(workspaceId, threadId);
  const rounds = useAgentRoundList(workspaceId, threadId);
  const collabUi = useCollabUiState(workspaceId, threadId);
  const evidenceRunId = useAgentEvidenceRunId(workspaceId, threadId);
  const [busy, setBusy] = useState<
    "approve" | "stop" | "replan" | "retry" | null
  >(null);
  const { openStage, jumpRound } = useSharedRoundActions(workspaceId, threadId);

  // Shared 内已进入协作 surface：不再用 feature flag 禁用批准/停止等操作。
  const featureEnabled = true;

  useEffect(() => {
    if (
      !workspaceId ||
      !threadId ||
      !isSharedSessionThreadId(threadId) ||
      !evidenceRunId ||
      projection?.runId === evidenceRunId ||
      !claimAgentHydration(workspaceId, threadId, evidenceRunId)
    ) {
      return;
    }
    void hydrateAgentProjection(workspaceId, threadId, evidenceRunId).catch(
      (error) => {
        console.warn("[multi-agent] hydrate failed", error);
      },
    );
  }, [evidenceRunId, projection?.runId, threadId, workspaceId]);

  if (!workspaceId || !threadId) return null;

  const roundIndex = projection
    ? Math.max(
        0,
        rounds.findIndex((r) => r.runId === projection.runId),
      )
    : rounds.length;

  // projection 空窗期（调度对话/启动节点/生成汇总）：相位卡保持 sticky 窗可见
  if (!projection || isTerminalAgentStatus(projection.status)) {
    if (collabUi && collabUi.phase !== "idle" && collabUi.phase !== "done") {
      return (
        <section className="ma-surface ma-surface--sticky" aria-live="polite">
          <div className="ma-msg">
            <div className="ma-who">{t("multiAgent.card.who")}</div>
            <div className="ma-meta-line">
              collab · shared · round {roundIndex + 1}
            </div>
            <CollabPhaseCard state={collabUi} roundIndex={roundIndex} />
          </div>
        </section>
      );
    }
    return null;
  }

  const approve = async (note?: string) => {
    if (busy) return;
    setBusy("approve");
    try {
      await approveAndExecuteAgent(
        workspaceId,
        threadId,
        projection.runId,
        projection.planRevision,
        note,
      );
    } catch (error) {
      pushErrorToast({
        title: t("multiAgent.errors.startFailed"),
        message: t("multiAgent.errors.approvalFailed", {
          diagnostic: diagnostic(error) }) });
    } finally {
      setBusy(null);
    }
  };

  const rejectReplan = async (note?: string) => {
    if (busy) return;
    setBusy("replan");
    try {
      await rejectAndReplanAgent({
        workspaceId,
        threadId,
        runId: projection.runId,
        requestText: projection.requestText,
        replanNote: note,
        target: projection.target,
        stageBindings: stageBindingsFromProjection(projection) });
    } catch (error) {
      pushErrorToast({
        title: t("multiAgent.errors.startFailed"),
        message: t("multiAgent.errors.replanFailed", {
          diagnostic: diagnostic(error) }) });
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (busy) return;
    setBusy("stop");
    try {
      await stopAgent(workspaceId, threadId, projection.runId);
    } catch (error) {
      pushErrorToast({
        title: t("multiAgent.errors.stopFailedTitle"),
        message: t("multiAgent.errors.stopFailed", {
          diagnostic: diagnostic(error) }) });
    } finally {
      setBusy(null);
    }
  };

  const forceUnlock = async () => {
    if (busy) return;
    setBusy("stop");
    try {
      await forceStopAndUnlock(workspaceId, threadId, projection.runId);
      pushErrorToast({
        variant: "success",
        title: t("multiAgent.actions.forceUnlockDoneTitle"),
        message: t("multiAgent.actions.forceUnlockDone") });
    } catch (error) {
      pushErrorToast({
        title: t("multiAgent.errors.stopFailedTitle"),
        message: t("multiAgent.errors.stopFailed", {
          diagnostic: diagnostic(error) }) });
    } finally {
      setBusy(null);
    }
  };

  const retryRun = async (stuckStageId?: string) => {
    if (busy) return;
    setBusy("retry");
    try {
      await retryCollabRun({
        workspaceId,
        threadId,
        runId: projection.runId,
        requestText: projection.requestText,
        target: projection.target,
        stageBindings: stageBindingsFromProjection(projection),
        stuckStageId });
    } catch (error) {
      pushErrorToast({
        title: t("multiAgent.errors.startFailed"),
        message: t("multiAgent.errors.retryFailed", {
          diagnostic: diagnostic(error) }) });
    } finally {
      setBusy(null);
    }
  };

  const retryStage = async (stage: AgentStageProjection) => {
    if (busy) return;
    setBusy("retry");
    try {
      await retryAgentStage({
        workspaceId,
        threadId,
        runId: projection.runId,
        stageId: stage.id,
        oldAttemptId: stage.attemptId });
    } catch (error) {
      const msg = diagnostic(error);
      // 终态 run 无法单节点重试 → 引导整轮
      if (msg.includes("agent-retry-stage-terminal")) {
        pushErrorToast({
          variant: "info",
          title: t("multiAgent.actions.retryStage"),
          message: t("multiAgent.errors.retryStageTerminal") });
      } else {
        pushErrorToast({
          title: t("multiAgent.errors.startFailed"),
          message: t("multiAgent.errors.retryFailed", {
            diagnostic: msg }) });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ma-surface ma-surface--sticky" aria-live="polite">
      <div className="ma-msg">
        <div className="ma-who">{t("multiAgent.card.who")}</div>
        <div className="ma-meta-line">
          {t("multiAgent.card.metaLine", { n: roundIndex + 1 })}
        </div>
        <OrchCard
          projection={projection}
          roundIndex={roundIndex}
          totalRounds={Math.max(rounds.length, 1)}
          active
          workspaceId={workspaceId}
          threadId={threadId}
          busy={busy}
          featureEnabled={featureEnabled}
          onApprove={(note) => void approve(note)}
          onRejectReplan={(note) => void rejectReplan(note)}
          onStop={() => void stop()}
          onForceUnlock={() => void forceUnlock()}
          onRetryRun={(stageId) => void retryRun(stageId)}
          onRetryStage={(stage) => void retryStage(stage)}
          onOpenStage={(stage) => openStage(projection, stage, roundIndex)}
          onJumpRound={(index) => jumpRound(rounds, index)}
        />
      </div>
    </section>
  );
}
