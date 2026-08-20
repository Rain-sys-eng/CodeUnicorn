import { describe, expect, it, vi } from "vitest";

import {
  applyThreadSelectChrome,
  applyThreadSelectIdentity,
  commitThreadSelection,
  resolveThreadSelectEngine,
} from "./commitThreadSelection";

function createIdentityActions() {
  return {
    selectWorkspace: vi.fn(),
    setActiveThreadId: vi.fn(),
  };
}

function createChromeActions() {
  return {
    setActiveEngine: vi.fn(),
    closeSettings: vi.fn(),
    setSelectedDiffPath: vi.fn(),
    exitDiffView: vi.fn(),
    resetPullRequestSelection: vi.fn(),
    setHomeOpen: vi.fn(),
    setWorkspaceHomeWorkspaceId: vi.fn(),
    setCenterMode: vi.fn(),
    setAppMode: vi.fn(),
    setActiveTab: vi.fn(),
    collapseRightPanel: vi.fn(),
  };
}

describe("commitThreadSelection", () => {
  it("applies workspace and thread identity before scheduled chrome", () => {
    const identityActions = createIdentityActions();
    const chromeActions = createChromeActions();
    const scheduleChrome = vi.fn((work: () => void) => work());

    commitThreadSelection(
      {
        workspaceId: "ws-1",
        threadId: "thread-1",
      },
      identityActions,
      {
        preserveEditor: false,
        requestedCollapseRightPanel: true,
        engineSource: "claude",
      },
      chromeActions,
      scheduleChrome,
    );

    expect(identityActions.selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(identityActions.setActiveThreadId).toHaveBeenCalledWith(
      "thread-1",
      "ws-1",
    );
    expect(chromeActions.setActiveEngine).toHaveBeenCalledWith("claude");
    expect(scheduleChrome).toHaveBeenCalledTimes(1);
    expect(
      identityActions.setActiveThreadId.mock.invocationCallOrder[0],
    ).toBeLessThan(chromeActions.setActiveEngine.mock.invocationCallOrder[0]);
    expect(
      identityActions.setActiveThreadId.mock.invocationCallOrder[0],
    ).toBeLessThan(chromeActions.setHomeOpen.mock.invocationCallOrder[0]);
    expect(
      identityActions.setActiveThreadId.mock.invocationCallOrder[0],
    ).toBeLessThan(chromeActions.collapseRightPanel.mock.invocationCallOrder[0]);
  });

  it("keeps editor chrome when preserveEditor is true", () => {
    const chromeActions = createChromeActions();

    applyThreadSelectChrome(
      { preserveEditor: true, requestedCollapseRightPanel: true },
      chromeActions,
    );

    expect(chromeActions.setSelectedDiffPath).toHaveBeenCalledWith(null);
    expect(chromeActions.exitDiffView).not.toHaveBeenCalled();
    expect(chromeActions.setCenterMode).not.toHaveBeenCalled();
    expect(chromeActions.collapseRightPanel).not.toHaveBeenCalled();
  });

  it("does not apply engine during identity", () => {
    const identityActions = createIdentityActions();

    applyThreadSelectIdentity(
      {
        workspaceId: "ws-1",
        threadId: "thread-1",
      },
      identityActions,
    );

    expect(identityActions.selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(identityActions.setActiveThreadId).toHaveBeenCalledWith(
      "thread-1",
      "ws-1",
    );
  });

  it("applies DSH engine chrome when selecting a DSH thread", () => {
    const chromeActions = createChromeActions();

    applyThreadSelectChrome(
      {
        preserveEditor: false,
        engineSource: "dsh",
      },
      chromeActions,
    );

    expect(chromeActions.setActiveEngine).toHaveBeenCalledWith("dsh");
  });

  it("infers DSH from a dsh: thread id when engineSource is missing", () => {
    const chromeActions = createChromeActions();

    applyThreadSelectChrome(
      {
        preserveEditor: false,
        threadId: "dsh:session-1",
      },
      chromeActions,
    );

    expect(chromeActions.setActiveEngine).toHaveBeenCalledWith("dsh");
  });

  it("does not infer Codex from an unprefixed thread id", () => {
    expect(resolveThreadSelectEngine(undefined, "thread-local-codex")).toBeNull();
    const chromeActions = createChromeActions();
    applyThreadSelectChrome(
      {
        preserveEditor: false,
        threadId: "thread-local-codex",
      },
      chromeActions,
    );
    expect(chromeActions.setActiveEngine).not.toHaveBeenCalled();
  });

  it("ignores unknown engine sources on chrome", () => {
    const chromeActions = createChromeActions();

    applyThreadSelectChrome(
      {
        preserveEditor: false,
        engineSource: "not-an-engine",
      },
      chromeActions,
    );

    expect(chromeActions.setActiveEngine).not.toHaveBeenCalled();
  });
});
