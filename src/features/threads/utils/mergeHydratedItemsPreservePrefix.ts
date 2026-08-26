import type { ConversationItem } from "../../../types";

/**
 * OpenSpec change: fix-claude-history-window-message-loss
 *
 * Post-turn history reconcile 的 hydrated window 只覆盖会话尾部；直接整体替换会把
 * 窗口之外已展示/已翻页的旧消息裁掉（用户感知「结束那一刻消息没了」）。
 *
 * preserve-prefix merge：以「当前列表中第一条也出现在 hydrated 里的 item」为锚点，
 * 锚点之前的旧消息保留，锚点起以 hydrated 为准（尾部含最新 turn，且 live-id 的
 * 尾部条目在此被其磁盘对应物替换，不会因 id 不同而重复）。
 *
 * 锚点找不到（无法对齐，例如外部改写历史）时回退为信任磁盘的整体替换。
 */
export function mergeHydratedItemsPreservePrefix(
 current: ConversationItem[],
 hydrated: ConversationItem[],
): ConversationItem[] {
 if (hydrated.length === 0) {
  return current;
 }
 if (current.length === 0) {
  return hydrated;
 }
 const hydratedIds = new Set(hydrated.map((item) => item.id));
 const anchorIndex = current.findIndex((item) => hydratedIds.has(item.id));
 if (anchorIndex < 0) {
  return hydrated;
 }
 return [...current.slice(0, anchorIndex), ...hydrated];
}
