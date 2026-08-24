import type { DebugEntry } from "../../../types";

const SCHEMA_VERSION = 1;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 1000;
const TEXT_SUMMARY_KEY_PATTERN =
  /(prompt|content|text|output|stdout|stderr|raw|delta|messageBody|error|message|detail|diagnosticMessage)/i;
const SECRET_KEY_PATTERN =
  /(token|password|secret|apiKey|api_key|authorization|cookie|credential)/i;
export const CODEX_MODEL_REFRESH_TIMEOUT_REASON_CODE =
  "codex-model-refresh-child-exit-timeout";
export const UNCLASSIFIED_STDERR_REASON_CODE = "unclassified-stderr";
export const KNOWN_SAFE_STDERR_SUMMARY_EVERY = 100;
const SAFE_STDERR_REASON_CODES = new Set([
  CODEX_MODEL_REFRESH_TIMEOUT_REASON_CODE,
  UNCLASSIFIED_STDERR_REASON_CODE,
]);

export type ClientErrorLogEntry = {
  schemaVersion: number;
  timestamp: string;
  source: DebugEntry["source"];
  label: string;
  payload?: unknown;
};

export type ClientStderrClassification = {
  reasonCode:
    | typeof CODEX_MODEL_REFRESH_TIMEOUT_REASON_CODE
    | typeof UNCLASSIFIED_STDERR_REASON_CODE;
  redactedText: true;
  rawMessageLength: number;
};

export function shouldPersistClientErrorLogEntry(entry: DebugEntry): boolean {
  if (entry.label.trim().toLowerCase() === "stderr/raw") {
    return false;
  }
  if (entry.source === "error" || entry.source === "stderr") {
    return true;
  }

  const label = entry.label.toLowerCase();
  if (label === "thread/session:turn-settlement:rejected") {
    return true;
  }

  if (!label.startsWith("thread/session:turn-diagnostic:")) {
    return false;
  }

  if (label.includes("three-evidence-dry-run")) {
    const payload = entry.payload;
    if (!payload || typeof payload !== "object") {
      return false;
    }
    const dryRunDecision = (payload as Record<string, unknown>).dryRunDecision;
    return (
      dryRunDecision === "wouldReject" ||
      dryRunDecision === "wouldDefer" ||
      dryRunDecision === "wouldRequestReconciliation" ||
      dryRunDecision === "wouldCleanupResidue"
    );
  }

  return (
    label.includes("terminal-settlement-rejected") ||
    label.includes("terminal-settlement-busy-residue") ||
    label.includes("codex-no-progress-watchdog-fired") ||
    label.includes("codex-no-progress-watchdog-skipped") ||
    label.includes("codex-no-progress-suspected") ||
    label.includes("three-evidence-reconciliation-query-requested") ||
    label.includes("three-evidence-reconciliation-query-skipped") ||
    label.includes("three-evidence-reconciliation-query-resolved") ||
    label.includes("three-evidence-reconciliation-query-rejected") ||
    label.includes("three-evidence-reconciliation-query-failed") ||
    label.includes("three-evidence-reconciliation-cleanup-applied") ||
    label.includes("three-evidence-reconciliation-cleanup-skipped")
  );
}

export function shouldPersistKnownSafeStderrAggregate(input: {
  reasonCode: string;
  rawCountTodayBefore: number;
  incomingCount: number;
}): boolean {
  if (input.reasonCode !== CODEX_MODEL_REFRESH_TIMEOUT_REASON_CODE) {
    return true;
  }
  const incoming = Math.max(0, input.incomingCount);
  if (incoming === 0) {
    return false;
  }
  const before = Math.max(0, input.rawCountTodayBefore);
  if (before === 0) {
    return true;
  }
  return (
    Math.floor((before + incoming) / KNOWN_SAFE_STDERR_SUMMARY_EVERY) >
    Math.floor(before / KNOWN_SAFE_STDERR_SUMMARY_EVERY)
  );
}

