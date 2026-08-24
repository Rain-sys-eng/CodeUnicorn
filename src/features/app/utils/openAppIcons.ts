import type { OpenAppTarget } from "../../../types";

type KnownOpenAppPngIconId =
  | "cursor"
  | "finder"
  | "antigravity"
  | "ghostty"
  | "idea"
  | "vscode"
  | "zed";

/**
 * Cold-start: bundled app-icon PNGs (~216KB raw) stay off the eager AppShell
 * chunk. Components call `useKnownOpenAppIcons()` (or
 * `ensureKnownOpenAppIconsLoaded()`) to hydrate the cache; until then the sync
 * getters below fall back to null → generic glyph for one brief paint.
 */
const KNOWN_PNG_ICON_LOADERS: Record<
  KnownOpenAppPngIconId,
  () => Promise<string>
> = {
  cursor: () =>
    import("../../../assets/app-icons/cursor.png?url").then(
      (module) => module.default,
    ),
  finder: () =>
    import("../../../assets/app-icons/finder.png?url").then(
      (module) => module.default,
    ),
  antigravity: () =>
    import("../../../assets/app-icons/antigravity.png?url").then(
      (module) => module.default,
    ),
  ghostty: () =>
    import("../../../assets/app-icons/ghostty.png?url").then(
      (module) => module.default,
    ),
  idea: () =>
    import("../../../assets/app-icons/idea.png?url").then(
      (module) => module.default,
    ),
  vscode: () =>
    import("../../../assets/app-icons/vscode.png?url").then(
      (module) => module.default,
    ),
  zed: () =>
    import("../../../assets/app-icons/zed.png?url").then(
      (module) => module.default,
    ),
};

const KNOWN_PNG_ICON_COUNT = Object.keys(KNOWN_PNG_ICON_LOADERS).length;

const knownPngIconSrcById = new Map<KnownOpenAppPngIconId, string>();
let knownPngIconsLoadPromise: Promise<void> | null = null;

/** True once every built-in PNG icon URL is cached for sync lookup. */
export function areKnownOpenAppIconsLoaded(): boolean {
  return knownPngIconSrcById.size === KNOWN_PNG_ICON_COUNT;
}

/** Load all built-in PNG icon URLs (lazy chunks); idempotent, promise cached. */
export function ensureKnownOpenAppIconsLoaded(): Promise<void> {
  if (!knownPngIconsLoadPromise) {
    const entries = Object.entries(KNOWN_PNG_ICON_LOADERS) as Array<
      [KnownOpenAppPngIconId, () => Promise<string>]
    >;
    const loadAll = Promise.all(
      entries.map(([id, load]) =>
        load().then((url) => {
          knownPngIconSrcById.set(id, url);
        }),
      ),
    ).then(() => undefined);
    // Evict failed loads so a later mount retries instead of caching the error.
    loadAll.catch(() => {
      knownPngIconsLoadPromise = null;
    });
    knownPngIconsLoadPromise = loadAll;
  }
  return knownPngIconsLoadPromise;
}

function getKnownPngIcon(id: KnownOpenAppPngIconId): string | null {
  return knownPngIconSrcById.get(id) ?? null;
}

/**
 * IMPORTANT: keep raw `#` colors here. `svgDataUri` runs encodeURIComponent;
 * pre-encoding as `%23` would double-encode and break fills (renders black).
 */
const GENERIC_APP_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#9CA3AF' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='3' width='16' height='18' rx='3' ry='3'/><path d='M9 7h6'/><path d='M9 11h6'/><path d='M9 15h4'/></svg>";

const SUBLIME_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='5' fill='#FF9800'/><path d='M7 8.5c1.8-.8 3.8-1.2 5.8-.9 1.1.2 2.2.6 3.2 1.2v1.6c-1-.5-2.1-.9-3.3-1-1.7-.2-3.4.1-5 .7L7 10.5V8.5zm0 3.8c1.8-.8 3.8-1.2 5.8-.9 1.1.2 2.2.6 3.2 1.2v1.6c-1-.5-2.1-.9-3.3-1-1.7-.2-3.4.1-5 .7L7 14.3v-2zm0 3.8c1.8-.8 3.8-1.2 5.8-.9 1.1.2 2.2.6 3.2 1.2V18c-1-.5-2.1-.9-3.3-1-1.7-.2-3.4.1-5 .7L7 18.1v-2z' fill='#fff'/></svg>";

const NOTEPAD_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'><rect x='4' y='3' width='16' height='18' rx='2' fill='#F4F4F5' stroke='#A1A1AA'/><path d='M8 8h8M8 12h8M8 16h5' stroke='#525A6A' stroke-width='1.5' stroke-linecap='round'/></svg>";

const TERMINAL_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'><rect x='3' y='4' width='18' height='16' rx='2.5' fill='#18181B'/><path d='M7 9l3 3-3 3M12 15h5' stroke='#78EBBE' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>";

const COMMAND_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#9CA3AF' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'><path d='M7 8l-3 4 3 4'/><path d='M17 8l3 4-3 4'/><path d='M14 6l-4 12'/></svg>";

