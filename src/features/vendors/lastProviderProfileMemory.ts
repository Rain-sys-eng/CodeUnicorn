import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
  OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
} from "../threads/constants/codexProviderProfiles";

export const LAST_PROVIDER_PROFILE_KEYS = {
  claude: "claudeLastProviderProfileId",
  codex: "codexLastProviderProfileId",
  kimi: "kimiLastProviderProfileId",
  grok: "grokLastProviderProfileId",
  opencode: "opencodeLastProviderProfileId",
} as const;

export type LastProviderEngine = keyof typeof LAST_PROVIDER_PROFILE_KEYS;

export const LAST_PROVIDER_PROFILE_CHANGED_EVENT =
  "ccgui:last-provider-profile-changed";

function notifyLastProviderProfileChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(LAST_PROVIDER_PROFILE_CHANGED_EVENT));
}

export const LAST_PROVIDER_LOCAL_PROFILE_IDS = {
  claude: CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  codex: CODEX_DISK_PROVIDER_PROFILE_ID,
  kimi: KIMI_LOCAL_PROVIDER_PROFILE_ID,
  grok: GROK_LOCAL_PROVIDER_PROFILE_ID,
  opencode: OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
} as const satisfies Record<LastProviderEngine, string>;

export function readLastProviderProfileId(
  engine: LastProviderEngine,
): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(LAST_PROVIDER_PROFILE_KEYS[engine]);
  } catch {
    return null;
  }
}

export function writeLastProviderProfileId(
  engine: LastProviderEngine,
  id: string,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LAST_PROVIDER_PROFILE_KEYS[engine], id);
    notifyLastProviderProfileChanged();
  } catch {
    // ignore storage write failures
  }
}

/**
 * 删除 managed provider 后：若新建菜单还记着这个 id，回退到该引擎本地配置。
 * 历史会话 binding 不在这里改。
 */
export function forgetDeletedLastProviderProfile(
  engine: LastProviderEngine,
  deletedProfileId: string,
): boolean {
  const deletedId = deletedProfileId.trim();
  if (!deletedId) {
    return false;
  }
  if (readLastProviderProfileId(engine) !== deletedId) {
    return false;
  }
  writeLastProviderProfileId(engine, LAST_PROVIDER_LOCAL_PROFILE_IDS[engine]);
  return true;
}
