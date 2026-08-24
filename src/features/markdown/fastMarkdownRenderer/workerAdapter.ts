import {
  compileFastMarkdown,
  finalizeFastMarkdownArtifact,
  getCachedFastMarkdownResult,
} from "./compile";
import { createFastMarkdownCompileIdentity } from "./compileCore";
import { workerDiagnostics } from "./workerAdapterDiagnostics";
import { hashStableString } from "../../files/utils/fileMarkdownDocument";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import type {
  CompileFastMarkdownArgs,
  FastMarkdownRenderResult,
  FastMarkdownUnsafeArtifact,
  FastMarkdownWorkerRequestMeta,
  FastMarkdownWorkerDiagnostics,
} from "./types";

type FastMarkdownWorkerResponse =
  | {
      type: "fast-markdown-result";
      requestId: string;
      result: FastMarkdownUnsafeArtifact;
    }
  | {
      type: "fast-markdown-error";
      requestId: string;
      error: {
        name: string;
        message: string;
      };
    };

type PendingWorkerRequest = {
  expectedCacheKey: string;
  expectedRendererProfile: CompileFastMarkdownArgs["rendererProfile"];
  resolve: (result: FastMarkdownUnsafeArtifact) => void;
  reject: (error: Error) => void;
  requestMeta: FastMarkdownWorkerRequestMeta;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

type CompileFastMarkdownWorkerOptions = {
  shouldAcceptWorkerArtifact?: () => boolean;
};

export type PrecomputeFastMarkdownWorkerOptions = {
  timeoutMs?: number;
};

let sharedWorker: Worker | null = null;
let listenersAttached = false;
let nextRequestOrdinal = 1;
const persistedWorkerFailureAtByReason = new Map<string, number>();
const WORKER_FAILURE_PERSIST_INTERVAL_MS = 60_000;
const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 15_000;
const MAX_WORKER_REQUEST_TIMEOUT_MS = 60_000;

const pendingRequests = new Map<string, PendingWorkerRequest>();

export async function compileFastMarkdownWithWorkerFallback(
  args: CompileFastMarkdownArgs,
  options: CompileFastMarkdownWorkerOptions = {},
): Promise<FastMarkdownRenderResult> {
  const cached = getCachedFastMarkdownResult(args);
  if (cached) {
    throwIfWorkerRequestIsStale(options);
    return cached;
  }
  let workerArtifact: FastMarkdownUnsafeArtifact | null = null;
  try {
    workerArtifact = await precomputeFastMarkdownInWorker(args);
  } catch (error: unknown) {
    throwIfWorkerRequestIsStale(options);
    reportWorkerFallback(error);
    workerDiagnostics.recordFallback("worker-request-failed");
    return compileFastMarkdown(args);
  }
  throwIfWorkerRequestIsStale(options);
  if (workerArtifact) {
    return finalizeFastMarkdownArtifact(workerArtifact);
  }
  workerDiagnostics.recordFallback("worker-not-available");
  return compileFastMarkdown(args);
}

export function compileFastMarkdownInWorker(
  args: CompileFastMarkdownArgs,
  options: PrecomputeFastMarkdownWorkerOptions = {},
): Promise<FastMarkdownRenderResult> | null {
  const artifactPromise = precomputeFastMarkdownInWorker(args, options);
  return artifactPromise?.then(finalizeFastMarkdownArtifact) ?? null;
}

export function precomputeFastMarkdownInWorker(
  args: CompileFastMarkdownArgs,
  options: PrecomputeFastMarkdownWorkerOptions = {},
): Promise<FastMarkdownUnsafeArtifact> | null {
  const worker = getSharedWorker();
  if (!worker) {
    workerDiagnostics.setHasWorker(false);
    return null;
  }

  const requestId = createRequestId(args.documentKey);
  const compileIdentity = createFastMarkdownCompileIdentity(args);
  const requestMeta = createWorkerRequestMeta(
    requestId,
    args,
    compileIdentity.contentHash,
  );
  workerDiagnostics.setPendingCount(pendingRequests.size + 1);
  return new Promise<FastMarkdownUnsafeArtifact>((resolve, reject) => {
    pendingRequests.set(requestId, {
      expectedCacheKey: compileIdentity.cacheKey,
      expectedRendererProfile: args.rendererProfile,
      resolve,
      reject,
      requestMeta,
      timeoutId: null,
    });
    const requestTimeoutMs = normalizeWorkerRequestTimeoutMs(options.timeoutMs);
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pending.timeoutId = setTimeout(() => {
        const timedOut = takePendingWorkerRequest(requestId);
        if (!timedOut) {
          return;
        }
        workerDiagnostics.recordFallback("worker-request-timeout");
        persistWorkerFailureDiagnostic("worker-request-timeout");
        timedOut.reject(new Error("fast-markdown-worker-request-timeout"));
      }, requestTimeoutMs);
    }
    try {
      worker.postMessage({
        type: "compile-fast-markdown",
        requestId,
        requestMeta,
        args,
      });
    } catch (error: unknown) {
      const failed = takePendingWorkerRequest(requestId);
      workerDiagnostics.recordPostMessageFailure();
      workerDiagnostics.recordFallback("worker-post-message-failed");
      persistWorkerFailureDiagnostic("worker-post-message-failed");
      failed?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function getFastMarkdownWorkerDiagnostics(): FastMarkdownWorkerDiagnostics {
  return workerDiagnostics.snapshot();
}

export function resetFastMarkdownWorkerDiagnostics(): void {
  workerDiagnostics.reset();
  workerDiagnostics.setPendingCount(pendingRequests.size);
  persistedWorkerFailureAtByReason.clear();
}

export function disposeFastMarkdownWorker() {
  if (sharedWorker) {
    sharedWorker.terminate();
  }
  sharedWorker = null;
  listenersAttached = false;
  rejectAllPendingRequests(new Error("Fast Markdown worker disposed"));
  workerDiagnostics.recordDispose();
  workerDiagnostics.setHasWorker(false);
}

function getSharedWorker(): Worker | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(
        new URL("./fastMarkdown.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      workerDiagnostics.setHasWorker(true);
    } catch {
      sharedWorker = null;
      workerDiagnostics.setHasWorker(false);
      workerDiagnostics.recordFallback("worker-creation-failed");
      persistWorkerFailureDiagnostic("worker-creation-failed");
      return null;
    }
  }
  attachWorkerListeners(sharedWorker);
  return sharedWorker;
}

function attachWorkerListeners(worker: Worker) {
  if (listenersAttached) {
    return;
  }
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", handleWorkerError);
  listenersAttached = true;
}

function handleWorkerMessage(event: MessageEvent<unknown>) {
  const message = event.data;
  if (!isWorkerResponse(message)) {
    workerDiagnostics.recordUnknownResponse();
    const requestId =
      isRecord(message) && typeof message.requestId === "string"
        ? message.requestId
        : null;
    const pending = requestId ? takePendingWorkerRequest(requestId) : null;
    if (pending) {
      workerDiagnostics.recordFallback("worker-invalid-response");
      persistWorkerFailureDiagnostic("worker-invalid-response");
      pending.reject(
        new Error("Fast Markdown worker returned an invalid response"),
      );
    }
    return;
  }

  const pending = takePendingWorkerRequest(message.requestId);
  if (!pending) {
    workerDiagnostics.recordUnknownResponse();
    return;
  }

  if (message.type === "fast-markdown-error") {
    workerDiagnostics.recordFallback("worker-compile-error");
    persistWorkerFailureDiagnostic("worker-compile-error");
    pending.reject(createWorkerError(message.error));
    return;
  }
  if (!matchesPendingWorkerRequestIdentity(message.result, pending)) {
    workerDiagnostics.recordFallback("worker-identity-mismatch");
    persistWorkerFailureDiagnostic("worker-identity-mismatch");
    pending.reject(
      new Error("Fast Markdown worker returned mismatched request identity"),
    );
    return;
  }
  pending.resolve(message.result);
}

export function classifyFastMarkdownWorkerRuntimeError(
  message: string | null | undefined,
): string {
  const text = (message ?? "").trim().toLowerCase();
  if (!text || text === "script error." || text === "script error") {
    return "script-error";
  }
  if (text.includes("out of memory") || /\boom\b/.test(text)) {
    return "out-of-memory";
  }
  if (
    text.includes("failed to fetch") ||
    text.includes("failed to load") ||
    text.includes("loading chunk") ||
    text.includes("networkerror") ||
    text.includes("network error")
  ) {
    return "worker-load-failed";
  }
  return "worker-uncaught";
}

function handleWorkerError(event: ErrorEvent) {
  const message = event.message || "Fast Markdown worker failed";
  disposeBrokenWorker(new Error(message));
}

function disposeBrokenWorker(error: Error) {
  if (sharedWorker) {
    sharedWorker.terminate();
  }
  sharedWorker = null;
  listenersAttached = false;
  rejectAllPendingRequests(error);
  workerDiagnostics.recordFallback("worker-disposed-after-error");
  workerDiagnostics.setHasWorker(false);
  persistWorkerFailureDiagnostic(
    "worker-runtime-error",
    classifyFastMarkdownWorkerRuntimeError(error.message),
  );
}

function rejectAllPendingRequests(error: Error) {
  for (const pending of pendingRequests.values()) {
    clearPendingWorkerRequestTimeout(pending);
    pending.reject(error);
  }
  pendingRequests.clear();
  workerDiagnostics.setPendingCount(0);
}

function normalizeWorkerRequestTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WORKER_REQUEST_TIMEOUT_MS;
  }
  return Math.min(
    MAX_WORKER_REQUEST_TIMEOUT_MS,
    Math.max(1, Math.round(value)),
  );
}

function clearPendingWorkerRequestTimeout(pending: PendingWorkerRequest): void {
  if (pending.timeoutId !== null) {
    clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }
}

function takePendingWorkerRequest(
  requestId: string,
): PendingWorkerRequest | null {
  const pending = pendingRequests.get(requestId) ?? null;
  if (!pending) {
    return null;
  }
  pendingRequests.delete(requestId);
  clearPendingWorkerRequestTimeout(pending);
  workerDiagnostics.setPendingCount(pendingRequests.size);
  return pending;
}

function createRequestId(documentKey: string) {
  const ordinal = nextRequestOrdinal;
  nextRequestOrdinal += 1;
  return `${documentKey}:${ordinal}`;
}

function createWorkerRequestMeta(
  requestId: string,
  args: CompileFastMarkdownArgs,
  contentHash: string,
): FastMarkdownWorkerRequestMeta {
  return {
    requestId,
    documentKey: args.documentKey,
    contentHash,
    optionsHash: hashStableString(
      JSON.stringify({
        rendererProfile: args.rendererProfile,
        featureFlags: args.featureFlags ?? null,
        options: args.options ?? null,
        bodyStartLine: args.bodyStartLine ?? null,
      }),
    ),
    schemaVersion: "fast-markdown-worker-v1",
    createdAtMs: Date.now(),
  };
}

function matchesPendingWorkerRequestIdentity(
  artifact: FastMarkdownUnsafeArtifact,
  pending: PendingWorkerRequest,
): boolean {
  return (
    artifact.cacheKey === pending.expectedCacheKey &&
    artifact.contentHash === pending.requestMeta.contentHash &&
    artifact.rendererProfile === pending.expectedRendererProfile &&
    artifact.diagnostics.cacheKey === artifact.cacheKey &&
    artifact.diagnostics.contentHash === artifact.contentHash &&
    artifact.diagnostics.profile === artifact.rendererProfile
  );
}

function isWorkerResponse(value: unknown): value is FastMarkdownWorkerResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.type !== "fast-markdown-result" &&
    value.type !== "fast-markdown-error"
  ) {
    return false;
  }
  if (typeof value.requestId !== "string") {
    return false;
  }
  if (value.type === "fast-markdown-result") {
    return isFastMarkdownUnsafeArtifact(value.result);
  }
  return isRecord(value.error) && typeof value.error.message === "string";
}

