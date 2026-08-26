/**
 * 按字符数截断文本，超长时在截断点追加省略符（结果长度可超过 maxChars）。
 * 全仓 truncate/clampChars 的单一事实源；如需「结果不超过 maxChars」的语义，
 * 请在调用侧自行让出省略符长度。
 */
export function truncateChars(
  value: string,
  maxChars: number,
  ellipsis = "…",
): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}${ellipsis}`;
}
