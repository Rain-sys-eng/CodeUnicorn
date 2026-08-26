import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  clearFirstEngineEventForThread,
  decideOrphanTurnWatch,
  getFirstEngineEventAtForThread,
  getOrphanTurnFirstEventTimeoutMs,
} from "../utils/orphanTurnWatchdog";
import type { ThreadState } from "./threadReducerTypes";
import type { DebugEntry } from "../../../types";

type UseOrphanTurnWatchdogOptions = {
  threadStatusById: ThreadState["threadStatusById"];
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  pushThreadErrorMessage: (
    workspaceId: string,
    threadId: string,
    message: string,
  ) => void;
  onDebug?: (entry: DebugEntry) => void;
};

type ArmedEntry = {
  workspaceId: string;
  armedAt: number;
  deadlineAt: number;
  timerId: number;
};

/**
 * Orphan turn watchdog（fix-orphan-turn-during-backend-unavailability F1）。
 *
 * native 引擎路径 turn 乐观点亮 processing 后 arm；90s（可配）内未收到任何
 * 首事件且仍 processing → 判孤儿：解除 processing / activeTurnId，落可重试
 * 错误消息 + 诊断。首事件到达（useThreads catch-all 登记）、或任何路径清除
 * processing（terminal / interrupt / rpcError）→ fire 时 no-op 自清理。
 *
 * shared V2 路径不 arm（durable 状态机 + recovery 自管）。
 */
export function useOrphanTurnWatchdog({
  threadStatusById,
  markProcessing,
  setActiveTurnId,
  pushThreadErrorMessage,
  onDebug,
}: UseOrphanTurnWatchdogOptions) {
  const armedByThreadRef = useRef<Map<string, ArmedEntry>>(new Map());
  const threadStatusByIdRef = useRef(threadStatusById);
  const markProcessingRef = useRef(markProcessing);
  const setActiveTurnIdRef = useRef(setActiveTurnId);
  const pushThreadErrorMessageRef = useRef(pushThreadErrorMessage);
  const onDebugRef = useRef(onDebug);
  const { t } = useTranslation();

  useEffect(() => {
    threadStatusByIdRef.current = threadStatusById;
    markProcessingRef.current = markProcessing;
    setActiveTurnIdRef.current = setActiveTurnId;
    pushThreadErrorMessageRef.current = pushThreadErrorMessage;
    onDebugRef.current = onDebug;
  }, [
    threadStatusById,
    markProcessing,
    setActiveTurnId,
    pushThreadErrorMessage,
    onDebug,
  ]);

  const disarmOrphanTurnWatchdog = useCallback((threadId: string) => {
    const entry = armedByThreadRef.current.get(threadId);
    if (!entry) {
      return;
    }
    window.clearTimeout(entry.timerId);
    armedByThreadRef.current.delete(threadId);
    clearFirstEngineEventForThread(threadId);
  }, []);

  const armOrphanTurnWatchdog = useCallback(
    (workspaceId: string, threadId: string) => {
      const existing = armedByThreadRef.current.get(threadId);
      if (existing) {
        // 同一零首事件窗口内的重复 arm（连发 / steer）：复用最早 deadline，
        // 不被连发无限顺延。
        if (getFirstEngineEventAtForThread(threadId) === null) {
          return;
        }
        // 上一窗口已见首事件（前 turn 正常完结 / steer 开启新 turn）：视为
        // 新 turn 重挂全新窗口，否则新 turn 的孤儿会被旧登记遮蔽而漏判。
        disarmOrphanTurnWatchdog(threadId);
      }
      // 清掉 arm 之前的陈旧首事件登记（历史加载 / 标题生成等非 turn 事件、
      // 上一 turn timer 清理后迟到的登记），保证 fire 时读到的首事件一定
      // 落在本 turn 窗口内。
      clearFirstEngineEventForThread(threadId);
      const armedAt = Date.now();
      const deadlineAt = armedAt + getOrphanTurnFirstEventTimeoutMs();
      const timerId = window.setTimeout(() => {
        const entry = armedByThreadRef.current.get(threadId);
        armedByThreadRef.current.delete(threadId);
        if (!entry) {
          return;
        }
        const decision = decideOrphanTurnWatch({
          isProcessing: Boolean(
            threadStatusByIdRef.current[threadId]?.isProcessing,
          ),
          firstEngineEventAt: getFirstEngineEventAtForThread(threadId),
          deadlineAt: entry.deadlineAt,
          now: Date.now(),
        });
        clearFirstEngineEventForThread(threadId);
        if (decision !== "settle-orphan") {
          return;
        }
        markProcessingRef.current(threadId, false);
        setActiveTurnIdRef.current(threadId, null);
        pushThreadErrorMessageRef.current(
          entry.workspaceId,
          threadId,
          t("threads.turnOrphanedRetryable"),
        );
        onDebugRef.current?.({
          id: `orphan-turn-first-event-timeout-${threadId}-${Date.now()}`,
          timestamp: Date.now(),
          source: "client",
          label: "orphan-turn-first-event-timeout",
          payload: {
            workspaceId: entry.workspaceId,
            threadId,
            elapsedMs: Date.now() - entry.armedAt,
            timeoutMs: getOrphanTurnFirstEventTimeoutMs(),
          },
        });
      }, getOrphanTurnFirstEventTimeoutMs());
      armedByThreadRef.current.set(threadId, {
        workspaceId,
        armedAt,
        deadlineAt,
        timerId,
      });
    },
    [disarmOrphanTurnWatchdog, t],
  );

  // 卸载时清全部 timer，防泄漏与已卸载组件上的 settle。
  useEffect(() => {
    const armed = armedByThreadRef.current;
    return () => {
      armed.forEach((entry) => window.clearTimeout(entry.timerId));
      armed.clear();
    };
  }, []);

  return { armOrphanTurnWatchdog, disarmOrphanTurnWatchdog };
}
