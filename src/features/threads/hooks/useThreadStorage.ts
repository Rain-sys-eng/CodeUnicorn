import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  isClientStoreReady,
  subscribeClientStoreHydrated,
} from "../../../services/clientStorage";
import {
  MAX_PINS_SOFT_LIMIT,
  buildUpdatedThreadAliases,
  buildClearedThreadAliases,
  type CustomNamesMap,
  type PinnedThreadsMap,
  type ThreadAliasMap,
  type ThreadActivityMap,
  loadCustomNames,
  loadPinnedThreads,
  loadWorkspacePinnedThreads,
  loadThreadAliases,
  loadThreadActivity,
  makeCustomNameKey,
  makePinKey,
  resolveCanonicalThreadAlias,
  savePinnedThreads,
  saveWorkspacePinnedThreads,
  saveThreadAliases,
  saveThreadActivity,
  type ThreadPinScope,
} from "../utils/threadStorage";

export type UseThreadStorageResult = {
  customNamesRef: MutableRefObject<CustomNamesMap>;
  pinnedThreadsRef: MutableRefObject<PinnedThreadsMap>;
  threadActivityRef: MutableRefObject<ThreadActivityMap>;
  threadAliasesRef: MutableRefObject<ThreadAliasMap>;
  pinnedThreadsVersion: number;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCanonicalThreadId: (threadId: string) => string;
  rememberThreadAlias: (oldThreadId: string, newThreadId: string) => void;
  clearThreadAlias: (oldThreadId: string) => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  pinThread: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => boolean;
  getPinTimestamp: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => number | null;
  markAutoTitlePending: (workspaceId: string, threadId: string) => void;
  clearAutoTitlePending: (workspaceId: string, threadId: string) => void;
  isAutoTitlePending: (workspaceId: string, threadId: string) => boolean;
  getAutoTitlePendingStartedAt: (
    workspaceId: string,
    threadId: string,
  ) => number | null;
  renameAutoTitlePendingKey: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  autoTitlePendingVersion: number;
};

type AutoTitlePendingMap = Record<string, number>;

const AUTO_TITLE_PENDING_EXPIRE_MS = 20_000;

