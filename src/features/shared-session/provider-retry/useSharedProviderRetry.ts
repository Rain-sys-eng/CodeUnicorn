import { useEffect } from "react";

import type { EngineType } from "../../../types";
import { getSharedSendState } from "../runtime/sharedSendStateStore";
import { useSharedTargetState } from "../target/targetStore";
import {
  cancelSharedProviderRetry,
  registerSharedProviderRetrySubmitter,
} from "./noteSharedProviderRetryTurn";
import { getSharedProviderRetryState } from "./providerRetryControllerStore";
import { resolveSharedProviderRetryResumePrompt } from "./providerRetryPolicy";
import { getSharedProviderRetrySettings } from "./providerRetrySettingsStore";

type UseSharedProviderRetryInput = {
  workspaceId: string | null | undefined;
  threadId: string | null | undefined;
  engine: EngineType | null | undefined;
  collabRunActive: boolean;
  sendResume: (
    workspaceId: string,
    threadId: string,
    text: string,
  ) => void | Promise<unknown>;
};

export function useSharedProviderRetry({
  workspaceId,
  threadId,
  engine,
  collabRunActive,
  sendResume,
}: UseSharedProviderRetryInput): void {
  useEffect(() => {
    if (!workspaceId || !threadId) {
      return;
    }
    return registerSharedProviderRetrySubmitter(
      workspaceId,
      threadId,
      (nextWorkspaceId, nextThreadId, rawPrompt) => {
        const settings = getSharedProviderRetrySettings(
          nextWorkspaceId,
          nextThreadId,
          engine ?? "claude",
        );
        return sendResume(
          nextWorkspaceId,
          nextThreadId,
          resolveSharedProviderRetryResumePrompt(rawPrompt || settings.resumePrompt),
        );
      },
    );
  }, [engine, sendResume, threadId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !threadId) {
      return;
    }
    if (collabRunActive) {
      cancelSharedProviderRetry(workspaceId, threadId, "idle");
    }
  }, [collabRunActive, threadId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !threadId) {
      return;
    }
    const sendState = getSharedSendState(workspaceId, threadId).state;
    if (sendState === "recovery-required" || sendState === "target-unavailable") {
      cancelSharedProviderRetry(workspaceId, threadId, "idle");
    }
  }, [threadId, workspaceId]);

  const target = useSharedTargetState(workspaceId ?? "", threadId ?? "");
  useEffect(() => {
    if (!workspaceId || !threadId) {
      return;
    }
    const current = getSharedProviderRetryState(workspaceId, threadId);
    const series = current.series;
    if (!series) {
      return;
    }
    const next = target.selectedNextTarget;
    if (!next) {
      return;
    }
    if (
      next.engine !== series.engine ||
      (next.providerProfileId ?? null) !== series.providerProfileId ||
      (next.model ?? null) !== series.model
    ) {
      cancelSharedProviderRetry(workspaceId, threadId, "idle");
    }
  }, [
    target.selectedNextTarget,
    threadId,
    workspaceId,
  ]);

  useEffect(() => {
    return () => {
      if (workspaceId && threadId) {
        cancelSharedProviderRetry(workspaceId, threadId, "idle");
      }
    };
  }, [threadId, workspaceId]);
}
