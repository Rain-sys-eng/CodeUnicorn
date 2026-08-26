import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
  MAX_GLOBAL_VISIBLE_THREAD_ROOT_COUNT,
  normalizeGlobalVisibleThreadRootCount,
  normalizeVisibleThreadRootCount,
  parseVisibleThreadRootCountDraft,
  planThreadListPageAdvance,
  resolveVisibleThreadRootLimit,
  resolveVisibleThreadRootPageSize,
} from "./constants";

describe("visible thread root paging", () => {
  it("defaults the first-paint page size to 5", () => {
    expect(DEFAULT_VISIBLE_THREAD_ROOT_COUNT).toBe(5);
    expect(normalizeVisibleThreadRootCount(undefined)).toBe(5);
    expect(normalizeVisibleThreadRootCount(null)).toBe(5);
    expect(normalizeGlobalVisibleThreadRootCount(undefined)).toBe(5);
  });

  it("clamps the global default to 1..20", () => {
    expect(normalizeGlobalVisibleThreadRootCount(0)).toBe(1);
    expect(normalizeGlobalVisibleThreadRootCount(20)).toBe(20);
    expect(normalizeGlobalVisibleThreadRootCount(21)).toBe(
      MAX_GLOBAL_VISIBLE_THREAD_ROOT_COUNT,
    );
  });

  it("lets a workspace override exceed the global max", () => {
    expect(resolveVisibleThreadRootPageSize(200, 5)).toBe(200);
    expect(resolveVisibleThreadRootPageSize(undefined, 8)).toBe(8);
    expect(resolveVisibleThreadRootPageSize(null, 99)).toBe(20);
  });

  it("parses numeric drafts without partial matches", () => {
    expect(parseVisibleThreadRootCountDraft("5")).toBe(5);
    expect(parseVisibleThreadRootCountDraft("12abc")).toBeNull();
    expect(parseVisibleThreadRootCountDraft("")).toBeNull();
  });

  it("raises the visible cap as 5, 10, 15, 20", () => {
    expect(resolveVisibleThreadRootLimit(5, 1)).toBe(5);
    expect(resolveVisibleThreadRootLimit(5, 2)).toBe(10);
    expect(resolveVisibleThreadRootLimit(5, 3)).toBe(15);
    expect(resolveVisibleThreadRootLimit(5, 4)).toBe(20);
  });

  it("uses the workspace page size when paging", () => {
    expect(resolveVisibleThreadRootLimit(8, 3)).toBe(24);
  });

  it("treats missing or invalid pages as the first page", () => {
    expect(resolveVisibleThreadRootLimit(5, undefined)).toBe(5);
    expect(resolveVisibleThreadRootLimit(5, 0)).toBe(5);
    expect(resolveVisibleThreadRootLimit(5, Number.NaN)).toBe(5);
  });

  it("consumes the in-memory page before fetching", () => {
    expect(
      planThreadListPageAdvance({
        totalRoots: 10,
        currentLimit: 5,
        nextCursor: "session-index::next",
        isPaging: false,
      }),
    ).toEqual({ advance: true, fetch: false });
  });

  it("fetches only after the in-memory page is exhausted", () => {
    expect(
      planThreadListPageAdvance({
        totalRoots: 5,
        currentLimit: 5,
        nextCursor: "session-index::next",
        isPaging: false,
      }),
    ).toEqual({ advance: true, fetch: true });
  });

  it("does not raise the cap or fetch without a remaining page", () => {
    expect(
      planThreadListPageAdvance({
        totalRoots: 5,
        currentLimit: 5,
        nextCursor: null,
        isPaging: false,
      }),
    ).toEqual({ advance: false, fetch: false });
  });

  it("ignores more-clicks while a page request is in flight", () => {
    expect(
      planThreadListPageAdvance({
        totalRoots: 5,
        currentLimit: 5,
        nextCursor: "session-index::next",
        isPaging: true,
      }),
    ).toEqual({ advance: false, fetch: false });
  });
});
