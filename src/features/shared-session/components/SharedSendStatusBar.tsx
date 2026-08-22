/**
 * Shared Send 状态条（Wave 4 / B.6 + recovery exit + simplified UX）。
 *
 * 按 `sendStateMachine` 九状态渲染 Composer 底部提示条：
 * - `preparing-context` / `awaiting-acceptance` / `cancel-pending` / `settling`：只读提示；
 * - `degraded-context`：legacy transient state，不渲染阻塞确认；
 * - `recovery-required`：单行折叠（自动处理 / 跳过本轮）+ 详情弹窗 + 展开高级；
 * - `target-unavailable`：展示不可用原因，Picker 保持可更换。
 *
 * 纪律：Probe / Stop / Rebuild / Abandon 能力保留；默认不把四动作平铺。
 * 禁止 window.confirm（Tauri WebView 下不可靠 / 可卡死）。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ArrowRightLeft from "lucide-react/dist/esm/icons/arrow-right-left";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import HelpCircle from "lucide-react/dist/esm/icons/help-circle";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import SkipForward from "lucide-react/dist/esm/icons/skip-forward";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Unplug from "lucide-react/dist/esm/icons/unplug";

import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { pushErrorToast } from "../../../services/toasts";
import {
  sharedSessionV2AbandonUnresolvedAttempt,
  sharedSessionV2InterruptTurn,
  sharedSessionV2ProbeBinding,
  sharedSessionV2RecoverAttempt,
  sharedSessionV2RebuildBinding,
} from "../services/sharedSessions";
import {
  canCancel,
  sharedAdapterCapabilities,
} from "../target/sendStateMachine";
import { useSharedTargetState } from "../target/targetStore";
import {
  dispatchSharedSendEvent,
  useSharedSendState,
} from "../runtime/sharedSendStateStore";
import { reattachSharedSessionAttempt } from "../runtime/reattachSharedSessionAttempt";
import { isSharedV2SendEnabled } from "../runtime/sharedV2SendFlag";
import { isSharedRecoveryExitV2Enabled } from "../runtime/sharedRecoveryExitFlag";
import {
  classifyRecoveryError,
  extractDurableOwnerFromMismatch,
  squadBaseBindingKey,
  type RecoveryActionKind,
} from "../runtime/recoveryErrorMap";
import {
  invalidateRecoveryOwnerPrefetch,
  prefetchRecoveryOwner,
  resolveSharedRecoveryOwner,
  takePrefetchedRecoveryOwner,
  yieldRecoveryClickPaint,
  type RecoveryOwner,
} from "../runtime/recoveryClickPath";

type SharedSendStatusBarProps = {
  workspaceId: string | null;
  threadId: string | null;
  isSharedSession: boolean;
};

type RecoveryWorkState = "idle" | "working" | "held" | "cleared";

type RecoverOutcome = "cleared" | "held" | "active";

function recoveryErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * 按动作分流 toast：换连接失败不得复用「自动处理没法继续」口吻。
 */
function mapRecoveryErrorToast(
  t: (key: string, params?: Record<string, unknown>) => string,
  action: RecoveryActionKind,
  error: unknown,
): string {
  const { kind } = classifyRecoveryError(error);
  switch (kind) {
    case "recovery-active":
      // rebuild 撞 Runtime own：引导停止或跳过，避免只说「先停再换」互推
      return action === "rebuild"
        ? t("sharedSend.recoveryErrorActiveRebuild")
        : t("sharedSend.recoveryErrorActive");
    case "recovery-active-requires-stop":
      // 跳过路径已 forceStop；若仍失败属后端异常，引导重试跳过
      return action === "skip"
        ? t("sharedSend.recoveryErrorActiveRequiresStopSkip")
        : t("sharedSend.recoveryErrorActiveRequiresStop");
    case "recovery-owner-ambiguous":
      return t("sharedSend.recoveryErrorAmbiguous");
    case "recovery-owner-missing":
      return t("sharedSend.recoveryErrorOwnerMissing");
    case "recovery-owner-mismatch":
      return action === "rebuild"
        ? t("sharedSend.recoveryErrorOwnerMismatchRebuild")
        : t("sharedSend.recoveryErrorOwnerMismatch");
    case "empty-context-handoff":
      return t("sharedSend.recoveryErrorEmptyContextHandoff");
    default:
      // 不把英文 raw stack 甩给用户；下一步按动作引导
      if (action === "rebuild") {
        return t("sharedSend.recoveryErrorGenericRebuild");
      }
      if (action === "stop") {
        return t("sharedSend.recoveryErrorGenericStop");
      }
      if (action === "skip") {
        return t("sharedSend.recoveryErrorGenericSkip");
      }
      return t("sharedSend.recoveryErrorGenericNext");
  }
}

