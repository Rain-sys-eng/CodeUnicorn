import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  piCompact,
  piGetSessionStats,
  piSessionIdFromThreadId,
  type PiSessionStats,
} from "../api/piSessionRpc";

type PiCompactEntryProps = {
  workspaceId: string;
  threadId: string;
  disabled?: boolean;
};

/**
 * Composer footer entry for PI RPC manual compaction: a small ghost button
 * next to the usage indicator that opens PiCompactDialog.
 */
export function PiCompactEntry({
  workspaceId,
  threadId,
  disabled = false,
}: PiCompactEntryProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="pi-compact-entry"
        title={t("piSession.compact.entryTitle")}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
      >
        ⤓ {t("piSession.compact.entryLabel")}
      </button>
      <PiCompactDialog
        open={open}
        workspaceId={workspaceId}
        threadId={threadId}
        onClose={() => setOpen(false)}
        onCompacted={() => {
          // compact 后下一次打开 dialog 时会重新拉 stats；不留 store 切片。
        }}
      />
    </>
  );
}

type PiCompactDialogProps = {
  open: boolean;
  workspaceId: string;
  threadId: string;
  onClose: () => void;
  onCompacted: (result: {
    tokensBefore: number | null;
    estimatedTokensAfter: number | null;
  }) => void;
};

function formatTokens(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value >= 1000 ? `~${Math.round(value / 1000)}k` : `${value}`;
}

/**
 * pi 的「会话太短无可压缩」是正常状态，不是故障——映射为中性提示而非
 * 红色错误。pi 默认完整保留最近约 20k tokens（keepRecentTokens），短会话
 * 整体落在保留窗口内时没有可压缩前缀。
 */
export function compactErrorToNotice(message: string): string | null {
  if (/nothing to compact|too small/i.test(message)) {
    return "会话还很短，没有可压缩的内容（pi 会完整保留最近约 20k tokens）。";
  }
  return null;
}

/**
 * Manual `/compact` dialog for PI RPC sessions: stats triple + optional
 * custom instructions (RPC `compact.customInstructions`).
 */
export function PiCompactDialog({
  open,
  workspaceId,
  threadId,
  onClose,
  onCompacted,
}: PiCompactDialogProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PiSessionStats | null>(null);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setNotice(null);
    setDone(false);
    void piGetSessionStats({
      workspaceId,
      sessionId: piSessionIdFromThreadId(threadId),
    })
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, workspaceId, threadId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const percent = stats?.contextUsage?.percent ?? null;
  const messageCount = useMemo(() => {
    const total = stats?.totalMessages;
    return total !== null && total !== undefined ? `${total} 条` : "—";
  }, [stats]);

  if (!open) {
    return null;
  }
  return createPortal(
    <div className="pi-overlay" onClick={onClose} role="presentation">
      <div
        className="pi-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("piSession.compact.dialogAria")}
        onClick={(event) => event.stopPropagation()}
      >
        <h3>
          ⤓ {t("piSession.compact.dialogTitle")}
          <span className="mono">pi RPC: compact</span>
        </h3>
        <div className="pi-stat-row">
          <div className="pi-stat">
            <div className={`v${(percent ?? 0) >= 80 ? " warn" : ""}`}>
              {percent !== null ? `${Math.round(percent)}%` : "—"}
            </div>
            <div className="k">{t("piSession.compact.occupancy")}</div>
          </div>
          <div className="pi-stat">
            <div className="v">{messageCount}</div>
            <div className="k">{t("piSession.compact.messages")}</div>
          </div>
          <div className="pi-stat">
            <div className="v">
              {formatTokens(stats?.contextUsage?.tokens ?? null)}
            </div>
            <div className="k">{t("piSession.compact.tokens")}</div>
          </div>
        </div>
        <label htmlFor="pi-compact-instructions">
          {t("piSession.compact.instructionsLabel")}
        </label>
        <textarea
          id="pi-compact-instructions"
          rows={2}
          value={instructions}
          placeholder={t("piSession.compact.instructionsPlaceholder")}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <div className="hint">
          {t("piSession.compact.hint")}
        </div>
        {error ? <p className="pi-dialog-error">{error}</p> : null}
        {notice ? <p className="pi-dialog-notice">{notice}</p> : null}
        <div className="pi-dialog-foot">
          <button
            type="button"
            className="pi-btn-plain"
            onClick={onClose}
            disabled={busy}
          >
            {done ? t("piSession.compact.close") : t("piSession.compact.cancel")}
          </button>
          <button
            type="button"
            className="pi-btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              setNotice(null);
              void piCompact({
                workspaceId,
                sessionId: piSessionIdFromThreadId(threadId),
                customInstructions: instructions,
              })
                .then((result) => {
                  setBusy(false);
                  setDone(true);
                  setInstructions("");
                  // 成功后原地展示结果并重拉统计（手动压缩无 active run，
                  // compaction_start/end 事件不会上屏，dialog 是唯一反馈面）。
                  setNotice(
                    `压缩完成：${formatTokens(result.tokensBefore)} → ${formatTokens(result.estimatedTokensAfter)}（估算）。`,
                  );
                  onCompacted({
                    tokensBefore: result.tokensBefore,
                    estimatedTokensAfter: result.estimatedTokensAfter,
                  });
                  void piGetSessionStats({
                    workspaceId,
                    sessionId: piSessionIdFromThreadId(threadId),
                  })
                    .then(setStats)
                    .catch(() => {
                      // 统计刷新失败不影响压缩结果本身
                    });
                })
                .catch((err) => {
                  setBusy(false);
                  const message =
                    err instanceof Error ? err.message : String(err);
                  const neutral = compactErrorToNotice(message);
                  if (neutral !== null) {
                    setNotice(neutral);
                  } else {
                    setError(message);
                  }
                });
            }}
          >
            {busy
              ? t("piSession.compact.confirming")
              : t("piSession.compact.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
