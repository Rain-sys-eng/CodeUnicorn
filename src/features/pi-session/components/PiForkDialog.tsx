import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  piFork,
  piGetForkMessages,
  piSessionIdFromThreadId,
  type PiForkMessage,
} from "../api/piSessionRpc";
import { requestPiThreadJump, markPiDerivedThread } from "../store/piSessionStore";

/**
 * Shared fork-entry resolution: the RPC `fork` command needs an entryId,
 * which the timeline does not carry — resolve it by matching the bubble
 * text against `get_fork_messages`.
 */
export async function resolvePiForkEntryId(
  workspaceId: string,
  sessionId: string | null,
  messageText: string,
): Promise<PiForkMessage | null> {
  const messages = await piGetForkMessages({ workspaceId, sessionId });
  const needle = messageText.trim();
  if (!needle) {
    return null;
  }
  return (
    messages.find((m) => m.text.trim() === needle) ??
    messages.find(
      (m) =>
        m.text.trim().startsWith(needle.slice(0, 80)) ||
        needle.startsWith(m.text.trim().slice(0, 80)),
    ) ??
    null
  );
}

type PiForkDialogProps = {
  open: boolean;
  quote: string;
  busy: boolean;
  error: string | null;
  /** 成功后的短暂确认态（自动关闭前展示新会话去向）。 */
  success: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Fork confirmation dialog. Copy deliberately states the real RPC semantics:
 * fork creates a NEW session file — it is NOT an in-tree lane (pi RPC has no
 * leaf-move command; see change design §2).
 */
export function PiForkDialog({
  open,
  quote,
  busy,
  error,
  success,
  onCancel,
  onConfirm,
}: PiForkDialogProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }
  if (success) {
    return createPortal(
      <div className="pi-overlay" role="presentation">
        <div className="pi-dialog" role="alertdialog" aria-label={t("piSession.fork.successTitle")}>
          <h3>{t("piSession.fork.successTitle")}</h3>
          <p>{t("piSession.fork.successBody")}</p>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="pi-overlay" onClick={onCancel} role="presentation">
      <div
        className="pi-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("piSession.fork.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <h3>
          ⑂ {t("piSession.fork.title")}
          <span className="mono">pi RPC: fork</span>
        </h3>
        <p>{t("piSession.fork.description")}</p>
        <div className="quote">「{quote}」</div>
        {error ? <p className="pi-dialog-error">{error}</p> : null}
        <div className="pi-dialog-foot">
          <button
            type="button"
            className="pi-btn-plain"
            onClick={onCancel}
            disabled={busy}
          >
            {t("piSession.fork.cancel")}
          </button>
          <button
            type="button"
            className="pi-btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t("piSession.fork.confirming") : t("piSession.fork.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type UsePiForkFlowArgs = {
  workspaceId: string;
  threadId: string;
  onForked: (forkedText: string, forkedSessionId: string | null) => void;
};

/**
 * Fork flow controller used by both the bubble ⑂ action (text → entryId
 * resolution) and the tree overlay (entryId already known).
 */
export function usePiForkFlow({
  workspaceId,
  threadId,
  onForked,
}: UsePiForkFlowArgs) {
  const { t } = useTranslation();
  const [state, setState] = useState<{
    entryId: string | null;
    quote: string;
    busy: boolean;
    error: string | null;
    success: boolean;
  } | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    },
    [],
  );

  const beginForkWithQuote = useCallback((quote: string) => {
    setState({ entryId: null, quote, busy: false, error: null, success: false });
  }, []);

  const beginForkWithEntryId = useCallback(
    (entryId: string, quote: string) => {
      setState({ entryId, quote, busy: false, error: null, success: false });
    },
    [],
  );

  const cancel = useCallback(() => setState(null), []);

  const confirm = useCallback(async () => {
    if (!state) {
      return;
    }
    setState({ ...state, busy: true, error: null });
    try {
      const sessionId = piSessionIdFromThreadId(threadId);
      const entryId =
        state.entryId ??
        (await resolvePiForkEntryId(workspaceId, sessionId, state.quote))
          ?.entryId ??
        null;
      if (!entryId) {
        setState({
          ...state,
          busy: false,
          error: t("piSession.fork.errorEntryNotFound"),
        });
        return;
      }
      const result = await piFork({ workspaceId, sessionId, entryId });
      if (result.cancelled) {
        setState(null);
        return;
      }
      const forkedText = result.text ?? state.quote;
      onForked(forkedText, result.forkedSessionId);
      // forkedSessionId == 源 sessionId = fork 静默 no-op（旧后端/remote
      // 未返回 cancelled 但也没切换文件）：禁止登记禁止跳转——否则会把
      // 主线自己误登记为派生，整局从侧栏隐藏（2026-08-24 取证）。
      if (result.forkedSessionId && result.forkedSessionId !== sessionId) {
        // fork 成功 = 用户明确的「去新分支继续」意图：跳转分叉幕布（草稿
        // 已在新会话 composer）；同时保留成功确认态——跳转若因会话索引
        // 延迟尚未生效，用户也有明确去向反馈，不会「没有反应」。
        // 同时立刻登记派生血缘：live 窗口内分支行没有 parentThreadId，
        // 不登记会泄漏成侧栏顶层行直到下一次 list 刷新/重启。
        markPiDerivedThread(`pi:${result.forkedSessionId}`);
        requestPiThreadJump(workspaceId, `pi:${result.forkedSessionId}`);
        setState({ ...state, busy: false, error: null, success: true });
        successTimerRef.current = setTimeout(() => setState(null), 1600);
        return;
      }
      // forkedSessionId 缺失的退化路径：给成功确认态告知去向。
      setState({ ...state, busy: false, error: null, success: true });
      successTimerRef.current = setTimeout(() => setState(null), 1600);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({
        ...state,
        busy: false,
        // pi RPC 的 "Invalid entry ID for forking" = 条目不在当前会话文件
        // （他 lane 的消息 / 已被压缩）——正常系提示，映射为清晰的行动指引：
        // 先在会话树跳转到该消息所在分支，再分叉。
        error: /invalid entry id for forking/i.test(message)
          ? t("piSession.fork.errorEntryNotForkable")
          : message,
        success: false,
      });
    }
  }, [state, workspaceId, threadId, onForked, t]);

  const dialog = useMemo(
    () => (
      <PiForkDialog
        open={state !== null}
        quote={state?.quote ?? ""}
        busy={state?.busy ?? false}
        error={state?.error ?? null}
        success={state?.success ?? false}
        onCancel={cancel}
        onConfirm={() => void confirm()}
      />
    ),
    [state, cancel, confirm],
  );

  return { beginForkWithQuote, beginForkWithEntryId, forkDialog: dialog };
}
