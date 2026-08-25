import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";

type ProcessPhaseBreakdown = {
  reasoningCount: number;
  toolCount: number;
  exploreCount: number;
  /** 极简展示 turn chip：被折叠的中间叙述 prose 段数。 */
  proseCount?: number;
};

type MiddleStepsCollapsedChipProps = {
  count: number;
  expanded: boolean;
  breakdown: ProcessPhaseBreakdown;
  onToggle: () => void;
};

/**
 * Flat process-phase control:
 *   思考 2 次 工具调用 5 次 ›
 *   ────────────────────────────────
 */
export const MiddleStepsCollapsedChip = memo(function MiddleStepsCollapsedChip({
  count,
  expanded,
  breakdown,
  onToggle,
}: MiddleStepsCollapsedChipProps) {
  const { t } = useTranslation();

  const label = useMemo(() => {
    const stats: string[] = [];
    if (breakdown.reasoningCount > 0) {
      stats.push(
        t("messages.middleStepsStatReasoning", { count: breakdown.reasoningCount }),
      );
    }
    if (breakdown.toolCount > 0) {
      stats.push(t("messages.middleStepsStatTool", { count: breakdown.toolCount }));
    }
    if (breakdown.exploreCount > 0) {
      stats.push(t("messages.middleStepsStatExplore", { count: breakdown.exploreCount }));
    }
    if ((breakdown.proseCount ?? 0) > 0) {
      stats.push(
        t("messages.middleStepsStatNarration", { count: breakdown.proseCount }),
      );
    }
    // Fallback when kinds were filtered but a phase still exists.
    if (stats.length === 0 && count > 0) {
      stats.push(t("messages.middleStepsProcessedSteps", { count }));
    }
    // e.g. 思考 4 次 工具调用 23 次
    return stats.join(" ");
  }, [breakdown, count, t]);

  const ariaLabel = t("messages.middleStepsProcessedAria", {
    count,
    duration: "",
    detail: label,
    state: expanded
      ? t("messages.middleStepsCollapseAction")
      : t("messages.middleStepsExpandAction"),
  });

  return (
    <div
      className={`messages-process-phase-drawer${expanded ? " is-expanded" : " is-collapsed"}`}
    >
      <button
        type="button"
        className={`messages-live-middle-collapsed-indicator messages-process-phase-toggle${
          expanded ? " is-expanded" : " is-collapsed"
        }`}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={ariaLabel}
      >
        <span className="messages-process-phase-toggle-copy">
          <span className="messages-process-phase-toggle-label">{label}</span>
          <ChevronRight
            className="messages-process-phase-toggle-chevron"
            size={14}
            strokeWidth={2}
            aria-hidden
          />
        </span>
        <span className="messages-process-phase-toggle-rule" aria-hidden />
      </button>
    </div>
  );
});