export function useThreadStorage(): UseThreadStorageResult {
  const threadActivityRef = useRef<ThreadActivityMap>(loadThreadActivity());
  const [initialPinnedThreads] = useState(loadPinnedThreads);
  const [initialWorkspacePinnedThreads] = useState(loadWorkspacePinnedThreads);
  const [initialThreadAliases] = useState(loadThreadAliases);
  const pinnedThreadsRef = useRef<PinnedThreadsMap>(initialPinnedThreads);
  const workspacePinnedThreadsRef = useRef<PinnedThreadsMap>(
    initialWorkspacePinnedThreads,
  );
  const threadAliasesRef = useRef<ThreadAliasMap>(initialThreadAliases);
  const [pinnedThreads, setPinnedThreads] = useState<PinnedThreadsMap>(
    initialPinnedThreads,
  );
  const [workspacePinnedThreads, setWorkspacePinnedThreads] =
    useState<PinnedThreadsMap>(initialWorkspacePinnedThreads);
  const autoTitlePendingRef = useRef<AutoTitlePendingMap>({});
  const [pinnedThreadsVersion, setPinnedThreadsVersion] = useState(() =>
    Object.keys(initialPinnedThreads).length > 0 ? 1 : 0,
  );
  const [autoTitlePendingVersion, setAutoTitlePendingVersion] = useState(0);
  const customNamesRef = useRef<CustomNamesMap>({});

  useEffect(() => {
    const hydrateThreadStorage = () => {
      customNamesRef.current = loadCustomNames();
      const nextPinned = loadPinnedThreads();
      const nextWorkspacePinned = loadWorkspacePinnedThreads();
      const nextAliases = loadThreadAliases();
      const nextActivity = loadThreadActivity();
      threadActivityRef.current = nextActivity;
      pinnedThreadsRef.current = nextPinned;
      workspacePinnedThreadsRef.current = nextWorkspacePinned;
      threadAliasesRef.current = nextAliases;
      setPinnedThreads(nextPinned);
      setWorkspacePinnedThreads(nextWorkspacePinned);
      if (
        Object.keys(nextPinned).length > 0 ||
        Object.keys(nextWorkspacePinned).length > 0
      ) {
        setPinnedThreadsVersion((version) => (version === 0 ? 1 : version));
      }
    };
    if (isClientStoreReady("threads")) {
      hydrateThreadStorage();
      return;
    }
    return subscribeClientStoreHydrated((store) => {
      if (store === "threads") {
        hydrateThreadStorage();
      }
    });
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const pending = autoTitlePendingRef.current;
      const keys = Object.keys(pending);
      if (keys.length === 0) {
        return;
      }
      const now = Date.now();
      const expired = keys.filter(
        (key) => now - (pending[key] ?? now) >= AUTO_TITLE_PENDING_EXPIRE_MS,
      );
      if (expired.length === 0) {
        return;
      }
      const next = { ...pending };
      for (const key of expired) {
        delete next[key];
      }
      autoTitlePendingRef.current = next;
      setAutoTitlePendingVersion((v) => v + 1);
    }, 30_000);
    // 30s 仅作清扫兜底（渲染红线：根链轮询 ≥30s）；正确性不依赖它——
    // 消费侧读取时已按 AUTO_TITLE_PENDING_EXPIRE_MS 做 on-demand 过期判断。
    return () => clearInterval(intervalId);
  }, []);

  const getCustomName = useCallback((workspaceId: string, threadId: string) => {
    const key = makeCustomNameKey(workspaceId, threadId);
    return customNamesRef.current[key];
  }, []);

  const resolveCanonicalThreadId = useCallback((threadId: string) => {
    return resolveCanonicalThreadAlias(threadAliasesRef.current, threadId);
  }, []);

  const rememberThreadAlias = useCallback(
    (oldThreadId: string, newThreadId: string) => {
      const next = buildUpdatedThreadAliases(
        threadAliasesRef.current,
        oldThreadId,
        newThreadId,
      );
      threadAliasesRef.current = next;
      saveThreadAliases(next);
    },
    [],
  );

  const clearThreadAlias = useCallback((oldThreadId: string) => {
    const next = buildClearedThreadAliases(threadAliasesRef.current, oldThreadId);
    threadAliasesRef.current = next;
    saveThreadAliases(next);
  }, []);

  const recordThreadActivity = useCallback(
    (workspaceId: string, threadId: string, timestamp = Date.now()) => {
      const nextForWorkspace = {
        ...(threadActivityRef.current[workspaceId] ?? {}),
        [threadId]: timestamp,
      };
      const next = {
        ...threadActivityRef.current,
        [workspaceId]: nextForWorkspace,
      };
      threadActivityRef.current = next;
      saveThreadActivity(next);
    },
    [],
  );

  useEffect(() => {
    const reloaded = loadPinnedThreads();
    pinnedThreadsRef.current = reloaded;
    setPinnedThreads(reloaded);
    const reloadedWorkspacePinned = loadWorkspacePinnedThreads();
    workspacePinnedThreadsRef.current = reloadedWorkspacePinned;
    setWorkspacePinnedThreads(reloadedWorkspacePinned);
    if (
      Object.keys(reloaded).length > 0 ||
      Object.keys(reloadedWorkspacePinned).length > 0
    ) {
      setPinnedThreadsVersion((version) => (version === 0 ? 1 : version));
    }
  }, []);

  // 两作用域互斥：scope 决定目标 map；写入前清掉另一作用域的记录。
  const pinThread = useCallback(
    (workspaceId: string, threadId: string, scope: ThreadPinScope = "global"): boolean => {
      const key = makePinKey(workspaceId, threadId);
      const targetRef =
        scope === "workspace" ? workspacePinnedThreadsRef : pinnedThreadsRef;
      const otherRef =
        scope === "workspace" ? pinnedThreadsRef : workspacePinnedThreadsRef;
      if (key in targetRef.current) {
        return false;
      }
      const currentPinsForWorkspace = Object.keys(targetRef.current).filter(
        (entry) => entry.startsWith(`${workspaceId}:`),
      ).length;
      if (currentPinsForWorkspace >= MAX_PINS_SOFT_LIMIT) {
        console.warn(
          `Pin limit reached (${MAX_PINS_SOFT_LIMIT}). Consider unpinning some threads.`,
        );
      }
      if (key in otherRef.current) {
        const { [key]: _migrated, ...otherRest } = otherRef.current;
        otherRef.current = otherRest;
        if (scope === "workspace") {
          setPinnedThreads(otherRest);
          savePinnedThreads(otherRest);
        } else {
          setWorkspacePinnedThreads(otherRest);
          saveWorkspacePinnedThreads(otherRest);
        }
      }
      const next = { ...targetRef.current, [key]: Date.now() };
      targetRef.current = next;
      if (scope === "workspace") {
        setWorkspacePinnedThreads(next);
        saveWorkspacePinnedThreads(next);
      } else {
        setPinnedThreads(next);
        savePinnedThreads(next);
      }
      setPinnedThreadsVersion((version) => version + 1);
      return true;
    },
    [],
  );

  const unpinThread = useCallback((workspaceId: string, threadId: string) => {
    const key = makePinKey(workspaceId, threadId);
    const inGlobal = key in pinnedThreadsRef.current;
    const inWorkspace = key in workspacePinnedThreadsRef.current;
    if (!inGlobal && !inWorkspace) {
      return;
    }
    if (inGlobal) {
      const { [key]: _removed, ...rest } = pinnedThreadsRef.current;
      pinnedThreadsRef.current = rest;
      setPinnedThreads(rest);
      savePinnedThreads(rest);
    }
    if (inWorkspace) {
      const { [key]: _removedWorkspace, ...workspaceRest } =
        workspacePinnedThreadsRef.current;
      workspacePinnedThreadsRef.current = workspaceRest;
      setWorkspacePinnedThreads(workspaceRest);
      saveWorkspacePinnedThreads(workspaceRest);
    }
    setPinnedThreadsVersion((version) => version + 1);
  }, []);

  const isThreadPinned = useCallback(
    (workspaceId: string, threadId: string, scope: ThreadPinScope = "global"): boolean => {
      const key = makePinKey(workspaceId, threadId);
      return scope === "workspace"
        ? key in workspacePinnedThreadsRef.current
        : key in pinnedThreadsRef.current;
    },
    [],
  );

  const getPinTimestamp = useCallback(
    (workspaceId: string, threadId: string, scope: ThreadPinScope = "global"): number | null => {
      const key = makePinKey(workspaceId, threadId);
      return scope === "workspace"
        ? (workspacePinnedThreads[key] ?? null)
        : (pinnedThreads[key] ?? null);
    },
    [pinnedThreads, workspacePinnedThreads],
  );

  const markAutoTitlePending = useCallback(
    (workspaceId: string, threadId: string) => {
      const key = makeCustomNameKey(workspaceId, threadId);
      if (autoTitlePendingRef.current[key]) {
        return;
      }
      const next: AutoTitlePendingMap = {
        ...autoTitlePendingRef.current,
        [key]: Date.now(),
      };
      autoTitlePendingRef.current = next;
      setAutoTitlePendingVersion((v) => v + 1);
    },
    [],
  );

  const clearAutoTitlePending = useCallback(
    (workspaceId: string, threadId: string) => {
      const key = makeCustomNameKey(workspaceId, threadId);
      if (!autoTitlePendingRef.current[key]) {
        return;
      }
      const { [key]: _removed, ...rest } = autoTitlePendingRef.current;
      autoTitlePendingRef.current = rest;
      setAutoTitlePendingVersion((v) => v + 1);
    },
    [],
  );

  const isAutoTitlePending = useCallback(
    (workspaceId: string, threadId: string): boolean => {
      const key = makeCustomNameKey(workspaceId, threadId);
      const startedAt = autoTitlePendingRef.current[key];
      if (!startedAt) {
        return false;
      }
      if (Date.now() - startedAt >= AUTO_TITLE_PENDING_EXPIRE_MS) {
        const { [key]: _expired, ...rest } = autoTitlePendingRef.current;
        autoTitlePendingRef.current = rest;
        setAutoTitlePendingVersion((v) => v + 1);
        return false;
      }
      return true;
    },
    [],
  );

  const getAutoTitlePendingStartedAt = useCallback(
    (workspaceId: string, threadId: string): number | null => {
      const key = makeCustomNameKey(workspaceId, threadId);
      return autoTitlePendingRef.current[key] ?? null;
    },
    [],
  );

  const renameAutoTitlePendingKey = useCallback(
    (workspaceId: string, oldThreadId: string, newThreadId: string) => {
      const fromKey = makeCustomNameKey(workspaceId, oldThreadId);
      if (!autoTitlePendingRef.current[fromKey]) {
        return;
      }
      const toKey = makeCustomNameKey(workspaceId, newThreadId);
      const next: AutoTitlePendingMap = { ...autoTitlePendingRef.current };
      delete next[fromKey];
      next[toKey] = autoTitlePendingRef.current[fromKey];
      autoTitlePendingRef.current = next;
    },
    [],
  );

  return {
    customNamesRef,
    pinnedThreadsRef,
    threadActivityRef,
    threadAliasesRef,
    pinnedThreadsVersion,
    getCustomName,
    resolveCanonicalThreadId,
    rememberThreadAlias,
    clearThreadAlias,
    recordThreadActivity,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    markAutoTitlePending,
    clearAutoTitlePending,
    isAutoTitlePending,
    getAutoTitlePendingStartedAt,
    renameAutoTitlePendingKey,
    autoTitlePendingVersion,
  };
}
