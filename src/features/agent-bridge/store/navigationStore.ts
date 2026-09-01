import { useSyncExternalStore } from "react";

type AgentBridgeThreadOpenRequest = {
  workspaceId: string;
  threadId: string;
};

let currentRequest: AgentBridgeThreadOpenRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestAgentBridgeThreadOpen(
  workspaceId: string,
  threadId: string,
): void {
  currentRequest = { workspaceId, threadId };
  emit();
}

export function consumeAgentBridgeThreadOpen(): void {
  currentRequest = null;
  emit();
}

export function useAgentBridgeThreadOpenRequest(): AgentBridgeThreadOpenRequest | null {
  return useSyncExternalStore(subscribe, () => currentRequest);
}
