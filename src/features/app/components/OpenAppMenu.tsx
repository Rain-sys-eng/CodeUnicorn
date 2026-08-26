import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Ellipsis from "lucide-react/dist/esm/icons/ellipsis";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import { pushErrorToast } from "../../../services/toasts";
import type { OpenAppTarget } from "../../../types";
import { openPathInTarget, resolveOpenAppPath } from "../utils/openApp";
import { useKnownOpenAppIcons } from "../hooks/useKnownOpenAppIcons";
import { useOpenAppIcons } from "../hooks/useOpenAppIcons";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "../constants";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { GENERIC_APP_ICON, getKnownOpenAppIcon } from "../utils/openAppIcons";

type OpenTarget = {
  id: string;
  label: string;
  icon: string;
  target: OpenAppTarget;
};

export type OpenAppMenuExtraAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  active?: boolean;
  /** false 时该行不显示「在顶栏显示」勾选框（如启动脚本子条目） */
  pinnable?: boolean;
};

type OpenAppMenuProps = {
  /** Workspace / folder fallback path (also used for file-manager targets). */
  path: string;
  /**
   * Currently focused file (absolute or workspace-relative).
   * App/command targets prefer this over `path`.
   */
  activeFilePath?: string | null;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  iconById?: Record<string, string>;
  iconOnly?: boolean;
  extraActions?: OpenAppMenuExtraAction[];
  /** 勾选后外显到顶栏的条目 id；配合 onTogglePinned 启用勾选框 */
  pinnedIds?: string[];
  onTogglePinned?: (id: string) => void;
  /** Footer menus open upward so they aren't clipped. */
  menuPlacement?: "up" | "down";
};

const EMPTY_OPEN_APP_ICON_BY_ID: Record<string, string> = {};
const EMPTY_OPEN_APP_EXTRA_ACTIONS: OpenAppMenuExtraAction[] = [];
const EMPTY_PINNED_IDS: string[] = [];

