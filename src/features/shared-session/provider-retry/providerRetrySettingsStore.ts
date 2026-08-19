import { useSyncExternalStore } from "react";

import type { EngineType } from "../../../types";
import {
  clampSharedProviderRetrySettings,
  SHARED_PROVIDER_RETRY_DEFAULTS,
  type SharedProviderRetrySettings,
} from "./providerRetryPolicy";

type Listener = () => void;

const settings = new Map<string, SharedProviderRetrySettings>();
const listeners = new Map<string, Set<Listener>>();

export function sharedProviderRetrySettingsKey(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
): string {
  return `${workspaceId}::${threadId}::${engine}`;
}

function readSettings(key: string): SharedProviderRetrySettings {
  return settings.get(key) ?? SHARED_PROVIDER_RETRY_DEFAULTS;
}

function notify(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}

export function getSharedProviderRetrySettings(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
): SharedProviderRetrySettings {
  return readSettings(sharedProviderRetrySettingsKey(workspaceId, threadId, engine));
}

export function setSharedProviderRetrySettings(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
  patch: Partial<SharedProviderRetrySettings>,
): SharedProviderRetrySettings {
  const key = sharedProviderRetrySettingsKey(workspaceId, threadId, engine);
  const next = clampSharedProviderRetrySettings(patch, readSettings(key));
  settings.set(key, next);
  notify(key);
  return next;
}

function subscribe(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
  listener: Listener,
): () => void {
  const key = sharedProviderRetrySettingsKey(workspaceId, threadId, engine);
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

export function useSharedProviderRetrySettings(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
  engine: EngineType | null | undefined,
): SharedProviderRetrySettings {
  const safeWorkspaceId = workspaceId ?? "";
  const safeThreadId = threadId ?? "";
  const safeEngine = engine ?? "claude";
  return useSyncExternalStore(
    (listener) => subscribe(safeWorkspaceId, safeThreadId, safeEngine, listener),
    () => getSharedProviderRetrySettings(safeWorkspaceId, safeThreadId, safeEngine),
    () => SHARED_PROVIDER_RETRY_DEFAULTS,
  );
}

export function resetSharedProviderRetrySettingsStoreForTests(): void {
  settings.clear();
  listeners.clear();
}
