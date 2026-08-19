import { useSyncExternalStore } from "react";

import type { EngineType } from "../../../types";
import type { SharedProviderRetryKind } from "./classifySharedProviderRetryError";

export type SharedProviderRetryPhase =
  | "idle"
  | "wait"
  | "sending"
  | "exhausted"
  | "permanent"
  | "stopped"
  | "success";

export type SharedProviderRetryOverlay = {
  phase: SharedProviderRetryPhase;
  attempt: number;
  maxAttempts: number;
  seconds: number;
  kind: SharedProviderRetryKind | null;
  engine: EngineType;
  seriesId: string;
  lastAttemptId: string | null;
  lastMessage: string | null;
  providerProfileId: string | null;
  model: string | null;
};

export type SharedProviderRetrySeries = {
  seriesId: string;
  engine: EngineType;
  providerProfileId: string | null;
  model: string | null;
  attempt: number;
  lastAttemptId: string | null;
  originUserMessageId: string | null;
};

type ThreadRetryState = {
  overlay: SharedProviderRetryOverlay | null;
  series: SharedProviderRetrySeries | null;
};

type Listener = () => void;

const EMPTY_STATE: ThreadRetryState = {
  overlay: null,
  series: null,
};

const states = new Map<string, ThreadRetryState>();
const listeners = new Map<string, Set<Listener>>();
const timers = new Map<string, ReturnType<typeof setInterval>>();

function storeKeyOf(workspaceId: string, threadId: string): string {
  return `${workspaceId}::${threadId}`;
}

function readState(key: string): ThreadRetryState {
  return states.get(key) ?? EMPTY_STATE;
}

function writeState(key: string, next: ThreadRetryState): void {
  if (next.overlay === null && next.series === null) {
    states.delete(key);
  } else {
    states.set(key, next);
  }
  listeners.get(key)?.forEach((listener) => listener());
}

function clearTimer(key: string): void {
  const timer = timers.get(key);
  if (timer) {
    clearInterval(timer);
    timers.delete(key);
  }
}

export function getSharedProviderRetryState(
  workspaceId: string,
  threadId: string,
): ThreadRetryState {
  return readState(storeKeyOf(workspaceId, threadId));
}

export function getSharedProviderRetryOverlay(
  workspaceId: string,
  threadId: string,
): SharedProviderRetryOverlay | null {
  return getSharedProviderRetryState(workspaceId, threadId).overlay;
}

export function setSharedProviderRetryState(
  workspaceId: string,
  threadId: string,
  next: ThreadRetryState,
): void {
  writeState(storeKeyOf(workspaceId, threadId), next);
}

export function patchSharedProviderRetryOverlay(
  workspaceId: string,
  threadId: string,
  patch: Partial<SharedProviderRetryOverlay>,
): SharedProviderRetryOverlay | null {
  const key = storeKeyOf(workspaceId, threadId);
  const current = readState(key);
  if (!current.overlay) {
    return null;
  }
  const overlay = { ...current.overlay, ...patch };
  writeState(key, { ...current, overlay });
  return overlay;
}

export function startSharedProviderRetryCountdown(
  workspaceId: string,
  threadId: string,
  onElapsed: () => void,
): void {
  const key = storeKeyOf(workspaceId, threadId);
  clearTimer(key);
  timers.set(
    key,
    setInterval(() => {
      const current = readState(key);
      if (!current.overlay || current.overlay.phase !== "wait") {
        clearTimer(key);
        return;
      }
      const nextSeconds = current.overlay.seconds - 1;
      if (nextSeconds <= 0) {
        clearTimer(key);
        writeState(key, {
          ...current,
          overlay: { ...current.overlay, seconds: 0, phase: "sending" },
        });
        onElapsed();
        return;
      }
      writeState(key, {
        ...current,
        overlay: { ...current.overlay, seconds: nextSeconds },
      });
    }, 1000),
  );
}

export function stopSharedProviderRetryCountdown(
  workspaceId: string,
  threadId: string,
): void {
  clearTimer(storeKeyOf(workspaceId, threadId));
}

export function clearSharedProviderRetryState(
  workspaceId: string,
  threadId: string,
): void {
  const key = storeKeyOf(workspaceId, threadId);
  clearTimer(key);
  writeState(key, EMPTY_STATE);
}

function subscribe(
  workspaceId: string,
  threadId: string,
  listener: Listener,
): () => void {
  const key = storeKeyOf(workspaceId, threadId);
  let bucket = listeners.get(key);
  if (!bucket) {
    bucket = new Set();
    listeners.set(key, bucket);
  }
  bucket.add(listener);
  return () => {
    bucket.delete(listener);
  };
}

export function useSharedProviderRetryOverlay(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
): SharedProviderRetryOverlay | null {
  const safeWorkspaceId = workspaceId ?? "";
  const safeThreadId = threadId ?? "";
  return useSyncExternalStore(
    (listener) => subscribe(safeWorkspaceId, safeThreadId, listener),
    () => getSharedProviderRetryOverlay(safeWorkspaceId, safeThreadId),
    () => null,
  );
}

export function resetSharedProviderRetryControllerStoreForTests(): void {
  for (const timer of timers.values()) {
    clearInterval(timer);
  }
  timers.clear();
  states.clear();
  listeners.clear();
}
