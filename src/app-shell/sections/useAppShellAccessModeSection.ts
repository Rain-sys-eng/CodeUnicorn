import { useCallback, useEffect, useRef, useState } from "react";
import { getComposerEnginePrefForEngine } from "../../features/composer/hooks/composerEnginePrefsStore";
import type { AccessMode, ComposerEnginePrefs, EngineType } from "../../types";
import { resolveRestoredAccessMode } from "../domains/composerEnginePrefs";

type UseAppShellAccessModeSectionInput = {
  activeEngine: EngineType;
  appSettingsLoading: boolean;
  defaultAccessMode: AccessMode;
  persistComposerEnginePref: (
    engine: EngineType,
    patch: Partial<ComposerEnginePrefs>,
  ) => void;
};

function initialAccessMode(
  engine: EngineType,
  defaultAccessMode: AccessMode,
): AccessMode {
  if (engine === "codex") {
    return "full-access";
  }
  return resolveRestoredAccessMode(
    engine,
    getComposerEnginePrefForEngine(engine).accessMode,
    defaultAccessMode,
  );
}

export function useAppShellAccessModeSection({
  activeEngine,
  appSettingsLoading,
  defaultAccessMode,
  persistComposerEnginePref,
}: UseAppShellAccessModeSectionInput) {
  const [accessMode, setAccessMode] = useState<AccessMode>(() =>
    initialAccessMode(activeEngine, defaultAccessMode),
  );
  const claudeAccessModeRef = useRef<AccessMode>(accessMode);

  useEffect(() => {
    if (activeEngine === "codex") {
      setAccessMode((prev) => {
        if (prev !== "full-access") {
          claudeAccessModeRef.current = prev;
        }
        return "full-access";
      });
      return;
    }
    const storedAccessMode =
      getComposerEnginePrefForEngine(activeEngine).accessMode;
    const restored = resolveRestoredAccessMode(
      activeEngine,
      storedAccessMode,
      defaultAccessMode,
    );
    claudeAccessModeRef.current = restored;
    setAccessMode(restored);
  }, [
    activeEngine,
    appSettingsLoading,
    defaultAccessMode,
  ]);

  const handleSetAccessMode = useCallback(
    (mode: AccessMode) => {
      setAccessMode(mode);
      if (activeEngine !== "codex") {
        claudeAccessModeRef.current = mode;
        persistComposerEnginePref(activeEngine, { accessMode: mode });
      }
    },
    [activeEngine, persistComposerEnginePref],
  );

  return {
    accessMode,
    claudeAccessModeRef,
    handleSetAccessMode,
    setAccessMode,
  };
}
