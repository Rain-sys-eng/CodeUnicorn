import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  subscribeAgentBridgeEvents,
  type AgentBridgeRuntimeEvent,
} from "../../../services/events";
import {
  cancelAgentBridgeRun,
  getAgentBridgeRun,
  listAgentBridgeWorkspaceRuns,
  retryAgentBridgeRun,
} from "../../../services/tauri/agentBridge";
import type { DelegationRun } from "../types";
import { selectVisibleDelegationRuns } from "../utils/delegationProjection";
import {
  reduceDelegationLiveActivity,
  type DelegationLiveActivity,
} from "../utils/liveActivity";

const MAX_LIVE_ACTIVITY_RUNS = 64;
const DURABLE_REFRESH_KINDS = new Set([
  "run.started",
  "run.settled",
  "control.event",
]);

type UseAgentBridgeRunsInput = {
  workspaceId: string | null | undefined;
  threadId: string | null | undefined;
  nativeThreadIds: readonly string[];
};

export type AgentBridgeRunsState = {
  runs: DelegationRun[];
  loading: boolean;
  error: string | null;
  cancellingRunIds: ReadonlySet<string>;
  retryingRunIds: ReadonlySet<string>;
  activityByRunId: Readonly<Record<string, DelegationLiveActivity>>;
  cancelRun: (runId: string) => Promise<void>;
  retryRun: (runId: string) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortRuns(runs: readonly DelegationRun[]): DelegationRun[] {
  return runs
    .slice()
    .sort(
      (left, right) =>
        left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
    );
}

export function useAgentBridgeRuns({
  workspaceId,
  threadId,
  nativeThreadIds,
}: UseAgentBridgeRunsInput): AgentBridgeRunsState {
  const [workspaceRuns, setWorkspaceRuns] = useState<DelegationRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingRunIds, setCancellingRunIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [retryingRunIds, setRetryingRunIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activityByRunId, setActivityByRunId] = useState<
    Readonly<Record<string, DelegationLiveActivity>>
  >({});
  const runsRef = useRef<DelegationRun[]>([]);
  const activityRef = useRef<Record<string, DelegationLiveActivity>>({});

  const commitRuns = useCallback((runs: readonly DelegationRun[]) => {
    const next = sortRuns(runs);
    runsRef.current = next;
    setWorkspaceRuns(next);
  }, []);

  const commitRun = useCallback((run: DelegationRun) => {
    const index = runsRef.current.findIndex(
      (candidate) => candidate.id === run.id,
    );
    const next = runsRef.current.slice();
    if (index >= 0) {
      next[index] = run;
    } else {
      next.push(run);
    }
    const sorted = sortRuns(next);
    runsRef.current = sorted;
    setWorkspaceRuns(sorted);
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      commitRuns([]);
      activityRef.current = {};
      setActivityByRunId({});
      setLoading(false);
      setError(null);
      return;
    }

    let disposed = false;
    const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    commitRuns([]);
    activityRef.current = {};
    setActivityByRunId({});
    setLoading(true);
    setError(null);

    const refreshWorkspace = async () => {
      try {
        const runs = await listAgentBridgeWorkspaceRuns(workspaceId);
        if (!disposed) {
          commitRuns(runs);
          setError(null);
        }
      } catch (refreshError) {
        if (!disposed) {
          setError(errorMessage(refreshError));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    const refreshRun = async (runId: string) => {
      try {
        const run = await getAgentBridgeRun(workspaceId, runId);
        if (!disposed) {
          commitRun(run);
          setError(null);
        }
      } catch (refreshError) {
        if (!disposed) {
          setError(errorMessage(refreshError));
        }
      }
    };

    const schedule = (key: string, refresh: () => Promise<void>) => {
      if (refreshTimers.has(key)) {
        return;
      }
      const timer = setTimeout(() => {
        refreshTimers.delete(key);
        if (!disposed) {
          void refresh();
        }
      }, 40);
      refreshTimers.set(key, timer);
    };

    const recordActivity = (event: AgentBridgeRuntimeEvent) => {
      const current = activityRef.current[event.runId] ?? null;
      const activity = reduceDelegationLiveActivity(current, event);
      if (!activity || activity === current) {
        return;
      }
      const next = { ...activityRef.current, [event.runId]: activity };
      const entries = Object.entries(next);
      if (entries.length > MAX_LIVE_ACTIVITY_RUNS) {
        entries.sort(
          ([, left], [, right]) => right.observedAtMs - left.observedAtMs,
        );
        activityRef.current = Object.fromEntries(
          entries.slice(0, MAX_LIVE_ACTIVITY_RUNS),
        );
      } else {
        activityRef.current = next;
      }
      setActivityByRunId(activityRef.current);
    };

    const unsubscribe = subscribeAgentBridgeEvents(
      (event) => {
        if (event.lane === "delta") {
          return;
        }
        if (runsRef.current.some((run) => run.id === event.runId)) {
          recordActivity(event);
          if (DURABLE_REFRESH_KINDS.has(event.kind)) {
            schedule(`run:${event.runId}`, () => refreshRun(event.runId));
          }
          return;
        }
        if (event.lane === "critical") {
          // An isolated descendant can carry its runtime workspace in the event. Re-list through
          // the source workspace command so root-lineage visibility remains backend-authorized.
          schedule("workspace", refreshWorkspace);
        }
      },
      {
        onError: (subscriptionError) => {
          if (!disposed) {
            setError(errorMessage(subscriptionError));
          }
        },
      },
    );
    void refreshWorkspace();

    return () => {
      disposed = true;
      unsubscribe();
      for (const timer of refreshTimers.values()) {
        clearTimeout(timer);
      }
      refreshTimers.clear();
    };
  }, [commitRun, commitRuns, workspaceId]);

  const cancelRun = useCallback(
    async (runId: string) => {
      if (!workspaceId || cancellingRunIds.has(runId)) {
        return;
      }
      setCancellingRunIds((current) => new Set(current).add(runId));
      try {
        const run = await cancelAgentBridgeRun(workspaceId, runId);
        commitRun(run);
        setError(null);
      } catch (cancelError) {
        const message = errorMessage(cancelError);
        throw new Error(message);
      } finally {
        setCancellingRunIds((current) => {
          const next = new Set(current);
          next.delete(runId);
          return next;
        });
      }
    },
    [cancellingRunIds, commitRun, workspaceId],
  );
  const retryRun = useCallback(
    async (runId: string) => {
      if (!workspaceId || retryingRunIds.has(runId)) {
        return;
      }
      setRetryingRunIds((current) => new Set(current).add(runId));
      try {
        const run = await retryAgentBridgeRun(workspaceId, runId);
        commitRun(run);
        setError(null);
      } catch (retryError) {
        // Dispatch errors still carry a durable created runId. Re-list through the authorized
        // workspace boundary so a missing settlement cannot make that identity disappear in UI.
        try {
          commitRuns(await listAgentBridgeWorkspaceRuns(workspaceId));
        } catch {
          // Preserve the original retry error; the normal event/list refresh remains available.
        }
        throw new Error(errorMessage(retryError));
      } finally {
        setRetryingRunIds((current) => {
          const next = new Set(current);
          next.delete(runId);
          return next;
        });
      }
    },
    [commitRun, commitRuns, retryingRunIds, workspaceId],
  );
  const visibleRuns = useMemo(
    () => selectVisibleDelegationRuns(workspaceRuns, threadId, nativeThreadIds),
    [nativeThreadIds, threadId, workspaceRuns],
  );

  return {
    runs: visibleRuns,
    loading,
    error,
    cancellingRunIds,
    retryingRunIds,
    activityByRunId,
    cancelRun,
    retryRun,
  };
}
