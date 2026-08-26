import {
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import ClipboardCopy from "lucide-react/dist/esm/icons/clipboard-copy";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Keyboard from "lucide-react/dist/esm/icons/keyboard";
import Play from "lucide-react/dist/esm/icons/play";
import Search from "lucide-react/dist/esm/icons/search";
import type { OpenAppTarget, WorkspaceInfo } from "../../../types";
import { copyTextToClipboard } from "../../../utils/clipboard";
import type { ReactElement, ReactNode } from "react";
import { OpenAppMenu, type OpenAppMenuExtraAction } from "./OpenAppMenu";
import { ShortcutsGuideModal } from "./ShortcutsGuideModal";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import { LaunchScriptButton } from "./LaunchScriptButton";
import { LaunchScriptEntryButton } from "./LaunchScriptEntryButton";
import type { WorkspaceLaunchScriptsState } from "../hooks/useWorkspaceLaunchScripts";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { pushErrorToast } from "../../../services/toasts";
import { DEFAULT_OPEN_APP_TARGETS } from "../constants";
import { useKnownOpenAppIcons } from "../hooks/useKnownOpenAppIcons";
import { useOpenAppIcons } from "../hooks/useOpenAppIcons";
import { getLaunchScriptIcon } from "../utils/launchScriptIcons";
import { openPathInTarget, resolveOpenAppPath } from "../utils/openApp";
import { GENERIC_APP_ICON, getKnownOpenAppIcon } from "../utils/openAppIcons";

type WorkspaceGroupSection = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type MainHeaderProps = {
  workspace: WorkspaceInfo;
  parentName?: string | null;
  worktreePath?: string | null;
  /** Currently open editor file (workspace-relative or absolute). Apps open this; finder keeps folder. */
  activeFilePath?: string | null;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  sessionTabsNode?: ReactNode;
  canCopyThread?: boolean;
  onCopyThread?: () => void | Promise<void>;
  onLockPanel?: () => void;
  extraActionsNode?: ReactNode;
  openAppExtraActions?: OpenAppMenuExtraAction[];
  launchScript?: string | null;
  launchScriptEditorOpen?: boolean;
  launchScriptDraft?: string;
  launchScriptSaving?: boolean;
  launchScriptError?: string | null;
  onRunLaunchScript?: () => void;
  onOpenLaunchScriptEditor?: () => void;
  onCloseLaunchScriptEditor?: () => void;
  onLaunchScriptDraftChange?: (value: string) => void;
  onSaveLaunchScript?: () => void;
  launchScriptsState?: WorkspaceLaunchScriptsState;
  showLaunchScriptControls?: boolean;
  showOpenAppMenu?: boolean;
  groupedWorkspaces?: WorkspaceGroupSection[];
  activeWorkspaceId?: string | null;
  onSelectWorkspace?: (workspaceId: string) => void;
  onOpenShortcutsSettings?: () => void;
};

const EMPTY_OPEN_APP_EXTRA_ACTIONS: OpenAppMenuExtraAction[] = [];

const HEADER_PINNED_ACTIONS_KEY = "headerPinnedActions";
// 默认外显：启动脚本、VS Code、终端；「更多」入口与右侧面板开关始终外显
const DEFAULT_HEADER_PINNED_ACTIONS = ["launch-script", "vscode", "terminal"];

function useHeaderPinnedActions() {
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    const stored = getClientStoreSync<unknown>("app", HEADER_PINNED_ACTIONS_KEY);
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : DEFAULT_HEADER_PINNED_ACTIONS;
  });
  const togglePinned = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((pinnedId) => pinnedId !== id)
        : [...prev, id];
      writeClientStoreValue("app", HEADER_PINNED_ACTIONS_KEY, next);
      return next;
    });
  }, []);
  return { pinnedIds, togglePinned };
}

