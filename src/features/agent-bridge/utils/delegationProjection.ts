import {
  collectSharedHideIdentityKeys,
  sharedHideIdentityIntersects,
} from "../../shared-session/runtime/sharedHideIdentity";
import type { DelegationRun } from "../types";

function compareRuns(left: DelegationRun, right: DelegationRun): number {
  return left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id);
}

export function collectDelegationSourceIdentityKeys(
  threadId: string | null | undefined,
  nativeThreadIds: readonly string[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const identity of [threadId ?? "", ...nativeThreadIds]) {
    for (const key of collectSharedHideIdentityKeys(identity)) {
      keys.add(key);
    }
  }
  return keys;
}

export function selectVisibleDelegationRuns(
  runs: readonly DelegationRun[],
  threadId: string | null | undefined,
  nativeThreadIds: readonly string[],
): DelegationRun[] {
  const sourceKeys = collectDelegationSourceIdentityKeys(
    threadId,
    nativeThreadIds,
  );
  if (sourceKeys.size === 0) {
    return [];
  }

  const byId = new Map(runs.map((run) => [run.id, run]));
  const visible = runs.filter((run) => {
    const root = byId.get(run.rootRunId) ?? (run.id === run.rootRunId ? run : null);
    if (!root) {
      return false;
    }
    const sourceIdentities = [
      root.source.logicalSessionId,
      root.source.nativeSessionId,
    ];
    return sourceIdentities.some(
      (identity) =>
        typeof identity === "string" &&
        sharedHideIdentityIntersects(identity, sourceKeys),
    );
  });

  const visibleById = new Map(visible.map((run) => [run.id, run]));
  const children = new Map<string, DelegationRun[]>();
  const roots: DelegationRun[] = [];
  for (const run of visible) {
    const parentId = run.parentRunId ?? "";
    if (!parentId || !visibleById.has(parentId)) {
      roots.push(run);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(run);
    children.set(parentId, siblings);
  }

  roots.sort(compareRuns);
  for (const siblings of children.values()) {
    siblings.sort(compareRuns);
  }
  const ordered: DelegationRun[] = [];
  const visited = new Set<string>();
  const append = (run: DelegationRun) => {
    if (visited.has(run.id)) {
      return;
    }
    visited.add(run.id);
    ordered.push(run);
    for (const child of children.get(run.id) ?? []) {
      append(child);
    }
  };
  roots.forEach(append);
  visible.slice().sort(compareRuns).forEach(append);
  return ordered;
}

export function formatDelegationElapsed(
  run: DelegationRun,
  nowMs: number,
): string {
  const start = run.startedAtMs ?? run.createdAtMs;
  const end = run.completedAtMs ?? nowMs;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
