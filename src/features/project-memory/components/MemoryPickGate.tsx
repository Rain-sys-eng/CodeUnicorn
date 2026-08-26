import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Send from "lucide-react/dist/esm/icons/send";
import SkipForward from "lucide-react/dist/esm/icons/skip-forward";
import BellOff from "lucide-react/dist/esm/icons/bell-off";
import TimerOff from "lucide-react/dist/esm/icons/timer-off";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import Infinity from "lucide-react/dist/esm/icons/infinity";
import Check from "lucide-react/dist/esm/icons/check";
import { Markdown } from "../../../markdown/components/Markdown";
import appLogo from "../../../assets/icon.png";
import { formatRelativeTimeShort } from "../../../utils/time";
import type { MemoryPickCandidate } from "../memoryPick/memoryPickTypes";
import {
  ALWAYS_AUTO_CONFIRM_MS,
  ALWAYS_TOP_K,
} from "../memoryPick/memoryPickTypes";
import { emitMemoryPickTelemetry } from "../memoryPick/memoryPickTelemetry";
import { useMemoryPickGate } from "../memoryPick/useMemoryPickGate";
import { projectMemoryFacade } from "../services/projectMemoryFacade";
import { resolveProjectMemoryDetailText } from "../utils/projectMemoryDisplay";
import "../../../styles/memory-pick-gate.css";

type MemoryPickGateProps = {
  workspaceId: string;
  threadId: string;
};

