import { useState, type ComponentProps, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import CopyX from "lucide-react/dist/esm/icons/copy-x";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import PanelTopClose from "lucide-react/dist/esm/icons/panel-top-close";
import X from "lucide-react/dist/esm/icons/x";
import { FileIcon, getFileName } from "../../../components/FileIcon";
import {
  clampRendererContextMenuPosition,
  estimateRendererContextMenuHeight,
  RendererContextMenu,
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import { GitHistoryPanel as GitHistoryPanelImpl } from "./git-history-panel/components";
import { GIT_GRAPH_TAB_ID, getFileHistoryTabId, type FileHistoryTarget } from "../types";
import { FileHistoryView } from "./FileHistoryView";
import {
  buildFileTreeItems,
  getDefaultColumnWidths,
} from "./git-history-panel/utils";
import { loadGitHistoryStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";

type GitHistoryPanelProps = ComponentProps<typeof GitHistoryPanelImpl> & {
  fileHistoryTabs?: readonly FileHistoryTarget[];
  activeTabId?: string;
  onActivateTab?: (tabId: string) => void;
  onCloseFileHistoryTab?: (tabId: string) => void;
  onCloseOtherFileHistoryTabs?: (tabId: string) => void;
  onCloseAllFileHistoryTabs?: () => void;
};

const EMPTY_FILE_HISTORY_TABS: readonly FileHistoryTarget[] = [];

export function GitHistoryPanel({
  fileHistoryTabs = EMPTY_FILE_HISTORY_TABS,
  activeTabId = GIT_GRAPH_TAB_ID,
  onActivateTab,
  onCloseFileHistoryTab,
  onCloseOtherFileHistoryTabs,
  onCloseAllFileHistoryTabs,
  ...panelProps
}: GitHistoryPanelProps) {
  const { t } = useTranslation();
  const [tabContextMenu, setTabContextMenu] = useState<RendererContextMenuState | null>(null);
  const stylesReady = useFeatureStylesReady(loadGitHistoryStyles);
  if (!stylesReady) {
    return null;
  }

  const activeFileHistoryTabIndex = fileHistoryTabs.findIndex(
    (target) => getFileHistoryTabId(target) === activeTabId,
  );
  const activeFileHistoryTarget = fileHistoryTabs[activeFileHistoryTabIndex] ?? null;
  const graphActive = activeFileHistoryTarget === null;

  const openTabContextMenu = (event: ReactMouseEvent, tabId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const items: RendererContextMenuItem[] = [
      {
        type: "item",
        id: "close-current-tab",
        label: t("files.closeCurrentTab"),
        icon: <X size={15} />,
        disabled: !onCloseFileHistoryTab,
        onSelect: () => onCloseFileHistoryTab?.(tabId),
      },
      {
        type: "item",
        id: "close-other-tabs",
        label: t("files.closeOtherTabs"),
        icon: <CopyX size={15} />,
        disabled: !onCloseOtherFileHistoryTabs || fileHistoryTabs.length <= 1,
        onSelect: () => onCloseOtherFileHistoryTabs?.(tabId),
      },
      {
        type: "item",
        id: "close-all-tabs",
        label: t("files.closeAllTabs"),
        icon: <PanelTopClose size={15} />,
        disabled: !onCloseAllFileHistoryTabs,
        onSelect: () => onCloseAllFileHistoryTabs?.(),
      },
    ];
    const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
      width: 220,
      height: estimateRendererContextMenuHeight(items),
      padding: 10,
    });
    setTabContextMenu({
      ...position,
      label: t("files.tabContextMenu"),
      items,
    });
  };

  const toolbarTabsNode = (
    <div
      className="git-history-document-tabs"
      role="tablist"
      aria-label={t("git.fileHistoryTitle")}
    >
      <button
        type="button"
        id="git-history-tab-graph"
        role="tab"
        aria-selected={graphActive}
        aria-controls="git-history-panel-graph"
        aria-label={t("git.historyQuickAction")}
        title={t("git.historyQuickAction")}
        tabIndex={0}
        className={`git-history-document-tab${graphActive ? " is-active" : ""}`}
        onClick={() => onActivateTab?.(GIT_GRAPH_TAB_ID)}
      >
        <GitCommitHorizontal size={13} aria-hidden />
      </button>
      {fileHistoryTabs.map((target, index) => {
        const tabId = getFileHistoryTabId(target);
        const active = tabId === activeTabId;
        const domId = `git-history-tab-file-${index}`;
        const fileName = getFileName(target.displayPath) || target.displayPath;
        return (
          <div
            key={tabId}
            className={`git-history-document-tab-shell${active ? " is-active" : ""}`}
            onContextMenu={(event) => openTabContextMenu(event, tabId)}
          >
            <button
              type="button"
              id={domId}
              role="tab"
              aria-selected={active}
              aria-controls="git-history-panel-file"
              aria-label={target.displayPath}
              tabIndex={0}
              className="git-history-document-tab"
              title={target.displayPath}
              onClick={() => onActivateTab?.(tabId)}
            >
              <FileIcon
                filePath={target.displayPath}
                className="git-history-document-file-icon file-icon"
              />
              <span>{fileName}</span>
            </button>
            <button
              type="button"
              className="git-history-document-tab-close"
              aria-label={`${t("git.fileHistoryClose")}: ${target.displayPath}`}
              title={t("git.fileHistoryClose")}
              onClick={() => onCloseFileHistoryTab?.(tabId)}
            >
              <X size={10} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <GitHistoryPanelImpl
        {...panelProps}
        toolbarTabsNode={toolbarTabsNode}
        activeDocumentTabId={
          graphActive ? "git-history-tab-graph" : `git-history-tab-file-${activeFileHistoryTabIndex}`
        }
        documentContentNode={activeFileHistoryTarget ? (
          <FileHistoryView
            key={activeTabId}
            target={activeFileHistoryTarget}
            onClose={() => onCloseFileHistoryTab?.(activeTabId)}
            showHeader={false}
          />
        ) : null}
      />
      {tabContextMenu ? (
        <RendererContextMenu
          menu={tabContextMenu}
          onClose={() => setTabContextMenu(null)}
        />
      ) : null}
    </>
  );
}

export { buildFileTreeItems, getDefaultColumnWidths };
