import type { EngineType } from "../../../types";
import {
  isTrustedDshCatalogId,
  splitDshCatalogSelection,
} from "../../threads/hooks/threadMessagingHelpers";

export type DshCatalogLike = {
  id?: string | null;
  model?: string | null;
};

/**
 * DSH host catalog ids are `{provider}/{model}` for every host route — official
 * (`kimi-coding`, `openai`, `anthropic`, …) and custom alike. PI/Kimi CLI
 * catalogs reuse some of those ids, so a DSH-thread pick must prefer the DSH
 * row over a foreign exact-id match. There is no official-provider allowlist.
 */
export function findDshCatalogModel<T extends DshCatalogLike>(
  models: readonly T[] | null | undefined,
  id: string | null | undefined,
): T | null {
  const requested = id?.trim() || "";
  if (!requested) {
    return null;
  }
  const list = models ?? [];
  return (
    list.find((model) => model.id?.trim() === requested) ??
    list.find((model) => model.model?.trim() === requested) ??
    null
  );
}

export function resolveDshPickerTargetEngine(input: {
  requestedId: string | null | undefined;
  threadEngine: EngineType | null;
  activeEngine: EngineType;
  dshModels: readonly DshCatalogLike[] | null | undefined;
  foreignEngine: EngineType;
}): EngineType {
  const onDshThread =
    input.threadEngine === "dsh" || input.activeEngine === "dsh";
  if (!onDshThread) {
    return input.foreignEngine;
  }
  if (findDshCatalogModel(input.dshModels, input.requestedId)) {
    return "dsh";
  }
  // Any trusted host `{provider}/{model}` stays on DSH while the catalog is
  // still empty after a session switch. Do not special-case official names.
  if (isTrustedDshCatalogId(input.requestedId)) {
    return "dsh";
  }
  return input.foreignEngine;
}

/**
 * Claude leftover `k3` / `kimi-` stripping must not run on DSH. Host runtime
 * ids are the catalog last segment for every provider, official or custom.
 */
export function resolveDshNativeRuntimeModel(input: {
  catalogEntryId: string | null | undefined;
  catalogRuntime?: string | null;
  overlayRuntime?: string | null;
}): string | null {
  const catalogEntryId = input.catalogEntryId?.trim() || "";
  const catalogRuntime = input.catalogRuntime?.trim() || null;
  if (catalogRuntime) {
    return catalogRuntime;
  }
  const overlayRuntime = input.overlayRuntime?.trim() || null;
  if (overlayRuntime && overlayRuntime !== catalogEntryId) {
    return overlayRuntime;
  }
  const split = splitDshCatalogSelection(catalogEntryId);
  if (split) {
    return split.model;
  }
  return overlayRuntime || catalogEntryId || null;
}

export function resolveDshAtomicCatalogIdForSend(input: {
  engine?: EngineType | null;
  modelCatalogEntryId?: string | null;
  model?: string | null;
}): string | null {
  if (input.engine !== "dsh") {
    return null;
  }
  const catalogId = input.modelCatalogEntryId?.trim() || "";
  if (isTrustedDshCatalogId(catalogId)) {
    return catalogId;
  }
  const runtime = input.model?.trim() || "";
  if (isTrustedDshCatalogId(runtime)) {
    return runtime;
  }
  return null;
}
