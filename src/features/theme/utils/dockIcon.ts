import { setDockIcon } from "../../../services/tauri/settings";

/** Dock / app logo preference id. `default` is the shipping product icon. */
export type DockIconId =
  | "default"
  | "multi-orbit-hub"
  | "open-star-ring"
  | "gravitational-core"
  | "dual-orbit-handoff"
  | "layered-control-plane"
  | "four-port-router"
  | "adaptive-routing-fabric"
  | "triadic-router";

export type DockIconOption = {
  id: DockIconId;
  labelKey: string;
};

export const DEFAULT_DOCK_ICON_ID: DockIconId = "default";

export const DOCK_ICON_OPTIONS: readonly DockIconOption[] = [
  { id: "default", labelKey: "settings.dockIconDefault" },
  { id: "multi-orbit-hub", labelKey: "settings.dockIconMultiOrbitHub" },
  { id: "open-star-ring", labelKey: "settings.dockIconOpenStarRing" },
  { id: "gravitational-core", labelKey: "settings.dockIconGravitationalCore" },
  { id: "dual-orbit-handoff", labelKey: "settings.dockIconDualOrbitHandoff" },
  {
    id: "layered-control-plane",
    labelKey: "settings.dockIconLayeredControlPlane",
  },
  { id: "four-port-router", labelKey: "settings.dockIconFourPortRouter" },
  {
    id: "adaptive-routing-fabric",
    labelKey: "settings.dockIconAdaptiveRoutingFabric",
  },
  { id: "triadic-router", labelKey: "settings.dockIconTriadicRouter" },
] as const;

/**
 * Cold-start: the 9 dock PNGs (~2.4MB raw) must stay off the eager AppShell
 * chunk. Each icon URL lives in its own lazily imported module; consumers get
 * the URL via `resolveDockIconSrc` (async) or `peekDockIconSrc` (cache).
 */
const DOCK_ICON_SRC_LOADERS: Record<DockIconId, () => Promise<string>> = {
  default: () =>
    import("../../../assets/dock-icons/default.png?url").then(
      (module) => module.default,
    ),
  "multi-orbit-hub": () =>
    import("../../../assets/dock-icons/orbit-routing/multi-orbit-hub.png?url").then(
      (module) => module.default,
    ),
  "open-star-ring": () =>
    import("../../../assets/dock-icons/orbit-routing/open-star-ring.png?url").then(
      (module) => module.default,
    ),
  "gravitational-core": () =>
    import(
      "../../../assets/dock-icons/orbit-routing/gravitational-core.png?url"
    ).then((module) => module.default),
  "dual-orbit-handoff": () =>
    import(
      "../../../assets/dock-icons/orbit-routing/dual-orbit-handoff.png?url"
    ).then((module) => module.default),
  "layered-control-plane": () =>
    import(
      "../../../assets/dock-icons/orbit-routing/layered-control-plane.png?url"
    ).then((module) => module.default),
  "four-port-router": () =>
    import(
      "../../../assets/dock-icons/orbit-routing/four-port-router.png?url"
    ).then((module) => module.default),
  "adaptive-routing-fabric": () =>
    import(
      "../../../assets/dock-icons/orbit-routing/adaptive-routing-fabric.png?url"
    ).then((module) => module.default),
  "triadic-router": () =>
    import("../../../assets/dock-icons/orbit-routing/triadic-router.png?url").then(
      (module) => module.default,
    ),
};

const DOCK_ICON_ID_SET = new Set<string>(
  DOCK_ICON_OPTIONS.map((option) => option.id),
);

const dockIconSrcCache = new Map<DockIconId, string>();
const dockIconSrcPromises = new Map<DockIconId, Promise<string>>();

export function isDockIconId(value: unknown): value is DockIconId {
  return typeof value === "string" && DOCK_ICON_ID_SET.has(value);
}

export function sanitizeDockIconId(value: unknown): DockIconId {
  return isDockIconId(value) ? value : DEFAULT_DOCK_ICON_ID;
}

/** Cached logo URL if that icon chunk already loaded this session, else null. */
export function peekDockIconSrc(iconId: unknown): string | null {
  return dockIconSrcCache.get(sanitizeDockIconId(iconId)) ?? null;
}

/** Resolve logo URL for Dock settings, About, lock screen, etc. (lazy chunk). */
export function resolveDockIconSrc(iconId: unknown): Promise<string> {
  const safeId = sanitizeDockIconId(iconId);
  let promise = dockIconSrcPromises.get(safeId);
  if (!promise) {
    promise = DOCK_ICON_SRC_LOADERS[safeId]().then((url) => {
      dockIconSrcCache.set(safeId, url);
      return url;
    });
    // Failed loads are evicted so a later call can retry instead of
    // permanently caching the rejection.
    promise.catch(() => {
      dockIconSrcPromises.delete(safeId);
    });
    dockIconSrcPromises.set(safeId, promise);
  }
  return promise;
}

/** PNG signature: \x89PNG\r\n\x1a\n */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function assertPngBytes(bytes: Uint8Array, context: string): void {
  if (bytes.byteLength < PNG_MAGIC.length) {
    throw new Error(`${context}: dock icon payload too short`);
  }
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      throw new Error(`${context}: dock icon payload is not a PNG`);
    }
  }
}

async function loadPngBytes(src: string): Promise<Uint8Array> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`failed to load dock icon asset: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  assertPngBytes(bytes, src);
  return bytes;
}

/**
 * Serializes rapid preference changes so an older in-flight apply cannot
 * overwrite a newer selection (common when users click through the rail quickly).
 */
let dockIconApplyGeneration = 0;

/** Last successfully requested id (used to re-stamp secondary windows on Win/Linux). */
let lastRequestedDockIconId: DockIconId = DEFAULT_DOCK_ICON_ID;

/**
 * Apply app icon preference across platforms.
 *
 * Always loads PNG bytes (including `default`) so picker / Dock / taskbar / window
 * icons stay consistent. Backend maps:
 * - macOS → NSApplication Dock icon (+ window chrome best-effort)
 * - Windows/Linux → window icons for every open window (taskbar / window chrome)
 *
 * Prefer re-calling this when secondary windows open so late-created surfaces
 * pick up the current preference (Win/Linux have no process-wide app icon API).
 */
export async function applyDockIconPreference(iconId: unknown): Promise<void> {
  const generation = ++dockIconApplyGeneration;
  const safeId = sanitizeDockIconId(iconId);
  lastRequestedDockIconId = safeId;
  const src = await resolveDockIconSrc(safeId);
  const pngBytes = await loadPngBytes(src);
  if (generation !== dockIconApplyGeneration) {
    return;
  }
  await setDockIcon({ iconId: safeId, pngBytes });
}

/**
 * Re-apply the last selected icon to all currently open windows.
 * Call after creating secondary surfaces (About, detached explorer) on Win/Linux.
 */
export async function reapplyLastDockIconPreference(): Promise<void> {
  await applyDockIconPreference(lastRequestedDockIconId);
}