function recoveryErrorToastTitle(
  t: (key: string, params?: Record<string, unknown>) => string,
  action: RecoveryActionKind,
): string {
  if (action === "rebuild") {
    return t("sharedSend.recoveryRebuildFailedTitle");
  }
  if (action === "auto") {
    return t("sharedSend.recoveryAutoFailedTitle");
  }
  if (action === "stop") {
    return t("sharedSend.recoveryStopFailedTitle");
  }
  if (action === "skip") {
    return t("sharedSend.recoverySkipFailedTitle");
  }
  return t("sharedSend.recoveryTitle");
}

/**
 * 显式 rebuild：先用解析出的 binding key；owner-mismatch 时用 durable key 重试一次。
 * Squad key 在后端已支持直接 rebuild；仍保留 durable 回退作防御。
 */
async function rebuildBindingWithMismatchRetry(
  workspaceId: string,
  threadId: string,
  bindingKey: string,
): Promise<void> {
  try {
    await sharedSessionV2RebuildBinding(workspaceId, threadId, bindingKey);
  } catch (error) {
    const { kind } = classifyRecoveryError(error);
    if (kind !== "recovery-owner-mismatch") {
      throw error;
    }
    const fallbackKey =
      extractDurableOwnerFromMismatch(error) ??
      squadBaseBindingKey(bindingKey);
    if (!fallbackKey || fallbackKey === bindingKey) {
      throw error;
    }
    await sharedSessionV2RebuildBinding(workspaceId, threadId, fallbackKey);
  }
}

