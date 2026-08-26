/**
 * Orphan turn watchdog（零首事件窗口兜底）。
 *
 * OpenSpec change：fix-orphan-turn-during-backend-unavailability。
 *
 * 背景：turn 乐观进入 processing 后，若后端在重启窗口 / wedge / 事件断流下
 * 永远不回任何事件（连 turn/started 都没有），前端 turn 状态机没有任何
 * 既有路径能清除 processing（rpcError / terminal / interrupt 都不会发生），
 * UI 永久停在「响应中」。既有看门狗（后端 900s silence、Claude mid-turn
 * idle、codex no-progress）都要求「后端存活且已起流」，不覆盖「从未起流」。
 *
 * 本模块只承载跨 hook 共享的信号与纯判定；定时器生命周期在
 * useOrphanTurnWatchdog hook 内管理。
 */

/** prod 阈值：大于全引擎已知最慢合法冷启动（CLI spawn + 模型排队 + 首事件）。 */
export const ORPHAN_TURN_FIRST_EVENT_TIMEOUT_MS = 90_000;

let orphanTurnFirstEventTimeoutMs = ORPHAN_TURN_FIRST_EVENT_TIMEOUT_MS;

/** @internal test-only：缩小阈值以便 fake timer 测试。传 null 复位。 */
export function __setOrphanTurnFirstEventTimeoutMsForTests(
  ms: number | null,
): void {
  orphanTurnFirstEventTimeoutMs =
    ms === null ? ORPHAN_TURN_FIRST_EVENT_TIMEOUT_MS : ms;
}

/** @internal 读取当前生效阈值（含 test override）。 */
export function getOrphanTurnFirstEventTimeoutMs(): number {
  return orphanTurnFirstEventTimeoutMs;
}

export type OrphanTurnWatchInput = {
  /** fire 时该 thread 是否仍处于 processing（terminal/interrupt/rpcError 已清则 false）。 */
  isProcessing: boolean;
  /** 首个引擎事件到达时间戳；null = 从未收到任何事件。 */
  firstEngineEventAt: number | null;
  /** 看门狗到期时间戳。 */
  deadlineAt: number;
  now: number;
};

export type OrphanTurnWatchDecision = "settle-orphan" | "keep-watching";

/**
 * 纯判定：仅当「仍 processing」且「零首事件」且「到期」才判孤儿。
 * 任一条件不满足即 keep-watching（外层据此清理自身并 no-op）。
 */
export function decideOrphanTurnWatch(
  input: OrphanTurnWatchInput,
): OrphanTurnWatchDecision {
  if (!input.isProcessing) {
    return "keep-watching";
  }
  if (input.firstEngineEventAt !== null) {
    return "keep-watching";
  }
  return input.now >= input.deadlineAt ? "settle-orphan" : "keep-watching";
}

/**
 * 首事件登记表：threadId → 首个引擎事件到达时间戳。
 * 由 useThreads 的 onAppServerEvent catch-all 写入（任何 method 都算首事件，
 * 定义刻意放宽，避免慢引擎冷启动误杀）；由看门狗在 fire 时读取。
 * Module-level（非 React state）避免高频事件打渲染链。
 */
const firstEngineEventAtByThread = new Map<string, number>();

/** 登记该 thread 的首引擎事件（幂等：仅首个生效）。 */
export function noteEngineEventForThread(threadId: string): void {
  if (!threadId || firstEngineEventAtByThread.has(threadId)) {
    return;
  }
  firstEngineEventAtByThread.set(threadId, Date.now());
}

/** 读取首事件时间戳（无则 null）。 */
export function getFirstEngineEventAtForThread(
  threadId: string,
): number | null {
  return firstEngineEventAtByThread.get(threadId) ?? null;
}

/** 清除该 thread 的首事件登记（settle 后 / 复用 entry 前）。 */
export function clearFirstEngineEventForThread(threadId: string): void {
  firstEngineEventAtByThread.delete(threadId);
}