export function MemoryPickGate({ workspaceId, threadId }: MemoryPickGateProps) {
  const { t } = useTranslation();
  const {
    gate,
    toggleSelected,
    setMode,
    confirm,
    skip,
    dismiss,
  } = useMemoryPickGate(workspaceId, threadId);

  const [detail, setDetail] = useState<MemoryPickCandidate | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** 一直开启：预览后倒计时自动确认（可取消）；null = 未在倒计时 */
  const [autoConfirmSec, setAutoConfirmSec] = useState<number | null>(null);
  /**
   * 本轮闸门是否已打断自动确认。
   * 任意用户交互后置 true，本轮不再重启倒计时。
   */
  const autoConfirmInterruptedRef = useRef(false);
  /**
   * 仅当「进入 awaiting 时 mode 已是 always」才武装自动确认。
   * 中途 pick→always 不武装（只改策略，不立刻倒计时）。
   */
  const autoConfirmArmedRef = useRef(false);
  /** 跟踪上一次 phase，用于识别「进入 awaiting」瞬间 */
  const prevPhaseRef = useRef<string | null>(null);
  /**
   * 打断代数：interrupt 时 +1，驱动 countdown effect cleanup，
   * 避免 interval 在打断后仍空转。
   */
  const [autoConfirmEpoch, setAutoConfirmEpoch] = useState(0);
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  useEffect(() => {
    if (!gate) {
      setDetail(null);
      autoConfirmInterruptedRef.current = false;
      autoConfirmArmedRef.current = false;
      prevPhaseRef.current = null;
      setAutoConfirmSec(null);
    }
  }, [gate]);

  const selectedSet = useMemo(
    () => new Set(gate?.selectedIds ?? []),
    [gate?.selectedIds],
  );

  const isAlways = gate?.mode === "always";
  const isRetrieving = gate?.phase === "retrieving";
  const isFlushing = gate?.phase === "flushing";
  const isAwaiting = gate?.phase === "awaiting-choice";
  const isEmpty = Boolean(
    isAwaiting && gate && gate.candidates.length === 0,
  );

  /** 本轮任意用户操作：打断自动确认，且本轮不再重启 */
  const interruptAutoConfirm = () => {
    const wasArmed = autoConfirmArmedRef.current;
    autoConfirmInterruptedRef.current = true;
    autoConfirmArmedRef.current = false;
    setAutoConfirmSec(null);
    setAutoConfirmEpoch((n) => n + 1);
    if (wasArmed) {
      emitMemoryPickTelemetry("memory_pick_auto_confirm", {
        action: "interrupt",
        mode: "always",
      });
    }
  };

  // 进入 awaiting 瞬间：仅 mode 已是 always 时武装；闸门关闭时复位
  useEffect(() => {
    if (!gate) {
      prevPhaseRef.current = null;
      return;
    }
    const phase = gate.phase;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (phase === "awaiting-choice" && prev !== "awaiting-choice") {
      // 新一轮 awaiting：复位打断标志，并按进入时 mode 决定是否武装
      autoConfirmInterruptedRef.current = false;
      const shouldArm = gate.mode === "always" && gate.candidates.length > 0;
      autoConfirmArmedRef.current = shouldArm;
      if (shouldArm) {
        // 触发 countdown effect 启动
        setAutoConfirmEpoch((n) => n + 1);
      } else {
        setAutoConfirmSec(null);
      }
    }
  }, [gate, gate?.phase, gate?.mode, gate?.candidates.length]);

  // 武装且未打断时跑 8s 倒计时；依赖 epoch + phase，不因勾选变更重启
  useEffect(() => {
    if (
      !gate ||
      !isAlways ||
      !isAwaiting ||
      isEmpty ||
      isFlushing ||
      !autoConfirmArmedRef.current ||
      autoConfirmInterruptedRef.current
    ) {
      setAutoConfirmSec(null);
      return undefined;
    }

    const deadline = Date.now() + ALWAYS_AUTO_CONFIRM_MS;
    const tick = () => {
      if (
        autoConfirmInterruptedRef.current ||
        !autoConfirmArmedRef.current
      ) {
        return;
      }
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setAutoConfirmSec(left);
      if (left <= 0) {
        autoConfirmArmedRef.current = false;
        emitMemoryPickTelemetry("memory_pick_auto_confirm", {
          action: "fire",
          mode: "always",
        });
        confirmRef.current();
      }
    };
    tick();
    // 倒计时基于 deadline 计算（Math.ceil），1s 粒度即可精确显示剩余秒数；
    // 250ms tick 只是徒增冷启窗内的空转（setState 同值虽 bail-out 仍占调度）。
    const id = window.setInterval(tick, 1_000);
    return () => {
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- epoch 表达 interrupt/arm；避免 selectedIds 误重启
  }, [
    isAlways,
    isAwaiting,
    isEmpty,
    isFlushing,
    gate?.phase,
    autoConfirmEpoch,
  ]);

  if (!gate) return null;

  const disabled = isFlushing || isRetrieving;
  const autoConfirmActive =
    isAlways && isAwaiting && !isEmpty && autoConfirmSec !== null;

  const openDetail = async (candidate: MemoryPickCandidate) => {
    interruptAutoConfirm();
    // 列表项可能是投影/仅用户输入：先展示摘要，再强制 get 全量（含 AI 回复）
    setDetail(candidate);
    setDetailLoading(true);
    try {
      const item = await projectMemoryFacade
        .get(candidate.id, workspaceId)
        .catch(() => null);
      if (item) {
        const detailText =
          resolveProjectMemoryDetailText(item).trim() ||
          item.detail?.trim() ||
          item.cleanText?.trim() ||
          item.rawText?.trim() ||
          candidate.detail?.trim() ||
          candidate.summary?.trim() ||
          "";
        setDetail({
          ...candidate,
          detail: detailText || candidate.detail,
          rawItem: item,
          title: item.title || candidate.title,
          summary: item.summary || candidate.summary,
        });
      } else if (candidate.rawItem) {
        // get 失败时仍用本地 raw 拼 conversation 详情
        const detailText =
          resolveProjectMemoryDetailText(candidate.rawItem).trim() ||
          candidate.detail?.trim() ||
          candidate.summary?.trim() ||
          "";
        setDetail({
          ...candidate,
          detail: detailText || candidate.detail,
        });
      }
    } finally {
      setDetailLoading(false);
    }
  };

  /** 手改勾选时打断自动确认，避免误提交 */
  const handleToggleSelected = (memoryId: string) => {
    interruptAutoConfirm();
    toggleSelected(memoryId);
  };

  const handleSetMode = (mode: "pick" | "always") => {
    interruptAutoConfirm();
    setMode(mode);
  };

  const selectFromDetail = () => {
    if (!detail) return;
    if (!selectedSet.has(detail.id)) {
      handleToggleSelected(detail.id);
    }
    setDetail(null);
  };

  // —— 匹配中：仅局部紧凑卡片，禁止半屏分栏 / 确认发送 ——
  if (isRetrieving) {
    return (
      <div
        className="memory-pick-gate memory-pick-gate--matching"
        role="region"
        aria-label={t("memoryPick.regionLabel", {
          defaultValue: "记忆参考挑选",
        })}
        aria-busy="true"
      >
        <div className="memory-pick-gate__role">
          <span className="memory-pick-gate__role-label">
            {t("memoryPick.role", { defaultValue: "记忆参考" })}
          </span>
          <span className="memory-pick-gate__role-desc">
            {t("memoryPick.roleDesc", {
              defaultValue: "发送前 · 本地检索 · 尚未调用模型",
            })}
          </span>
        </div>
        <div className="memory-pick-gate__match" role="status">
          <div className="memory-pick-gate__match-brand">
            <span className="memory-pick-gate__match-logo" aria-hidden>
              <img
                src={appLogo}
                alt=""
                className="memory-pick-gate__match-logo-img"
                draggable={false}
              />
            </span>
            <span>
              {t("memoryPick.match.brand", {
                defaultValue: "ccgui · 正在匹配项目记忆",
              })}
            </span>
          </div>
          <div className="memory-pick-gate__match-dots" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <p className="memory-pick-gate__match-sub">
            {t("memoryPick.match.sub", {
              defaultValue: "本地检索中，有结果再选择注入；无结果将自动继续发送…",
            })}
          </p>
        </div>
      </div>
    );
  }

  // —— 匹配完成：完整挑选 UI（有候选 / 空态都需用户操作，禁止自动放行） ——
  return (
    <div
      className="memory-pick-gate memory-pick-gate--ready"
      role="region"
      aria-label={t("memoryPick.regionLabel", {
        defaultValue: "记忆参考挑选",
      })}
      aria-busy={isFlushing}
    >
      <div className="memory-pick-gate__toolbar">
        <div className="memory-pick-gate__toolbar-left">
          <div className="memory-pick-gate__toolbar-actions">
            <button
              type="button"
              className={`memory-pick-gate__action is-primary${autoConfirmActive ? " is-auto-confirm" : ""}`}
              disabled={disabled || (isEmpty && isAlways)}
              onClick={() => {
                interruptAutoConfirm();
                confirm();
              }}
              style={
                autoConfirmActive
                  ? ({
                      ["--auto-confirm-ms" as string]: `${ALWAYS_AUTO_CONFIRM_MS}ms`,
                    } as CSSProperties)
                  : undefined
              }
            >
              <span className="memory-pick-gate__action-fill" aria-hidden />
              <Send
                size={14}
                strokeWidth={2}
                aria-hidden
                className="memory-pick-gate__action-icon"
              />
              <span className="memory-pick-gate__action-label">
                {isEmpty
                  ? t("memoryPick.action.confirmEmpty", {
                      defaultValue: "不带记忆发送",
                    })
                  : t("memoryPick.action.confirm", {
                      defaultValue: "确认并发送",
                    })}
              </span>
            </button>
            {autoConfirmActive ? (
              <button
                type="button"
                className="memory-pick-gate__action is-warn"
                disabled={disabled}
                onClick={() => {
                  interruptAutoConfirm();
                }}
              >
                <TimerOff
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className="memory-pick-gate__action-icon"
                />
                <span className="memory-pick-gate__action-label">
                  {t("memoryPick.action.cancelAutoConfirm", {
                    defaultValue: "取消自动确认",
                  })}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className="memory-pick-gate__action"
              disabled={disabled}
              onClick={() => {
                interruptAutoConfirm();
                skip();
              }}
            >
              <SkipForward
                size={14}
                strokeWidth={2}
                aria-hidden
                className="memory-pick-gate__action-icon"
              />
              <span className="memory-pick-gate__action-label">
                {t("memoryPick.action.skip", {
                  defaultValue: "不选，直接发送",
                })}
              </span>
            </button>
          </div>
          <div
            className={`memory-pick-gate__count${
              autoConfirmActive && autoConfirmSec !== null ? " is-countdown" : ""
            }`}
            aria-live="polite"
            title={
              isEmpty
                ? undefined
                : isAlways
                  ? autoConfirmActive && autoConfirmSec !== null
                    ? t("memoryPick.count.alwaysCountdown", {
                        defaultValue: `整轮自动 · 已选 ${selectedSet.size} · ${autoConfirmSec}s 后自动确认 · 可改勾选`,
                        n: selectedSet.size,
                        sec: autoConfirmSec,
                      })
                    : t("memoryPick.count.always", {
                        defaultValue: `整轮自动 · 已选 ${selectedSet.size} · 可改勾选`,
                        n: selectedSet.size,
                      })
                  : t("memoryPick.count.pick", {
                      defaultValue: `已选 ${selectedSet.size} · 默认全不选`,
                      n: selectedSet.size,
                    })
            }
          >
            {isEmpty
              ? t("memoryPick.count.empty", { defaultValue: "候选 0 条" })
              : isAlways
                ? autoConfirmActive && autoConfirmSec !== null
                  ? t("memoryPick.count.alwaysCountdown", {
                      defaultValue: `整轮自动 · 已选 ${selectedSet.size} · ${autoConfirmSec}s 后自动确认 · 可改勾选`,
                      n: selectedSet.size,
                      sec: autoConfirmSec,
                    })
                  : t("memoryPick.count.always", {
                      defaultValue: `整轮自动 · 已选 ${selectedSet.size} · 可改勾选`,
                      n: selectedSet.size,
                    })
                : t("memoryPick.count.pick", {
                    defaultValue: `已选 ${selectedSet.size} · 默认全不选`,
                    n: selectedSet.size,
                  })}
          </div>
        </div>
        <button
          type="button"
          className="memory-pick-gate__action is-danger memory-pick-gate__dismiss"
          disabled={disabled}
          onClick={() => {
            interruptAutoConfirm();
            dismiss();
          }}
          title={t("memoryPick.action.dismiss", {
            defaultValue: "本 session 不再提示 · 整轮关闭记忆注入",
          })}
        >
          <BellOff
            size={14}
            strokeWidth={2}
            aria-hidden
            className="memory-pick-gate__action-icon"
          />
          <span className="memory-pick-gate__action-label">
            {t("memoryPick.action.dismiss", {
              defaultValue: "本 session 不再提示 · 整轮关闭记忆注入",
            })}
          </span>
        </button>
      </div>

      <div className="memory-pick-gate__split">
        <div className="memory-pick-gate__left">
          <h3 className="memory-pick-gate__list-title">
            {isAlways
              ? t("memoryPick.listTitle.always", {
                  defaultValue: "整轮自动 top(n) · 相关记忆（可改勾选数量）",
                })
              : t("memoryPick.listTitle.pick", {
                  defaultValue: "本轮候选记忆",
                })}
          </h3>
          <p
            className={`memory-pick-gate__list-hint${isAlways ? " is-always" : ""}`}
          >
            {isEmpty
              ? t("memoryPick.listHint.empty", {
                  defaultValue:
                    "未找到相关记忆 · 可「不选直接发送」",
                })
              : isAlways
                ? t("memoryPick.listHint.always", {
                    defaultValue: `整轮自动 · 按相关分预勾（默认 ${ALWAYS_TOP_K} 条，可增减）· 下次沿用相同数量`,
                    k: ALWAYS_TOP_K,
                  })
                : t("memoryPick.listHint.pick", {
                    defaultValue:
                      "本轮挑选 · 默认全不选 · 点「详情」看全文 · 仅本次发送",
                  })}
          </p>

          <div className="memory-pick-gate__list scrollable">
            {isEmpty ? (
              <div className="memory-pick-gate__empty" role="status">
                {gate.error === "timeout"
                  ? t("memoryPick.empty.timeout", {
                      defaultValue: "检索超时，未找到可用记忆。",
                    })
                  : gate.error === "retrieve_failed"
                    ? t("memoryPick.empty.error", {
                        defaultValue: "检索失败，未找到可用记忆。",
                      })
                    : t("memoryPick.empty.none", {
                        defaultValue: "没有匹配到项目记忆。",
                      })}
              </div>
            ) : (
              gate.candidates.map((candidate, index) => {
                const checked = selectedSet.has(candidate.id);
                // TOP 仅为相关分排序提示：徽章可显示，背景只跟勾选走
                const isTop =
                  isAlways &&
                  [...gate.candidates]
                    .sort((a, b) => {
                      if (b.score !== a.score) return b.score - a.score;
                      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
                    })
                    .slice(0, ALWAYS_TOP_K)
                    .some((c) => c.id === candidate.id);
                const updatedAtMs = candidate.updatedAt;
                const timeLabel =
                  typeof updatedAtMs === "number" && updatedAtMs > 0
                    ? formatRelativeTimeShort(updatedAtMs)
                    : "—";
                const timeTitle =
                  typeof updatedAtMs === "number" && updatedAtMs > 0
                    ? new Date(updatedAtMs).toLocaleString()
                    : undefined;
                return (
                  <div
                    key={candidate.id}
                    className={[
                      "memory-pick-gate__row",
                      // 背景高亮 = 已勾选；always 用绿色主题，pick 用 accent
                      checked ? (isAlways ? "is-auto" : "is-on") : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => handleToggleSelected(candidate.id)}
                      aria-label={candidate.title}
                    />
                    <span className="memory-pick-gate__row-idx">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div
                      className="memory-pick-gate__row-title"
                      title={candidate.title}
                    >
                      {candidate.title}
                      {isTop ? (
                        <span className="memory-pick-gate__top-badge">Top</span>
                      ) : null}
                    </div>
                    <span
                      className="memory-pick-gate__row-time"
                      title={timeTitle}
                    >
                      {timeLabel}
                    </span>
                    <span className="memory-pick-gate__score">
                      {candidate.score.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      className="memory-pick-gate__detail-btn"
                      onClick={() => void openDetail(candidate)}
                      disabled={disabled}
                    >
                      {t("memoryPick.detail", { defaultValue: "详情" })}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="memory-pick-gate__right">
          <h3 className="memory-pick-gate__strategy-title">
            {t("memoryPick.strategyTitle", { defaultValue: "策略" })}
          </h3>
          <div className="memory-pick-gate__mode-menu" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={!isAlways}
              className={!isAlways ? "is-on" : undefined}
              disabled={disabled}
              onClick={() => handleSetMode("pick")}
            >
              <ListChecks
                className="memory-pick-gate__mode-icon"
                size={14}
                strokeWidth={2}
                aria-hidden
              />
              <span className="memory-pick-gate__mode-text">
                <span className="memory-pick-gate__mode-title">
                  {t("memoryPick.mode.pick", {
                    defaultValue: "本轮挑选记忆注入",
                  })}
                </span>
                <span className="memory-pick-gate__mode-sub">
                  {t("memoryPick.mode.pickSub", {
                    defaultValue: "仅本次 · 手动勾选",
                  })}
                </span>
              </span>
              <span className="memory-pick-gate__mode-check" aria-hidden>
                {!isAlways ? (
                  <Check size={11} strokeWidth={3} />
                ) : null}
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isAlways}
              className={isAlways ? "is-on is-always-mode" : "is-always-mode"}
              disabled={disabled || isEmpty}
              onClick={() => handleSetMode("always")}
            >
              <Infinity
                className="memory-pick-gate__mode-icon"
                size={14}
                strokeWidth={2}
                aria-hidden
              />
              <span className="memory-pick-gate__mode-text">
                <span className="memory-pick-gate__mode-title">
                  {t("memoryPick.mode.always", {
                    defaultValue: "整轮开启自动top(n)记忆注入",
                  })}
                </span>
                <span className="memory-pick-gate__mode-sub">
                  {t("memoryPick.mode.alwaysSub", {
                    defaultValue: `本 session · 默认预勾 ${ALWAYS_TOP_K} 条（可改）`,
                    k: ALWAYS_TOP_K,
                  })}
                </span>
              </span>
              <span className="memory-pick-gate__mode-check" aria-hidden>
                {isAlways ? <Check size={11} strokeWidth={3} /> : null}
              </span>
            </button>
          </div>

          <div
            className={`memory-pick-gate__strategy-panel scrollable${isAlways ? " is-always" : ""}`}
          >
            <div className="memory-pick-gate__strategy-kicker">
              {t("memoryPick.strategy.kicker", {
                defaultValue: "Current strategy",
              })}
            </div>
            <div className="memory-pick-gate__strategy-heading">
              {isAlways
                ? t("memoryPick.strategy.alwaysTitle", {
                    defaultValue: "整轮开启自动top(n)记忆注入（本 session）",
                  })
                : t("memoryPick.strategy.pickTitle", {
                    defaultValue: "本轮挑选记忆注入",
                  })}
            </div>
            {isAlways ? (
              <StrategyAlwaysBody t={t} />
            ) : (
              <StrategyPickBody t={t} />
            )}
          </div>
        </div>
      </div>

      <div className="memory-pick-gate__role">
        <span className="memory-pick-gate__role-label">
          {t("memoryPick.role", { defaultValue: "记忆参考" })}
        </span>
        <span className="memory-pick-gate__role-desc">
          {t("memoryPick.roleDescReady", {
            defaultValue: "发送前 · 匹配完成 · 请选择后发送",
          })}
        </span>
      </div>

      {detail && typeof document !== "undefined"
        ? createPortal(
            // 必须 portal 到 body：闸门在 messages 滚动树内，祖先 transform/overflow
            // 会让 position:fixed 相对错误容器，遮罩盖不全、弹窗错位（截图 bug）
            <div
              className="memory-pick-gate memory-pick-gate__dialog-overlay"
              role="presentation"
              onClick={() => setDetail(null)}
            >
              <div
                className="memory-pick-gate__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="memory-pick-detail-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="memory-pick-gate__dialog-head">
                  <h3 id="memory-pick-detail-title">{detail.title}</h3>
                  <p className="memory-pick-gate__dialog-sub">
                    {detail.engine ?? "—"} · {detail.threadId ?? "—"} ·{" "}
                    {detail.updatedAt
                      ? new Date(detail.updatedAt).toLocaleString()
                      : "—"}
                  </p>
                </div>
                <div className="memory-pick-gate__dialog-body">
                  <div className="memory-pick-gate__dialog-meta">
                    <span>
                      {t("memoryPick.detailScore", { defaultValue: "相关" })}{" "}
                      {detail.score.toFixed(2)}
                    </span>
                    {detail.kind ? <span>{detail.kind}</span> : null}
                    {detail.importance ? (
                      <span>{detail.importance}</span>
                    ) : null}
                    {(detail.tags ?? []).map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                  {detailLoading ? (
                    <p className="memory-pick-gate__dialog-loading">
                      {t("memoryPick.detailLoading", {
                        defaultValue: "加载中…",
                      })}
                    </p>
                  ) : (
                    <Markdown
                      className="markdown memory-pick-gate__dialog-markdown"
                      value={
                        detail.detail?.trim() ||
                        detail.summary?.trim() ||
                        "—"
                      }
                      workspaceId={workspaceId}
                      codeBlockStyle="message"
                    />
                  )}
                </div>
                <div className="memory-pick-gate__dialog-foot">
                  <button
                    type="button"
                    className="memory-pick-gate__btn"
                    onClick={() => {
                      interruptAutoConfirm();
                      setDetail(null);
                    }}
                  >
                    {t("memoryPick.detailClose", { defaultValue: "关闭" })}
                  </button>
                  <button
                    type="button"
                    className="memory-pick-gate__btn is-primary"
                    onClick={selectFromDetail}
                  >
                    {t("memoryPick.detailSelect", {
                      defaultValue: "勾选本条并关闭",
                    })}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function StrategyPickBody({
  t,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <StrategySection
        title={t("memoryPick.strategy.pick.what", { defaultValue: "做什么" })}
        items={[
          t("memoryPick.strategy.pick.what1", {
            defaultValue:
              "只影响这一次发送，不会把记忆参考锁成 session 常开。",
          }),
          t("memoryPick.strategy.pick.what2", {
            defaultValue:
              "左侧列表默认全不选；你勾哪几条，确认后才注入模型。",
          }),
          t("memoryPick.strategy.pick.what3", {
            defaultValue: "可点每行详情核对全文后再决定是否勾选。",
          }),
          t("memoryPick.strategy.pick.what4", {
            defaultValue: "勾选 0 条也可以：等于本轮不带项目记忆发送。",
          }),
        ]}
      />
      <StrategySection
        title={t("memoryPick.strategy.pick.when", {
          defaultValue: "什么时候用",
        })}
        items={[
          t("memoryPick.strategy.pick.when1", {
            defaultValue:
              "这次问题只和某几条约定 / 踩坑相关，怕自动 Top3 带噪声。",
          }),
          t("memoryPick.strategy.pick.when2", {
            defaultValue: "想先扫一眼再决定，而不是把排序结果全权交给算法。",
          }),
        ]}
      />
    </>
  );
}

function StrategyAlwaysBody({
  t,
}: {
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <StrategySection
        title={t("memoryPick.strategy.always.what", { defaultValue: "做什么" })}
        items={[
          t("memoryPick.strategy.always.what1", {
            defaultValue: `本 session 内，每轮按相关分预勾（默认 ${ALWAYS_TOP_K} 条）；你可增减勾选。`,
            k: ALWAYS_TOP_K,
          }),
          t("memoryPick.strategy.always.what2", {
            defaultValue:
              "确认时记住勾选数量，下次发送按相同数量预勾（仍可改）。",
          }),
          t("memoryPick.strategy.always.what3", {
            defaultValue: "约 8s 后可自动确认；可随时取消自动确认或手改列表。",
          }),
        ]}
      />
      <StrategySection
        title={t("memoryPick.strategy.always.when", {
          defaultValue: "什么时候用",
        })}
        items={[
          t("memoryPick.strategy.always.when1", {
            defaultValue: "连续多轮同一主题，不想每轮从零勾选。",
          }),
          t("memoryPick.strategy.always.when2", {
            defaultValue: "信任检索排序，又希望能微调条数。",
          }),
        ]}
      />
    </>
  );
}

function StrategySection({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="memory-pick-gate__strategy-section">
      <div className="memory-pick-gate__strategy-h">{title}</div>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
