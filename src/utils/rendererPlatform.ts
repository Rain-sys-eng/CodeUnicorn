export type RendererPlatform = "macos" | "windows" | "linux" | "unknown";

type NavigatorLike = Pick<Navigator, "platform" | "userAgent"> & {
  userAgentData?: {
    platform?: string;
  };
};

export type RevealInOsFileManagerLabelKey =
  | "files.revealInFinder"
  | "files.revealInExplorer"
  | "files.revealInFileManager";

export function detectRendererPlatform(
  navigatorLike: NavigatorLike | undefined = globalThis.navigator,
): RendererPlatform {
  const platform = (
    navigatorLike?.userAgentData?.platform ||
    navigatorLike?.platform ||
    navigatorLike?.userAgent ||
    ""
  ).toLowerCase();

  if (platform.includes("mac")) {
    return "macos";
  }
  if (platform.includes("win")) {
    return "windows";
  }
  if (platform.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

/**
 * Linux Tauri uses WebKitGTK. HTMLMediaElement audio goes through GStreamer;
 * missing appsink/autoaudiosink aborts WebKitWebProcess (desktop-cc-gui#1125).
 * Linux web-service (regular browser) is not affected.
 */
export function isLinuxWebKitGtkHtmlMediaUnsafe(
  navigatorLike: NavigatorLike | undefined = globalThis.navigator,
  webServiceRuntime?: boolean,
): boolean {
  const isWebService =
    webServiceRuntime ??
    (typeof window !== "undefined" && window.__MOSSX_WEB_SERVICE__ === true);
  if (isWebService) {
    return false;
  }
  return detectRendererPlatform(navigatorLike) === "linux";
}

export function getRevealInOsFileManagerLabelKey(
  platform: RendererPlatform = detectRendererPlatform(),
): RevealInOsFileManagerLabelKey {
  if (platform === "windows") {
    return "files.revealInExplorer";
  }
  if (platform === "linux") {
    return "files.revealInFileManager";
  }
  return "files.revealInFinder";
}

export function installRendererPlatformAttribute(
  documentLike:
    | Pick<Document, "documentElement">
    | undefined = globalThis.document,
  navigatorLike?: NavigatorLike,
) {
  documentLike?.documentElement.setAttribute(
    "data-platform",
    detectRendererPlatform(navigatorLike),
  );
}
