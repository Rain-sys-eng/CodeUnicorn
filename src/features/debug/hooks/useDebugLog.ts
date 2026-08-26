import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugEntry } from "../../../types";
import { copyTextToClipboard } from "../../../utils/clipboard";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { appendClientErrorLog } from "../../../services/tauri";
import {
  buildClientErrorLogSignature,
  buildClientErrorLogEntry,
  createKnownSafeStderrDailyBudget,
  getSafeClientStderrReasonCode,
  shouldPersistClientErrorLogEntry,
} from "../utils/clientErrorLog";

const MAX_DEBUG_ENTRIES = 200;
const THREAD_SESSION_LOG_KEY = "diagnostics.threadSessionLog";
const THREAD_SESSION_LOG_STORE = "diagnostics";
const LEGACY_THREAD_SESSION_LOG_STORE = "app";
export const MAX_THREAD_SESSION_LOG_ENTRIES = 400;
// 单条 payload 序列化体积上限：防止单个巨型 payload 把 diagnostics store 再次撑爆。
export const MAX_THREAD_SESSION_LOG_PAYLOAD_CHARS = 8_000;
const TRUNCATED_PAYLOAD_PREVIEW_CHARS = 2_000;
export const STDERR_AGGREGATION_WINDOW_MS = 5_000;
export const MAX_PENDING_STDERR_SIGNATURES = 64;
const MAX_STDERR_SCOPE_IDS = 32;
const STDERR_AGGREGATE_LABEL = "stderr/aggregate";

type ThreadSessionLogEntry = {
  timestamp: number;
  source: string;
  label: string;
  payload: unknown;
};

type PendingStderrAggregate = {
  signature: string;
  reasonCode: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  maxRawMessageLength: number;
  workspaceIds: Set<string>;
  threadIds: Set<string>;
  turnIds: Set<string>;
  scopeCountsCapped: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEventTimestamp(timestamp: number): number {
  return Number.isFinite(timestamp) &&
    Number.isFinite(new Date(timestamp).getTime())
    ? timestamp
    : Date.now();
}

function readBoundedPayloadString(
  payload: unknown,
  ...keys: string[]
): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 240);
    }
  }
  return null;
}

