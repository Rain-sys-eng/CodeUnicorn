import { useEffect, useState } from "react";
import {
  peekDockIconSrc,
  resolveDockIconSrc,
  sanitizeDockIconId,
} from "../utils/dockIcon";

type UseDockIconSrcOptions = {
  /** When false, skip loading (e.g. hidden overlays); cached URLs still return. */
  enabled?: boolean;
};

/**
 * Resolves a dock/app logo URL from its lazily imported asset chunk.
 * Returns null until the chunk loads; a brief icon-less paint is expected
 * (dock PNGs are intentionally kept off the eager AppShell bundle).
 */
export function useDockIconSrc(
  iconId: unknown,
  options?: UseDockIconSrcOptions,
): string | null {
  const enabled = options?.enabled ?? true;
  const safeId = sanitizeDockIconId(iconId);
  const cachedSrc = peekDockIconSrc(safeId);
  const [, setLoadedIconId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || peekDockIconSrc(safeId)) {
      return;
    }
    let active = true;
    resolveDockIconSrc(safeId)
      .then(() => {
        if (active) {
          setLoadedIconId(safeId);
        }
      })
      .catch(() => {
        // Keep the icon-less fallback; a later mount/id change retries.
      });
    return () => {
      active = false;
    };
  }, [enabled, safeId]);

  return cachedSrc;
}
