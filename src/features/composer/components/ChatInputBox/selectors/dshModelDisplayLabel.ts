import type { ModelInfo } from "../types";

const PROVIDER_LABEL_SEPARATOR = " / ";

export type DshModelVendorSection<
  T extends Pick<ModelInfo, "id" | "label"> & Partial<Pick<ModelInfo, "provider">>,
> = {
  key: string;
  label: string;
  models: T[];
};

export type DshModelDisplayLabelOptions = {
  /** Closed trigger shows `provider / lastSegment` so it cannot collide with other CLI names. */
  closed?: boolean;
};

const SLASH_CATALOG_ENGINES = new Set(["dsh", "pi"]);

export function isSlashCatalogEngine(
  providerId: string | null | undefined,
): boolean {
  return Boolean(providerId && SLASH_CATALOG_ENGINES.has(providerId));
}

/**
 * DSH catalog rows are stored as `{provider} / {model}` and some model ids
 * are routed (`ovh/Qwen2.5-VL-72B-Instruct`). PI `--list-models` rows use
 * the same `{provider}/{model}` id. List rows show the last model token; the
 * closed trigger keeps the provider prefix.
 */
export function formatDshModelDisplayLabel(
  model: Pick<ModelInfo, "id"> & Partial<Pick<ModelInfo, "model" | "label">>,
  options: DshModelDisplayLabelOptions = {},
): string {
  const lastSegment = resolveDshLastSegment(model);
  if (!options.closed) {
    return lastSegment;
  }
  const provider = firstPathSegment(model.id);
  if (!provider || provider.toLowerCase() === lastSegment.toLowerCase()) {
    return lastSegment;
  }
  return `${provider}${PROVIDER_LABEL_SEPARATOR}${lastSegment}`;
}

function resolveDshLastSegment(
  model: Pick<ModelInfo, "id"> & Partial<Pick<ModelInfo, "model" | "label">>,
): string {
  const candidates = [
    model.model?.trim(),
    takeAfterProviderSeparator(model.label),
    model.id.trim(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const last = lastPathSegment(candidate);
    if (last) {
      return last;
    }
  }
  return model.id;
}

function takeAfterProviderSeparator(label?: string): string {
  const value = label?.trim() ?? "";
  const index = value.lastIndexOf(PROVIDER_LABEL_SEPARATOR);
  return index >= 0
    ? value.slice(index + PROVIDER_LABEL_SEPARATOR.length).trim()
    : value;
}

function firstPathSegment(value: string): string {
  const slash = value.indexOf("/");
  return (slash >= 0 ? value.slice(0, slash) : "").trim();
}

function lastPathSegment(value: string): string {
  const slash = value.lastIndexOf("/");
  return (slash >= 0 ? value.slice(slash + 1) : value).trim();
}

/**
 * Official DSH picker sections by host catalog `group.name`. mossx flattens
 * that catalog to `{provider} / {model}` labels, so recover the vendor heading
 * from the catalog label prefix, then `provider`, then the catalog id.
 *
 * PI reuses the same heading recovery: `pi --list-models` already stores
 * `provider` plus `{provider}/{model}` ids, so the fallback path is enough.
 */
export function groupDshModelsByVendor<
  T extends Pick<ModelInfo, "id" | "label"> & Partial<Pick<ModelInfo, "provider">>,
>(models: readonly T[]): DshModelVendorSection<T>[] {
  const sections: DshModelVendorSection<T>[] = [];
  const indexByKey = new Map<string, number>();

  for (const model of models) {
    const label = resolveDshVendorSectionLabel(model);
    const key = model.provider?.trim() || firstPathSegment(model.id) || label;
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      sections[existing].models.push(model);
      continue;
    }
    indexByKey.set(key, sections.length);
    sections.push({ key, label, models: [model] });
  }

  return sections;
}

export function resolveDshVendorSectionLabel(
  model: Pick<ModelInfo, "id" | "label"> & Partial<Pick<ModelInfo, "provider">>,
): string {
  const fromLabel = takeBeforeProviderSeparator(model.label);
  if (fromLabel) {
    return fromLabel;
  }
  const fromProvider = model.provider?.trim();
  if (fromProvider) {
    return fromProvider;
  }
  return firstPathSegment(model.id) || model.id;
}

function takeBeforeProviderSeparator(label?: string): string {
  const value = label?.trim() ?? "";
  const index = value.lastIndexOf(PROVIDER_LABEL_SEPARATOR);
  return index >= 0 ? value.slice(0, index).trim() : "";
}