function readRawMessageLength(payload: unknown): number {
  if (typeof payload === "string") {
    return payload.length;
  }
  if (!isRecord(payload)) {
    return 0;
  }
  const value = payload.rawMessageLength;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function addBoundedScopeId(target: Set<string>, value: string | null): boolean {
  if (!value || target.has(value)) {
    return false;
  }
  if (target.size >= MAX_STDERR_SCOPE_IDS) {
    return true;
  }
  target.add(value);
  return false;
}

function createPendingStderrAggregate(
  entry: DebugEntry,
): PendingStderrAggregate {
  const occurredAt = normalizeEventTimestamp(entry.timestamp);
  const workspaceIds = new Set<string>();
  const threadIds = new Set<string>();
  const turnIds = new Set<string>();
  addBoundedScopeId(
    workspaceIds,
    readBoundedPayloadString(entry.payload, "workspaceId", "workspace_id"),
  );
  addBoundedScopeId(
    threadIds,
    readBoundedPayloadString(entry.payload, "threadId", "thread_id"),
  );
  addBoundedScopeId(
    turnIds,
    readBoundedPayloadString(entry.payload, "turnId", "turn_id"),
  );
  return {
    signature: buildClientErrorLogSignature(entry),
    reasonCode: getSafeClientStderrReasonCode(entry),
    count: 1,
    firstSeen: occurredAt,
    lastSeen: occurredAt,
    maxRawMessageLength: readRawMessageLength(entry.payload),
    workspaceIds,
    threadIds,
    turnIds,
    scopeCountsCapped: false,
  };
}

function updatePendingStderrAggregate(
  aggregate: PendingStderrAggregate,
  entry: DebugEntry,
): void {
  const occurredAt = normalizeEventTimestamp(entry.timestamp);
  aggregate.count += 1;
  aggregate.firstSeen = Math.min(aggregate.firstSeen, occurredAt);
  aggregate.lastSeen = Math.max(aggregate.lastSeen, occurredAt);
  aggregate.maxRawMessageLength = Math.max(
    aggregate.maxRawMessageLength,
    readRawMessageLength(entry.payload),
  );
  const workspaceCountCapped = addBoundedScopeId(
    aggregate.workspaceIds,
    readBoundedPayloadString(entry.payload, "workspaceId", "workspace_id"),
  );
  const threadCountCapped = addBoundedScopeId(
    aggregate.threadIds,
    readBoundedPayloadString(entry.payload, "threadId", "thread_id"),
  );
  const turnCountCapped = addBoundedScopeId(
    aggregate.turnIds,
    readBoundedPayloadString(entry.payload, "turnId", "turn_id"),
  );
  aggregate.scopeCountsCapped =
    workspaceCountCapped ||
    threadCountCapped ||
    turnCountCapped ||
    aggregate.scopeCountsCapped;
}

function singleScopeId(values: Set<string>): string | undefined {
  return values.size === 1 ? values.values().next().value : undefined;
}

function buildStderrAggregateDebugEntry(
  aggregate: PendingStderrAggregate,
): DebugEntry {
  return {
    id: `stderr-aggregate-${aggregate.lastSeen}`,
    timestamp: aggregate.lastSeen,
    source: "stderr",
    label: STDERR_AGGREGATE_LABEL,
    payload: {
      signature: aggregate.signature,
      reasonCode: aggregate.reasonCode,
      count: aggregate.count,
      firstSeen: new Date(aggregate.firstSeen).toISOString(),
      lastSeen: new Date(aggregate.lastSeen).toISOString(),
      workspaceCount: aggregate.workspaceIds.size,
      threadCount: aggregate.threadIds.size,
      turnCount: aggregate.turnIds.size,
      ...(singleScopeId(aggregate.workspaceIds)
        ? { workspaceId: singleScopeId(aggregate.workspaceIds) }
        : {}),
      ...(singleScopeId(aggregate.threadIds)
        ? { threadId: singleScopeId(aggregate.threadIds) }
        : {}),
      ...(singleScopeId(aggregate.turnIds)
        ? { turnId: singleScopeId(aggregate.turnIds) }
        : {}),
      redactedText: true,
      rawMessageLength: aggregate.maxRawMessageLength,
      scopeCountsCapped: aggregate.scopeCountsCapped,
    },
  };
}

export function normalizeThreadSessionLogPayload(payload: unknown): unknown {
  if (payload == null) {
    return payload;
  }
  if (typeof payload === "string") {
    return payload.length > TRUNCATED_PAYLOAD_PREVIEW_CHARS
      ? `${payload.slice(0, TRUNCATED_PAYLOAD_PREVIEW_CHARS)}...(truncated)`
      : payload;
  }
  if (typeof payload !== "object") {
    return payload;
  }
  try {
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== "string") {
      return String(payload);
    }
    if (serialized.length > MAX_THREAD_SESSION_LOG_PAYLOAD_CHARS) {
      return `${serialized.slice(0, TRUNCATED_PAYLOAD_PREVIEW_CHARS)}...(truncated ${serialized.length} chars)`;
    }
    return JSON.parse(serialized);
  } catch {
    return String(payload);
  }
}

function shouldMirrorThreadSessionLog(entry: DebugEntry): boolean {
  const label = entry.label.toLowerCase();
  return (
    label.startsWith("thread/session:") ||
    label.startsWith("thread/history") ||
    label.startsWith("thread/list") ||
    label.startsWith("workspace/reconnect") ||
    label.startsWith("reasoning/raw:") ||
    label === "item/started" ||
    label === "item/updated" ||
    label === "item/completed"
  );
}

/** 高频/巨型 payload 的 label 黑名单：新增条目拒绝，startup maintenance 用同一判定清理存量。 */
export function isBlockedThreadSessionLogLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    normalized === "thread/session:turn-diagnostic:codex-no-progress-watchdog-scheduled" ||
    // reasoning per-delta：流式期间逐条落盘（实测单会话 323 条），turn 级聚合
    // 由 realtime.turnTrace.summary 承担。
    normalized === "thread/session:reasoning-text-delta" ||
    normalized === "thread/session:reasoning-summary-delta" ||
    normalized === "thread/list" ||
    normalized === "thread/list response" ||
    normalized === "thread/list older" ||
    normalized === "thread/list older response"
  );
}

function shouldPersistThreadSessionLogEntry(entry: DebugEntry): boolean {
  if (isBlockedThreadSessionLogLabel(entry.label)) {
    return false;
  }
  return shouldMirrorThreadSessionLog(entry);
}

