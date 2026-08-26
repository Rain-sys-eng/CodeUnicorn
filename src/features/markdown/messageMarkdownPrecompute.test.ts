import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGE_MARKDOWN_PRECOMPUTE_SCHEMA_VERSION,
  clearMessageMarkdownPrecomputeCache,
  classifyMessageMarkdownPrecomputeThreshold,
  createMessageMarkdownOptionsHash,
  createMessageMarkdownPrecomputeRequest,
  getMessageMarkdownPrecomputeCacheSize,
  isStaleMessageMarkdownPrecomputeResult,
  runMessageMarkdownPrecompute,
  type MessageMarkdownRendererOptions,
} from "./messageMarkdownPrecompute";
import type { FastMarkdownUnsafeArtifact } from "./fastMarkdownRenderer/types";

const rendererOptions: MessageMarkdownRendererOptions = {
  softBreaks: false,
  codeBlockStyle: "message",
  preserveFormatting: false,
  hasFileLinkHandlers: true,
  hasMathContent: false,
};

const workerResult: FastMarkdownUnsafeArtifact = {
  cacheKey: "worker-cache-key",
  contentHash: "worker-content",
  unsafeHtml: "<h1>ignored</h1>",
  sanitization: "main-thread-required",
  outline: [],
  sourceLineAnchors: [],
  heavyBlocks: [],
  rendererProfile: "fast-html",
  diagnostics: {
    profile: "fast-html",
    contentHash: "worker-content",
    cacheKey: "worker-cache-key",
    cacheState: "miss",
    compileDurationMs: 12,
    sanitizeDurationMs: 2,
    totalSourceLines: 8,
    totalHeadings: 2,
    totalHeavyBlocks: 1,
    fallbackReason: "none",
    truncated: false,
    featureFlagApplied: false,
  },
};

beforeEach(() => {
  clearMessageMarkdownPrecomputeCache();
});

afterEach(() => {
  clearMessageMarkdownPrecomputeCache();
  vi.useRealTimers();
});

