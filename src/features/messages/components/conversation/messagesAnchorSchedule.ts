/**
 * 锚点轨道高亮的调度决策。
 *
 * 背景（2026-08-25 W1）：renderer diagnostics 显示 messages/overlay-loop-guard
 * 被持续触发（counter 最高 132）。根因：钉底跟随期间，每次 scroll 事件 / items
 * 变化都会 rAF 调度一次锚点解析，解析结果恒为 latest anchor，guard 拦下了
 * setState 但拦不住每帧的调度与 DOM 遍历。
 *
 * 不变量：钉底（isCanvasNearBottom）时 active anchor 恒为 latest anchor，
 * 无需任何 DOM 计算；已是 latest 则整次触发可以跳过。
 */
export type AnchorSchedulePlan =
  | { action: "skip" }
  | { action: "commit"; nextActiveAnchor: string | null }
  | { action: "compute" };

export function resolveAnchorSchedulePlan(input: {
  isNearBottom: boolean;
  latestAnchorId: string | null;
  activeAnchorId: string | null;
}): AnchorSchedulePlan {
  if (!input.isNearBottom) {
    return { action: "compute" };
  }
  if (input.activeAnchorId === input.latestAnchorId) {
    return { action: "skip" };
  }
  return { action: "commit", nextActiveAnchor: input.latestAnchorId };
}
