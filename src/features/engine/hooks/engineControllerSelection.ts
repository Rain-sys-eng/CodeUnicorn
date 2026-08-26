import type {
  CodexDoctorResult,
  EngineType,
} from "../../../types";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { isEngineExecutionEnabled } from "../../../utils/engineExecutionPolicy";
import { isSupportedEngineType } from "../engineRegistry";

const ENGINE_SELECTION_STORE = "composer";
const ENGINE_SELECTION_KEY = "selectedEngine";

export function readPersistedEngineSelection(): EngineType | null {
  const stored = getClientStoreSync<string>(
    ENGINE_SELECTION_STORE,
    ENGINE_SELECTION_KEY,
  );
  return isSupportedEngineType(stored) && isEngineExecutionEnabled(stored)
    ? stored
    : null;
}

export function persistEngineSelection(engineType: EngineType) {
  writeClientStoreValue(
    ENGINE_SELECTION_STORE,
    ENGINE_SELECTION_KEY,
    engineType,
    { immediate: true },
  );
}

export function buildCodexSwitchUnavailablePayload(
  doctorResult: CodexDoctorResult | null,
  doctorError: unknown,
) {
  const doctorErrorMessage =
    doctorError instanceof Error
      ? doctorError.message
      : doctorError
        ? String(doctorError)
        : null;

  return {
    reasonCode: "codex-not-installed",
    message: "Engine codex is not installed",
    doctorOk: doctorResult?.ok ?? false,
    doctorError: doctorErrorMessage,
    environmentDiagnosis: doctorResult?.environmentDiagnosis ?? null,
    resolvedBinaryPath:
      doctorResult?.resolvedBinaryPath ??
      doctorResult?.environmentDiagnosis?.resolvedBinaryPath ??
      null,
    pathEnvUsed: doctorResult?.pathEnvUsed ?? null,
  };
}