export function OpenAppMenu({
  path,
  activeFilePath = null,
  openTargets,
  selectedOpenAppId,
  onSelectOpenAppId,
  iconById = EMPTY_OPEN_APP_ICON_BY_ID,
  iconOnly = false,
  extraActions = EMPTY_OPEN_APP_EXTRA_ACTIONS,
  pinnedIds = EMPTY_PINNED_IDS,
  onTogglePinned,
  menuPlacement = "down",
}: OpenAppMenuProps) {
  const { t } = useTranslation();
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  // 保持菜单挂载到退出动画播完，`data-state="closed"` 才能渲染出渐隐
  const [menuRendered, setMenuRendered] = useState(false);
  const openMenuRef = useRef<HTMLDivElement | null>(null);
  const availableTargets =
    openTargets.length > 0 ? openTargets : DEFAULT_OPEN_APP_TARGETS;
  // Built-in open-app PNGs load lazily; recompute icons once they are cached.
  const knownOpenAppIconsLoaded = useKnownOpenAppIcons();
  const lazyIconById = useOpenAppIcons(availableTargets, { enabled: openMenuOpen });
  const openAppId = useMemo(
    () =>
      availableTargets.find((target) => target.id === selectedOpenAppId)?.id,
    [availableTargets, selectedOpenAppId],
  );
  const resolvedOpenAppId =
    openAppId ?? availableTargets[0]?.id ?? DEFAULT_OPEN_APP_ID;

  const resolvedOpenTargets = useMemo<OpenTarget[]>(
    () =>
      availableTargets.map((target) => ({
        id: target.id,
        label: target.label,
        icon:
          (knownOpenAppIconsLoaded ? getKnownOpenAppIcon(target.id) : null) ??
          lazyIconById[target.id] ??
          iconById[target.id] ??
          GENERIC_APP_ICON,
        target,
      })),
    [availableTargets, iconById, knownOpenAppIconsLoaded, lazyIconById],
  );

  const fallbackTarget: OpenTarget = {
    id: DEFAULT_OPEN_APP_ID,
    label: DEFAULT_OPEN_APP_TARGETS[0]?.label ?? "Open",
    icon: getKnownOpenAppIcon(DEFAULT_OPEN_APP_ID) ?? GENERIC_APP_ICON,
    target:
      DEFAULT_OPEN_APP_TARGETS[0] ?? {
        id: DEFAULT_OPEN_APP_ID,
        label: "VS Code",
        kind: "app",
        appName: "Visual Studio Code",
        command: null,
        args: [],
      },
  };
  const selectedOpenTarget =
    resolvedOpenTargets.find((target) => target.id === resolvedOpenAppId) ??
    resolvedOpenTargets[0] ??
    fallbackTarget;
  const selectedOpenLabel = t("settings.openInTarget", {
    target: selectedOpenTarget.label,
  });
  const selectEditorLabel = t("settings.selectEditor");

  const reportOpenError = (error: unknown, target: OpenTarget) => {
    const message = error instanceof Error ? error.message : String(error);
    pushErrorToast({
      title: t("errors.couldntOpenWorkspace"),
      message,
    });
    console.warn("Failed to open workspace in target app", {
      message,
      path,
      targetId: target.id,
    });
  };

  useEffect(() => {
    if (openMenuOpen) {
      setMenuRendered(true);
    }
  }, [openMenuOpen]);

  useEffect(() => {
    if (!openMenuOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const openContains = openMenuRef.current?.contains(target) ?? false;
      if (!openContains) {
        setOpenMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("mousedown", handleClick);
    };
  }, [openMenuOpen]);

  const openWithTarget = async (target: OpenTarget) => {
    try {
      const resolvedPath = resolveOpenAppPath(target.target, {
        workspacePath: path,
        activeFilePath,
      });
      await openPathInTarget(resolvedPath, target.target);
    } catch (error) {
      reportOpenError(error, target);
    }
  };

  const handleOpen = async () => {
    if (!selectedOpenTarget) {
      return;
    }
    await openWithTarget(selectedOpenTarget);
  };

  const handleSelectOpenTarget = async (target: OpenTarget) => {
    onSelectOpenAppId(target.id);
    writeClientStoreValue("app", "openWorkspaceApp", target.id);
    setOpenMenuOpen(false);
    await openWithTarget(target);
  };

  const handleSelectExtraAction = (action: OpenAppMenuExtraAction) => {
    setOpenMenuOpen(false);
    action.onSelect();
  };

  const renderPinCheckbox = (id: string, pinnable = true) =>
    onTogglePinned && pinnable ? (
      <input
        type="checkbox"
        className="open-app-command-pin"
        checked={pinnedIds.includes(id)}
        onChange={() => onTogglePinned(id)}
        aria-label={t("common.showInHeader")}
        title={t("common.showInHeader")}
        data-tauri-drag-region="false"
      />
    ) : null;

  if (iconOnly) {
    return (
      <div className="open-app-menu is-icon-only" ref={openMenuRef}>
        <TooltipIconButton
          className="ghost main-header-action open-app-fusion-trigger"
          onClick={() => setOpenMenuOpen((prev) => !prev)}
          data-tauri-drag-region="false"
          aria-haspopup="menu"
          aria-expanded={openMenuOpen}
          label={t("common.moreActions")}
        >
          <Ellipsis size={16} aria-hidden />
        </TooltipIconButton>
        {menuRendered && (
          <div
            className="open-app-command-menu popover-surface"
            role="menu"
            data-state={openMenuOpen ? "open" : "closed"}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && !openMenuOpen) {
                setMenuRendered(false);
              }
            }}
          >
            {resolvedOpenTargets.map((target) => (
              <div
                key={target.id}
                className={`open-app-command-option${
                  target.id === resolvedOpenAppId ? " is-active" : ""
                }`}
              >
                <button
                  type="button"
                  className="open-app-command-main"
                  onClick={() => handleSelectOpenTarget(target)}
                  role="menuitem"
                  data-tauri-drag-region="false"
                  aria-label={target.label}
                  title={target.label}
                >
                  <span className="open-app-command-icon" aria-hidden>
                    <img className="open-app-icon" src={target.icon} alt="" />
                  </span>
                  <span className="open-app-command-label">{target.label}</span>
                </button>
                {renderPinCheckbox(target.id)}
              </div>
            ))}
            {extraActions.map((action) => (
              <div
                key={action.id}
                className={`open-app-command-option${action.active ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="open-app-command-main"
                  onClick={() => handleSelectExtraAction(action)}
                  role="menuitem"
                  data-tauri-drag-region="false"
                >
                  <span className="open-app-command-icon" aria-hidden>
                    {action.icon}
                  </span>
                  <span className="open-app-command-label">{action.label}</span>
                </button>
                {renderPinCheckbox(action.id, action.pinnable !== false)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`open-app-menu${openMenuOpen ? " is-open" : ""}${
        menuPlacement === "up" ? " is-menu-up" : ""
      }`}
      ref={openMenuRef}
    >
      <div className={`open-app-button${iconOnly ? " is-icon-only" : ""}`}>
        <button
          type="button"
          className={`ghost main-header-action open-app-action${iconOnly ? " is-icon-only" : ""}`}
          onClick={handleOpen}
          data-tauri-drag-region="false"
          aria-label={selectedOpenLabel}
          title={selectedOpenLabel}
        >
          {iconOnly ? (
            <img
              className="open-app-icon"
              src={selectedOpenTarget.icon}
              alt=""
              aria-hidden
            />
          ) : (
            <span className="open-app-label">
              <img
                className="open-app-icon"
                src={selectedOpenTarget.icon}
                alt=""
                aria-hidden
              />
              <span className="open-app-label-text">
                {selectedOpenTarget.label}
              </span>
            </span>
          )}
        </button>
        <button
          type="button"
          className={`ghost main-header-action open-app-toggle${iconOnly ? " is-icon-only" : ""}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpenMenuOpen((prev) => !prev);
          }}
          data-tauri-drag-region="false"
          aria-haspopup="menu"
          aria-expanded={openMenuOpen}
          aria-label={selectEditorLabel}
          title={selectEditorLabel}
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>
      {openMenuOpen && (
        <div className="open-app-dropdown" role="menu">
          {resolvedOpenTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={`open-app-option${
                target.id === resolvedOpenAppId ? " is-active" : ""
              }`}
              onClick={() => handleSelectOpenTarget(target)}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              <img className="open-app-icon" src={target.icon} alt="" aria-hidden />
              {target.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