describe("message markdown precompute", () => {
  it("classifies large and complex messages as worker-precompute candidates", () => {
    expect(classifyMessageMarkdownPrecomputeThreshold("x".repeat(10_000))).toBe("length");
    expect(classifyMessageMarkdownPrecomputeThreshold("```ts\nconst x = 1;\n```")).toBe("complexity");
    expect(classifyMessageMarkdownPrecomputeThreshold("short paragraph")).toBe("below-threshold");
  });

  it("runs large final markdown through worker precompute", async () => {
    const optionsHash = createMessageMarkdownOptionsHash(rendererOptions);
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-1",
      source: "x".repeat(10_000),
      optionsHash,
    });
    const compileInWorker = vi.fn().mockResolvedValue(workerResult);

    const result = await runMessageMarkdownPrecompute(request, {
      compileInWorker,
      now: () => 100,
    });

    expect(compileInWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        documentKey: "assistant-1",
        rawMarkdown: "x".repeat(10_000),
        rendererProfile: "fast-html",
      }),
      { timeoutMs: request.timeoutMs },
    );
    expect(result.mode).toBe("worker-precompute");
    expect(result.cacheState).toBe("miss");
    expect(result.fallbackReason).toBe("none");
    expect(result.precomputeResult).toMatchObject({
      totalHeadings: 2,
      totalHeavyBlocks: 1,
      totalSourceLines: 8,
      unsafeHtmlBoundary: "main-thread-sanitized-rich-render",
    });
    expect(JSON.stringify(result.precomputeResult)).not.toContain(workerResult.unsafeHtml);
  });

  it("reuses cache for same profile/message/content/options/schema", async () => {
    const optionsHash = createMessageMarkdownOptionsHash(rendererOptions);
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-cache",
      source: "x".repeat(10_000),
      optionsHash,
    });
    const compileInWorker = vi.fn().mockResolvedValue(workerResult);

    const first = await runMessageMarkdownPrecompute(request, { compileInWorker });
    const second = await runMessageMarkdownPrecompute(request, { compileInWorker });

    expect(first.mode).toBe("worker-precompute");
    expect(second.mode).toBe("cache-hit");
    expect(second.cacheState).toBe("hit");
    expect(compileInWorker).toHaveBeenCalledTimes(1);
    expect(getMessageMarkdownPrecomputeCacheSize()).toBe(1);
  });

  it("invalidates cache when renderer options change", async () => {
    const firstOptionsHash = createMessageMarkdownOptionsHash(rendererOptions);
    const secondOptionsHash = createMessageMarkdownOptionsHash({
      ...rendererOptions,
      softBreaks: true,
    });
    const firstRequest = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-options",
      source: "x".repeat(10_000),
      optionsHash: firstOptionsHash,
    });
    const secondRequest = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-options",
      source: "x".repeat(10_000),
      optionsHash: secondOptionsHash,
    });
    const compileInWorker = vi.fn().mockResolvedValue(workerResult);

    await runMessageMarkdownPrecompute(firstRequest, { compileInWorker });
    await runMessageMarkdownPrecompute(secondRequest, { compileInWorker });

    expect(compileInWorker).toHaveBeenCalledTimes(2);
    expect(getMessageMarkdownPrecomputeCacheSize()).toBe(2);
  });

  it("drops stale worker results by content/options/schema identity", () => {
    const optionsHash = createMessageMarkdownOptionsHash(rendererOptions);
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-stale",
      source: "x".repeat(10_000),
      optionsHash,
    });

    expect(isStaleMessageMarkdownPrecomputeResult(request, {
      messageId: "assistant-stale",
      contentHash: "newer-content",
      optionsHash,
      schemaVersion: MESSAGE_MARKDOWN_PRECOMPUTE_SCHEMA_VERSION,
    })).toBe(true);
    expect(isStaleMessageMarkdownPrecomputeResult(request, {
      messageId: "assistant-stale",
      contentHash: request.contentHash,
      optionsHash,
      schemaVersion: MESSAGE_MARKDOWN_PRECOMPUTE_SCHEMA_VERSION,
    })).toBe(false);
  });

  it("falls back when worker is unsupported", async () => {
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-unsupported",
      source: "x".repeat(10_000),
      optionsHash: createMessageMarkdownOptionsHash(rendererOptions),
    });

    const result = await runMessageMarkdownPrecompute(request, {
      compileInWorker: () => null,
    });

    expect(result.mode).toBe("fallback");
    expect(result.cacheState).toBe("unsupported");
    expect(result.fallbackReason).toBe("worker-unsupported");
    expect(result.precomputeResult).toBeNull();
  });

  it("falls back when worker precompute times out", async () => {
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-timeout",
      source: "x".repeat(10_000),
      optionsHash: createMessageMarkdownOptionsHash(rendererOptions),
      timeoutMs: 1,
    });
    const pendingWorker = new Promise<FastMarkdownUnsafeArtifact>(() => {});
    const result = await runMessageMarkdownPrecompute(request, {
      compileInWorker: () => pendingWorker,
      timeoutMs: 1,
    });

    expect(result.mode).toBe("fallback");
    expect(result.fallbackReason).toBe("worker-timeout");
    expect(result.precomputeResult).toBeNull();
  });

  it("negatively caches worker failures so identical requests skip the worker roundtrip", async () => {
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-worker-crash",
      source: "x".repeat(10_000),
      optionsHash: createMessageMarkdownOptionsHash(rendererOptions),
    });
    const compileInWorker = vi
      .fn()
      .mockRejectedValue(new Error("fast-markdown-worker crashed"));

    const first = await runMessageMarkdownPrecompute(request, { compileInWorker });
    expect(first.mode).toBe("fallback");
    expect(first.fallbackReason).toBe("worker-error");

    const second = await runMessageMarkdownPrecompute(request, { compileInWorker });
    expect(compileInWorker).toHaveBeenCalledTimes(1);
    expect(second.mode).toBe("cache-hit");
    expect(second.cacheState).toBe("hit");
    expect(second.durationMs).toBe(0);
    expect(second.fallbackReason).toBe("worker-error");
  });

  it("keeps small final markdown on the main path with explicit diagnostics mode", async () => {
    const request = createMessageMarkdownPrecomputeRequest({
      messageId: "assistant-small",
      source: "small paragraph",
      optionsHash: createMessageMarkdownOptionsHash(rendererOptions),
    });
    const compileInWorker = vi.fn();

    const result = await runMessageMarkdownPrecompute(request, { compileInWorker });

    expect(compileInWorker).not.toHaveBeenCalled();
    expect(result.mode).toBe("main");
    expect(result.fallbackReason).toBe("below-threshold");
    expect(result.cacheState).toBe("unsupported");
  });
});
