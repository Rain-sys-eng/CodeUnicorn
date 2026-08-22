import { startTransition } from "react";

import type { EngineType } from "../../../types";
import { isEngineType } from "../workspaceFlowsTypes";
import {
  getThreadSelectDiffCleanupAction,
  shouldCollapseRightPanelOnThreadSelect,
} from "../threadEditorPreservation";

export type ThreadSelectIdentityInput = {
  workspaceId: string;
  threadId: string;
};

export type ThreadSelectIdentityActions = {
  selectWorkspace: (workspaceId: string) => void;
  setActiveThreadId: (threadId: string, workspaceId: string) => void;
};

export type ThreadSelectChromeInput = {
  preserveEditor: boolean;
  requestedCollapseRightPanel?: boolean;
  engineSource?: unknown;
  threadId?: string;
};

export type ThreadSelectChromeActions = {
  closeSettings?: () => void;
  setSelectedDiffPath?: (path: null) => void;
  exitDiffView?: () => void;
  resetPullRequestSelection?: () => void;
  extraChrome?: () => void;
  setHomeOpen?: (open: false) => void;
  setWorkspaceHomeWorkspaceId?: (id: null) => void;
  setCenterMode?: (mode: "chat") => void;
  setAppMode?: (mode: "chat") => void;
  setActiveTab?: (tab: "codex") => void;
  collapseRightPanel?: () => void;
  setActiveEngine?: (engine: EngineType) => void;
};

const PREFIXED_NATIVE_ENGINE = /^(claude|gemini|grok|kimi|opencode|pi|dsh|qoder):/i;

export function resolveThreadSelectEngine(
  engineSource: unknown,
  threadId?: string,
): EngineType | null {
  if (isEngineType(engineSource)) {
    return engineSource;
  }
  const id = String(threadId ?? "").trim().toLowerCase();
  const match = PREFIXED_NATIVE_ENGINE.exec(id);
  return match ? (match[1] as EngineType) : null;
}

export function applyThreadSelectIdentity(
  input: ThreadSelectIdentityInput,
  actions: ThreadSelectIdentityActions,
): void {
  actions.selectWorkspace(input.workspaceId);
  actions.setActiveThreadId(input.threadId, input.workspaceId);
}

export function applyThreadSelectChrome(
  input: ThreadSelectChromeInput,
  actions: ThreadSelectChromeActions,
): void {
  const engine = resolveThreadSelectEngine(input.engineSource, input.threadId);
  if (actions.setActiveEngine && engine) {
    actions.setActiveEngine(engine);
  }
  actions.closeSettings?.();
  const diffCleanupAction = getThreadSelectDiffCleanupAction(
    input.preserveEditor,
  );
  if (diffCleanupAction === "clear-selected-diff") {
    actions.setSelectedDiffPath?.(null);
  } else {
    actions.exitDiffView?.();
  }
  actions.resetPullRequestSelection?.();
  actions.extraChrome?.();
  actions.setHomeOpen?.(false);
  actions.setWorkspaceHomeWorkspaceId?.(null);
  if (!input.preserveEditor) {
    actions.setCenterMode?.("chat");
  }
  actions.setAppMode?.("chat");
  actions.setActiveTab?.("codex");
  if (
    shouldCollapseRightPanelOnThreadSelect({
      preserveEditor: input.preserveEditor,
      requestedCollapse: input.requestedCollapseRightPanel === true,
    })
  ) {
    actions.collapseRightPanel?.();
  }
}

export function commitThreadSelection(
  identity: ThreadSelectIdentityInput,
  identityActions: ThreadSelectIdentityActions,
  chrome: ThreadSelectChromeInput,
  chromeActions: ThreadSelectChromeActions,
  scheduleChrome: (work: () => void) => void = startTransition,
): void {
  applyThreadSelectIdentity(identity, identityActions);
  scheduleChrome(() => {
    applyThreadSelectChrome(chrome, chromeActions);
  });
}