function isFastMarkdownUnsafeArtifact(
  value: unknown,
): value is FastMarkdownUnsafeArtifact {
  if (!isRecord(value) || !isRecord(value.diagnostics)) {
    return false;
  }
  return (
    value.sanitization === "main-thread-required" &&
    typeof value.cacheKey === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.unsafeHtml === "string" &&
    typeof value.rendererProfile === "string" &&
    Array.isArray(value.outline) &&
    Array.isArray(value.sourceLineAnchors) &&
    Array.isArray(value.heavyBlocks) &&
    typeof value.diagnostics.fallbackReason === "string"
  );
}

function createWorkerError(error: { name: string; message: string }) {
  const workerError = new Error(
    error.message || "Fast Markdown worker compile failed",
  );
  workerError.name = error.name || "Error";
  return workerError;
}

function reportWorkerFallback(error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  console.warn(
    "[file-markdown-preview] Fast Markdown worker failed; falling back to main-thread compile.",
    normalized,
  );
}

function throwIfWorkerRequestIsStale(
  options: CompileFastMarkdownWorkerOptions,
): void {
  if (options.shouldAcceptWorkerArtifact?.() !== false) {
    return;
  }
  workerDiagnostics.recordStaleDrop();
  throw new Error("fast-markdown-worker-result-stale");
}

function persistWorkerFailureDiagnostic(
  reasonCode: string,
  errorClass?: string,
) {
  const now = Date.now();
  const previousAt = persistedWorkerFailureAtByReason.get(reasonCode);
  if (
    typeof previousAt === "number" &&
    now - previousAt < WORKER_FAILURE_PERSIST_INTERVAL_MS
  ) {
    return;
  }
  persistedWorkerFailureAtByReason.set(reasonCode, now);
  const snapshot = workerDiagnostics.snapshot();
  appendRendererDiagnostic("fast-markdown-worker/failed", {
    reasonCode,
    errorClass: errorClass ?? reasonCode,
    fallbackCount: snapshot.fallbackCount,
    pendingRequestCount: snapshot.pendingRequestCount,
    postMessageFailureCount: snapshot.postMessageFailureCount,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
