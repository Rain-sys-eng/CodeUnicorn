import { useTranslation } from "react-i18next";
import {
  openPiTreeOverlay,
  usePiSessionTree,
} from "../store/piSessionStore";

/**
 * Sidebar `⑂ N` badge for PI threads. Rendered only for the active pi thread
 * (tree data is fetched lazily for the active thread only — no background IPC
 * fan-out for every sidebar row). Click opens the tree overlay.
 */
export function PiThreadBranchBadge({
  workspaceId,
  threadId,
}: {
  workspaceId: string;
  threadId: string;
}) {
  const { t } = useTranslation();
  const tree = usePiSessionTree(workspaceId, threadId);

  if (!tree || tree.laneCount < 2) {
    return null;
  }
  return (
    <span
      className="thread-branch-count"
      title={t("piSession.tree.sidebarBadgeTitle", { count: tree.laneCount })}
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
      ⑂ {tree.laneCount}
    </span>
  );
}
