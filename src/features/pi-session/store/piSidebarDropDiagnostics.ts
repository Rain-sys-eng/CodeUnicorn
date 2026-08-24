/**
 * pi 侧栏丢失诊断（2026-08-24 多轮「main 丢失」取证沉淀）。
 *
 * 三轮取证证明静态层（磁盘血缘 / index 行 / 纯管线）全部清白，缺失只能
 * 来自运行时通道（collab worker hide 注册表 / verified shared hide /
 * 内存派生集合 / 分页时序）。离线无法还原组合时序——把每个决策点变成
 * 可观测：哪一级（stage）、哪条规则（reason）、藏了哪条 pi 行。
 *
 * 防刷屏：同一 (stage, id) 每次进程运行只打一次（模块级 Set）。
 */

import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";

const loggedOnce = new Set<string>();

export function debugPiSidebarDrop(
  stage: string,
  threadId: string,
  reason: string,
): void {
  const key = `${stage}:${threadId}`;
  if (loggedOnce.has(key)) {
    return;
  }
  loggedOnce.add(key);
  console.debug(`[pi-sidebar-drop] stage=${stage} id=${threadId} reason=${reason}`);
  // 同步落 renderer 诊断存储（~/.ccgui/client/diagnostics.json）——
  // webview console 不落盘，运维/取证只能读持久化通道。
  appendRendererDiagnostic("pi-sidebar-drop", { stage, threadId, reason });
}

/**
 * 对比「输入行里的 pi id」与「产出的 summary id」，报告在汇总层消失的 pi 行。
 * 输入行形态宽松（index 行 / 磁盘 list 归一化结果均可）。
 */
export function debugPiSummaryLayerDrops(
  stage: string,
  inputRows: ReadonlyArray<{ engine?: string | null; sessionId?: unknown }>,
  producedIds: ReadonlySet<string>,
  resolveReason?: (threadId: string) => string,
): void {
  for (const row of inputRows) {
    if (row.engine != null && String(row.engine).trim() !== "pi") {
      continue;
    }
    const sessionId = String(row.sessionId ?? "").trim();
    if (!sessionId) {
      continue;
    }
    const threadId = `pi:${sessionId}`;
    if (!producedIds.has(threadId)) {
      debugPiSidebarDrop(
        stage,
        threadId,
        resolveReason?.(threadId) ?? "dropped-at-summary-layer",
      );
    }
  }
}
