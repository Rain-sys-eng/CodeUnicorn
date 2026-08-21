type ReasoningGuardState = {
  activeTurnIdByThread: Record<string, string | null | undefined>;
  threadStatusById: Record<
    string,
    {
      isProcessing: boolean;
    } | undefined
  >;
};

export function isLocalCliReasoningThread(threadId: string) {
  return (
    threadId.startsWith("claude:") ||
    threadId.startsWith("claude-pending-") ||
    threadId.startsWith("gemini:") ||
    threadId.startsWith("gemini-pending-") ||
    threadId.startsWith("grok:") ||
    threadId.startsWith("grok-pending-") ||
    threadId.startsWith("kimi:") ||
    threadId.startsWith("kimi-pending-") ||
    threadId.startsWith("pi:") ||
    threadId.startsWith("pi-pending-") ||
    threadId.startsWith("qoder:") ||
    threadId.startsWith("qoder-pending-") ||
    threadId.startsWith("opencode:") ||
    threadId.startsWith("opencode-pending-") ||
    threadId.startsWith("dsh:") ||
    threadId.startsWith("dsh-pending-")
  );
}

export function isGeminiReasoningThread(threadId: string) {
  return threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-");
}

export function isGrokReasoningThread(threadId: string) {
  return threadId.startsWith("grok:") || threadId.startsWith("grok-pending-");
}

export function isKimiReasoningThread(threadId: string) {
  return threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-");
}

export function isDshReasoningThread(threadId: string) {
  return threadId.startsWith("dsh:") || threadId.startsWith("dsh-pending-");
}

export function isPiReasoningThread(threadId: string) {
  return threadId.startsWith("pi:") || threadId.startsWith("pi-pending-");
}

export function isQoderReasoningThread(threadId: string) {
  return threadId.startsWith("qoder:") || threadId.startsWith("qoder-pending-");
}

export function isClaudeReasoningThread(threadId: string) {
  return threadId.startsWith("claude:") || threadId.startsWith("claude-pending-");
}

export function shouldAcceptReasoningDelta(
  state: ReasoningGuardState,
  threadId: string,
) {
  // Gemini may emit reasoning fallback snapshots after processing settles.
  // Keep these deltas so realtime reasoning stays consistent with history.
  // Kimi/Grok share the same spawn-per-turn runtime shape, so they get the same
  // fallback-snapshot acceptance.
  if (
    isGeminiReasoningThread(threadId) ||
    isGrokReasoningThread(threadId) ||
    isKimiReasoningThread(threadId) ||
    isDshReasoningThread(threadId) ||
    isPiReasoningThread(threadId) ||
    isQoderReasoningThread(threadId)
  ) {
    return true;
  }
  if (!isLocalCliReasoningThread(threadId)) {
    return true;
  }
  const hasActiveTurn = (state.activeTurnIdByThread[threadId] ?? null) !== null;
  const isProcessing = Boolean(state.threadStatusById[threadId]?.isProcessing);
  return hasActiveTurn || isProcessing;
}