function formatLocalDayKey(nowMs: number): string {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createKnownSafeStderrDailyBudget(
  now: () => number = Date.now,
) {
  let dayKey = "";
  const rawCountByReason = new Map<string, number>();

  const resolveDay = () => {
    const nextKey = formatLocalDayKey(now());
    if (nextKey !== dayKey) {
      dayKey = nextKey;
      rawCountByReason.clear();
    }
  };

  return {
    consume(reasonCode: string, incomingCount: number): boolean {
      resolveDay();
      const before = rawCountByReason.get(reasonCode) ?? 0;
      const shouldPersist = shouldPersistKnownSafeStderrAggregate({
        reasonCode,
        rawCountTodayBefore: before,
        incomingCount,
      });
      rawCountByReason.set(reasonCode, before + Math.max(0, incomingCount));
      return shouldPersist;
    },
  };
}

export function classifyClientStderr(
  rawMessage: string,
): ClientStderrClassification {
  const normalized = rawMessage.toLowerCase();
  const isKnownModelRefreshTimeout =
    normalized.includes("codex_models_manager") &&
    normalized.includes("refresh") &&
    normalized.includes("child") &&
    (normalized.includes("timed out") || normalized.includes("timeout"));
  return {
    reasonCode: isKnownModelRefreshTimeout
      ? CODEX_MODEL_REFRESH_TIMEOUT_REASON_CODE
      : UNCLASSIFIED_STDERR_REASON_CODE,
    redactedText: true,
    rawMessageLength: rawMessage.length,
  };
}

export function getSafeClientStderrReasonCode(entry: DebugEntry): string {
  if (!entry.payload || typeof entry.payload !== "object") {
    return UNCLASSIFIED_STDERR_REASON_CODE;
  }
  const reasonCode = (entry.payload as Record<string, unknown>).reasonCode;
  return typeof reasonCode === "string" &&
    SAFE_STDERR_REASON_CODES.has(reasonCode)
    ? reasonCode
    : UNCLASSIFIED_STDERR_REASON_CODE;
}

export function buildClientErrorLogSignature(entry: DebugEntry): string {
  const safeLabel =
    entry.label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:/-]+/g, "-")
      .slice(0, 120) || "stderr";
  return [entry.source, safeLabel, getSafeClientStderrReasonCode(entry)].join(
    "|",
  );
}

export function buildClientErrorLogEntry(entry: DebugEntry): ClientErrorLogEntry {
  const entryDate = new Date(entry.timestamp);
  const timestamp =
    Number.isFinite(entry.timestamp) && Number.isFinite(entryDate.getTime())
      ? entryDate.toISOString()
      : new Date().toISOString();

  return {
    schemaVersion: SCHEMA_VERSION,
    timestamp,
    source: entry.source,
    label: truncateString(entry.label, 240),
    ...(entry.payload !== undefined
      ? { payload: sanitizePayload(entry.payload, 0, null, true) }
      : {}),
  };
}

function sanitizePayload(
  value: unknown,
  depth: number,
  key: string | null,
  isRoot = false,
  redactNestedText = false,
): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  const shouldRedactText =
    redactNestedText || Boolean(key && TEXT_SUMMARY_KEY_PATTERN.test(key));
  if (typeof value === "string") {
    if (isRoot || shouldRedactText) {
      return { redactedText: true, length: value.length };
    }
    return truncateString(value, MAX_STRING_LENGTH);
  }

  if (value == null || typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return { truncated: true, reason: "max-depth" };
  }

  if (Array.isArray(value)) {
    const redactArrayText = shouldRedactText || isRoot;
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) =>
        sanitizePayload(item, depth + 1, null, false, redactArrayText),
      );
    if (value.length <= MAX_ARRAY_ITEMS) {
      return items;
    }
    return [
      ...items,
      {
        truncated: true,
        omittedItems: value.length - MAX_ARRAY_ITEMS,
      },
    ];
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = sanitizePayload(
      childValue,
      depth + 1,
      childKey,
      false,
      shouldRedactText,
    );
  }
  return output;
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...(truncated)`;
}
