/**
 * 客户端唯一 id 生成的单一事实源。
 * 优先使用 crypto.randomUUID；极少数无 crypto 环境下回退到时间戳 + 随机串
 * （回退 id 仅保证足够唯一，不保证 UUID 格式）。
 */
export function createId(prefix?: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const fallback = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return prefix ? `${prefix}-${fallback}` : fallback;
}
