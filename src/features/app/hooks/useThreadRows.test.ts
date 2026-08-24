// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ThreadSummary } from "../../../types";
import { markPiDerivedThread, reconcilePiDerivedHideWithAuthoritativeRows } from "../../pi-session/store/piSessionStore";
import {
  rememberVerifiedSharedHide,
  resetSharedNativeVisibilityMemory,
} from "../../threads/hooks/sharedNativeVisibility";
import { useThreadRows } from "./useThreadRows";

const getPinTimestamp = () => null;

describe("useThreadRows", () => {
  afterEach(() => {
    resetSharedNativeVisibilityMemory();
  });

  it("renders Codex subagent sessions under one parent root", () => {
    const parent: ThreadSummary = {
      id: "parent-session",
      name: "Parent",
      updatedAt: 100,
      engineSource: "codex",
    };
    const child: ThreadSummary = {
      id: "child-session",
      name: "Aristotle",
      parentThreadId: "parent-session",
      updatedAt: 200,
      engineSource: "codex",
    };

    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [parent, child],
      false,
      "ws-1",
      getPinTimestamp,
    );

    expect(rows.totalRoots).toBe(1);
    expect(rows.unpinnedRows.map((row) => [row.thread.id, row.depth])).toEqual([
      ["parent-session", 0],
      ["child-session", 1],
    ]);
  });

  it("hides live-window pi fork branch rows via derived mark (parentThreadId 未就位)", () => {
    // live 窗口：fork 跳转 / thread/started 新建的分支行还没有 parentThreadId，
    // list 刷新可能整局不跑——fork 成功时的派生登记必须立刻隐藏它。
    const main: ThreadSummary = {
      id: "pi:main-livewindow",
      name: "99+22",
      updatedAt: 100,
      engineSource: "pi",
    };
    const branch: ThreadSummary = {
      id: "pi:branch-livewindow",
      name: "99+22",
      updatedAt: 200,
      engineSource: "pi",
    };
    markPiDerivedThread("pi:branch-livewindow");

    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [main, branch],
      false,
      "ws-1",
      getPinTimestamp,
    );

    expect(rows.unpinnedRows.map((row) => row.thread.id)).toEqual([
      "pi:main-livewindow",
    ]);
  });

  it("keeps pi main visible while hiding parented pi branch (权威 parent 路径)", () => {
    const main: ThreadSummary = {
      id: "pi:main-parented",
      name: "1+1",
      updatedAt: 100,
      engineSource: "pi",
    };
    const branch: ThreadSummary = {
      id: "pi:branch-parented",
      name: "1+1",
      parentThreadId: "pi:main-parented",
      updatedAt: 200,
      engineSource: "pi",
    };

    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [main, branch],
      false,
      "ws-1",
      getPinTimestamp,
    );

    expect(rows.unpinnedRows.map((row) => row.thread.id)).toEqual([
      "pi:main-parented",
    ]);
  });

  it("reconcile 放归被误登记的主线（权威行无 parentSession），保留真派生隐藏", () => {
    // fork 静默 no-op 会把源主线 id 误登记进内存派生集合，整局隐藏；
    // index/磁盘 list 的权威行（无 parentSessionId）必须立即放归它。
    const main: ThreadSummary = {
      id: "pi:main-mismarked",
      name: "帮我执行打包",
      updatedAt: 100,
      engineSource: "pi",
    };
    const branch: ThreadSummary = {
      id: "pi:branch-real",
      name: "分支",
      updatedAt: 200,
      engineSource: "pi",
    };
    markPiDerivedThread("pi:main-mismarked"); // 模拟误登记
    markPiDerivedThread("pi:branch-real"); // 真派生

    reconcilePiDerivedHideWithAuthoritativeRows([
      // 权威证明 main-mismarked 是主线（无 parent）→ 放归
      { engine: "pi", sessionId: "main-mismarked", parentSessionId: null },
      // 权威证明 branch-real 是真派生 → 保持隐藏
      { engine: "pi", sessionId: "branch-real", parentSessionId: "main-mismarked" },
      // 非 pi 引擎行不得触碰集合
      { engine: "codex", sessionId: "main-mismarked", parentSessionId: null },
    ]);

    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [main, branch],
      false,
      "ws-1",
      getPinTimestamp,
    );

    expect(rows.unpinnedRows.map((row) => row.thread.id)).toEqual([
      "pi:main-mismarked",
    ]);
  });

  it("sorts roots by createdAt so later activity does not reshuffle the list", () => {
    const older: ThreadSummary = {
      id: "claude:older",
      name: "Older session",
      createdAt: 100,
      updatedAt: 9_000,
      engineSource: "claude",
    };
    const newer: ThreadSummary = {
      id: "codex:newer",
      name: "Newer session",
      createdAt: 500,
      updatedAt: 600,
      engineSource: "codex",
    };

    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [older, newer],
      false,
      "ws-1",
      getPinTimestamp,
    );

    expect(rows.unpinnedRows.map((row) => row.thread.id)).toEqual([
      "codex:newer",
      "claude:older",
    ]);
  });

  it("hides Shared-owned subagent pups from the sidebar tree without removing native trees", () => {
    const shared: ThreadSummary = {
      id: "shared:s1",
      name: "Shared Session",
      updatedAt: 300,
      engineSource: "codex",
      threadKind: "shared",
      nativeThreadIds: ["codex:hidden-owner"],
    };
    // parent 已 remap 到 shared: — 侧栏必须隐藏（不下崽）
    const remountedPup: ThreadSummary = {
      id: "child-archimedes",
      name: "Archimedes",
      parentThreadId: "shared:s1",
      updatedAt: 400,
      engineSource: "codex",
    };
    // parent 仍为 hidden owner raw — 同样隐藏
    const rawParentPup: ThreadSummary = {
      id: "child-aristotle",
      name: "Aristotle",
      parentThreadId: "hidden-owner",
      updatedAt: 350,
      engineSource: "codex",
    };
    // Native 父子：不受影响
    const nativeParent: ThreadSummary = {
      id: "codex:native-parent",
      name: "Native Parent",
      updatedAt: 100,
      engineSource: "codex",
    };
    const nativeChild: ThreadSummary = {
      id: "codex:native-child",
      name: "Native Child",
      parentThreadId: "codex:native-parent",
      updatedAt: 200,
      engineSource: "codex",
    };

    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [shared, remountedPup, rawParentPup, nativeParent, nativeChild],
      true,
      "ws-1",
      getPinTimestamp,
    );

    const visibleIds = rows.unpinnedRows.map((row) => row.thread.id);
    expect(visibleIds).toContain("shared:s1");
    expect(visibleIds).toContain("codex:native-parent");
    expect(visibleIds).toContain("codex:native-child");
    expect(visibleIds).not.toContain("child-archimedes");
    expect(visibleIds).not.toContain("child-aristotle");
    // Shared 不展示 hasChildren（崽子已从树剔除）
    const sharedRow = rows.unpinnedRows.find((row) => row.thread.id === "shared:s1");
    expect(sharedRow?.hasChildren).toBe(false);
    expect(rows.totalRoots).toBe(2);
  });

  it("hides Shared Codex pups whose parent is a rollout stem alias on any OS", () => {
    const uuid = "b7e2c1a0-4d3f-4a21-9c8e-1f2a3b4c5d6e";
    const rolloutStem = `rollout-2026-04-10T10-00-00-${uuid}`;
    const shared: ThreadSummary = {
      id: "shared:s-codex",
      name: "Shared Codex",
      updatedAt: 300,
      engineSource: "codex",
      threadKind: "shared",
      nativeThreadIds: [`codex:${uuid}`],
    };
    const windowsLivePup: ThreadSummary = {
      id: `codex:${rolloutStem}-child`,
      name: "Socrates",
      parentThreadId: rolloutStem,
      updatedAt: 400,
      engineSource: "codex",
    };
    const prefixedStemPup: ThreadSummary = {
      id: "child-singer",
      name: "Singer",
      parentThreadId: `codex:${rolloutStem}`,
      updatedAt: 390,
      engineSource: "codex",
    };
    const nativeParent: ThreadSummary = {
      id: "codex:visible-parent",
      name: "Native Parent",
      updatedAt: 100,
      engineSource: "codex",
    };
    const nativeChild: ThreadSummary = {
      id: "codex:visible-child",
      name: "Native Child",
      parentThreadId: "codex:visible-parent",
      updatedAt: 200,
      engineSource: "codex",
    };

    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [shared, windowsLivePup, prefixedStemPup, nativeParent, nativeChild],
      true,
      "ws-1",
      getPinTimestamp,
    );

    const visibleIds = rows.unpinnedRows.map((row) => row.thread.id);
    expect(visibleIds).toEqual([
      "shared:s-codex",
      "codex:visible-parent",
      "codex:visible-child",
    ]);
    expect(visibleIds).not.toContain(windowsLivePup.id);
    expect(visibleIds).not.toContain("child-singer");
  });

  it("does not promote Claude subagent when protocol owner is missing from the list", () => {
    const fileUuid = "1807f883-011c-46bd-94d5-ff483ffb1a4a";
    rememberVerifiedSharedHide(
      "ws-protocol",
      new Set([fileUuid, `claude:${fileUuid}`]),
    );
    const shared: ThreadSummary = {
      id: "shared:267c001d-932a-4a05-bfa9-a238937f7707",
      name: "Shared",
      updatedAt: 300,
      engineSource: "claude",
      threadKind: "shared",
      nativeThreadIds: ["claude:c65677af-c64e-4fce-9e34-76f1cd1a7c7f"],
    };
    const pup: ThreadSummary = {
      id: `claude:subagent:${fileUuid}:agent-a0f4436c38b58a97e`,
      name: "调研 Zen 代理",
      parentThreadId: `claude:${fileUuid}`,
      updatedAt: 400,
      engineSource: "claude",
    };
    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [shared, pup],
      true,
      "ws-protocol",
      getPinTimestamp,
    );
    const visibleIds = rows.unpinnedRows.map((row) => row.thread.id);
    expect(visibleIds).toEqual(["shared:267c001d-932a-4a05-bfa9-a238937f7707"]);
    expect(visibleIds).not.toContain(pup.id);
  });

  it("keeps local Socrates and Singer under their TUI/Desktop parents", () => {
    const desktopParent: ThreadSummary = {
      id: "01a00d6c-205e-7492-b344-dccefed9909d",
      name: "Desktop parent",
      updatedAt: 100,
      engineSource: "codex",
    };
    const socrates: ThreadSummary = {
      id: "01a00d8f-7e8d-7481-bb59-9d3f79e4b51b",
      name: "Socrates",
      parentThreadId: "01a00d6c-205e-7492-b344-dccefed9909d",
      updatedAt: 200,
      engineSource: "codex",
    };
    const tuiParent: ThreadSummary = {
      id: "019fc7da-75f2-73a3-8793-9a8705e33a18",
      name: "TUI parent",
      updatedAt: 90,
      engineSource: "codex",
    };
    const singer: ThreadSummary = {
      id: "019fc810-0a87-7542-8cf3-5a70454f2fa4",
      name: "Singer",
      parentThreadId: "019fc7da-75f2-73a3-8793-9a8705e33a18",
      updatedAt: 180,
      engineSource: "codex",
    };
    rememberVerifiedSharedHide(
      "ws-native-codex",
      new Set(["1807f883-011c-46bd-94d5-ff483ffb1a4a", "claude:hidden-owner"]),
    );
    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [desktopParent, socrates, tuiParent, singer],
      true,
      "ws-native-codex",
      getPinTimestamp,
    );
    const visible = rows.unpinnedRows.map((row) => [row.thread.id, row.depth]);
    expect(visible).toEqual(
      expect.arrayContaining([
        ["01a00d6c-205e-7492-b344-dccefed9909d", 0],
        ["01a00d8f-7e8d-7481-bb59-9d3f79e4b51b", 1],
        ["019fc7da-75f2-73a3-8793-9a8705e33a18", 0],
        ["019fc810-0a87-7542-8cf3-5a70454f2fa4", 1],
      ]),
    );
  });

  it("nests Codex philosopher pups by uuid/rollout identity and hides orphan pups", () => {
    const parentCanonical = "01a01b3c-db39-7362-9505-3e3535f4b878";
    const parent: ThreadSummary = {
      id: `codex:rollout-2026-08-20T02-16-08-${parentCanonical}`,
      name: "any",
      updatedAt: 100,
      engineSource: "codex",
    };
    const socrates: ThreadSummary = {
      id: "01a01d13-7328-7153-99f3-faf8693a30cb",
      name: "Socrates",
      parentThreadId: parentCanonical,
      updatedAt: 400,
      engineSource: "codex",
    };
    const beauvoir: ThreadSummary = {
      id: "codex:01a01d24-29c1-7741-8941-e17e7a5b5e85",
      name: "Beauvoir",
      parentThreadId: `codex:${parentCanonical}`,
      updatedAt: 390,
      engineSource: "codex",
    };
    const orphanFaraday: ThreadSummary = {
      id: "01a01d2d-a9c0-73e2-a507-603c2dd048da",
      name: "Faraday",
      parentThreadId: "01a01c67-d7e4-7cc0-a638-74a21cc47767",
      updatedAt: 380,
      engineSource: "codex",
    };
    const { result } = renderHook(() => useThreadRows({}));
    const rows = result.current.getThreadRows(
      [parent, socrates, beauvoir, orphanFaraday],
      true,
      "ws-codex-pups",
      getPinTimestamp,
    );
    const visible = rows.unpinnedRows.map((row) => [row.thread.name, row.depth]);
    expect(visible).toEqual([
      ["any", 0],
      ["Socrates", 1],
      ["Beauvoir", 1],
    ]);
    expect(rows.unpinnedRows.map((row) => row.thread.name)).not.toContain(
      "Faraday",
    );
  });
});