const CHROME_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='#F1F3F4'/><circle cx='12' cy='12' r='3.6' fill='#4285F4'/><path d='M12 2a10 10 0 0 1 8.66 5H13.2A3.6 3.6 0 0 0 12 8.4 3.6 3.6 0 0 0 8.8 7L12 2z' fill='#EA4335'/><path d='M20.66 7A10 10 0 0 1 12 22l3.2-5.54A3.6 3.6 0 0 0 15.6 12c0-.72-.21-1.39-.58-1.94H20.66z' fill='#FBBC05'/><path d='M12 22A10 10 0 0 1 3.34 7l5.04 2.91A3.6 3.6 0 0 0 8.4 12c0 1.16.55 2.19 1.4 2.85L12 22z' fill='#34A853'/></svg>";

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const GENERIC_APP_ICON = svgDataUri(GENERIC_APP_SVG);
export const SUBLIME_APP_ICON = svgDataUri(SUBLIME_SVG);
export const NOTEPAD_APP_ICON = svgDataUri(NOTEPAD_SVG);
export const TERMINAL_APP_ICON = svgDataUri(TERMINAL_SVG);
export const COMMAND_APP_ICON = svgDataUri(COMMAND_SVG);
export const CHROME_APP_ICON = svgDataUri(CHROME_SVG);

export function getKnownOpenAppIcon(id: string): string | null {
  switch (id) {
    case "vscode":
      return getKnownPngIcon("vscode");
    case "cursor":
      return getKnownPngIcon("cursor");
    case "zed":
      return getKnownPngIcon("zed");
    case "idea":
    case "intellij":
    case "jetbrains":
      return getKnownPngIcon("idea");
    case "ghostty":
      return getKnownPngIcon("ghostty");
    case "antigravity":
      return getKnownPngIcon("antigravity");
    case "finder":
      return getKnownPngIcon("finder");
    case "sublime":
      return SUBLIME_APP_ICON;
    case "notepad":
      return NOTEPAD_APP_ICON;
    case "windows-terminal":
      return TERMINAL_APP_ICON;
    case "command":
      return COMMAND_APP_ICON;
    case "chrome":
    case "google-chrome":
      return CHROME_APP_ICON;
    default:
      return null;
  }
}

/**
 * Match built-in icons by label / appName / path basename when target id is a UUID.
 * Used only as fallback when OS icon extraction is unavailable.
 */
export function getKnownOpenAppIconByRef(
  appName?: string | null,
  label?: string | null,
): string | null {
  const haystack = `${appName ?? ""} ${label ?? ""}`.toLowerCase();
  if (!haystack.trim()) {
    return null;
  }
  if (
    haystack.includes("visual studio code") ||
    haystack.includes("vscode") ||
    /[/\\]code\.app\b/.test(haystack) ||
    /[/\\]code\.exe\b/.test(haystack)
  ) {
    return getKnownPngIcon("vscode");
  }
  if (haystack.includes("cursor")) {
    return getKnownPngIcon("cursor");
  }
  if (/\bzed\b/.test(haystack) || haystack.includes("zed.app")) {
    return getKnownPngIcon("zed");
  }
  if (
    haystack.includes("intellij") ||
    haystack.includes("idea") ||
    haystack.includes("jetbrains")
  ) {
    return getKnownPngIcon("idea");
  }
  if (haystack.includes("ghostty")) {
    return getKnownPngIcon("ghostty");
  }
  if (haystack.includes("antigravity")) {
    return getKnownPngIcon("antigravity");
  }
  if (haystack.includes("sublime")) {
    return SUBLIME_APP_ICON;
  }
  if (haystack.includes("notepad")) {
    return NOTEPAD_APP_ICON;
  }
  if (haystack.includes("windows terminal") || haystack.includes("wt.exe")) {
    return TERMINAL_APP_ICON;
  }
  if (haystack.includes("chrome")) {
    return CHROME_APP_ICON;
  }
  if (
    haystack.includes("finder") ||
    haystack.includes("explorer") ||
    haystack.includes("访达") ||
    haystack.includes("资源管理器")
  ) {
    return getKnownPngIcon("finder");
  }
  return null;
}

/**
 * Display icon priority:
 * 1) OS-extracted icon (true app logo) when available
 * 2) Built-in known glyphs
 * 3) Generic placeholder
 */
export function resolveOpenAppDisplayIcon(
  target: Pick<OpenAppTarget, "id" | "kind" | "appName" | "label" | "command">,
  lazyIconById?: Record<string, string>,
): string {
  if (target.kind === "finder") {
    return getKnownOpenAppIcon("finder") ?? GENERIC_APP_ICON;
  }

  const osIcon = lazyIconById?.[target.id];
  if (osIcon) {
    return osIcon;
  }

  if (target.kind === "command") {
    return (
      getKnownOpenAppIconByRef(target.command, target.label) ??
      getKnownOpenAppIcon("command") ??
      COMMAND_APP_ICON
    );
  }

  return (
    getKnownOpenAppIcon(target.id) ??
    getKnownOpenAppIconByRef(target.appName, target.label) ??
    GENERIC_APP_ICON
  );
}

/** Icon lookup key for host extraction (absolute path preferred). */
export function resolveOpenAppIconLookupKey(
  target: Pick<OpenAppTarget, "kind" | "appName" | "label" | "command">,
): string | null {
  if (target.kind === "finder") {
    return null;
  }
  if (target.kind === "command") {
    const cmd = target.command?.trim() ?? "";
    return cmd || null;
  }
  const appName = target.appName?.trim() ?? "";
  if (appName) {
    return appName;
  }
  const label = target.label?.trim() ?? "";
  return label || null;
}
