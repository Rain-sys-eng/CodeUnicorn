/** 数值区间夹取；全仓通用 clamp 的单一事实源，请勿在 feature 内重复实现。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
