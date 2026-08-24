/**
 * HTML 转义的单一事实源。
 * - escapeHtmlText：用于 HTML 文本节点（& < >）。
 * - escapeHtmlAttr：用于 HTML 属性值（& " ' < >）。
 */

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Note: backslashes don't need escaping as they are valid in HTML attributes. */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
