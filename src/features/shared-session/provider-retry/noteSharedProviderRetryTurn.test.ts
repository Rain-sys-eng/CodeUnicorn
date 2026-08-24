import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchSharedSendEvent,
  resetSharedSendStateStoreForTests,
  tryAcquireSharedSend,
} from "../runtime/sharedSendStateStore";
import {
  cancelSharedProviderRetry,
  fireSharedProviderRetry,
  noteSharedProviderRetryTurnSettled,
  noteSharedProviderRetryUserSend,
  registerSharedProviderRetrySubmitter,
  resetSharedProviderRetryRuntimeForTests,
  startSharedProviderRetryManually,
} from "./noteSharedProviderRetryTurn";
import {
  getSharedProviderRetryOverlay,
  resetSharedProviderRetryControllerStoreForTests,
} from "./providerRetryControllerStore";
import { SHARED_PROVIDER_RETRY_DEFAULTS } from "./providerRetryPolicy";
import {
  resetSharedProviderRetrySettingsStoreForTests,
  setSharedProviderRetrySettings,
} from "./providerRetrySettingsStore";

const WORKSPACE = "ws";
const THREAD = "shared:retry";

function failedNotice(message: string) {
  return {
    workspaceId: WORKSPACE,
    threadId: THREAD,
    engine: "claude" as const,
    providerProfileId: "provider-a",
    model: "claude-sonnet",
    attemptId: `attempt-${message.slice(0, 8)}`,
    outcome: "failed" as const,
    message,
    wasLocalInterrupt: false,
  };
}

