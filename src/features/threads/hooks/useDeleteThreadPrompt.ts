import { useCallback, useState } from "react";
import type { ThreadSummary } from "../../../types";
import { isSessionDeleteV2Enabled } from "../utils/sessionDeleteV2";

type DeletePromptState = {
  workspaceId: string;
  threadId: string;
  threadName: string;
};

type UseDeleteThreadPromptOptions = {
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  removeThread: (workspaceId: string, threadId: string) => Promise<{
    success: boolean;
    message: string | null;
  }>;
  onDeleteSuccess?: (threadId: string) => void;
  onDeleteError?: (message: string | null) => void;
};

export function useDeleteThreadPrompt({
  threadsByWorkspace,
  removeThread,
  onDeleteSuccess,
  onDeleteError,
}: UseDeleteThreadPromptOptions) {
  const [deletePrompt, setDeletePrompt] = useState<DeletePromptState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const openDeletePrompt = useCallback(
    (workspaceId: string, threadId: string) => {
      const threads = threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((entry) => entry.id === threadId);
      setDeletePrompt({
        workspaceId,
        threadId,
        threadName: thread?.name?.trim() || "Thread",
      });
    },
    [threadsByWorkspace],
  );

  const handleDeletePromptCancel = useCallback(() => {
    if (isDeleting) {
      return;
    }
    setDeletePrompt(null);
  }, [isDeleting]);

  const handleDeletePromptConfirm = useCallback(async () => {
    if (!deletePrompt || isDeleting) {
      return;
    }
    // v2 乐观删除：确认即关框（行已由 removeThread 乐观摘除），
    // 结果在后台对账，失败由 onDeleteError 提示 + 行回滚。
    if (isSessionDeleteV2Enabled()) {
      const { workspaceId, threadId } = deletePrompt;
      setDeletePrompt(null);
      void removeThread(workspaceId, threadId).then((result) => {
        if (!result.success) {
          onDeleteError?.(result.message);
          return;
        }
        onDeleteSuccess?.(threadId);
      });
      return;
    }
    setIsDeleting(true);
    try {
      const result = await removeThread(deletePrompt.workspaceId, deletePrompt.threadId);
      if (!result.success) {
        onDeleteError?.(result.message);
        return;
      }
      onDeleteSuccess?.(deletePrompt.threadId);
      setDeletePrompt(null);
    } finally {
      setIsDeleting(false);
    }
  }, [deletePrompt, isDeleting, onDeleteError, onDeleteSuccess, removeThread]);

  return {
    deletePrompt,
    isDeleting,
    openDeletePrompt,
    handleDeletePromptCancel,
    handleDeletePromptConfirm,
  };
}
