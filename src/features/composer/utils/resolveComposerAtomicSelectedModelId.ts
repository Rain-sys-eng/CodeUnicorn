import type { ExecutionTarget } from "../../shared-session/target/types";

/**
 * Composer → Atomic ModelSelect 的 selectedModelId 投影。
 *
 * - Shared：只信 selectedNextTarget（executionTarget）；缺失时 MUST 返回空串，
 *   禁止回落全局/Native selectedModelId（防串台）。
 * - Native / create-session：有 Atomic target 时用 target 身份；否则回落全局
 *   selectedModelId（Native 会话选择权威仍在 per-thread composer selection）。
 */
export function resolveComposerAtomicSelectedModelId(input: {
  isSharedSession: boolean;
  executionTarget: ExecutionTarget | null | undefined;
  globalSelectedModelId: string | null | undefined;
}): string {
  const fromTarget =
    input.executionTarget?.modelCatalogEntryId?.trim() ||
    input.executionTarget?.model?.trim() ||
    "";

  if (input.isSharedSession) {
    return fromTarget;
  }

  if (fromTarget) {
    return fromTarget;
  }

  // DSH catalog ids are `{provider}/{model}`. Falling back to the global
  // native selectedModelId after visiting Codex/Claude paints that leftover
  // on the closed trigger and moves the green dot off DeepSeek Harness.
  if (input.executionTarget?.engine === "dsh") {
    return "";
  }

  return input.globalSelectedModelId?.trim() || "";
}