function appendDebugEntryToList(
  prev: DebugEntry[],
  entry: DebugEntry,
  nextCounter: () => number,
): DebugEntry[] {
  const trimmedId = entry.id.trim();
  const baseId =
    trimmedId.length > 0
      ? trimmedId
      : `debug-${entry.timestamp}-${nextCounter()}`;

  let resolvedId = baseId;
  while (prev.some((existing) => existing.id === resolvedId)) {
    resolvedId = `${baseId}-${nextCounter()}`;
  }

  const nextEntry =
    resolvedId === entry.id ? entry : { ...entry, id: resolvedId };

  return [...prev, nextEntry].slice(-MAX_DEBUG_ENTRIES);
}

export function useDebugLog() {
  const [debugOpen, setDebugOpenState] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [hasDebugAlerts, setHasDebugAlerts] = useState(false);
  const [debugPinned, setDebugPinned] = useState(false);
  const debugEntryIdCounterRef = useRef(0);
  const threadSessionLogCacheRef = useRef<ThreadSessionLogEntry[] | null>(null);
  // 面板关闭期间日志只进内存缓冲，不写 React state。本 hook 挂在 AppShell 根，
  // setDebugEntries 是数组追加型 setState（必换引用、无法做 same-value 守卫），
  // 对话/Agent 期间每条引擎日志都会触发一次 100ms+ 的根渲染。打开面板时缓冲
  // 一次性灌入；磁盘侧 threadSessionLog / clientErrorLog 不受影响，始终完整。
  const debugOpenRef = useRef(false);
  const pendingDebugEntriesRef = useRef<DebugEntry[]>([]);
  const pendingStderrAggregatesRef = useRef<
    Map<string, PendingStderrAggregate>
  >(new Map());
  const stderrAggregationTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const nextDebugEntryCounter = useCallback(
    () => debugEntryIdCounterRef.current++,
    [],
  );

  const persistClientErrorEntry = useCallback((entry: DebugEntry) => {
    void appendClientErrorLog(buildClientErrorLogEntry(entry)).catch(() => {
      // 错误日志本身是 best-effort 通道，失败不能递归制造新的 DebugEntry。
    });
  }, []);
  const knownSafeStderrBudgetRef = useRef(createKnownSafeStderrDailyBudget());
  const persistStderrAggregate = useCallback(
    (aggregate: PendingStderrAggregate) => {
      if (
        !knownSafeStderrBudgetRef.current.consume(
          aggregate.reasonCode,
          aggregate.count,
        )
      ) {
        return;
      }
      persistClientErrorEntry(buildStderrAggregateDebugEntry(aggregate));
    },
    [persistClientErrorEntry],
  );

  const flushPendingStderrAggregates = useCallback(() => {
    if (stderrAggregationTimerRef.current !== null) {
      clearTimeout(stderrAggregationTimerRef.current);
      stderrAggregationTimerRef.current = null;
    }
    const pending = pendingStderrAggregatesRef.current;
    if (pending.size === 0) {
      return;
    }
    pendingStderrAggregatesRef.current = new Map();
    for (const aggregate of pending.values()) {
      persistStderrAggregate(aggregate);
    }
  }, [persistStderrAggregate]);

  const queueStderrAggregate = useCallback(
    (entry: DebugEntry) => {
      const signature = buildClientErrorLogSignature(entry);
      const pending = pendingStderrAggregatesRef.current;
      const existing = pending.get(signature);
      if (existing) {
        updatePendingStderrAggregate(existing, entry);
      } else {
        if (pending.size >= MAX_PENDING_STDERR_SIGNATURES) {
          const oldest = pending.values().next().value;
          if (oldest) {
            pending.delete(oldest.signature);
            persistStderrAggregate(oldest);
          }
        }
        pending.set(signature, createPendingStderrAggregate(entry));
      }
      if (stderrAggregationTimerRef.current === null) {
        stderrAggregationTimerRef.current = setTimeout(
          flushPendingStderrAggregates,
          STDERR_AGGREGATION_WINDOW_MS,
        );
      }
    },
    [flushPendingStderrAggregates, persistStderrAggregate],
  );

  const flushPendingDebugEntries = useCallback(() => {
    const pending = pendingDebugEntriesRef.current;
    if (pending.length === 0) {
      return;
    }
    pendingDebugEntriesRef.current = [];
    setDebugEntries((prev) => {
      let next = prev;
      for (const entry of pending) {
        next = appendDebugEntryToList(next, entry, nextDebugEntryCounter);
      }
      return next;
    });
  }, [nextDebugEntryCounter]);

  useEffect(() => {
    debugOpenRef.current = debugOpen;
    if (debugOpen) {
      flushPendingDebugEntries();
    }
  }, [debugOpen, flushPendingDebugEntries]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      typeof window.addEventListener !== "function" ||
      typeof document.addEventListener !== "function"
    ) {
      return () => {
        flushPendingStderrAggregates();
      };
    }
    const handlePageHide = () => {
      flushPendingStderrAggregates();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingStderrAggregates();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingStderrAggregates();
    };
  }, [flushPendingStderrAggregates]);

  const shouldLogEntry = useCallback((entry: DebugEntry) => {
    if (entry.source === "error" || entry.source === "stderr") {
      return true;
    }
    const label = entry.label.toLowerCase();
    if (label === "stderr/raw") {
      return true;
    }
    if (label.startsWith("thread/title")) {
      return true;
    }
    if (label.startsWith("thread/session:")) {
      return true;
    }
    if (label.startsWith("reasoning/raw:")) {
      return true;
    }
    if (label.includes("turn/start")) {
      return true;
    }
    if (label.includes("warn") || label.includes("warning")) {
      return true;
    }
    if (typeof entry.payload === "string") {
      const payload = entry.payload.toLowerCase();
      return payload.includes("warn") || payload.includes("warning");
    }
    return false;
  }, []);

  const addDebugEntry = useCallback(
    (entry: DebugEntry) => {
      if (shouldPersistThreadSessionLogEntry(entry)) {
        const cachedLogs =
          threadSessionLogCacheRef.current ??
          (getClientStoreSync<ThreadSessionLogEntry[]>(
            THREAD_SESSION_LOG_STORE,
            THREAD_SESSION_LOG_KEY,
          ) ??
            getClientStoreSync<ThreadSessionLogEntry[]>(
              LEGACY_THREAD_SESSION_LOG_STORE,
              THREAD_SESSION_LOG_KEY,
            ) ??
            []);
        const nextEntry: ThreadSessionLogEntry = {
          timestamp: entry.timestamp,
          source: entry.source,
          label: entry.label,
          payload: normalizeThreadSessionLogPayload(entry.payload),
        };
        const nextLogs = [...cachedLogs, nextEntry].slice(
          -MAX_THREAD_SESSION_LOG_ENTRIES,
        );
        threadSessionLogCacheRef.current = nextLogs;
        writeClientStoreValue(THREAD_SESSION_LOG_STORE, THREAD_SESSION_LOG_KEY, nextLogs);
      }

      if (shouldPersistClientErrorLogEntry(entry)) {
        if (entry.source === "stderr") {
          queueStderrAggregate(entry);
        } else {
          persistClientErrorEntry(entry);
        }
      }

      if (!shouldLogEntry(entry)) {
        return;
      }
      // setHasDebugAlerts(true) 在已为 true 时会被 React same-value bailout，
      // 最多只引发一次根渲染，保留它以维持「有告警」红点提示。
      setHasDebugAlerts(true);
      if (!debugOpenRef.current) {
        const pending = pendingDebugEntriesRef.current;
        pending.push(entry);
        if (pending.length > MAX_DEBUG_ENTRIES) {
          pending.splice(0, pending.length - MAX_DEBUG_ENTRIES);
        }
        return;
      }
      setDebugEntries((prev) =>
        appendDebugEntryToList(prev, entry, nextDebugEntryCounter),
      );
    },
    [
      nextDebugEntryCounter,
      persistClientErrorEntry,
      queueStderrAggregate,
      shouldLogEntry,
    ],
  );

  const handleCopyDebug = useCallback(async () => {
    const text = debugEntries
      .map((entry) => {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const payload =
          entry.payload !== undefined
            ? typeof entry.payload === "string"
              ? entry.payload
              : JSON.stringify(entry.payload, null, 2)
            : "";
        return [entry.source.toUpperCase(), timestamp, entry.label, payload]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    if (text) {
      await copyTextToClipboard(text);
    }
  }, [debugEntries]);

  const clearDebugEntries = useCallback(() => {
    pendingDebugEntriesRef.current = [];
    setDebugEntries([]);
    setHasDebugAlerts(false);
  }, []);

  const setDebugOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setDebugOpenState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        if (resolved) {
          setDebugPinned(true);
        }
        return resolved;
      });
    },
    [],
  );

  const showDebugButton = debugOpen || debugPinned;

  return {
    debugOpen,
    setDebugOpen,
    debugEntries,
    hasDebugAlerts,
    showDebugButton,
    addDebugEntry,
    handleCopyDebug,
    clearDebugEntries,
  };
}