function MainHeaderImpl({
  workspace,
  parentName = null,
  worktreePath = null,
  activeFilePath = null,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  sessionTabsNode,
  canCopyThread: _canCopyThread = false,
  onCopyThread: _onCopyThread,
  onLockPanel: _onLockPanel,
  extraActionsNode,
  openAppExtraActions = EMPTY_OPEN_APP_EXTRA_ACTIONS,
  launchScript = null,
  launchScriptEditorOpen = false,
  launchScriptDraft = "",
  launchScriptSaving = false,
  launchScriptError = null,
  onRunLaunchScript,
  onOpenLaunchScriptEditor,
  onCloseLaunchScriptEditor,
  onLaunchScriptDraftChange,
  onSaveLaunchScript,
  launchScriptsState,
  showLaunchScriptControls = true,
  showOpenAppMenu = true,
  groupedWorkspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpenShortcutsSettings,
}: MainHeaderProps) {
  const { t } = useTranslation();
  // Built-in open-app PNGs load lazily; re-render once cached so the pinned
  // target buttons swap from the generic glyph to real logos.
  const knownOpenAppIconsLoaded = useKnownOpenAppIcons();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [shortcutsGuideOpen, setShortcutsGuideOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);

  // 判断是否显示项目选择菜单
  const showProjectMenu = Boolean(
    groupedWorkspaces &&
    groupedWorkspaces.length > 0 &&
    onSelectWorkspace
  );

  // 项目搜索过滤
  const trimmedProjectQuery = projectQuery.trim();
  const lowercaseProjectQuery = trimmedProjectQuery.toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!groupedWorkspaces) {
      return [];
    }
    if (trimmedProjectQuery.length === 0) {
      return groupedWorkspaces;
    }
    return groupedWorkspaces
      .map((group) => ({
        ...group,
        workspaces: group.workspaces.filter((ws) =>
          ws.name.toLowerCase().includes(lowercaseProjectQuery)
        ),
      }))
      .filter((group) => group.workspaces.length > 0);
  }, [groupedWorkspaces, lowercaseProjectQuery, trimmedProjectQuery]);

  const resolvedWorktreePath = worktreePath ?? workspace.path;
  const copyPathAction: OpenAppMenuExtraAction = useMemo(
    () => ({
      id: "copy-path",
      label: t("files.copyPath"),
      icon: <ClipboardCopy size={18} aria-hidden />,
      onSelect: () => {
        void copyTextToClipboard(resolvedWorktreePath);
      },
    }),
    [resolvedWorktreePath, t],
  );
  // 「右侧边栏开关」从下拉菜单中抽出，单独渲染为顶栏独立图标按钮（见下方 JSX）
  const rightPanelAction = useMemo(
    () => openAppExtraActions.find((action) => action.id === "right-panel"),
    [openAppExtraActions],
  );

  // 用户自选外显按钮：菜单里勾选的条目以图标按钮形式外显到顶栏
  const { pinnedIds, togglePinned } = useHeaderPinnedActions();
  const isLaunchScriptPinned = pinnedIds.includes("launch-script");
  const launchScriptControlsAvailable = Boolean(
    showLaunchScriptControls &&
      onRunLaunchScript &&
      onOpenLaunchScriptEditor &&
      onCloseLaunchScriptEditor &&
      onLaunchScriptDraftChange &&
      onSaveLaunchScript,
  );
  // 未外显时仍需在编辑态渲染整个 cluster，否则菜单里触发的脚本编辑弹层没有锚点
  const launchScriptEditorVisible = Boolean(
    launchScriptEditorOpen ||
      launchScriptsState?.newEditorOpen ||
      launchScriptsState?.editorOpenId,
  );
  const showLaunchScriptCluster =
    launchScriptControlsAvailable &&
    (isLaunchScriptPinned || launchScriptEditorVisible);
  const hasLaunchScript = Boolean(launchScript?.trim());
  const launchScriptMenuActions = useMemo<OpenAppMenuExtraAction[]>(() => {
    if (!launchScriptControlsAvailable || !onRunLaunchScript) {
      return [];
    }
    const actions: OpenAppMenuExtraAction[] = [
      {
        id: "launch-script",
        label: t(
          hasLaunchScript
            ? "composer.runLaunchScript"
            : "composer.setLaunchScript",
        ),
        icon: <Play size={18} aria-hidden />,
        onSelect: onRunLaunchScript,
      },
    ];
    if (!isLaunchScriptPinned && launchScriptsState) {
      for (const entry of launchScriptsState.launchScripts) {
        const EntryIcon = getLaunchScriptIcon(entry.icon);
        actions.push({
          id: `launch-script-entry-${entry.id}`,
          label: entry.label || t("composer.runLaunchScript"),
          icon: <EntryIcon size={18} aria-hidden />,
          onSelect: () => launchScriptsState.onRunScript(entry.id),
          pinnable: false,
        });
      }
    }
    return actions;
  }, [
    hasLaunchScript,
    isLaunchScriptPinned,
    launchScriptControlsAvailable,
    launchScriptsState,
    onRunLaunchScript,
    t,
  ]);
  const shortcutsGuideAction: OpenAppMenuExtraAction = useMemo(
    () => ({
      id: "shortcuts-guide",
      label: t("shortcutsGuide.title"),
      icon: <Keyboard size={18} aria-hidden />,
      onSelect: () => setShortcutsGuideOpen(true),
    }),
    [t],
  );
  const openAppMenuActions = useMemo(
    () => [
      ...launchScriptMenuActions,
      ...openAppExtraActions.filter((action) => action.id !== "right-panel"),
      shortcutsGuideAction,
      copyPathAction,
    ],
    [copyPathAction, launchScriptMenuActions, openAppExtraActions, shortcutsGuideAction],
  );
  const pinnedOpenTargets = useMemo(() => {
    if (!showOpenAppMenu) {
      return [];
    }
    const availableTargets =
      openTargets.length > 0 ? openTargets : DEFAULT_OPEN_APP_TARGETS;
    return availableTargets.filter((target) => pinnedIds.includes(target.id));
  }, [openTargets, pinnedIds, showOpenAppMenu]);
  const pinnedTargetIconById = useOpenAppIcons(pinnedOpenTargets, {
    enabled: pinnedOpenTargets.length > 0,
  });
  const pinnedExtraActions = useMemo(
    () =>
      openAppMenuActions.filter(
        (action) =>
          action.id !== "launch-script" && pinnedIds.includes(action.id),
      ),
    [openAppMenuActions, pinnedIds],
  );
  const handleOpenPinnedTarget = useCallback(
    async (target: OpenAppTarget) => {
      try {
        const path = resolveOpenAppPath(target, {
          workspacePath: resolvedWorktreePath,
          activeFilePath,
        });
        await openPathInTarget(path, target);
      } catch (openError) {
        pushErrorToast({
          title: t("errors.couldntOpenWorkspace"),
          message:
            openError instanceof Error ? openError.message : String(openError),
        });
      }
    },
    [activeFilePath, resolvedWorktreePath, t],
  );
  // 处理项目选择
  const handleSelectProject = (workspaceId: string) => {
    if (onSelectWorkspace) {
      onSelectWorkspace(workspaceId);
      setProjectMenuOpen(false);
      setProjectQuery("");
    }
  };
  useEffect(() => {
    if (!projectMenuOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const projectMenuContains =
        projectMenuRef.current?.contains(target) ?? false;
      if (!projectMenuContains) {
        setProjectMenuOpen(false);
        setProjectQuery("");
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("mousedown", handleClick);
    };
  }, [projectMenuOpen]);

  return (
    <header
      className={`main-header${sessionTabsNode ? " has-session-tabs" : ""}`}
      data-tauri-drag-region
    >
      <div className="workspace-header">
        <div className="workspace-title-line">
          {showProjectMenu ? (
            <div className="workspace-project-menu" ref={projectMenuRef}>
              <button
                type="button"
                className="workspace-project-button"
                onClick={() => {
                  setProjectMenuOpen((prev) => !prev);
                }}
                aria-haspopup="menu"
                aria-expanded={projectMenuOpen}
                data-tauri-drag-region="false"
              >
                <span className="workspace-project-icon" aria-hidden>
                  <Folder size={14} />
                </span>
                <span className="workspace-title">
                  {parentName ? parentName : workspace.name}
                </span>
                <span className="workspace-project-caret" aria-hidden>
                  ›
                </span>
              </button>
              {projectMenuOpen && (
                <div
                  className="workspace-project-dropdown"
                  role="menu"
                  data-tauri-drag-region="false"
                >
                  <label className="workspace-project-search">
                    <span className="workspace-project-search-icon" aria-hidden>
                      <Search size={14} />
                    </span>
                    <input
                      value={projectQuery}
                      onChange={(event) => setProjectQuery(event.target.value)}
                      placeholder={t("workspace.searchProjects")}
                      className="workspace-project-search-input"
                      autoFocus
                      data-tauri-drag-region="false"
                      aria-label={t("workspace.searchProjects")}
                    />
                  </label>
                  <div className="workspace-project-list" role="none">
                    {filteredGroups.map((group) => (
                      <div key={group.id ?? "ungrouped"} className="workspace-project-group">
                        {group.name && (
                          <div className="workspace-project-group-label">{group.name}</div>
                        )}
                        {group.workspaces.map((ws) => (
                          <button
                            key={ws.id}
                            type="button"
                            className={`workspace-project-item${
                              ws.kind === "worktree" ? " is-worktree" : ""
                            }${
                              ws.id === activeWorkspaceId ? " is-active" : ""
                            }`}
                            onClick={() => handleSelectProject(ws.id)}
                            role="menuitem"
                            data-tauri-drag-region="false"
                          >
                            <span className="workspace-project-item-icon" aria-hidden>
                              {ws.kind === "worktree" ? <GitBranch size={14} /> : <Folder size={14} />}
                            </span>
                            <span className="workspace-project-item-label">
                              {ws.kind === "worktree" ? (ws.worktree?.branch ?? ws.name) : ws.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                    {filteredGroups.length === 0 && (
                      <div className="workspace-project-empty">
                        {t("workspace.noProjectsFound")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="workspace-title">
              {parentName ? parentName : workspace.name}
            </span>
          )}
        </div>
      </div>
      {sessionTabsNode ? (
        <div
          className="main-header-session-tabs-slot"
          data-tauri-drag-region="false"
        >
          <div
            className="main-header-session-tabs-interactive"
            data-tauri-drag-region="false"
          >
            {sessionTabsNode}
          </div>
          <div
            className="main-header-session-tabs-drag-lane"
            data-tauri-drag-region
            aria-hidden="true"
          />
        </div>
      ) : null}
      <div className="main-header-actions">
        {showLaunchScriptCluster &&
          onRunLaunchScript &&
          onOpenLaunchScriptEditor &&
          onCloseLaunchScriptEditor &&
          onLaunchScriptDraftChange &&
          onSaveLaunchScript && (
            <div className="launch-script-cluster">
              <LaunchScriptButton
                launchScript={launchScript}
                editorOpen={launchScriptEditorOpen}
                draftScript={launchScriptDraft}
                isSaving={launchScriptSaving}
                error={launchScriptError}
                onRun={onRunLaunchScript}
                onOpenEditor={onOpenLaunchScriptEditor}
                onCloseEditor={onCloseLaunchScriptEditor}
                onDraftChange={onLaunchScriptDraftChange}
                onSave={onSaveLaunchScript}
                showNew={Boolean(launchScriptsState)}
                newEditorOpen={launchScriptsState?.newEditorOpen}
                newDraftScript={launchScriptsState?.newDraftScript}
                newDraftIcon={launchScriptsState?.newDraftIcon}
                newDraftLabel={launchScriptsState?.newDraftLabel}
                newError={launchScriptsState?.newError ?? null}
                onOpenNew={launchScriptsState?.onOpenNew}
                onCloseNew={launchScriptsState?.onCloseNew}
                onNewDraftChange={launchScriptsState?.onNewDraftScriptChange}
                onNewDraftIconChange={launchScriptsState?.onNewDraftIconChange}
                onNewDraftLabelChange={launchScriptsState?.onNewDraftLabelChange}
                onCreateNew={launchScriptsState?.onCreateNew}
              />
              {launchScriptsState?.launchScripts.map((entry) => (
                <LaunchScriptEntryButton
                  key={entry.id}
                  entry={entry}
                  editorOpen={launchScriptsState.editorOpenId === entry.id}
                  draftScript={launchScriptsState.draftScript}
                  draftIcon={launchScriptsState.draftIcon}
                  draftLabel={launchScriptsState.draftLabel}
                  isSaving={launchScriptsState.isSaving}
                  error={launchScriptsState.errorById[entry.id] ?? null}
                  onRun={() => launchScriptsState.onRunScript(entry.id)}
                  onOpenEditor={() => launchScriptsState.onOpenEditor(entry.id)}
                  onCloseEditor={launchScriptsState.onCloseEditor}
                  onDraftChange={launchScriptsState.onDraftScriptChange}
                  onDraftIconChange={launchScriptsState.onDraftIconChange}
                  onDraftLabelChange={launchScriptsState.onDraftLabelChange}
                  onSave={launchScriptsState.onSaveScript}
                  onDelete={launchScriptsState.onDeleteScript}
                />
              ))}
            </div>
          )}
        {pinnedOpenTargets.map((target) => (
          <TooltipIconButton
            key={target.id}
            className="ghost main-header-action"
            onClick={() => void handleOpenPinnedTarget(target)}
            data-tauri-drag-region="false"
            label={t("settings.openInTarget", { target: target.label })}
          >
            <img
              className="open-app-icon"
              src={
                (knownOpenAppIconsLoaded
                  ? getKnownOpenAppIcon(target.id)
                  : null) ??
                pinnedTargetIconById[target.id] ??
                openAppIconById[target.id] ??
                GENERIC_APP_ICON
              }
              alt=""
              aria-hidden
            />
          </TooltipIconButton>
        ))}
        {pinnedExtraActions.map((action) => (
          <TooltipIconButton
            key={action.id}
            className={`ghost main-header-action${action.active ? " is-active" : ""}`}
            onClick={action.onSelect}
            data-tauri-drag-region="false"
            label={action.label}
            aria-pressed={action.active}
          >
            {isValidElement(action.icon)
              ? cloneElement(
                  action.icon as ReactElement<{ size?: number }>,
                  { size: 14 },
                )
              : action.icon}
          </TooltipIconButton>
        ))}
        {showOpenAppMenu ? (
          <OpenAppMenu
            path={resolvedWorktreePath}
            activeFilePath={activeFilePath}
            openTargets={openTargets}
            selectedOpenAppId={selectedOpenAppId}
            onSelectOpenAppId={onSelectOpenAppId}
            iconById={openAppIconById}
            iconOnly
            extraActions={openAppMenuActions}
            pinnedIds={pinnedIds}
            onTogglePinned={togglePinned}
          />
        ) : null}
        {extraActionsNode}
        {rightPanelAction ? (
          <TooltipIconButton
            className="ghost main-header-action"
            onClick={rightPanelAction.onSelect}
            data-tauri-drag-region="false"
            label={rightPanelAction.label}
          >
            {isValidElement(rightPanelAction.icon)
              ? cloneElement(
                  rightPanelAction.icon as ReactElement<{ size?: number }>,
                  { size: 14 },
                )
              : rightPanelAction.icon}
          </TooltipIconButton>
        ) : null}
      </div>
      <ShortcutsGuideModal
        open={shortcutsGuideOpen}
        onOpenChange={setShortcutsGuideOpen}
        onOpenShortcutsSettings={onOpenShortcutsSettings}
      />
    </header>
  );
}

export const MainHeader = memo(MainHeaderImpl);
MainHeader.displayName = "MainHeader";
