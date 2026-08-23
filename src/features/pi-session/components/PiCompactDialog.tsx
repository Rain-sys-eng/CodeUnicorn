import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  piCompact,
  piGetSessionStats,
  piSessionIdFromThreadId,
  type PiSessionStats,
} from "../api/piSessionRpc";

type PiCompactEntryProps = {
  workspaceId: string;
  threadId: string;
};

/**
 * Composer footer entry for PI RPC manual compaction: a small ghost button
 * next to the usage indicator that opens PiCompactDialog.
 */
export function PiCompactEntry({ workspaceId, threadId }: PiCompactEntryProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="pi-compact-entry"
        title="压缩上下文（pi RPC: compact）"
        onClick={() => setOpen(true)}
      >
        ⤓ 压缩
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
  const [stats, setStats] = useState<PiSessionStats | null>(null);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setNotice(null);
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
        aria-label="压缩上下文"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>
          ⤓ 压缩上下文
          <span className="mono">pi RPC: compact</span>
        </h3>
        <div className="pi-stat-row">
          <div className="pi-stat">
            <div className={`v${(percent ?? 0) >= 80 ? " warn" : ""}`}>
              {percent !== null ? `${Math.round(percent)}%` : "—"}
            </div>
            <div className="k">当前上下文占用</div>
          </div>
          <div className="pi-stat">
            <div className="v">{messageCount}</div>
            <div className="k">会话消息</div>
          </div>
          <div className="pi-stat">
            <div className="v">
              {formatTokens(stats?.contextUsage?.tokens ?? null)}
            </div>
            <div className="k">上下文 tokens</div>
          </div>
        </div>
        <label htmlFor="pi-compact-instructions">压缩指令（可选）</label>
        <textarea
          id="pi-compact-instructions"
          rows={2}
          value={instructions}
          placeholder="例如：保留根因结论与文件清单，压缩试错过程"
          onChange={(event) => setInstructions(event.target.value)}
        />
        <div className="hint">
          压缩是有损的：完整历史保留在 pi 会话文件中，可在会话树中回溯。
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
            取消
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
                  onCompacted({
                    tokensBefore: result.tokensBefore,
                    estimatedTokensAfter: result.estimatedTokensAfter,
                  });
                  onClose();
                })
                .catch((err) => {
                  setBusy(false);
                  const message =
                    err instanceof Error ? err.message : String(err);
                  // pi 的「会话太短无可压缩」是正常状态，不是故障——
                  // 中性提示而非红色错误。
                  if (/nothing to compact|too small/i.test(message)) {
                    setNotice("会话还很短，没有可压缩的内容。");
                  } else {
                    setError(message);
                  }
                });
            }}
          >
            {busy ? "压缩中…" : "压缩上下文"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
