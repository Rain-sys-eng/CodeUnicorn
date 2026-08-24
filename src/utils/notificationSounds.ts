import { convertFileSrc } from "@tauri-apps/api/core";
import type { DebugEntry } from "../types";

type DebugLogger = (entry: DebugEntry) => void;

export type NotificationSoundId =
  | "default"
  | "chime"
  | "bell"
  | "ding"
  | "success"
  | "custom";

type NotificationSoundLabel = "notification" | "test";

type PlayNotificationSoundBySelectionParams = {
  soundId?: string | null;
  customSoundPath?: string | null;
  label: NotificationSoundLabel;
  onDebug?: DebugLogger;
};

const CUSTOM_SOUND_FILE_PATTERN = /\.(wav|mp3|aiff)$/i;

type BuiltinNotificationSoundId = Exclude<NotificationSoundId, "custom">;

/**
 * Cold-start: the bundled .wav files (~212KB) stay off the eager AppShell
 * chunk. Each URL module is imported lazily on first playback and the promise
 * is cached, so repeat plays cost nothing extra.
 */
const BUILTIN_SOUND_URL_LOADERS: Record<
  BuiltinNotificationSoundId,
  () => Promise<string>
> = {
  default: () =>
    import("../assets/sounds/success.wav?url").then((module) => module.default),
  chime: () =>
    import("../assets/sounds/chime.wav?url").then((module) => module.default),
  bell: () =>
    import("../assets/sounds/bell.wav?url").then((module) => module.default),
  ding: () =>
    import("../assets/sounds/ding.wav?url").then((module) => module.default),
  success: () =>
    import("../assets/sounds/task-complete.wav?url").then(
      (module) => module.default,
    ),
};

const builtinSoundUrlPromises = new Map<
  BuiltinNotificationSoundId,
  Promise<string>
>();

function loadBuiltinSoundUrl(
  soundId: BuiltinNotificationSoundId,
): Promise<string> {
  let promise = builtinSoundUrlPromises.get(soundId);
  if (!promise) {
    promise = BUILTIN_SOUND_URL_LOADERS[soundId]();
    // Evict failed loads so the next play retries instead of caching the error.
    promise.catch(() => {
      builtinSoundUrlPromises.delete(soundId);
    });
    builtinSoundUrlPromises.set(soundId, promise);
  }
  return promise;
}

const KNOWN_NOTIFICATION_SOUND_IDS = new Set<NotificationSoundId>([
  "default",
  "chime",
  "bell",
  "ding",
  "success",
  "custom",
]);

const resolveSoundId = (soundId?: string | null): NotificationSoundId => {
  if (!soundId) {
    return "default";
  }
  return KNOWN_NOTIFICATION_SOUND_IDS.has(soundId as NotificationSoundId)
    ? (soundId as NotificationSoundId)
    : "default";
};

const resolveCustomSoundUrl = (customSoundPath?: string | null): string | null => {
  const rawPath = customSoundPath?.trim() ?? "";
  if (!rawPath) {
    return null;
  }
  const normalizedPath =
    rawPath.length >= 2 && rawPath.startsWith("\"") && rawPath.endsWith("\"")
      ? rawPath.slice(1, -1).trim()
      : rawPath;
  if (!normalizedPath) {
    return null;
  }
  if (/^(https?:\/\/|asset:\/\/|blob:|data:|file:\/\/)/i.test(normalizedPath)) {
    return normalizedPath;
  }
  if (!CUSTOM_SOUND_FILE_PATTERN.test(normalizedPath)) {
    return null;
  }
  return convertFileSrc(normalizedPath);
};

const playNotificationAudioUrl = (
  url: string,
  label: NotificationSoundLabel,
  onDebug?: DebugLogger,
) => {
  try {
    const audio = new Audio(url);
    audio.volume = 1;
    audio.preload = "auto";
    audio.addEventListener("error", () => {
      onDebug?.({
        id: `${Date.now()}-audio-${label}-load-error`,
        timestamp: Date.now(),
        source: "error",
        label: `audio/${label} load error`,
        payload: `Failed to load audio: ${url}`,
      });
    });
    void audio.play().catch((error) => {
      onDebug?.({
        id: `${Date.now()}-audio-${label}-play-error`,
        timestamp: Date.now(),
        source: "error",
        label: `audio/${label} play error`,
        payload: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    onDebug?.({
      id: `${Date.now()}-audio-${label}-init-error`,
      timestamp: Date.now(),
      source: "error",
      label: `audio/${label} init error`,
      payload: error instanceof Error ? error.message : String(error),
    });
  }
};

const playBuiltinNotificationSound = (
  soundId: BuiltinNotificationSoundId,
  label: NotificationSoundLabel,
  onDebug?: DebugLogger,
) => {
  loadBuiltinSoundUrl(soundId)
    .then((url) => {
      playNotificationAudioUrl(url, label, onDebug);
    })
    .catch((error) => {
      onDebug?.({
        id: `${Date.now()}-audio-${label}-asset-load-error`,
        timestamp: Date.now(),
        source: "error",
        label: `audio/${label} asset load error`,
        payload: error instanceof Error ? error.message : String(error),
      });
    });
};

export function playNotificationSoundBySelection({
  soundId,
  customSoundPath,
  label,
  onDebug,
}: PlayNotificationSoundBySelectionParams) {
  const resolvedSoundId = resolveSoundId(soundId);
  if (resolvedSoundId === "custom") {
    const customUrl = resolveCustomSoundUrl(customSoundPath);
    if (customUrl) {
      playNotificationAudioUrl(customUrl, label, onDebug);
      return;
    }
    onDebug?.({
      id: `${Date.now()}-audio-${label}-custom-path-invalid`,
      timestamp: Date.now(),
      source: "error",
      label: `audio/${label} custom path invalid`,
      payload: customSoundPath ?? "",
    });
    playBuiltinNotificationSound("default", label, onDebug);
    return;
  }
  playBuiltinNotificationSound(resolvedSoundId, label, onDebug);
}