describe("noteSharedProviderRetryTurn", () => {
  beforeEach(() => {
    resetSharedSendStateStoreForTests();
    resetSharedProviderRetryControllerStoreForTests();
    resetSharedProviderRetrySettingsStoreForTests();
    resetSharedProviderRetryRuntimeForTests();
  });

  afterEach(() => {
    resetSharedProviderRetryRuntimeForTests();
    resetSharedProviderRetryControllerStoreForTests();
    resetSharedProviderRetrySettingsStoreForTests();
    resetSharedSendStateStoreForTests();
  });

  it("starts a wait overlay after a pool 403 and then submits the resume prompt", async () => {
    const submit = vi.fn();
    registerSharedProviderRetrySubmitter(WORKSPACE, THREAD, submit);
    noteSharedProviderRetryTurnSettled(
      failedNotice("Failed to authenticate. API Error: 403 API Key is not assigned to any group"),
    );
    const overlay = getSharedProviderRetryOverlay(WORKSPACE, THREAD);
    expect(overlay).toMatchObject({
      phase: "wait",
      attempt: 1,
      maxAttempts: 3,
      seconds: 3,
      kind: "pool",
    });
    fireSharedProviderRetry(WORKSPACE, THREAD);
    expect(submit).toHaveBeenCalledWith(
      WORKSPACE,
      THREAD,
      SHARED_PROVIDER_RETRY_DEFAULTS.resumePrompt,
      expect.objectContaining({ attempt: 1, atMs: expect.any(Number) }),
    );
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)?.phase).toBe("sending");
  });

  it("does not start a series for recovery-required or a local stop", () => {
    expect(tryAcquireSharedSend(WORKSPACE, THREAD).acquired).toBe(true);
    dispatchSharedSendEvent(WORKSPACE, THREAD, { type: "packagePrepared" });
    dispatchSharedSendEvent(WORKSPACE, THREAD, { type: "ackAmbiguous" });
    noteSharedProviderRetryTurnSettled(
      failedNotice("API Key is not assigned to any group"),
    );
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)).toBeNull();

    resetSharedSendStateStoreForTests();
    noteSharedProviderRetryTurnSettled({
      ...failedNotice("Turn cancelled"),
      wasLocalInterrupt: true,
    });
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)?.phase).toBe("stopped");
  });

  it("opens a new series from 再试 and still waits first", () => {
    const submit = vi.fn();
    registerSharedProviderRetrySubmitter(WORKSPACE, THREAD, submit);
    setSharedProviderRetrySettings(WORKSPACE, THREAD, "claude", { maxAttempts: 1 });
    noteSharedProviderRetryTurnSettled(
      failedNotice("API Key is not assigned to any group"),
    );
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)?.phase).toBe("wait");
    noteSharedProviderRetryTurnSettled({
      ...failedNotice("API Key is not assigned to any group"),
      originKind: "shared-provider-retry",
      attemptId: "attempt-2",
    });
    const exhausted = getSharedProviderRetryOverlay(WORKSPACE, THREAD);
    expect(exhausted?.phase).toBe("exhausted");
    expect(exhausted?.seriesStartedAtMs).toBeGreaterThan(0);
    expect(exhausted?.batchStartedAtMs).toBeGreaterThan(0);
    startSharedProviderRetryManually(
      failedNotice("API Key is not assigned to any group"),
    );
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)).toMatchObject({
      phase: "wait",
      attempt: 1,
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("cancels the series when the user types a new message", () => {
    noteSharedProviderRetryTurnSettled(
      failedNotice("API Key is not assigned to any group"),
    );
    noteSharedProviderRetryUserSend({
      workspaceId: WORKSPACE,
      threadId: THREAD,
      originKind: null,
    });
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)).toBeNull();
  });

  it("does not submit while Shared send is not idle", () => {
    const submit = vi.fn();
    registerSharedProviderRetrySubmitter(WORKSPACE, THREAD, submit);
    noteSharedProviderRetryTurnSettled(
      failedNotice("API Key is not assigned to any group"),
    );
    expect(tryAcquireSharedSend(WORKSPACE, THREAD).acquired).toBe(true);
    fireSharedProviderRetry(WORKSPACE, THREAD);
    expect(submit).not.toHaveBeenCalled();
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)?.phase).toBe("stopped");
    cancelSharedProviderRetry(WORKSPACE, THREAD, "idle");
  });

  it("trips the circuit breaker after three identical-signature failures", () => {
    const submit = vi.fn();
    registerSharedProviderRetrySubmitter(WORKSPACE, THREAD, submit);
    setSharedProviderRetrySettings(WORKSPACE, THREAD, "claude", { maxAttempts: 10 });
    const message =
      "Claude exited with status: exit code: 1. Diagnostics: input_format=stream-json. No stdout/stderr diagnostics were observed.";

    noteSharedProviderRetryTurnSettled(failedNotice(message));
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)).toMatchObject({
      phase: "wait",
      attempt: 1,
      kind: "soft-cancel",
    });

    noteSharedProviderRetryTurnSettled({
      ...failedNotice(message),
      originKind: "shared-provider-retry",
      attemptId: "resume-1",
    });
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)?.phase).toBe("wait");

    noteSharedProviderRetryTurnSettled({
      ...failedNotice(message),
      originKind: "shared-provider-retry",
      attemptId: "resume-2",
    });
    const overlay = getSharedProviderRetryOverlay(WORKSPACE, THREAD);
    expect(overlay?.phase).toBe("exhausted");
    expect(overlay?.kind).toBe("soft-cancel");
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not trip the circuit breaker when failure signatures differ", () => {
    registerSharedProviderRetrySubmitter(WORKSPACE, THREAD, vi.fn());
    setSharedProviderRetrySettings(WORKSPACE, THREAD, "claude", { maxAttempts: 10 });

    noteSharedProviderRetryTurnSettled(
      failedNotice("API Key is not assigned to any group"),
    );
    noteSharedProviderRetryTurnSettled({
      ...failedNotice("API Key is not assigned to any group"),
      originKind: "shared-provider-retry",
      attemptId: "resume-1",
    });
    noteSharedProviderRetryTurnSettled({
      ...failedNotice("API Error: 429 Too Many Requests"),
      originKind: "shared-provider-retry",
      attemptId: "resume-2",
    });
    // 三次失败但第三次签名不同：不熔断，按既有 backoff 继续
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)).toMatchObject({
      phase: "wait",
      attempt: 3,
      kind: "rate",
    });
  });

  it("allows a fresh series after the user sends manually post-circuit-break", () => {
    registerSharedProviderRetrySubmitter(WORKSPACE, THREAD, vi.fn());
    setSharedProviderRetrySettings(WORKSPACE, THREAD, "claude", { maxAttempts: 10 });
    const message = "502 bad gateway";

    noteSharedProviderRetryTurnSettled(failedNotice(message));
    noteSharedProviderRetryTurnSettled({
      ...failedNotice(message),
      originKind: "shared-provider-retry",
      attemptId: "resume-1",
    });
    noteSharedProviderRetryTurnSettled({
      ...failedNotice(message),
      originKind: "shared-provider-retry",
      attemptId: "resume-2",
    });
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)?.phase).toBe("exhausted");

    noteSharedProviderRetryUserSend({
      workspaceId: WORKSPACE,
      threadId: THREAD,
      originKind: null,
    });
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)).toBeNull();

    noteSharedProviderRetryTurnSettled(failedNotice(message));
    expect(getSharedProviderRetryOverlay(WORKSPACE, THREAD)).toMatchObject({
      phase: "wait",
      attempt: 1,
    });
  });
});
