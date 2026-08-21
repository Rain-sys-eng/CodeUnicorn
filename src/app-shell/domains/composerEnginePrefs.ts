import type { AccessMode, ComposerEnginePrefs, EngineType } from "../../types";
import { BUILTIN_ENGINE_TYPES } from "../../features/engine/engineRegistry";

const ENGINE_TYPES: readonly EngineType[] = BUILTIN_ENGINE_TYPES;
const ACCESS_MODES = new Set<AccessMode>([
  "default",
  "read-only",
  "current",
  "full-access",
]);

export type ComposerEnginePrefsRecord = Partial<
  Record<EngineType, ComposerEnginePrefs>
>;

export const EMPTY_COMPOSER_ENGINE_PREF: ComposerEnginePrefs = {
  modelId: null,
  effort: null,
  accessMode: null,
  collaborationModeId: null,
  dshAgentPreset: null,
};

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAccessMode(value: unknown): AccessMode | null {
  return typeof value === "string" && ACCESS_MODES.has(value as AccessMode)
    ? (value as AccessMode)
    : null;
}

function normalizeEnginePref(value: unknown): ComposerEnginePrefs | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const pref: ComposerEnginePrefs = {
    modelId: normalizeNullableString(record.modelId),
    effort: normalizeNullableString(record.effort),
    accessMode: normalizeAccessMode(record.accessMode),
    collaborationModeId: normalizeNullableString(record.collaborationModeId),
    dshAgentPreset: normalizeNullableString(record.dshAgentPreset),
  };
  const isEmpty =
    pref.modelId === null &&
    pref.effort === null &&
    pref.accessMode === null &&
    pref.collaborationModeId === null &&
    pref.dshAgentPreset === null;
  return isEmpty ? null : pref;
}

/** Read one engine's stored preferences, always returning a fully-populated object. */
export function getComposerEnginePref(
  prefs: ComposerEnginePrefsRecord | undefined,
  engine: EngineType,
): ComposerEnginePrefs {
  const stored = prefs?.[engine];
  if (!stored) {
    return EMPTY_COMPOSER_ENGINE_PREF;
  }
  return {
    modelId: stored.modelId ?? null,
    effort: stored.effort ?? null,
    accessMode: stored.accessMode ?? null,
    collaborationModeId: stored.collaborationModeId ?? null,
    dshAgentPreset: stored.dshAgentPreset ?? null,
  };
}

/**
 * Immutably merge a partial patch into one engine's preferences. Returns the same
 * record reference when nothing changes so callers can skip redundant persistence.
 */
export function upsertComposerEnginePref(
  prefs: ComposerEnginePrefsRecord | undefined,
  engine: EngineType,
  patch: Partial<ComposerEnginePrefs>,
): ComposerEnginePrefsRecord {
  const base = prefs ?? {};
  const current = getComposerEnginePref(base, engine);
  const next: ComposerEnginePrefs = {
    modelId: patch.modelId !== undefined ? patch.modelId : current.modelId,
    effort: patch.effort !== undefined ? patch.effort : current.effort,
    accessMode:
      patch.accessMode !== undefined ? patch.accessMode : current.accessMode,
    collaborationModeId:
      patch.collaborationModeId !== undefined
        ? patch.collaborationModeId
        : current.collaborationModeId,
    dshAgentPreset:
      patch.dshAgentPreset !== undefined
        ? patch.dshAgentPreset
        : current.dshAgentPreset,
  };
  if (
    next.modelId === current.modelId &&
    next.effort === current.effort &&
    next.accessMode === current.accessMode &&
    next.collaborationModeId === current.collaborationModeId &&
    next.dshAgentPreset === current.dshAgentPreset
  ) {
    return base;
  }
  return { ...base, [engine]: next };
}

/**
 * Resolve the access mode to restore when switching to an engine. Claude's
 * permission menu keeps acceptEdits ("current") disabled, so a stored or
 * default "current" degrades to the approval-required "default" instead.
 * DSH auto mode is an explicit session pin to danger-full-access; blank DSH
 * conversations stay on workspace-write unless the user already chose auto.
 */
export function resolveRestoredAccessMode(
  engine: EngineType,
  stored: AccessMode | null,
  defaultAccessMode: AccessMode | undefined,
): AccessMode {
  if (engine === "dsh") {
    if (stored === "full-access" || stored === "default") {
      return stored;
    }
    return "default";
  }
  const restored = stored ?? defaultAccessMode ?? "full-access";
  if (engine === "claude" && restored === "current") {
    return "default";
  }
  return restored;
}

/**
 * Sanitize a raw persisted record. Unknown engines and malformed fields are dropped.
 * When the record has no `codex` entry, legacy top-level composer fields seed it so
 * older settings keep working after the migration to per-engine preferences.
 */
export function normalizeComposerEnginePrefsRecord(
  value: unknown,
  legacy?: { modelId?: string | null; effort?: string | null },
): ComposerEnginePrefsRecord {
  const result: ComposerEnginePrefsRecord = {};
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const engine of ENGINE_TYPES) {
      const normalized = normalizeEnginePref(record[engine]);
      if (normalized) {
        result[engine] = normalized;
      }
    }
  }
  if (!result.codex) {
    const legacyPref = normalizeEnginePref({
      modelId: legacy?.modelId ?? null,
      effort: legacy?.effort ?? null,
    });
    if (legacyPref) {
      result.codex = legacyPref;
    }
  }
  return result;
}
