import { useEffect } from "react";
import {
  openPiTreeOverlay,
  refreshPiSessionTree,
  usePiSessionTree,
} from "../store/piSessionStore";
import { laneChipLabel } from "../utils/piSessionTreeProjection";

/**
 * Tab suffix chip for PI threads: appears only when the session tree has
 * more than one lane. Click opens the tree split panel — it deliberately
 * does NOT switch lanes (pi RPC has no lane-switch command).
 */
export function PiBranchChip({
  workspaceId,
  threadId,
}: {
  workspaceId: string;
  threadId: string;
}) {
  const tree = usePiSessionTree(workspaceId, threadId);

  // Active pi tab 挂载即拉取树快照（事件驱动一次性拉取，不轮询）；
  // chip 本体在 laneCount>1 时才渲染。
  useEffect(() => {
    void refreshPiSessionTree(workspaceId, threadId);
  }, [workspaceId, threadId]);

  if (!tree || tree.laneCount < 2) {
    return null;
  }
  return (
    <span
      className="topbar-tab-branch pi-branch-chip"
      title={`会话分支（${tree.laneCount} 条 lane）· 点击查看会话树（pi RPC 无 lane 切换命令）`}
      onClick={(event) => {
        event.stopPropagation();
        openPiTreeOverlay(workspaceId, threadId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
          openPiTreeOverlay(workspaceId, threadId);
        }
      }}
      role="button"
      tabIndex={0}
    >
      {laneChipLabel(tree.activeLane)} ▾
    </span>
  );
}
