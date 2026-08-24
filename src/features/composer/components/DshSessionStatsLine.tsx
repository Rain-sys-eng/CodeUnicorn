import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThreadTokenUsage } from "../../../types";
import { deriveDshSessionStatsLine } from "../utils/dshSessionStats";

type DshSessionStatsLineProps = {
  usage?: ThreadTokenUsage | null;
};

export const DshSessionStatsLine = memo(function DshSessionStatsLine({
  usage = null,
}: DshSessionStatsLineProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  const model = useMemo(() => deriveDshSessionStatsLine(usage), [usage]);
  const groups = useMemo(() => {
    if (!model) {
      return [];
    }
    const speeds: string[] = [];
    if (model.ttftAverage) {
      speeds.push(
        t("composer.dshStatsTtftAverage", {
          defaultValue: "首 token 平均 {{duration}}",
          duration: model.ttftAverage,
        }),
      );
    }
    if (model.tokensPerSecond) {
      speeds.push(
        t("composer.dshStatsTokensPerSecond", {
          defaultValue: "{{throughput}} tok/s",
          throughput: model.tokensPerSecond,
        }),
      );
    }
    const next: string[] = [];
    if (speeds.length > 0) {
      next.push(speeds.join(" · "));
    }
    if (model.cacheHitPercent !== null) {
      next.push(
        t("composer.dshStatsCacheHit", {
          defaultValue: "缓存命中 {{percent}}%",
          percent: model.cacheHitPercent,
        }),
      );
    }
    return next;
  }, [model, t]);
  const line = groups.join(" | ");

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setTruncated(element.scrollWidth > element.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [line]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="composer-dsh-stats-line"
      title={truncated ? line : undefined}
      aria-label={line}
    >
      {groups.map((group, index) => (
        <span key={group}>
          {index > 0 ? (
            <>
              <span className="composer-dsh-stats-sep" aria-hidden>
                |
              </span>{" "}
            </>
          ) : null}
          <span>{group}</span>
        </span>
      ))}
    </div>
  );
});