export function SharedSendStatusBar({
  workspaceId,
  threadId,
  isSharedSession,
}: SharedSendStatusBarProps) {
  const { t } = useTranslation();
  const entry = useSharedSendState(workspaceId ?? "", threadId ?? "");
  const targetState = useSharedTargetState(workspaceId ?? "", threadId ?? "");
  const adapterCapabilities = sharedAdapterCapabilities(
    targetState.activeTurnTarget?.engine ??
      targetState.selectedNextTarget?.engine,
  );
  const exitLadderEnabled = isSharedRecoveryExitV2Enabled();
  const [recoveryWork, setRecoveryWork] = useState<RecoveryWorkState>("idle");
  const [lastErrorDetail, setLastErrorDetail] = useState<string | null>(null);
  const [runtimeReleased, setRuntimeReleased] = useState(false);
  const [stoppableAttemptId, setStoppableAttemptId] = useState<string | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  /** 自动失败或再查仍锁时，高亮「跳过本轮」 */
  const [recommendSkip, setRecommendSkip] = useState(false);

  const findRecoveryOwner = useCallback(async (): Promise<RecoveryOwner> => {
    if (!workspaceId || !threadId) {
      return { kind: "ambiguous" };
    }
    const owner = await resolveSharedRecoveryOwner(workspaceId, threadId);
    setStoppableAttemptId(owner.kind === "attempt" ? owner.attemptId : null);
    return owner;
  }, [workspaceId, threadId]);

  useEffect(() => {
    if (entry.state !== "recovery-required" || !workspaceId || !threadId) {
      return;
    }
    void prefetchRecoveryOwner(workspaceId, threadId, findRecoveryOwner).catch(
      () => undefined,
    );
    return () => {
      invalidateRecoveryOwnerPrefetch(workspaceId, threadId);
    };
  }, [entry.state, workspaceId, threadId, findRecoveryOwner]);

  const invalidateOwnerPrefetch = useCallback(() => {
    if (!workspaceId || !threadId) {
      return;
    }
    invalidateRecoveryOwnerPrefetch(workspaceId, threadId);
  }, [workspaceId, threadId]);

  const resolveFirstRecoveryOwner = useCallback(async () => {
    if (!workspaceId || !threadId) {
      return { kind: "ambiguous" } as const;
    }
    const prefetched = await takePrefetchedRecoveryOwner(
      workspaceId,
      threadId,
    );
    return prefetched ?? findRecoveryOwner();
  }, [workspaceId, threadId, findRecoveryOwner]);

  const beginRecoveryAction = useCallback(async () => {
    await yieldRecoveryClickPaint();
    return resolveFirstRecoveryOwner();
  }, [resolveFirstRecoveryOwner]);

  const unlockSession = useCallback(() => {
    if (!workspaceId || !threadId) {
      return;
    }
    dispatchSharedSendEvent(workspaceId, threadId, { type: "probeNotAccepted" });
    dispatchSharedSendEvent(workspaceId, threadId, { type: "canonicalCommitted" });
    setRuntimeReleased(false);
    setLastErrorDetail(null);
    setAutoFailed(false);
    setRecommendSkip(false);
    setStoppableAttemptId(null);
  }, [workspaceId, threadId]);

  const settleCancelled = useCallback(() => {
    if (!workspaceId || !threadId) {
      return;
    }
    dispatchSharedSendEvent(workspaceId, threadId, { type: "commitCancelled" });
    dispatchSharedSendEvent(workspaceId, threadId, { type: "canonicalCommitted" });
    setRuntimeReleased(false);
    setLastErrorDetail(null);
    setAutoFailed(false);
    setRecommendSkip(false);
    setStoppableAttemptId(null);
  }, [workspaceId, threadId]);

  const recoverAttemptOwner = useCallback(
    async (attemptId: string): Promise<RecoverOutcome> => {
      if (!workspaceId || !threadId) {
        return "held";
      }
      invalidateRecoveryOwnerPrefetch(workspaceId, threadId);
      const recovery = await sharedSessionV2RecoverAttempt(
        workspaceId,
        threadId,
        attemptId,
      );
      if (recovery.status === "active") {
        const observer = reattachSharedSessionAttempt(
          workspaceId,
          threadId,
          recovery,
        );
        void observer
          .then((commit) => {
            if (commit.terminal.recoveryReason) {
              setRecoveryWork("held");
            }
          })
          .catch((error: unknown) => {
            setRecoveryWork("held");
            setLastErrorDetail(recoveryErrorMessage(error));
            pushErrorToast({
              title: recoveryErrorToastTitle(t, "probe"),
              message: mapRecoveryErrorToast(t, "probe", error),
              durationMs: 4800,
            });
          });
        setRecoveryWork("cleared");
        setAutoFailed(false);
        return "active";
      }
      if (recovery.status === "unknown") {
        setRecoveryWork("held");
        return "held";
      }
      dispatchSharedSendEvent(workspaceId, threadId, {
        type:
          recovery.status === "terminal-committed"
            ? "probeTerminalRun"
            : "probeNotAccepted",
      });
      dispatchSharedSendEvent(workspaceId, threadId, {
        type: "canonicalCommitted",
      });
      setRecoveryWork("cleared");
      setAutoFailed(false);
      setStoppableAttemptId(null);
      return "cleared";
    },
    [workspaceId, threadId, t],
  );

  const notifyProbeHeld = useCallback(() => {
    // 查完仍锁：必须有可见反馈，不能静默
    setRecommendSkip(true);
    pushErrorToast({
      title: t("sharedSend.recoveryProbeTitle"),
      message: t("sharedSend.recoveryProbeStillLocked"),
      variant: "info",
      durationMs: 5600,
    });
  }, [t]);

  const handleProbe = useCallback(async () => {
    if (!workspaceId || !threadId) {
      return;
    }
    setRecoveryWork("working");
    setLastErrorDetail(null);
    // 再查一次后以本次结果为准，别被「自动失败」旧文案盖住
    setAutoFailed(false);
    setRecommendSkip(false);
    try {
      const owner = await beginRecoveryAction();
      if (owner.kind === "clear") {
        unlockSession();
        setRecoveryWork("cleared");
        pushErrorToast({
          title: t("sharedSend.recoveryProbeTitle"),
          message: t("sharedSend.recoveryProbeCleared"),
          variant: "success",
          durationMs: 4200,
        });
        return;
      }
      if (owner.kind === "ambiguous") {
        setRecoveryWork("held");
        setRecommendSkip(true);
        setLastErrorDetail(t("sharedSend.recoveryErrorAmbiguous"));
        pushErrorToast({
          title: t("sharedSend.recoveryProbeTitle"),
          message: t("sharedSend.recoveryErrorAmbiguous"),
          durationMs: 5600,
        });
        return;
      }
      if (owner.kind === "attempt") {
        const outcome = await recoverAttemptOwner(owner.attemptId);
        if (outcome === "held") {
          notifyProbeHeld();
        } else if (outcome === "cleared") {
          pushErrorToast({
            title: t("sharedSend.recoveryProbeTitle"),
            message: t("sharedSend.recoveryProbeCleared"),
            variant: "success",
            durationMs: 4200,
          });
        } else if (outcome === "active") {
          pushErrorToast({
            title: t("sharedSend.recoveryProbeTitle"),
            message: t("sharedSend.recoveryProbeReattached"),
            variant: "success",
            durationMs: 4200,
          });
        }
        return;
      }
      const bindingProbe = await sharedSessionV2ProbeBinding(
        workspaceId,
        threadId,
        owner.bindingKey,
      );
      if (bindingProbe.inFlightAttempts.length !== 1) {
        setRecoveryWork("held");
        notifyProbeHeld();
        return;
      }
      const attemptId = bindingProbe.inFlightAttempts[0]?.attemptId?.trim();
      if (!attemptId) {
        setRecoveryWork("held");
        notifyProbeHeld();
        return;
      }
      setStoppableAttemptId(attemptId);
      const outcome = await recoverAttemptOwner(attemptId);
      if (outcome === "held") {
        notifyProbeHeld();
      } else if (outcome === "cleared") {
        pushErrorToast({
          title: t("sharedSend.recoveryProbeTitle"),
          message: t("sharedSend.recoveryProbeCleared"),
          variant: "success",
          durationMs: 4200,
        });
      } else if (outcome === "active") {
        pushErrorToast({
          title: t("sharedSend.recoveryProbeTitle"),
          message: t("sharedSend.recoveryProbeReattached"),
          variant: "success",
          durationMs: 4200,
        });
      }
    } catch (error) {
      setRecoveryWork("held");
      setRecommendSkip(true);
      setLastErrorDetail(recoveryErrorMessage(error));
      pushErrorToast({
        title: t("sharedSend.recoveryProbeTitle"),
        message: mapRecoveryErrorToast(t, "probe", error),
        durationMs: 4800,
      });
    }
  }, [
    workspaceId,
    threadId,
    beginRecoveryAction,
    recoverAttemptOwner,
    unlockSession,
    notifyProbeHeld,
    t,
  ]);

  const handleStop = useCallback(async () => {
    if (!workspaceId || !threadId) {
      return;
    }
    setRecoveryWork("working");
    setLastErrorDetail(null);
    try {
      const owner = await beginRecoveryAction();
      if (owner.kind === "clear") {
        unlockSession();
        setRecoveryWork("cleared");
        return;
      }
      if (owner.kind === "ambiguous") {
        setRecoveryWork("held");
        setLastErrorDetail(t("sharedSend.recoveryErrorAmbiguous"));
        pushErrorToast({
          title: recoveryErrorToastTitle(t, "stop"),
          message: t("sharedSend.recoveryErrorAmbiguous"),
          durationMs: 4800,
        });
        return;
      }
      // binding-only：没有可 interrupt 的 in-flight attempt
      if (owner.kind !== "attempt") {
        setRecoveryWork("held");
        setLastErrorDetail(t("sharedSend.recoveryStopNoAttempt"));
        pushErrorToast({
          title: recoveryErrorToastTitle(t, "stop"),
          message: t("sharedSend.recoveryStopNoAttempt"),
          durationMs: 4200,
        });
        return;
      }
      invalidateOwnerPrefetch();
      const result = await sharedSessionV2InterruptTurn(
        workspaceId,
        threadId,
        owner.attemptId,
      );
      if (result.status === "terminal-committed") {
        dispatchSharedSendEvent(workspaceId, threadId, {
          type: "probeTerminalRun",
        });
        dispatchSharedSendEvent(workspaceId, threadId, {
          type: "canonicalCommitted",
        });
        setRecoveryWork("cleared");
        setAutoFailed(false);
        setStoppableAttemptId(null);
        return;
      }
      // 停止已受理，会话仍锁定；底条走 recoveryHintAfterStop
      setRuntimeReleased(true);
      setRecoveryWork("held");
    } catch (error) {
      setRecoveryWork("held");
      setLastErrorDetail(recoveryErrorMessage(error));
      pushErrorToast({
        title: recoveryErrorToastTitle(t, "stop"),
        message: mapRecoveryErrorToast(t, "stop", error),
        durationMs: 4800,
      });
    }
  }, [
    workspaceId,
    threadId,
    beginRecoveryAction,
    invalidateOwnerPrefetch,
    unlockSession,
    t,
  ]);

  const handleStopAndRebuild = useCallback(async () => {
    if (!workspaceId || !threadId) {
      return;
    }
    setRecoveryWork("working");
    setLastErrorDetail(null);
    try {
      const owner = await beginRecoveryAction();
      if (owner.kind === "clear") {
        unlockSession();
        setRecoveryWork("cleared");
        return;
      }
      if (owner.kind === "ambiguous") {
        setRecoveryWork("held");
        setRecommendSkip(true);
        setLastErrorDetail(t("sharedSend.recoveryErrorAmbiguous"));
        pushErrorToast({
          title: recoveryErrorToastTitle(t, "rebuild"),
          message: t("sharedSend.recoveryErrorAmbiguous"),
          durationMs: 5200,
        });
        return;
      }
      if (owner.kind === "attempt") {
        try {
          invalidateOwnerPrefetch();
          const interruptResult = await sharedSessionV2InterruptTurn(
            workspaceId,
            threadId,
            owner.attemptId,
          );
          if (interruptResult.status === "terminal-committed") {
            dispatchSharedSendEvent(workspaceId, threadId, {
              type: "probeTerminalRun",
            });
            dispatchSharedSendEvent(workspaceId, threadId, {
              type: "canonicalCommitted",
            });
            setRecoveryWork("cleared");
            setAutoFailed(false);
            setStoppableAttemptId(null);
            return;
          }
          setRuntimeReleased(true);
        } catch {
          // best-effort stop；rebuild 仍可能 recovery-active
        }
      }
      invalidateOwnerPrefetch();
      await rebuildBindingWithMismatchRetry(
        workspaceId,
        threadId,
        owner.bindingKey,
      );
      settleCancelled();
      setRecoveryWork("cleared");
      setRecommendSkip(false);
      setAutoFailed(false);
    } catch (error) {
      setRecoveryWork("held");
      setRecommendSkip(true);
      setLastErrorDetail(recoveryErrorMessage(error));
      pushErrorToast({
        title: recoveryErrorToastTitle(t, "rebuild"),
        message: mapRecoveryErrorToast(t, "rebuild", error),
        durationMs: 5200,
      });
    }
  }, [
    workspaceId,
    threadId,
    beginRecoveryAction,
    invalidateOwnerPrefetch,
    unlockSession,
    settleCancelled,
    t,
  ]);

  const handleRebuild = useCallback(async () => {
    if (exitLadderEnabled) {
      await handleStopAndRebuild();
      return;
    }
    if (!workspaceId || !threadId) {
      return;
    }
    setRecoveryWork("working");
    try {
      const owner = await beginRecoveryAction();
      if (owner.kind === "clear") {
        unlockSession();
        setRecoveryWork("cleared");
        return;
      }
      if (owner.kind === "ambiguous") {
        setRecoveryWork("held");
        setRecommendSkip(true);
        return;
      }
      invalidateOwnerPrefetch();
      await rebuildBindingWithMismatchRetry(
        workspaceId,
        threadId,
        owner.bindingKey,
      );
      settleCancelled();
      setRecoveryWork("cleared");
      setRecommendSkip(false);
    } catch (error) {
      setRecoveryWork("held");
      setRecommendSkip(true);
      setLastErrorDetail(recoveryErrorMessage(error));
      pushErrorToast({
        title: recoveryErrorToastTitle(t, "rebuild"),
        message: mapRecoveryErrorToast(t, "rebuild", error),
        durationMs: 4800,
      });
    }
  }, [
    exitLadderEnabled,
    handleStopAndRebuild,
    workspaceId,
    threadId,
    beginRecoveryAction,
    invalidateOwnerPrefetch,
    unlockSession,
    settleCancelled,
    t,
  ]);

  /** 跳过本轮：确认后执行（无 window.confirm）。 */
  const performAbandon = useCallback(async () => {
    if (!workspaceId || !threadId) {
      return;
    }
    setRecoveryWork("working");
    setLastErrorDetail(null);
    try {
      const owner = await beginRecoveryAction();
      if (owner.kind === "clear") {
        unlockSession();
        setRecoveryWork("cleared");
        return;
      }
      if (owner.kind === "ambiguous") {
        setRecoveryWork("held");
        setLastErrorDetail(t("sharedSend.recoveryErrorAmbiguous"));
        pushErrorToast({
          title: t("sharedSend.recoveryTitle"),
          message: t("sharedSend.recoveryErrorAmbiguous"),
          durationMs: 4800,
        });
        return;
      }
      if (owner.kind === "binding") {
        unlockSession();
        setRecoveryWork("cleared");
        return;
      }
      invalidateOwnerPrefetch();
      const result = await sharedSessionV2AbandonUnresolvedAttempt(
        workspaceId,
        threadId,
        {
          attemptId: owner.attemptId,
          forceStop: true,
        },
      );
      if (result.status === "clear") {
        unlockSession();
      } else {
        settleCancelled();
      }
      setRecoveryWork("cleared");
    } catch (error) {
      setRecoveryWork("held");
      setRecommendSkip(true);
      setLastErrorDetail(recoveryErrorMessage(error));
      pushErrorToast({
        title: recoveryErrorToastTitle(t, "skip"),
        message: mapRecoveryErrorToast(t, "skip", error),
        durationMs: 5200,
      });
    }
  }, [
    workspaceId,
    threadId,
    beginRecoveryAction,
    invalidateOwnerPrefetch,
    unlockSession,
    settleCancelled,
    t,
  ]);

  /**
   * 自动处理：串行 exit ladder，不自动 abandon。
   * owner → recover → interrupt → rebuild。
   */
  const handleAuto = useCallback(async () => {
    if (!workspaceId || !threadId) {
      return;
    }
    setRecoveryWork("working");
    setLastErrorDetail(null);
    setAutoFailed(false);
    try {
      let owner = await beginRecoveryAction();
      if (owner.kind === "clear") {
        unlockSession();
        setRecoveryWork("cleared");
        return;
      }
      if (owner.kind === "ambiguous") {
        setRecoveryWork("held");
        setAutoFailed(true);
        setLastErrorDetail(t("sharedSend.recoveryErrorAmbiguous"));
        pushErrorToast({
          title: t("sharedSend.recoveryTitle"),
          message: t("sharedSend.recoveryErrorAmbiguous"),
          durationMs: 4800,
        });
        return;
      }

      if (owner.kind === "attempt") {
        const outcome = await recoverAttemptOwner(owner.attemptId);
        if (outcome === "cleared" || outcome === "active") {
          return;
        }
        try {
          invalidateOwnerPrefetch();
          const interruptResult = await sharedSessionV2InterruptTurn(
            workspaceId,
            threadId,
            owner.attemptId,
          );
          if (interruptResult.status === "terminal-committed") {
            dispatchSharedSendEvent(workspaceId, threadId, {
              type: "probeTerminalRun",
            });
            dispatchSharedSendEvent(workspaceId, threadId, {
              type: "canonicalCommitted",
            });
            setRecoveryWork("cleared");
            setAutoFailed(false);
            setStoppableAttemptId(null);
            return;
          }
          setRuntimeReleased(true);
        } catch {
          // best-effort；继续 rebuild
        }
      }

      // rebuild 前再解析一次 owner（interrupt 后可能 clear）；不走 prefetch
      owner = await findRecoveryOwner();
      if (owner.kind === "clear") {
        unlockSession();
        setRecoveryWork("cleared");
        return;
      }
      if (owner.kind === "ambiguous") {
        setRecoveryWork("held");
        setAutoFailed(true);
        setLastErrorDetail(t("sharedSend.recoveryErrorAmbiguous"));
        return;
      }

      if (owner.kind === "attempt") {
        try {
          invalidateOwnerPrefetch();
          const interruptResult = await sharedSessionV2InterruptTurn(
            workspaceId,
            threadId,
            owner.attemptId,
          );
          if (interruptResult.status === "terminal-committed") {
            dispatchSharedSendEvent(workspaceId, threadId, {
              type: "probeTerminalRun",
            });
            dispatchSharedSendEvent(workspaceId, threadId, {
              type: "canonicalCommitted",
            });
            setRecoveryWork("cleared");
            setAutoFailed(false);
            setStoppableAttemptId(null);
            return;
          }
          setRuntimeReleased(true);
        } catch {
          // continue rebuild
        }
      }

      invalidateOwnerPrefetch();
      await rebuildBindingWithMismatchRetry(
        workspaceId,
        threadId,
        owner.bindingKey,
      );
      settleCancelled();
      setRecoveryWork("cleared");
      setAutoFailed(false);
      setRecommendSkip(false);
    } catch (error) {
      setRecoveryWork("held");
      setAutoFailed(true);
      setRecommendSkip(true);
      setLastErrorDetail(recoveryErrorMessage(error));
      pushErrorToast({
        title: recoveryErrorToastTitle(t, "auto"),
        message: mapRecoveryErrorToast(t, "auto", error),
        durationMs: 7200,
      });
    }
  }, [
    workspaceId,
    threadId,
    beginRecoveryAction,
    findRecoveryOwner,
    invalidateOwnerPrefetch,
    recoverAttemptOwner,
    unlockSession,
    settleCancelled,
    t,
  ]);

  if (!isSharedSession || !workspaceId || !threadId) {
    return null;
  }
  if (!isSharedV2SendEnabled()) {
    return null;
  }
  const { state, detail } = entry;
  if (
    state === "idle" ||
    state === "running" ||
    state === "degraded-context"
  ) {
    return null;
  }

  const dispatch = (event: Parameters<typeof dispatchSharedSendEvent>[2]) => {
    dispatchSharedSendEvent(workspaceId, threadId, event);
  };

  const recoveryHintText =
    recoveryWork === "working"
      ? t("sharedSend.recoveryProbing")
      : autoFailed
        ? t("sharedSend.recoveryAutoFailedHint")
        : recoveryWork === "held"
          ? runtimeReleased
            ? t("sharedSend.recoveryHintAfterStop")
            : t("sharedSend.recoveryProbeHeldNext")
          : recoveryWork === "cleared"
            ? t("sharedSend.recoveryProbeCleared")
            : t("sharedSend.recoveryHintShort");

  const busy = recoveryWork === "working";
  const canStop = Boolean(stoppableAttemptId) && !busy;

  return (
    <>
      <div
        className={`shared-send-status shared-send-status--${state}${
          expanded ? " shared-send-status--expanded" : ""
        }`}
        role="status"
        data-testid="shared-send-status"
      >
        {state === "preparing-context" && (
          <span className="shared-send-status__text">
            {t("sharedSend.preparingContext")}
          </span>
        )}

        {state === "awaiting-acceptance" && (
          <>
            <span className="shared-send-status__text">
              {t("sharedSend.awaitingAcceptance")}
            </span>
            <span className="shared-send-status__actions">
              <button
                type="button"
                className="shared-send-status__button"
                disabled={
                  !canCancel(state, adapterCapabilities.cancelPendingDelivery)
                }
                title={t("sharedSend.cancelUnsupported")}
                onClick={() => dispatch({ type: "cancelRequested" })}
              >
                {t("sharedSend.cancel")}
              </button>
            </span>
          </>
        )}

        {state === "cancel-pending" && (
          <span className="shared-send-status__text">
            {t("sharedSend.cancelPending")}
          </span>
        )}

        {state === "settling" && (
          <span className="shared-send-status__text">
            {t("sharedSend.settling")}
          </span>
        )}

        {state === "recovery-required" && exitLadderEnabled && (
          <div className="shared-send-status__recovery">
            <div className="shared-send-status__row">
              <span className="shared-send-status__label">
                {t("sharedSend.recoveryTitleShort")}
              </span>
              <span className="shared-send-status__sep" aria-hidden>
                ·
              </span>
              <span
                className="shared-send-status__msg"
                title={recoveryHintText}
              >
                {recoveryHintText}
              </span>

              <button
                type="button"
                className="shared-send-status__icon-btn"
                title={t("sharedSend.recoveryDetails")}
                aria-label={t("sharedSend.recoveryDetails")}
                data-testid="shared-send-recovery-info"
                onClick={() => setDetailsOpen(true)}
              >
                <HelpCircle size={13} aria-hidden />
              </button>

              <span className="shared-send-status__actions">
                <button
                  type="button"
                  className="shared-send-status__button shared-send-status__button--primary"
                  disabled={busy}
                  data-testid="shared-send-recovery-auto"
                  onClick={() => void handleAuto()}
                >
                  {busy
                    ? t("sharedSend.recoveryAutoWorking")
                    : autoFailed
                      ? t("sharedSend.recoveryAutoRetry")
                      : t("sharedSend.recoveryAuto")}
                </button>
                <button
                  type="button"
                  className={`shared-send-status__button shared-send-status__button--danger${
                    recommendSkip || autoFailed
                      ? " shared-send-status__button--recommend"
                      : ""
                  }`}
                  disabled={busy}
                  data-testid="shared-send-recovery-skip"
                  title={
                    recommendSkip || autoFailed
                      ? t("sharedSend.recoverySkipRecommendedHint")
                      : t("sharedSend.recoverySkipHint")
                  }
                  onClick={() => setSkipConfirmOpen(true)}
                >
                  {t("sharedSend.recoverySkip")}
                </button>
                <button
                  type="button"
                  className="shared-send-status__icon-btn shared-send-status__expand"
                  title={
                    expanded
                      ? t("sharedSend.recoveryCollapseAdvanced")
                      : t("sharedSend.recoveryExpandAdvanced")
                  }
                  aria-expanded={expanded}
                  aria-label={
                    expanded
                      ? t("sharedSend.recoveryCollapseAdvanced")
                      : t("sharedSend.recoveryExpandAdvanced")
                  }
                  data-testid="shared-send-recovery-expand"
                  onClick={() => {
                    setExpanded((v) => {
                      const next = !v;
                      if (next) {
                        // 展开时刷新 stoppable，避免停止按钮永远禁用
                        void findRecoveryOwner().catch(() => {
                          setStoppableAttemptId(null);
                        });
                      }
                      return next;
                    });
                  }}
                >
                  <ChevronDown
                    size={13}
                    aria-hidden
                    className={
                      expanded
                        ? "shared-send-status__chevron shared-send-status__chevron--open"
                        : "shared-send-status__chevron"
                    }
                  />
                </button>
              </span>
            </div>

            {expanded ? (
              <div
                className="shared-send-status__advanced"
                data-testid="shared-send-recovery-advanced"
              >
                <p className="shared-send-status__advanced-hint">
                  {t("sharedSend.recoveryAdvancedHint")}
                </p>
                <div className="shared-send-status__advanced-actions">
                  <button
                    type="button"
                    className="shared-send-status__button"
                    disabled={busy}
                    onClick={() => void handleProbe()}
                  >
                    {busy
                      ? t("sharedSend.recoveryProbing")
                      : t("sharedSend.recoveryProbe")}
                  </button>
                  <button
                    type="button"
                    className="shared-send-status__button"
                    disabled={!canStop}
                    title={
                      canStop
                        ? t("sharedSend.recoveryStopHint")
                        : t("sharedSend.recoveryStopNoAttempt")
                    }
                    onClick={() => void handleStop()}
                  >
                    {t("sharedSend.recoveryStop")}
                  </button>
                  <button
                    type="button"
                    className="shared-send-status__button"
                    disabled={busy}
                    title={t("sharedSend.recoveryStopAndRebuildHint")}
                    onClick={() => void handleStopAndRebuild()}
                  >
                    {t("sharedSend.recoveryStopAndRebuild")}
                  </button>
                </div>
                {lastErrorDetail ? (
                  <p
                    className="shared-send-status__tech"
                    data-testid="shared-send-recovery-detail"
                    title={lastErrorDetail}
                  >
                    {t("sharedSend.recoveryTechDetail")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {state === "recovery-required" && !exitLadderEnabled && (
          <>
            <span className="shared-send-status__text">
              <strong>{t("sharedSend.recoveryTitle")}</strong>
              {" · "}
              {t("sharedSend.recoveryHint")}
            </span>
            <span className="shared-send-status__actions">
              <button
                type="button"
                className="shared-send-status__button"
                disabled={busy}
                onClick={() => void handleProbe()}
              >
                {busy
                  ? t("sharedSend.recoveryProbing")
                  : t("sharedSend.recoveryProbe")}
              </button>
              <button
                type="button"
                className="shared-send-status__button"
                disabled={busy}
                onClick={() => void handleRebuild()}
              >
                {t("sharedSend.recoveryRebuild")}
              </button>
            </span>
          </>
        )}

        {state === "target-unavailable" && (
          <span className="shared-send-status__text">
            {detail
              ? t("sharedSend.targetUnavailableReason", { reason: detail })
              : t("sharedSend.targetUnavailable")}
            {" · "}
            {t("sharedSend.targetUnavailableHint")}
          </span>
        )}
      </div>

      <ConfirmDialog
        open={skipConfirmOpen}
        title={t("sharedSend.recoverySkipConfirmTitle")}
        body={t("sharedSend.recoverySkipConfirm")}
        confirmText={t("sharedSend.recoverySkipConfirmAction")}
        danger
        onCancel={() => setSkipConfirmOpen(false)}
        onConfirm={() => {
          setSkipConfirmOpen(false);
          void performAbandon();
        }}
      />

      <AlertDialog
        open={detailsOpen}
        onOpenChange={(next) => {
          if (!next) {
            setDetailsOpen(false);
          }
        }}
      >
        <AlertDialogPopup bottomStickOnMobile={false} modalLayer>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sharedSend.recoveryDetailsTitle")}
            </AlertDialogTitle>
            {/* Description 仅作无障碍摘要；正文用结构化段落，避免一整坨挤在一起 */}
            <AlertDialogDescription className="shared-send-status__sr-only">
              {t("sharedSend.recoveryDetailsBody")}
            </AlertDialogDescription>
            <div className="shared-send-status__details-body">
              <p>{t("sharedSend.recoveryDetailsBody")}</p>
              <p>{t("sharedSend.recoveryDetailsBodyWhy")}</p>

              <div className="shared-send-status__details-section shared-send-status__details-section--auto">
                <p className="shared-send-status__details-section-title">
                  <span
                    className="shared-send-status__details-icon shared-send-status__details-icon--auto"
                    aria-hidden
                  >
                    <Sparkles size={13} />
                  </span>
                  {t("sharedSend.recoveryDetailsAutoTitle")}
                </p>
                <p>{t("sharedSend.recoveryDetailsAuto")}</p>
              </div>

              <div className="shared-send-status__details-section shared-send-status__details-section--skip">
                <p className="shared-send-status__details-section-title">
                  <span
                    className="shared-send-status__details-icon shared-send-status__details-icon--skip"
                    aria-hidden
                  >
                    <SkipForward size={13} />
                  </span>
                  {t("sharedSend.recoveryDetailsSkipTitle")}
                </p>
                <p>{t("sharedSend.recoveryDetailsSkip")}</p>
              </div>

              <div className="shared-send-status__details-section shared-send-status__details-section--rebuild">
                <p className="shared-send-status__details-section-title">
                  <span
                    className="shared-send-status__details-icon shared-send-status__details-icon--rebuild"
                    aria-hidden
                  >
                    <Unplug size={13} />
                  </span>
                  {t("sharedSend.recoveryDetailsRebuildTitle")}
                </p>
                <p>{t("sharedSend.recoveryDetailsRebuild")}</p>
              </div>

              <div className="shared-send-status__details-compare">
                <p className="shared-send-status__details-section-title">
                  <span
                    className="shared-send-status__details-icon shared-send-status__details-icon--compare"
                    aria-hidden
                  >
                    <ArrowRightLeft size={13} />
                  </span>
                  {t("sharedSend.recoveryDetailsDiffTitle")}
                </p>
                <div className="shared-send-status__details-compare-grid">
                  <div className="shared-send-status__details-compare-card shared-send-status__details-compare-card--skip">
                    <p className="shared-send-status__details-compare-label">
                      <SkipForward size={12} aria-hidden />
                      {t("sharedSend.recoveryDetailsDiffSkipLabel")}
                    </p>
                    <p>{t("sharedSend.recoveryDetailsDiffSkip")}</p>
                  </div>
                  <div className="shared-send-status__details-compare-card shared-send-status__details-compare-card--rebuild">
                    <p className="shared-send-status__details-compare-label">
                      <RefreshCw size={12} aria-hidden />
                      {t("sharedSend.recoveryDetailsDiffRebuildLabel")}
                    </p>
                    <p>{t("sharedSend.recoveryDetailsDiffRebuild")}</p>
                  </div>
                </div>
                <p className="shared-send-status__details-compare-tip">
                  {t("sharedSend.recoveryDetailsDiffTip")}
                </p>
              </div>

              <div className="shared-send-status__details-section shared-send-status__details-section--advanced">
                <p className="shared-send-status__details-section-title">
                  <span
                    className="shared-send-status__details-icon shared-send-status__details-icon--advanced"
                    aria-hidden
                  >
                    <Search size={13} />
                  </span>
                  {t("sharedSend.recoveryDetailsAdvancedTitle")}
                </p>
                <p>{t("sharedSend.recoveryDetailsAdvanced")}</p>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <button
              type="button"
              className="primary"
              onClick={() => setDetailsOpen(false)}
            >
              {t("sharedSend.recoveryDetailsDismiss")}
            </button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
