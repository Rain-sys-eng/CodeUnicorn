import type { Dispatch, MutableRefObject } from "react";
import type {
  DebugEntry,
  WorkspaceSessionAttributionMode,
} from "../../../types";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

export type UseThreadActionsOptions = {
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
  historyWindowByThread?: ThreadState["historyWindowByThread"];
  tokenUsageByThread?: ThreadState["tokenUsageByThread"];
  userInputRequests: ThreadState["userInputRequests"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  threadListCursorByWorkspace: ThreadState["threadListCursorByWorkspace"];
  threadStatusById: ThreadState["threadStatusById"];
  onDebug?: (entry: DebugEntry) => void;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  threadActivityRef: MutableRefObject<Record<string, Record<string, number>>>;
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  replaceOnResumeRef: MutableRefObject<Record<string, boolean>>;
  applyCollabThreadLinksFromThread: (
    threadId: string,
    thread: Record<string, unknown>,
  ) => void;
  updateThreadParent?: (parentId: string, childIds: string[]) => void;
  onThreadTitleMappingsLoaded?: (
    workspaceId: string,
    titles: Record<string, string>,
  ) => void;
  onRenameThreadTitleMapping?: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  onCodexPendingThreadFinalized?: (
    workspaceId: string,
    pendingThreadId: string,
    realThreadId: string,
  ) => void;
  resolveCanonicalThreadId?: (threadId: string) => string;
  rememberThreadAlias?: (oldThreadId: string, newThreadId: string) => void;
  clearThreadAlias?: (oldThreadId: string) => void;
  resolveWorkspacePath?: (workspaceId: string) => string | null;
  useUnifiedHistoryLoader?: boolean;
  sessionAttributionMode?: WorkspaceSessionAttributionMode;
  defaultVisibleThreadRootCount?: number | null;
};
