import { Suspense, useState } from "react";
import { useWindowLabel } from "./features/layout/hooks/useWindowLabel";
import { isDetachedFileExplorerWindowLabel } from "./features/files/detachedFileExplorer";
import { isBrowserAgentDockWindowLabel } from "./features/browser-agent/browserAgentDockWindow";
import { StartupGateOverlay } from "./features/app/components/StartupGateOverlay";
import { FirstRunSetupHost } from "./features/onboarding/components/FirstRunSetupHost";
import { WorkspaceWallpaperHost } from "./features/theme/components/WorkspaceWallpaperHost";
import { isStartupGateOverlayTestEnabled } from "./features/startup-orchestration/utils/startupGateOverlayTestFlag";
import { LazyAppShell } from "./router/lazyAppShell";
import {
  LazyAboutView,
  LazyClientDocumentationWindow,
  LazyDetachedBrowserAgentWindow,
  LazyDetachedFileExplorerWindow,
  LazyDetachedSpecHubWindow,
} from "./router/lazyWindows";

export function AppRouter() {
  const windowLabel = useWindowLabel();
  const [startupGateOverlayEnabledAtMount] = useState(
    isStartupGateOverlayTestEnabled,
  );
  if (windowLabel === "about") {
    return (
      <Suspense fallback={null}>
        <LazyAboutView />
      </Suspense>
    );
  }
  if (isDetachedFileExplorerWindowLabel(windowLabel)) {
    return (
      <Suspense fallback={null}>
        <LazyDetachedFileExplorerWindow />
      </Suspense>
    );
  }
  if (windowLabel === "spec-hub") {
    return (
      <Suspense fallback={null}>
        <LazyDetachedSpecHubWindow />
      </Suspense>
    );
  }
  if (windowLabel === "client-documentation") {
    return (
      <Suspense fallback={null}>
        <LazyClientDocumentationWindow />
      </Suspense>
    );
  }
  if (isBrowserAgentDockWindowLabel(windowLabel)) {
    return (
      <Suspense fallback={null}>
        <LazyDetachedBrowserAgentWindow />
      </Suspense>
    );
  }
  return (
    <>
      <WorkspaceWallpaperHost />
      <Suspense fallback={null}>
        <LazyAppShell />
      </Suspense>
      <FirstRunSetupHost />
      {startupGateOverlayEnabledAtMount ? <StartupGateOverlay /> : null}
    </>
  );
}
