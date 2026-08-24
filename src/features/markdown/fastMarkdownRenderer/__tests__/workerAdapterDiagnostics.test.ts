// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyFastMarkdownWorkerRuntimeError,
  compileFastMarkdownInWorker,
  compileFastMarkdownWithWorkerFallback,
  disposeFastMarkdownWorker,
  getFastMarkdownWorkerDiagnostics,
  precomputeFastMarkdownInWorker,
  resetFastMarkdownWorkerDiagnostics,
} from "../workerAdapter";
import { compileFastMarkdown } from "../compile";
import { createFastMarkdownCompileIdentity } from "../compileCore";
import {
  clearFastMarkdownRenderCache,
  getFastMarkdownRenderCacheSize,
} from "../cache";
import {
  clearRendererDiagnostics,
  exportRendererDiagnostics,
} from "../../../../services/rendererDiagnostics";
import type {
  CompileFastMarkdownArgs,
  FastMarkdownUnsafeArtifact,
  FastMarkdownWorkerRequestMeta,
} from "../types";

const baseArgs: CompileFastMarkdownArgs = {
  documentKey: "diagnostics-doc",
  rawMarkdown: "# Heading",
  rendererProfile: "fast-html",
  featureFlags: { fastHtmlRendererEnabled: true },
};

describe("fastMarkdownRenderer worker adapter diagnostics", () => {
  beforeEach(() => {
    resetFastMarkdownWorkerDiagnostics();
    clearFastMarkdownRenderCache();
    clearRendererDiagnostics();
    FakeFastMarkdownWorker.postMessageCount = 0;
    FakeFastMarkdownWorker.mutateArtifact = null;
    FakeFastMarkdownWorker.responseError = false;
    FakeFastMarkdownWorker.suppressResponse = false;
  });

  afterEach(() => {
    disposeFastMarkdownWorker();
    clearFastMarkdownRenderCache();
    clearRendererDiagnostics();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("classifies worker runtime errors without retaining the raw message", () => {
    expect(classifyFastMarkdownWorkerRuntimeError("")).toBe("script-error");
    expect(classifyFastMarkdownWorkerRuntimeError("Script error.")).toBe(
      "script-error",
    );
    expect(classifyFastMarkdownWorkerRuntimeError("Uncaught RangeError: out of memory")).toBe(
      "out-of-memory",
    );
    expect(
      classifyFastMarkdownWorkerRuntimeError("Failed to fetch worker script"),
    ).toBe("worker-load-failed");
    expect(
      classifyFastMarkdownWorkerRuntimeError(
        "Cannot read properties of undefined (reading 'upload')",
      ),
    ).toBe("worker-uncaught");
    expect(classifyFastMarkdownWorkerRuntimeError("private source content")).toBe(
      "worker-uncaught",
    );
  });

  it("records a fallback when the worker is not available", async () => {
    // jsdom does not provide a Worker; compileFastMarkdownInWorker will
    // return null and the fallback path will run.
    await compileFastMarkdownWithWorkerFallback(baseArgs);
    const snapshot = getFastMarkdownWorkerDiagnostics();
    expect(snapshot.hasWorker).toBe(false);
    expect(snapshot.fallbackCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.lastFallbackReason).toBe("worker-not-available");
  });

  it("records a dispose and clears pending count", () => {
    disposeFastMarkdownWorker();
    const snapshot = getFastMarkdownWorkerDiagnostics();
    expect(snapshot.disposedCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.pendingRequestCount).toBe(0);
  });

  it("persists a bounded content-safe diagnostic when Worker creation fails", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("private source content must not persist");
        }
      },
    );

    await compileFastMarkdownWithWorkerFallback(baseArgs);

    const workerFailures = exportRendererDiagnostics().filter(
      (entry) => entry.label === "fast-markdown-worker/failed",
    );
    expect(workerFailures).toHaveLength(1);
    expect(workerFailures[0]?.payload).toMatchObject({
      reasonCode: "worker-creation-failed",
      fallbackCount: 1,
      pendingRequestCount: 0,
    });
    expect(JSON.stringify(workerFailures[0])).not.toContain(
      "private source content",
    );
  });

  it("sanitizes a successful unsafe worker artifact without recording fallback", async () => {
    vi.stubGlobal("Worker", FakeFastMarkdownWorker);

    const result = await compileFastMarkdownWithWorkerFallback(baseArgs);

    expect(result.html).toContain("<h1>Heading</h1>");
    expect(result.html).not.toMatch(/<script|onerror|javascript:/i);
    expect(getFastMarkdownWorkerDiagnostics().fallbackCount).toBe(0);
  });

  it("returns a trusted cache hit without repeating Worker compilation", async () => {
    const initialResult = await compileFastMarkdown(baseArgs);
    expect(initialResult.diagnostics.cacheState).toBe("miss");
    vi.stubGlobal("Worker", FakeFastMarkdownWorker);

    const cachedResult = await compileFastMarkdownWithWorkerFallback(baseArgs);

    expect(cachedResult.diagnostics.cacheState).toBe("hit");
    expect(cachedResult.html).toContain("<h1");
    expect(FakeFastMarkdownWorker.postMessageCount).toBe(0);
  });

  it("drops a stale trusted cache hit before returning it to the caller", async () => {
    await compileFastMarkdown(baseArgs);

    await expect(
      compileFastMarkdownWithWorkerFallback(baseArgs, {
        shouldAcceptWorkerArtifact: () => false,
      }),
    ).rejects.toThrow("fast-markdown-worker-result-stale");

    expect(FakeFastMarkdownWorker.postMessageCount).toBe(0);
    expect(getFastMarkdownWorkerDiagnostics().staleResultDropCount).toBe(1);
  });

  it("drops a stale worker artifact before final sanitization or caching", async () => {
    vi.stubGlobal("Worker", FakeFastMarkdownWorker);

    await expect(
      compileFastMarkdownWithWorkerFallback(baseArgs, {
        shouldAcceptWorkerArtifact: () => false,
      }),
    ).rejects.toThrow("fast-markdown-worker-result-stale");

    expect(getFastMarkdownRenderCacheSize()).toBe(0);
    expect(getFastMarkdownWorkerDiagnostics()).toMatchObject({
      fallbackCount: 0,
      staleResultDropCount: 1,
    });
  });

  it("does not enter main-thread fallback when an unavailable Worker request is stale", async () => {
    let shouldAcceptResult = true;
    const compilation = compileFastMarkdownWithWorkerFallback(baseArgs, {
      shouldAcceptWorkerArtifact: () => shouldAcceptResult,
    });
    shouldAcceptResult = false;

    await expect(compilation).rejects.toThrow(
      "fast-markdown-worker-result-stale",
    );

    expect(getFastMarkdownRenderCacheSize()).toBe(0);
    expect(getFastMarkdownWorkerDiagnostics()).toMatchObject({
      fallbackCount: 0,
      staleResultDropCount: 1,
    });
  });

  it("does not enter main-thread fallback when a rejected Worker request becomes stale", async () => {
    FakeFastMarkdownWorker.responseError = true;
    vi.stubGlobal("Worker", FakeFastMarkdownWorker);
    let shouldAcceptResult = true;
    const compilation = compileFastMarkdownWithWorkerFallback(baseArgs, {
      shouldAcceptWorkerArtifact: () => shouldAcceptResult,
    });
    shouldAcceptResult = false;

    await expect(compilation).rejects.toThrow(
      "fast-markdown-worker-result-stale",
    );

    expect(getFastMarkdownRenderCacheSize()).toBe(0);
    expect(getFastMarkdownWorkerDiagnostics()).toMatchObject({
      lastFallbackReason: "worker-compile-error",
      staleResultDropCount: 1,
    });
  });

  it("keeps main-thread fallback for an active rejected Worker request", async () => {
    FakeFastMarkdownWorker.responseError = true;
    vi.stubGlobal("Worker", FakeFastMarkdownWorker);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const result = await compileFastMarkdownWithWorkerFallback(baseArgs, {
      shouldAcceptWorkerArtifact: () => true,
    });

    expect(result.html).toContain("<h1");
    expect(getFastMarkdownRenderCacheSize()).toBe(1);
    expect(getFastMarkdownWorkerDiagnostics()).toMatchObject({
      lastFallbackReason: "worker-request-failed",
      staleResultDropCount: 0,
    });
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("does not enter main-thread fallback when a timed-out Worker request becomes stale", async () => {
    vi.useFakeTimers();
    FakeFastMarkdownWorker.suppressResponse = true;
    vi.stubGlobal("Worker", FakeFastMarkdownWorker);
    let shouldAcceptResult = true;
    const compilation = compileFastMarkdownWithWorkerFallback(baseArgs, {
      shouldAcceptWorkerArtifact: () => shouldAcceptResult,
    });
    shouldAcceptResult = false;
    const staleExpectation = expect(compilation).rejects.toThrow(
      "fast-markdown-worker-result-stale",
    );

    await vi.advanceTimersByTimeAsync(15_000);
    await staleExpectation;

    expect(getFastMarkdownRenderCacheSize()).toBe(0);
    expect(getFastMarkdownWorkerDiagnostics()).toMatchObject({
      pendingRequestCount: 0,
      lastFallbackReason: "worker-request-timeout",
      staleResultDropCount: 1,
    });
  });

  it("times out and removes a hung precompute request with reserved evidence", async () => {
    vi.useFakeTimers();
    FakeFastMarkdownWorker.suppressResponse = true;
    vi.stubGlobal("Worker", FakeFastMarkdownWorker);

    const workerResult = precomputeFastMarkdownInWorker(baseArgs, {
      timeoutMs: 25,
    });
    expect(workerResult).not.toBeNull();
    const timeoutExpectation = expect(workerResult).rejects.toThrow(
      "fast-markdown-worker-request-timeout",
    );
    await vi.advanceTimersByTimeAsync(25);

    await timeoutExpectation;
    expect(getFastMarkdownWorkerDiagnostics()).toMatchObject({
      pendingRequestCount: 0,
      fallbackCount: 1,
      lastFallbackReason: "worker-request-timeout",
    });
    const timeoutEvidence = exportRendererDiagnostics().filter(
      (entry) =>
        entry.label === "fast-markdown-worker/failed" &&
        entry.payload.reasonCode === "worker-request-timeout",
    );
    expect(timeoutEvidence).toHaveLength(1);
  });

  it.each([
    {
      name: "cache key",
      mutate: (artifact: FastMarkdownUnsafeArtifact) => ({
        ...artifact,
        cacheKey: "forged-cache-key",
      }),
    },
    {
      name: "content hash",
      mutate: (artifact: FastMarkdownUnsafeArtifact) => ({
        ...artifact,
        contentHash: "forged-content-hash",
      }),
    },
    {
      name: "renderer profile",
      mutate: (artifact: FastMarkdownUnsafeArtifact) => ({
        ...artifact,
        rendererProfile: "bounded-fast-html" as const,
      }),
    },
  ])(
    "rejects a mismatched Worker $name before finalization or caching",
    async ({ mutate }) => {
      FakeFastMarkdownWorker.mutateArtifact = mutate;
      vi.stubGlobal("Worker", FakeFastMarkdownWorker);

      const workerResult = compileFastMarkdownInWorker(baseArgs);
      expect(workerResult).not.toBeNull();
      await expect(workerResult).rejects.toThrow("mismatched request identity");

      expect(getFastMarkdownRenderCacheSize()).toBe(0);
    },
  );
});

