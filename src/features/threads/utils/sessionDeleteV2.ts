/**
 * Session delete v2 前端协议封装。
 *
 * Canonical 设计：docs/plans/2026-08-24-session-delete-architecture-redesign.md
 * - `delete_workspace_sessions_v2` 立即返回 requestId；
 * - 结果经 `session-delete:settled` 事件按 requestId 路由回推；
 * - 30s 无 settled 视为超时（前端回滚 + 可重试）；
 * - flag `ccgui.delete.v2`（localStorage，默认 on）可整体回退旧链路。
 */

import { listen } from "@tauri-apps/api/event";
import {
  deleteWorkspaceSessionsV2,
  type SessionDeleteV2Result,
} from "../../../services/tauri/sessionManagement";

export const SESSION_DELETE_V2_FLAG_KEY = "ccgui.delete.v2";
export const SESSION_DELETE_SETTLED_EVENT = "session-delete:settled";
export const SESSION_DELETE_V2_TIMEOUT_MS = 30_000;

export type { SessionDeleteV2Result };

/** 幂等成功码（设计文档 §4.2）：侧栏保持隐藏。 */
const SESSION_DELETE_SUCCESS_CODES = new Set([
  "OK",
  "ALREADY_MISSING",
  "GHOST_CLEANED",
  "MARKED_DELETED",
]);

export function isSessionDeleteSuccessCode(code: string | null | undefined): boolean {
  return SESSION_DELETE_SUCCESS_CODES.has((code ?? "").trim().toUpperCase());
}

const isTestMode = (() => {
  try {
    return import.meta.env.MODE === "test";
  } catch {
    return false;
  }
})();

export function isSessionDeleteV2Enabled(): boolean {
  try {
    if (typeof window === "undefined") {
      return false;
    }
    const raw = window.localStorage.getItem(SESSION_DELETE_V2_FLAG_KEY);
    if (raw == null) {
      // 生产默认 on；测试默认 off（对齐 realtimePerfFlags 的 testDefaultValue
      // 模式，避免存量测试静默改道 v2 路径），测试需显式 localStorage 开启。
      return !isTestMode;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized !== "off" && normalized !== "false" && normalized !== "0";
  } catch {
    return true;
  }
}

type SettledPayload = {
  requestId: string;
  results: SessionDeleteV2Result[];
};

type PendingEntry = {
  resolve: (results: SessionDeleteV2Result[]) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingByRequestId = new Map<string, PendingEntry>();
/**
 * Early-settled buffer：settled 事件先于 pending 注册到达（后端在 command
 * 返回前就 spawn 删除任务，快路径毫秒级 emit）时先缓存，注册 pending 时领取。
 * 这是消除「快删除必超时」竞态的关键。
 */
const earlySettledByRequestId = new Map<string, SessionDeleteV2Result[]>();
const EARLY_SETTLED_BUFFER_CAP = 100;
let settledListenerReady: Promise<boolean> | null = null;

function rememberEarlySettled(requestId: string, results: SessionDeleteV2Result[]) {
  if (earlySettledByRequestId.size >= EARLY_SETTLED_BUFFER_CAP) {
    const oldest = earlySettledByRequestId.keys().next().value;
    if (oldest != null) {
      earlySettledByRequestId.delete(oldest);
    }
  }
  earlySettledByRequestId.set(requestId, results);
}

/**
 * 建立常驻 settled listener（只建一次，不随 pending 清空反注册——
 * 反注册会让每次删除都重开「listener 未就绪」竞态窗口）。
 */
function ensureSettledListener(): Promise<boolean> {
  if (settledListenerReady) {
    return settledListenerReady;
  }
  settledListenerReady = listen<SettledPayload>(SESSION_DELETE_SETTLED_EVENT, (event) => {
    const payload = event.payload;
    const requestId = payload?.requestId ?? "";
    const entry = pendingByRequestId.get(requestId);
    if (!entry) {
      if (requestId) {
        rememberEarlySettled(requestId, payload?.results ?? []);
      }
      return;
    }
    pendingByRequestId.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve(payload.results ?? []);
  })
    .then(() => true)
    .catch((error) => {
      settledListenerReady = null;
      console.error("[sessionDeleteV2] settled listener failed", error);
      return false;
    });
  return settledListenerReady;
}

/**
 * 发起一次 v2 删除（批量恒为一次 IPC），返回 settled 结果。
 * 超时 reject（调用方负责回滚 + 提示重试）。
 */
export async function requestSessionDelete(
  workspaceId: string,
  threadIds: string[],
  options?: { timeoutMs?: number },
): Promise<SessionDeleteV2Result[]> {
  // 先建 listener 再发请求：快删除（ghost / index hit）在 invoke 返回前
  // 就可能 emit settled，listener 必须先就位。
  await ensureSettledListener();
  const targets = threadIds.map((threadId) => ({ threadId }));
  const { requestId } = await deleteWorkspaceSessionsV2(workspaceId, targets);
  // settled 可能先于 pending 注册到达：先查 early buffer
  const early = earlySettledByRequestId.get(requestId);
  if (early) {
    earlySettledByRequestId.delete(requestId);
    return early;
  }
  // 超时随批量放大：后端 Semaphore(4) + 单条上限 10s，大 batch（如会话管理
  // 全选数百条）需要线性余量；单条仍走 30s 默认值。
  const timeoutMs =
    options?.timeoutMs ??
    Math.max(SESSION_DELETE_V2_TIMEOUT_MS, threadIds.length * 1_000);
  return new Promise<SessionDeleteV2Result[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingByRequestId.delete(requestId);
      reject(new Error("session delete request timeout"));
    }, timeoutMs);
    pendingByRequestId.set(requestId, { resolve, timer });
  });
}

/** 测试专用：清空挂起请求、early buffer 与 listener 缓存。 */
export function resetSessionDeleteV2ForTests() {
  for (const entry of pendingByRequestId.values()) {
    clearTimeout(entry.timer);
  }
  pendingByRequestId.clear();
  earlySettledByRequestId.clear();
  settledListenerReady = null;
}
