/**
 * 剪贴板文本写入的单一事实源：内部固定走 navigator.clipboard.writeText
 * （保持既有测试对 navigator.clipboard 的 spy 生效），失败时吞掉异常并返回 false。
 * 调用点的 toast / 状态翻转等用户可见行为由各自根据返回值决定。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn("Failed to write text to clipboard", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