type FakeWorkerRequest = {
  type: "compile-fast-markdown";
  requestId: string;
  requestMeta: FastMarkdownWorkerRequestMeta;
  args: CompileFastMarkdownArgs;
};

class FakeFastMarkdownWorker {
  static postMessageCount = 0;
  static responseError = false;
  static suppressResponse = false;
  static mutateArtifact:
    | ((artifact: FastMarkdownUnsafeArtifact) => FastMarkdownUnsafeArtifact)
    | null = null;
  private messageListener: ((event: MessageEvent<unknown>) => void) | null =
    null;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") {
      this.messageListener = listener as (event: MessageEvent<unknown>) => void;
    }
  }

  postMessage(value: unknown) {
    FakeFastMarkdownWorker.postMessageCount += 1;
    if (FakeFastMarkdownWorker.suppressResponse) {
      return;
    }
    const request = value as FakeWorkerRequest;
    const baseArtifact = createUnsafeArtifact(request);
    const artifact =
      FakeFastMarkdownWorker.mutateArtifact?.(baseArtifact) ?? baseArtifact;
    queueMicrotask(() => {
      this.messageListener?.({
        data: FakeFastMarkdownWorker.responseError
          ? {
              type: "fast-markdown-error",
              requestId: request.requestId,
              error: {
                name: "WorkerCompileError",
                message: "synthetic-worker-rejection",
              },
            }
          : {
              type: "fast-markdown-result",
              requestId: request.requestId,
              result: artifact,
            },
      } as MessageEvent<unknown>);
    });
  }

  terminate() {}
}

function createUnsafeArtifact(
  request: FakeWorkerRequest,
): FastMarkdownUnsafeArtifact {
  const identity = createFastMarkdownCompileIdentity(request.args);
  return {
    cacheKey: identity.cacheKey,
    contentHash: request.requestMeta.contentHash,
    unsafeHtml:
      `<h1>Heading</h1><script>alert(1)</script>` +
      `<img src="x" onerror="alert(1)">` +
      `<a href="javascript:alert(1)">unsafe</a>`,
    sanitization: "main-thread-required",
    outline: [],
    sourceLineAnchors: [],
    heavyBlocks: [],
    rendererProfile: request.args.rendererProfile,
    diagnostics: {
      profile: request.args.rendererProfile,
      contentHash: request.requestMeta.contentHash,
      cacheKey: identity.cacheKey,
      cacheState: "miss",
      compileDurationMs: 1,
      sanitizeDurationMs: 0,
      totalSourceLines: 1,
      totalHeadings: 1,
      totalHeavyBlocks: 0,
      fallbackReason: "none",
      truncated: false,
      featureFlagApplied: true,
    },
  };
}
