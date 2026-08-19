import type { EngineType } from "../../../types";
import { getSharedSendState } from "../runtime/sharedSendStateStore";
import {
  classifySharedProviderRetryError,
  type SharedProviderRetryClassification,
} from "./classifySharedProviderRetryError";
import {
  clearSharedProviderRetryState,
  getSharedProviderRetryState,
  patchSharedProviderRetryOverlay,
  setSharedProviderRetryState,
  startSharedProviderRetryCountdown,
  stopSharedProviderRetryCountdown,
  type SharedProviderRetryOverlay,
  type SharedProviderRetrySeries,
} from "./providerRetryControllerStore";
import {
  isSharedProviderRetryAutoSendEnabled,
  resolveSharedProviderRetryDelaySec,
  resolveSharedProviderRetryResumePrompt,
} from "./providerRetryPolicy";
import { getSharedProviderRetrySettings } from "./providerRetrySettingsStore";

export type SharedProviderRetryTurnNotice = {
  workspaceId: string;
  threadId: string;
  engine: EngineType;
  providerProfileId?: string | null;
  model?: string | null;
  attemptId?: string | null;
  outcome?: "completed" | "failed" | "cancelled" | null;
  message?: string | null;
  wasLocalInterrupt?: boolean;
  originKind?: string | null;
};

export type SharedProviderRetrySubmit = (
  workspaceId: string,
  threadId: string,
  text: string,
) => void | Promise<unknown>;

const submitters = new Map<string, SharedProviderRetrySubmit>();
const successTimers = new Map<string, ReturnType<typeof setTimeout>>();

function noticeKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}::${threadId}`;
}

export function registerSharedProviderRetrySubmitter(
  workspaceId: string,
  threadId: string,
  submit: SharedProviderRetrySubmit | null,
): () => void {
  const key = noticeKey(workspaceId, threadId);
  if (submit) {
    submitters.set(key, submit);
  } else {
    submitters.delete(key);
  }
  return () => {
    if (submitters.get(key) === submit) {
      submitters.delete(key);
    }
  };
}

function sameTarget(
  series: SharedProviderRetrySeries | null,
  notice: SharedProviderRetryTurnNotice,
): boolean {
  if (!series) {
    return false;
  }
  return (
    series.engine === notice.engine &&
    (series.providerProfileId ?? null) === (notice.providerProfileId ?? null) &&
    (series.model ?? null) === (notice.model ?? null)
  );
}

function clearSuccessTimer(workspaceId: string, threadId: string): void {
  const key = noticeKey(workspaceId, threadId);
  const timer = successTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    successTimers.delete(key);
  }
}

function scheduleOverlayClear(workspaceId: string, threadId: string): void {
  clearSuccessTimer(workspaceId, threadId);
  successTimers.set(
    noticeKey(workspaceId, threadId),
    setTimeout(() => {
      const current = getSharedProviderRetryState(workspaceId, threadId);
      if (current.overlay?.phase === "success") {
        clearSharedProviderRetryState(workspaceId, threadId);
      }
    }, 2000),
  );
}

function enterWait(
  notice: SharedProviderRetryTurnNotice,
  series: SharedProviderRetrySeries,
  classification: SharedProviderRetryClassification,
): void {
  const settings = getSharedProviderRetrySettings(
    notice.workspaceId,
    notice.threadId,
    notice.engine,
  );
  if (!isSharedProviderRetryAutoSendEnabled(settings)) {
    setSharedProviderRetryState(notice.workspaceId, notice.threadId, {
      series: null,
      overlay: {
        phase: "exhausted",
        attempt: series.attempt,
        maxAttempts: settings.maxAttempts,
        seconds: 0,
        kind: classification.kind,
        engine: notice.engine,
        seriesId: series.seriesId,
        lastAttemptId: series.lastAttemptId,
        lastMessage: notice.message ?? null,
        providerProfileId: notice.providerProfileId ?? null,
        model: notice.model ?? null,
      },
    });
    return;
  }
  if (series.attempt > settings.maxAttempts) {
    setSharedProviderRetryState(notice.workspaceId, notice.threadId, {
      series: null,
      overlay: {
        phase: "exhausted",
        attempt: settings.maxAttempts,
        maxAttempts: settings.maxAttempts,
        seconds: 0,
        kind: classification.kind,
        engine: notice.engine,
        seriesId: series.seriesId,
        lastAttemptId: series.lastAttemptId,
        lastMessage: notice.message ?? null,
        providerProfileId: notice.providerProfileId ?? null,
        model: notice.model ?? null,
      },
    });
    return;
  }
  const overlay: SharedProviderRetryOverlay = {
    phase: "wait",
    attempt: series.attempt,
    maxAttempts: settings.maxAttempts,
    seconds: resolveSharedProviderRetryDelaySec(settings, series.attempt),
    kind: classification.kind,
    engine: notice.engine,
    seriesId: series.seriesId,
    lastAttemptId: series.lastAttemptId,
    lastMessage: notice.message ?? null,
    providerProfileId: notice.providerProfileId ?? null,
    model: notice.model ?? null,
  };
  setSharedProviderRetryState(notice.workspaceId, notice.threadId, {
    series,
    overlay,
  });
  startSharedProviderRetryCountdown(
    notice.workspaceId,
    notice.threadId,
    () => {
      void fireSharedProviderRetry(notice.workspaceId, notice.threadId);
    },
  );
}

export function cancelSharedProviderRetry(
  workspaceId: string,
  threadId: string,
  phase: "stopped" | "idle" = "stopped",
): void {
  stopSharedProviderRetryCountdown(workspaceId, threadId);
  clearSuccessTimer(workspaceId, threadId);
  if (phase === "idle") {
    clearSharedProviderRetryState(workspaceId, threadId);
    return;
  }
  const current = getSharedProviderRetryState(workspaceId, threadId);
  if (!current.overlay && !current.series) {
    return;
  }
  setSharedProviderRetryState(workspaceId, threadId, {
    series: null,
    overlay: current.overlay
      ? {
          ...current.overlay,
          phase: "stopped",
          seconds: 0,
        }
      : null,
  });
}

export function fireSharedProviderRetry(
  workspaceId: string,
  threadId: string,
): void {
  const current = getSharedProviderRetryState(workspaceId, threadId);
  if (!current.series || !current.overlay) {
    return;
  }
  const sendState = getSharedSendState(workspaceId, threadId).state;
  if (sendState !== "idle") {
    cancelSharedProviderRetry(workspaceId, threadId, "stopped");
    return;
  }
  const settings = getSharedProviderRetrySettings(
    workspaceId,
    threadId,
    current.series.engine,
  );
  stopSharedProviderRetryCountdown(workspaceId, threadId);
  patchSharedProviderRetryOverlay(workspaceId, threadId, {
    phase: "sending",
    seconds: 0,
  });
  const submit = submitters.get(noticeKey(workspaceId, threadId));
  if (!submit) {
    cancelSharedProviderRetry(workspaceId, threadId, "stopped");
    return;
  }
  void Promise.resolve(
    submit(
      workspaceId,
      threadId,
      resolveSharedProviderRetryResumePrompt(settings.resumePrompt),
    ),
  ).catch(() => {
    // sendMessageToThread already notes the failure; keep overlay for that path.
  });
}

export function noteSharedProviderRetryUserSend(input: {
  workspaceId: string;
  threadId: string;
  originKind?: string | null;
}): void {
  if (input.originKind === "shared-provider-retry") {
    return;
  }
  const current = getSharedProviderRetryState(input.workspaceId, input.threadId);
  if (current.overlay || current.series) {
    cancelSharedProviderRetry(input.workspaceId, input.threadId, "idle");
  }
}

export function noteSharedProviderRetryTurnSettled(
  notice: SharedProviderRetryTurnNotice,
): void {
  const sendState = getSharedSendState(notice.workspaceId, notice.threadId).state;
  const current = getSharedProviderRetryState(notice.workspaceId, notice.threadId);
  if (
    notice.attemptId &&
    current.overlay?.lastAttemptId === notice.attemptId &&
    current.overlay.phase !== "sending"
  ) {
    return;
  }

  const classification = classifySharedProviderRetryError({
    message: notice.message,
    outcome: notice.outcome,
    wasLocalInterrupt: notice.wasLocalInterrupt,
    sendState,
  });

  if (classification.disposition === "ignore" && classification.kind === "recovery") {
    cancelSharedProviderRetry(notice.workspaceId, notice.threadId, "idle");
    return;
  }

  const isResumeTurn = notice.originKind === "shared-provider-retry";
  const inSeries = sameTarget(current.series, notice);
  const successful =
    notice.outcome === "completed" ||
    (notice.outcome == null &&
      !notice.message &&
      classification.disposition === "ignore");

  if (successful && (isResumeTurn || inSeries)) {
    stopSharedProviderRetryCountdown(notice.workspaceId, notice.threadId);
    setSharedProviderRetryState(notice.workspaceId, notice.threadId, {
      series: null,
      overlay: {
        phase: "success",
        attempt: current.overlay?.attempt ?? current.series?.attempt ?? 1,
        maxAttempts:
          current.overlay?.maxAttempts ??
          getSharedProviderRetrySettings(
            notice.workspaceId,
            notice.threadId,
            notice.engine,
          ).maxAttempts,
        seconds: 0,
        kind: null,
        engine: notice.engine,
        seriesId: current.series?.seriesId ?? current.overlay?.seriesId ?? "done",
        lastAttemptId: notice.attemptId ?? current.overlay?.lastAttemptId ?? null,
        lastMessage: notice.message ?? current.overlay?.lastMessage ?? null,
        providerProfileId: notice.providerProfileId ?? current.series?.providerProfileId ?? null,
        model: notice.model ?? current.series?.model ?? null,
      },
    });
    scheduleOverlayClear(notice.workspaceId, notice.threadId);
    return;
  }

  if (successful) {
    return;
  }

  if (current.overlay?.phase === "wait" && !isResumeTurn) {
    return;
  }

  if (classification.disposition === "abort") {
    stopSharedProviderRetryCountdown(notice.workspaceId, notice.threadId);
    clearSuccessTimer(notice.workspaceId, notice.threadId);
    setSharedProviderRetryState(notice.workspaceId, notice.threadId, {
      series: null,
      overlay: {
        phase: "stopped",
        attempt: current.overlay?.attempt ?? 0,
        maxAttempts:
          current.overlay?.maxAttempts ??
          getSharedProviderRetrySettings(
            notice.workspaceId,
            notice.threadId,
            notice.engine,
          ).maxAttempts,
        seconds: 0,
        kind: classification.kind,
        engine: notice.engine,
        seriesId: current.series?.seriesId ?? current.overlay?.seriesId ?? "stopped",
        lastAttemptId: notice.attemptId ?? current.overlay?.lastAttemptId ?? null,
        lastMessage: notice.message ?? current.overlay?.lastMessage ?? null,
        providerProfileId:
          notice.providerProfileId ?? current.overlay?.providerProfileId ?? null,
        model: notice.model ?? current.overlay?.model ?? null,
      },
    });
    return;
  }

  if (classification.disposition === "permanent") {
    stopSharedProviderRetryCountdown(notice.workspaceId, notice.threadId);
    setSharedProviderRetryState(notice.workspaceId, notice.threadId, {
      series: null,
      overlay: {
        phase: "permanent",
        attempt: current.overlay?.attempt ?? 0,
        maxAttempts: getSharedProviderRetrySettings(
          notice.workspaceId,
          notice.threadId,
          notice.engine,
        ).maxAttempts,
        seconds: 0,
        kind: classification.kind,
        engine: notice.engine,
        seriesId: current.series?.seriesId ?? "permanent",
        lastAttemptId: notice.attemptId ?? null,
        lastMessage: notice.message ?? null,
        providerProfileId: notice.providerProfileId ?? null,
        model: notice.model ?? null,
      },
    });
    return;
  }

  if (classification.disposition !== "retryable") {
    return;
  }

  const settings = getSharedProviderRetrySettings(
    notice.workspaceId,
    notice.threadId,
    notice.engine,
  );
  if (!isSharedProviderRetryAutoSendEnabled(settings) && !inSeries) {
    return;
  }

  const nextAttempt = inSeries && current.series ? current.series.attempt + 1 : 1;
  const series: SharedProviderRetrySeries = {
    seriesId:
      inSeries && current.series
        ? current.series.seriesId
        : `retry-${Date.now().toString(36)}`,
    engine: notice.engine,
    providerProfileId: notice.providerProfileId ?? null,
    model: notice.model ?? null,
    attempt: nextAttempt,
    lastAttemptId: notice.attemptId ?? null,
    originUserMessageId: current.series?.originUserMessageId ?? null,
  };
  enterWait(notice, series, classification);
}

export function startSharedProviderRetryManually(
  notice: Omit<SharedProviderRetryTurnNotice, "originKind">,
): void {
  cancelSharedProviderRetry(notice.workspaceId, notice.threadId, "idle");
  noteSharedProviderRetryTurnSettled({
    ...notice,
    originKind: null,
    outcome: "failed",
  });
}

export function resetSharedProviderRetryRuntimeForTests(): void {
  submitters.clear();
  for (const timer of successTimers.values()) {
    clearTimeout(timer);
  }
  successTimers.clear();
}
