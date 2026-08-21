import type { EngineType } from "../../../types";

export type SharedSessionSupportedEngine =
  | "claude"
  | "codex"
  | "kimi"
  | "grok"
  | "opencode"
  | "pi";

const SHARED_SESSION_SUPPORTED_ENGINES = new Set<EngineType>([
  "claude",
  "codex",
  "kimi",
  "grok",
  "opencode",
  "pi",
]);

export function isSharedSessionSupportedEngine(
  engine: EngineType | null | undefined,
): engine is SharedSessionSupportedEngine {
  return Boolean(engine && SHARED_SESSION_SUPPORTED_ENGINES.has(engine));
}

/**
 * Read/legacy fallback for stored snapshots. Gemini/DSH/Qoder are Native-only;
 * write paths must use {@link assertSharedSessionWriteEngine} instead of this.
 */
export function normalizeSharedSessionEngine(
  engine: EngineType | null | undefined,
): SharedSessionSupportedEngine {
  return isSharedSessionSupportedEngine(engine) ? engine : "claude";
}

/** Fail-closed write gate: never persist an unsupported engine as a Shared target. */
export function assertSharedSessionWriteEngine(
  engine: EngineType | null | undefined,
): SharedSessionSupportedEngine {
  if (!isSharedSessionSupportedEngine(engine)) {
    throw new Error(
      `Unsupported shared session engine: ${engine ?? "unknown"}`,
    );
  }
  return engine;
}
