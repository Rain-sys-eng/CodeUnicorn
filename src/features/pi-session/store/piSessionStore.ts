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
