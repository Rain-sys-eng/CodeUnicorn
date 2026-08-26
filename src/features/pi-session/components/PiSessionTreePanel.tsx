import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyedLoadState } from "../../../components/common/KeyedLoadState";
import {
  refreshPiSessionTree,
  requestPiThreadJump,
  usePiSessionTree,
  usePiSessionTreeError,
} from "../store/piSessionStore";
import {
  laneChipLabel,
  type PiLaneNode,
} from "../utils/piSessionTreeProjection";
import { setComposerDraft } from "../../composer/hooks/composerDraftStore";
import { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import { usePiForkFlow } from "./PiForkDialog";
import GitFork from "lucide-react/dist/esm/icons/git-fork";

/** lane 配色板：lane 0 = 主蓝，其余按序轮换；chip 与轨道/圆点/连接线配套 */
const LANE_COLORS = [
  "#4d99ff",
  "#34c08e",
  "#f5a524",
  "#a78bfa",
  "#f470a0",
  "#22c5d8",
  "#e2c044",
  "#ff7a59",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function laneColorAlpha(lane: number, alpha: number): string {
  const hex = laneColor(lane);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type PiSessionTreePanelProps = {
  workspaceId: string;
  threadId: string;
};

function nodeVisible(node: PiLaneNode): boolean {
  // 元数据条目（model_change / thinking_level_change / compaction 标记 /
  // sidechain 等非 message 条目）在任何过滤模式下都不渲染。
  if (node.role === null && !node.text) {
    return false;
  }
  // 工具结果条目（bash 输出 / 文件内容等）不渲染：它们是过程噪音，
  // 不是对话内容（美观口径：树上只留 user 提问与 AI 回复首行）。
  if (node.role === "toolResult") {
    return false;
  }
  return true;
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex < 0) {
    return trimmed;
  }
  return `${trimmed.slice(0, newlineIndex).trim()}…`;
}

function nodeDisplayText(node: PiLaneNode): string {
  if (node.text) {
    // 规矩：非 user 文本（AI 回复 / 工具结果）在树上按换行切第一行 + …
    // （美观用，完整内容在幕布）
    return node.role === "user" ? node.text : firstLine(node.text);
  }
  if (node.role === "assistant") {
    return "⚙ 工具调用";
  }
  return "（非文本条目）";
}

function formatEntryTime(timestamp: string | null): string | null {
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * PI 会话树面板：会话族「一棵大树」——lane 按列排布（main 主线在最左，
 * 分支从分叉点向右侧长出），当前激活路径实体展示、其余虚化。
 * - 分叉：user 节点 ⑂（pi 语义：回到该消息父点、以该消息为草稿重写）
 * - 跳转：lane 头「↪」切到该 lane 的会话（主线与派生 lane 都可，来回跳）
 */
export function PiSessionTreePanel({
  workspaceId,
  threadId,
}: PiSessionTreePanelProps) {
  const { t } = useTranslation();
  const tree = usePiSessionTree(workspaceId, threadId);
  const treeError = usePiSessionTreeError(workspaceId, threadId);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    void refreshPiSessionTree(workspaceId, threadId);
  }, [workspaceId, threadId]);

  // turn 结束刷一次树：pi 对话结束后 session 文件才有最新节点，不刷则
  // 要手动切分支再切回来才能看到新节点（只响应本线程的完成事件）。
  useAppServerEvents({
    onTurnCompleted: (eventWorkspaceId, eventThreadId) => {
      if (eventWorkspaceId === workspaceId && eventThreadId === threadId) {
        void refreshPiSessionTree(workspaceId, threadId);
      }
    },
  });

  const { beginForkWithEntryId, forkDialog } = usePiForkFlow({
    workspaceId,
    threadId,
    onForked: (forkedText, forkedSessionId) => {
      const targetThreadId = forkedSessionId
        ? `pi:${forkedSessionId}`
        : threadId;
      setComposerDraft(targetThreadId, forkedText);
      void refreshPiSessionTree(workspaceId, threadId);
    },
  });

  const visibleNodes = useMemo(() => {
    if (!tree) {
      return [];
    }
    // 规矩：一次用户对话下面只放 1 条 AI 回复——一个 turn 的多条
    // assistant 条目（思考分段 / 工具间插话）只显示首条有文本的，其余收起。
    const out: PiLaneNode[] = [];
    let inAssistantRun = false;
    let runTextShown = false;
    for (const node of tree.nodes) {
      if (!nodeVisible(node)) {
        continue;
      }
      if (node.role === "assistant") {
        if (!inAssistantRun) {
          inAssistantRun = true;
          runTextShown = false;
        }
        if (runTextShown) {
          continue;
        }
        if (!node.text) {
          continue; // 空文本工具调用也收起，不收进树
        }
        runTextShown = true;
        out.push(node);
        continue;
      }
      inAssistantRun = false;
      runTextShown = false;
      out.push(node);
    }
    // 渲染排序：按时间线排（分叉从发起点开始往下画，而不是 DFS 地把整条
    // 分支排到主线子树末尾）。时间缺失时保持原始 append 顺序；只改展示
    // 顺序，数据轮廓（lane / 父子关系 / 激活路径）不变。
    const withIndex = out.map((node, index) => ({ node, index }));
    withIndex.sort((a, b) => {
      const timeA = a.node.timestamp ? Date.parse(a.node.timestamp) : NaN;
      const timeB = b.node.timestamp ? Date.parse(b.node.timestamp) : NaN;
      const validA = Number.isFinite(timeA);
      const validB = Number.isFinite(timeB);
      if (validA && validB && timeA !== timeB) {
        return timeA - timeB;
      }
      if (validA !== validB) {
        return validA ? -1 : 1;
      }
      return a.index - b.index;
    });
    return withIndex.map((entry) => entry.node);
  }, [tree]);

  const laneById = useMemo(() => {
    const map = new Map<string, number>();
    visibleNodes.forEach((node) => map.set(node.entryId, node.lane));
    return map;
  }, [visibleNodes]);

  const maxLane = useMemo(
    () => visibleNodes.reduce((max, node) => Math.max(max, node.lane), 0),
    [visibleNodes],
  );

  // lane 轨道：线性链是直线，分叉点才偏移。每个 row × lane 格子 =
  // node（该行此 lane 有节点）/ line（该 lane 在此行上下贯通）/ empty。
  const laneFirstSeen = useMemo(() => {
    const seen = new Set<number>();
    const first = new Map<string, number>();
    visibleNodes.forEach((node) => {
      if (!seen.has(node.lane)) {
        seen.add(node.lane);
        first.set(node.entryId, node.lane);
      }
    });
    return first;
  }, [visibleNodes]);

  const railCells = useMemo(() => {
    // O(n·lanes)：先一次扫出每条 lane 的首/末行号，格子判定退化为比较
    // （原实现每格两次 some 全扫，1000+ 行大会话是 O(n²·lanes) 百万级）。
    const firstIdx = new Map<number, number>();
    const lastIdx = new Map<number, number>();
    visibleNodes.forEach((node, index) => {
      if (!firstIdx.has(node.lane)) {
        firstIdx.set(node.lane, index);
      }
      lastIdx.set(node.lane, index);
    });
    return visibleNodes.map((node, index) => {
      const cells: ("node" | "line" | "empty")[] = [];
      for (let lane = 0; lane <= maxLane; lane++) {
        if (node.lane === lane) {
          cells.push("node");
        } else {
          const first = firstIdx.get(lane);
          const last = lastIdx.get(lane);
          cells.push(
            first !== undefined && last !== undefined && first < index && last > index
              ? "line"
              : "empty",
          );
        }
      }
      return cells;
    });
  }, [visibleNodes, maxLane]);

  // 跨行距分叉连接：lane-start 行与分叉点父行之间画 S 曲线（git graph 同款）。
  // 行高固定 34px（单行省略），坐标纯数据计算，不用量 DOM。
  const ROW_H = 34;
  const forkLinks = useMemo(() => {
    const rowIndexById = new Map<string, number>();
    visibleNodes.forEach((node, index) => rowIndexById.set(node.entryId, index));
    // 未过滤全图：lane-start 的直接父条目可能是被过滤的元数据条目
    // （model_change / thinking_level_change 等，如 b1 分叉点的 parent 是
    // model_change）——此时沿父子链向上找最近的可见祖先行作为曲线起点，
    // 否则整条曲线被丢弃，分支画成没有连接线的「裸偏移列」。
    const allById = new Map<string, PiLaneNode>();
    (tree?.nodes ?? []).forEach((node) => allById.set(node.entryId, node));
    const links: {
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      active: boolean;
      toLane: number;
      key: string;
    }[] = [];
    const seenLanes = new Set<number>();
    visibleNodes.forEach((node, index) => {
      // 按行序首个即该 lane 首行：无论其连接是否可画都必须登记，
      // 否则后续行会被误判为首行而画出错误曲线（O(1) 替代原 some 全扫）
      const firstOfLane = !seenLanes.has(node.lane);
      seenLanes.add(node.lane);
      if (node.lane === 0 || !node.parentId || !firstOfLane) {
        return;
      }
      // 最近可见祖先（通常就是直接父；父被过滤时向上走，带环保护）
      let anchorId: string | null = node.parentId;
      for (let guard = 0; anchorId && !rowIndexById.has(anchorId) && guard < 64; guard++) {
        anchorId = allById.get(anchorId)?.parentId ?? null;
      }
      const parentIndex = anchorId ? rowIndexById.get(anchorId) : undefined;
      const parentLane = anchorId ? laneById.get(anchorId) : undefined;
      if (parentIndex === undefined || parentLane === undefined) {
        return;
      }
      // 仅 lane 首行（其父在不同 lane）需要跨 lane 连接
      if (parentLane === node.lane) {
        return;
      }
      links.push({
        fromX: 12 + parentLane * 16,
        fromY: parentIndex * ROW_H + ROW_H / 2,
        toX: 12 + node.lane * 16,
        toY: index * ROW_H + ROW_H / 2,
        // lane-start 在激活路径上 ⇒ 其父是祖先也在路径上 ⇒ 曲线属于路径
        active: node.onActivePath,
        toLane: node.lane,
        key: `${node.parentId}->${node.entryId}`,
      });
    });
    return links;
  }, [visibleNodes, laneById, tree]);

  // 激活路径贯通染色：当前叶到根的整条祖先链可能跨越多条 lane（main →
  // 中间分支 → 当前分支）。每条 lane 上「首个 ~ 末个 on-path 节点」之间
  // 的格子（轨道 + 圆点 + 中间被时间序插入的他 lane 行的过路段）全部染
  // 上激活 lane 色；两端都在路径上的分叉曲线同理。未在路径上的分支保持
  // 灰（选中哪条亮哪条）。
  const activePathLaneRows = useMemo(() => {
    const ranges = new Map<number, { first: number; last: number }>();
    visibleNodes.forEach((node, index) => {
      if (!node.onActivePath) {
        return;
      }
      const range = ranges.get(node.lane);
      if (!range) {
        ranges.set(node.lane, { first: index, last: index });
      } else {
        // forEach 按行序推进，first 保持最小、last 递增
        range.last = index;
      }
    });
    return ranges;
  }, [visibleNodes]);

  // 大行数 DOM 窗口化：1000+ 行大会话全量渲染会挂死面板。行高固定
  // 34px（与 forkLinks 坐标假设一致），只渲染视口 ±overscan 的行，
  // 上下用 spacer 撑起总高；分叉 SVG 仍按全高绝对定位（path 数量极少）。
  const VIRTUALIZE_THRESHOLD = 300;
  const OVERSCAN_ROWS = 20;
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef(0);
  const [viewRange, setViewRange] = useState({ start: 0, end: 80 });
  const virtualized = visibleNodes.length > VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    if (!virtualized) {
      return;
    }
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const update = () => {
      const total = visibleNodes.length;
      const start = Math.min(
        total,
        Math.max(0, Math.floor(body.scrollTop / ROW_H) - OVERSCAN_ROWS),
      );
      const end = Math.min(
        total,
        Math.max(
          start,
          Math.ceil((body.scrollTop + body.clientHeight) / ROW_H) +
            OVERSCAN_ROWS,
        ),
      );
      setViewRange((prev) =>
        prev.start === start && prev.end === end ? prev : { start, end },
      );
    };
    const onScroll = () => {
      if (scrollRafRef.current) {
        return;
      }
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        update();
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      body.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [virtualized, visibleNodes.length]);

  const renderStart = virtualized ? viewRange.start : 0;
  const renderEnd = virtualized ? viewRange.end : visibleNodes.length;

  return (
    <div className="pi-tree-panel" role="region" aria-label={t("piSession.tree.panelAria")}>
      <div className="pi-fs-body" ref={bodyRef}>
        {tree === null ? (
          treeError !== null ? (
            <KeyedLoadState
              error={treeError}
              onRetry={() => void refreshPiSessionTree(workspaceId, threadId)}
              title={t("piSession.tree.loadFailed")}
              className="pi-fs-empty pi-fs-load-error"
              detailClassName="pi-fs-load-error-detail"
              retryClassName="pi-fs-load-error-retry"
            />
          ) : (
            <div className="pi-fs-empty">加载中…</div>
          )
        ) : visibleNodes.length === 0 ? (
          <div className="pi-fs-empty">当前过滤条件下没有节点</div>
        ) : (
          <div className="pi-tree-rows">
            {forkLinks.length > 0 ? (
              <svg
                className="pi-tree-links"
                width={(maxLane + 1) * 16 + 16}
                height={visibleNodes.length * ROW_H}
                aria-hidden="true"
              >
                {forkLinks.map((link) => {
                  const midY = (link.fromY + link.toY) / 2;
                  return (
                    <path
                      key={link.key}
                      d={`M ${link.fromX} ${link.fromY} C ${link.fromX} ${midY}, ${link.toX} ${midY}, ${link.toX} ${link.toY}`}
                      fill="none"
                      strokeWidth="1.5"
                      stroke={
                        link.active
                          ? laneColorAlpha(tree.activeLane, 0.85)
                          : "var(--border-strong)"
                      }
                      strokeOpacity={link.active ? 1 : 0.55}
                    />
                  );
                })}
              </svg>
            ) : null}
            {virtualized && renderStart > 0 ? (
              <div aria-hidden="true" style={{ height: renderStart * ROW_H }} />
            ) : null}
            {visibleNodes.slice(renderStart, renderEnd).map((node, sliceIndex) => {
              const rowIndex = renderStart + sliceIndex;
              const isCurrent = node.entryId === tree.leafId;
              const laneLabel = laneFirstSeen.get(node.entryId);
              const jumpSessionId =
                laneLabel !== undefined
                  ? tree.laneSessionIds[laneLabel]
                  : undefined;
              const timeLabel = formatEntryTime(node.timestamp);
              return (
                <div
                  key={node.entryId}
                  className={`pi-tree-node${node.onActivePath ? " onpath" : " offpath"}${isCurrent ? " current" : ""}${focusId === node.entryId ? " focused" : ""}${node.role === "user" ? " user" : ""}`}
                  onClick={() => setFocusId(node.entryId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setFocusId(node.entryId);
                    }
                  }}
                >
                  <span className="pi-tree-rail" aria-hidden="true">
                    {(railCells[rowIndex] ?? []).map((cell, lane) => {
                      // 激活路径段：该 lane 被当前叶→根祖先链经过时，首个
                      // ~ 末个 on-path 节点之间的格子全部染上激活 lane 色，
                      // 与分叉曲线贯通（路径外的 lane / 分支保持灰）。
                      const pathRange = activePathLaneRows.get(lane);
                      const onPathSegment =
                        cell !== "empty" &&
                        pathRange !== undefined &&
                        rowIndex >= pathRange.first &&
                        rowIndex <= pathRange.last;
                      const laneActive =
                        lane === tree.activeLane || onPathSegment;
                      // 只保留激活 lane / 激活路径段上色，其余置灰
                      const color = laneActive
                        ? laneColor(tree.activeLane)
                        : "var(--border-strong)";
                      return (
                        <span
                          key={lane}
                          className={`pi-tree-cell ${cell}${cell !== "empty" && laneActive ? " active" : ""}`}
                          style={{ ["--lane-color" as string]: color }}
                        >
                          {cell !== "empty" ? (
                            <span className="pi-tree-track" />
                          ) : null}
                          {cell === "node" ? (
                            <span
                              className={`pi-fs-dot${isCurrent ? " current" : ""}${node.role === "user" ? " user" : ""}`}
                              style={
                                node.role === "user"
                                  ? {
                                      background: color,
                                      borderColor: color,
                                    }
                                  : { borderColor: color }
                              }
                            />
                          ) : null}

                        </span>
                      );
                    })}
                  </span>
                  <span className="txt">{nodeDisplayText(node)}</span>
                  {laneLabel !== undefined ? (
                    <>
                      {(() => {
                        const laneSelected = laneLabel === tree.activeLane;
                        const color = laneSelected
                          ? laneColor(laneLabel)
                          : "var(--text-faint)";
                        const chipStyle = {
                          color,
                          background: laneSelected
                            ? laneColorAlpha(laneLabel, 0.16)
                            : "transparent",
                          border: `1px solid ${laneSelected ? laneColorAlpha(laneLabel, 0.4) : "var(--border-subtle)"}`,
                        };
                        const chipText =
                          laneLabel === 0
                            ? "main 主线"
                            : `分支 ${laneChipLabel(laneLabel)}`;
                        return jumpSessionId ? (
                          <button
                            type="button"
                            className="pi-fs-lane-label is-link"
                            style={chipStyle}
                            title={
                              laneLabel === 0
                                ? "跳回主线会话"
                                : "跳转到该分支会话继续"
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              requestPiThreadJump(
                                workspaceId,
                                `pi:${jumpSessionId}`,
                              );
                            }}
                          >
                            {chipText}
                          </button>
                        ) : (
                          <span
                            className="pi-fs-lane-label"
                            style={chipStyle}
                            title={
                              laneLabel > 0
                                ? "文件内分支：pi RPC 无树内跳转命令，可从该分支的 user 消息分叉继续"
                                : undefined
                            }
                          >
                            {chipText}
                          </span>
                        );
                      })()}
                    </>
                  ) : null}
                  {node.label ? <span className="bm">🔖 {node.label}</span> : null}
                  <span className="meta">
                    {timeLabel ? `${timeLabel} · ` : ""}
                    {isCurrent ? "当前" : ""}
                  </span>
                  {node.role === "user" ? (
                    <button
                      type="button"
                      className="fork-btn"
                      title="从这条消息分叉（回到该消息父点，以它为草稿重写）"
                      onClick={(event) => {
                        event.stopPropagation();
                        beginForkWithEntryId(node.entryId, node.text);
                      }}
                    >
                      <GitFork size={13} aria-hidden />
                    </button>
                  ) : null}
                </div>
              );
            })}
            {virtualized && renderEnd < visibleNodes.length ? (
              <div
                aria-hidden="true"
                style={{ height: (visibleNodes.length - renderEnd) * ROW_H }}
              />
            ) : null}
          </div>
        )}
      </div>
      <div className="pi-fs-foot">
        <span className="pi-badge" title={t("piSession.tree.badge")}>
          <GitFork size={11} aria-hidden />
          {t("piSession.tree.badge")}
        </span>
        <span className="stats">
          {tree
            ? `${tree.nodes.length} 节点 · ${tree.laneCount} lane · 当前 ${laneChipLabel(tree.activeLane)}`
            : ""}
        </span>
        <span className="hints">
          当前路径实体 · 其余虚化 · ⑂ 分叉（重写该消息）· lane 头 ↪ 跳转
        </span>
      </div>
      {forkDialog}
    </div>
  );
}
