import { useSyncExternalStore } from "react";
import {
  piGetSessionTree,
  piSessionIdFromThreadId,
} from "../api/piSessionRpc";
import {
  projectPiSessionTree,
  type PiLaneProjection,
} from "../utils/piSessionTreeProjection";

/**
 * Feature-local module store for PI native session enhancements (fork / tree
 * / stats), keyed by `${workspaceId}:${threadId}`. Same external-store pattern
 * as composerDraftStore: writes never touch the AppShell root; only subscribing
 * components re-render. Deliberately NOT part of the AppShell domain bag
 * (AppShell Structure Gate).
 */

function piSessionKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

type PiSessionFeatureState = {
  treeByKey: Record<string, PiLaneProjection>;
  loadingByKey: Record<string, boolean>;
  /** thread key whose center-dock tree panel is open (null = closed) */
  treeOverlayKey: string | null;
  /** 树内跳转请求（store 中转：panel 无布局上下文，useLayoutNodes 消费） */
  jumpRequest: { workspaceId: string; threadId: string } | null;
};

let state: PiSessionFeatureState = {
  treeByKey: {},
  loadingByKey: {},
  treeOverlayKey: null,
  jumpRequest: null,
};

/**
 * 本会话内已确证的 fork 派生 thread id 集合（侧栏隐藏补助）：
 * live 窗口内产生的分支行（fork 跳转 / thread/started）没有 parentThreadId，
 * 而 list 刷新可能整局不跑——没这个集合，分支会泄漏成顶层行直到重启。
 * 数据源：① fork 成功时登记（markPiDerivedThread）；② 树投影加载时登记
 * 全部派生 lane（lane>0 的 laneSessionIds；lane 0 是主线 root，必须可见）。
 * 进程内存级：重启后由 index / live list 的 parentSessionId 接管（权威）。
 */
const derivedThreadIds = new Set<string>();

export function markPiDerivedThread(threadId: string): void {
  const trimmed = threadId.trim();
  if (trimmed) {
    derivedThreadIds.add(trimmed);
    console.debug(`[pi-session] derived-hide registered: ${trimmed}`);
  }
}

/** 侧栏过滤用：该 pi thread 是否已确证为 fork 派生（应隐藏）。 */
export function isPiDerivedThreadHidden(threadId: string): boolean {
  return derivedThreadIds.has(threadId.trim());
}

/**
 * 自愈 reconcile：权威列表（session-index 行 / pi 磁盘 list）证明某 session
 * 没有 parentSession（= 主线 root）时，立刻把它从内存派生集合移除——
 * 不等重启。堵住「fork 静默 no-op 把源主线误登记为派生」的整局隐藏窗口
 * （2026-08-24 侧栏主线丢失取证：静态层全清白，唯一能把主线藏掉的就是
 * 这个进程级集合）。
 * 安全论证：真实 fork 分支是全新文件/全新 id，权威行要么缺席（不触发）、
 * 要么带 parentSessionId（保持隐藏）——不会出现「旧的无 parent 行」误放归。
 */
export function reconcilePiDerivedHideWithAuthoritativeRows(
  rows: ReadonlyArray<{
    engine?: string | null;
    sessionId?: unknown;
    parentSessionId?: unknown;
  }>,
): void {
  for (const row of rows) {
    // 调用方两类：index 行（带 engine，只取 pi）/ pi 磁盘 list（无 engine）。
    if (row.engine != null && String(row.engine).trim() !== "pi") {
      continue;
    }
    const sessionId = String(row.sessionId ?? "").trim();
    if (!sessionId) {
      continue;
    }
    const parent = String(row.parentSessionId ?? "").trim();
    if (parent) {
      continue; // 权威确认为 fork 派生：保持隐藏
    }
    const threadId = `pi:${sessionId}`;
    if (derivedThreadIds.delete(threadId)) {
      console.debug(
        `[pi-session] derived-hide reconciled (authoritative root): ${threadId}`,
      );
    }
  }
}

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(next: Partial<PiSessionFeatureState>): void {
  state = { ...state, ...next };
  notify();
}

export async function refreshPiSessionTree(
  workspaceId: string,
  threadId: string,
): Promise<void> {
  const key = piSessionKey(workspaceId, threadId);
  if (state.loadingByKey[key]) {
    return;
  }
  setState({ loadingByKey: { ...state.loadingByKey, [key]: true } });
  try {
    const tree = await piGetSessionTree({
      workspaceId,
      sessionId: piSessionIdFromThreadId(threadId),
    });
    const projection = projectPiSessionTree(tree);
    // 树投影是派生血缘的权威快照：lane>0 的 laneSessionIds 全部是派生会话
    // （lane 0 = 主线 root），登记进侧栏隐藏集合——覆盖 live 窗口。
    for (const [lane, sessionId] of Object.entries(projection.laneSessionIds)) {
      if (
        Number(lane) > 0 &&
        sessionId &&
        // 双保险：root 主线永远可见——即便投影 lane 编号异常，也禁止把
        // 家族 root 登记进隐藏集合（误登记会把主线从侧栏整局藏掉）。
        sessionId !== tree.rootSessionId
      ) {
        derivedThreadIds.add(`pi:${sessionId}`);
      }
    }
    setState({ treeByKey: { ...state.treeByKey, [key]: projection } });
  } catch (error) {
    // RPC unavailable (print-json fallback / old pi): keep last-good snapshot.
    console.warn("[pi-session] refreshTree failed", error);
  } finally {
    setState({ loadingByKey: { ...state.loadingByKey, [key]: false } });
  }
}

export function openPiTreeOverlay(workspaceId: string, threadId: string): void {
  const key = piSessionKey(workspaceId, threadId);
  if (state.treeOverlayKey === key) {
    // 再次点击入口 = 关闭（toggle 语义，不再需要 ✕ 按钮）
    setState({ treeOverlayKey: null });
    return;
  }
  setState({ treeOverlayKey: key });
  void refreshPiSessionTree(workspaceId, threadId);
}

export function closePiTreeOverlay(): void {
  setState({ treeOverlayKey: null });
}

/** 树面板「↪ 跳转」经 store 发请求；useLayoutNodes 消费后执行 onSelectThread。 */
export function requestPiThreadJump(
  workspaceId: string,
  threadId: string,
): void {
  setState({ jumpRequest: { workspaceId, threadId } });
}

export function consumePiThreadJump(): void {
  setState({ jumpRequest: null });
}

export function usePiThreadJumpRequest(): {
  workspaceId: string;
  threadId: string;
} | null {
  return useSyncExternalStore(subscribe, () => state.jumpRequest);
}

// ===== React bindings =====

export function usePiSessionTree(
  workspaceId: string,
  threadId: string,
): PiLaneProjection | null {
  const key = piSessionKey(workspaceId, threadId);
  return useSyncExternalStore(subscribe, () => state.treeByKey[key] ?? null);
}


export function usePiTreeOverlayKey(): string | null {
  return useSyncExternalStore(subscribe, () => state.treeOverlayKey);
}
