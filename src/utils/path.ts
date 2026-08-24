/**
 * 路径分隔符归一（`\` → `/`）的单一事实源，请勿在 feature 内重复实现。
 * 仅做分隔符替换；trim / 大小写 / 前缀剥离等额外逻辑留在各调用点。
 */
export function normalizePathSeparators(p: string): string {
  return p.replace(/\\/g, "/");
}
