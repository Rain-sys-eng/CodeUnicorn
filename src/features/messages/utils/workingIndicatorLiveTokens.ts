import type { ThreadTokenUsage } from "../../../types";

export type WorkingIndicatorLiveTokenSnapshot = {
  tokenCount: number | null;
  usageUpdatedAt: number | null;
};

function asFiniteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/**
 * Whole-turn live count for the working bar: last-turn input (incl. cache read)
 * plus output. Matches the footer input aggregation, then adds output so the
 * in-flight chip can climb as the model writes.
 */
export function sumWorkingIndicatorLiveTokens(
  tokenUsage: ThreadTokenUsage | null | undefined,
): number {
  const source = tokenUsage?.last ?? tokenUsage?.total;
  if (!source) {
    return 0;
  }
  return (
    asFiniteNonNegative(source.inputTokens) +
    asFiniteNonNegative(source.cachedInputTokens) +
    asFiniteNonNegative(source.outputTokens)
  );
}

/**
 * Hide the previous turn's leftover snapshot until this turn reports usage.
 * Missing timestamps keep the count visible so engines without
 * lastTokenUsageUpdatedAt still light the chip.
 */
export function resolveWorkingIndicatorLiveTokenCount(options: {
  isThinking: boolean;
  tokenCount: number | null | undefined;
  usageUpdatedAt?: number | null;
  processingStartedAt?: number | null;
}): number | null {
  if (!options.isThinking) {
    return null;
  }
  const tokenCount =
    typeof options.tokenCount === "number" &&
    Number.isFinite(options.tokenCount) &&
    options.tokenCount > 0
      ? options.tokenCount
      : 0;
  if (tokenCount <= 0) {
    return null;
  }
  const usageUpdatedAt =
    typeof options.usageUpdatedAt === "number" &&
    Number.isFinite(options.usageUpdatedAt) &&
    options.usageUpdatedAt > 0
      ? options.usageUpdatedAt
      : null;
  const processingStartedAt =
    typeof options.processingStartedAt === "number" &&
    Number.isFinite(options.processingStartedAt) &&
    options.processingStartedAt > 0
      ? options.processingStartedAt
      : null;
  if (
    usageUpdatedAt != null &&
    processingStartedAt != null &&
    usageUpdatedAt < processingStartedAt
  ) {
    return null;
  }
  return tokenCount;
}

export function selectWorkingIndicatorLiveTokenSnapshot(
  tokenUsage: ThreadTokenUsage | null | undefined,
  usageUpdatedAt: number | null | undefined,
): WorkingIndicatorLiveTokenSnapshot {
  const tokenCount = sumWorkingIndicatorLiveTokens(tokenUsage);
  return {
    tokenCount: tokenCount > 0 ? tokenCount : null,
    usageUpdatedAt:
      typeof usageUpdatedAt === "number" &&
      Number.isFinite(usageUpdatedAt) &&
      usageUpdatedAt > 0
        ? usageUpdatedAt
        : null,
  };
}
