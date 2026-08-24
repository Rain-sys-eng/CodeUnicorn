import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import ListTree from "lucide-react/dist/esm/icons/list-tree";
import Pin from "lucide-react/dist/esm/icons/pin";
import PinOff from "lucide-react/dist/esm/icons/pin-off";
import type { MarkdownOutlineEntry } from "../../../markdown/fastMarkdownRenderer";
import { useCollapsibleFloater } from "../../hooks/useCollapsibleFloater";
import { loadMessagesOutlineFloaterStyles } from "../../../../styles/featureStyleLoaders";

type MessagesOutlineFloaterProps = {
  outline: MarkdownOutlineEntry[] | null;
  activeHeadingId: string | null;
  onJumpToHeading: (headingId: string) => void;
};

export function MessagesOutlineFloater({
  outline,
  activeHeadingId,
  onJumpToHeading,
}: MessagesOutlineFloaterProps) {
  const { t } = useTranslation();
  const { state, expand, scheduleCollapse, reset, togglePin } =
    useCollapsibleFloater();

  useEffect(() => {
    if (outline && outline.length > 0) {
      void loadMessagesOutlineFloaterStyles();
    }
  }, [outline]);

  // Reset state to collapsed only when the outline CONTENT identity
  // changes (e.g. user scrolled to a different message). Using the
  // outline length + first heading id avoids re-collapsing on every
  // streaming re-render that produces a new array reference but the
  // same content.
  const outlineIdentity = outline
    ? `${outline.length}:${outline[0]?.id ?? "none"}`
    : "empty";
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineIdentity]);

  if (!outline || outline.length === 0) {
    return null;
  }

  const isCollapsed = state === "collapsed";
  const isPinned = state === "pinned";

  return (
    <div
      className="messages-outline-floater"
      data-testid="messages-outline-floater"
      data-state={state}
    >
      {isCollapsed ? (
        <button
          type="button"
          className="messages-outline-floater-entry"
          aria-label={t("messages.outlineShow")}
          title={t("messages.outlineShow")}
          data-testid="messages-outline-floater-entry"
          onClick={expand}
        >
          <ListTree size={16} aria-hidden />
        </button>
      ) : (
        <div
          className="messages-outline-floater-panel"
          onMouseEnter={expand}
          onMouseLeave={isPinned ? undefined : scheduleCollapse}
          role="dialog"
          aria-label={t("messages.outlineShow")}
        >
          <div className="messages-outline-floater-header">
            <span>{t("messages.outlineShow")}</span>
            <button
              type="button"
              className="messages-outline-floater-pin"
              aria-label={isPinned ? t("messages.outlineUnpin") : t("messages.outlinePin")}
              title={isPinned ? t("messages.outlineUnpin") : t("messages.outlinePin")}
              onClick={togglePin}
            >
              {isPinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
            </button>
          </div>
          <ul className="messages-outline-floater-list">
            {outline.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`messages-outline-floater-row${
                    activeHeadingId === entry.id ? " is-active" : ""
                  }`}
                  style={{ paddingInlineStart: `${(entry.depth - 1) * 12 + 8}px` }}
                  onClick={() => onJumpToHeading(entry.id)}
                  data-depth={entry.depth}
                  data-anchor={entry.anchor}
                  data-testid="messages-outline-floater-row"
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
