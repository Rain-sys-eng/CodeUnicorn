/**
 * 模型选择 apply 熔断的 epoch 不得包含全量 catalog fingerprint。
 *
 * 线上 2026-08-25：`model selection apply circuit breaker` 的 applyCount=1，
 * epochKey 却是整份模型列表拼接。catalog 刷新（observedAt / 顺序）会换 fingerprint，
 * 1s 窗口内 24 个不同 epoch 就把 storm 打爆，用户模型切换被误伤。
 */
export function buildSelectionApplyEpochKey(input: {
  preferredModelId: string | null | undefined;
  preferredEffort: string | null | undefined;
  preferredSelectionReady: boolean | undefined;
  nextModelId: string | null;
  nextEffort: string | null;
}): string {
  return [
    input.preferredModelId ?? "",
    input.preferredEffort ?? "",
    input.preferredSelectionReady ? "1" : "0",
    input.nextModelId ?? "",
    input.nextEffort ?? "",
  ].join("\0");
}
