import { useEffect, useState } from "react";
import {
  areKnownOpenAppIconsLoaded,
  ensureKnownOpenAppIconsLoaded,
} from "../utils/openAppIcons";

/**
 * Loads the built-in open-app PNG icon URLs (lazy chunks, kept off the eager
 * AppShell bundle) on mount and re-renders the caller once they are cached, so
 * sync getters like `getKnownOpenAppIcon` start returning real logos.
 * Returns the loaded flag for use in memo dependencies; callers that resolve
 * icons directly in render can ignore it.
 */
export function useKnownOpenAppIcons(): boolean {
  const [loaded, setLoaded] = useState(() => areKnownOpenAppIconsLoaded());

  useEffect(() => {
    if (areKnownOpenAppIconsLoaded()) {
      return;
    }
    let active = true;
    ensureKnownOpenAppIconsLoaded()
      .then(() => {
        if (active) {
          setLoaded(true);
        }
      })
      .catch(() => {
        // Generic glyphs remain; the next mount retries the load.
      });
    return () => {
      active = false;
    };
  }, []);

  return loaded;
}
