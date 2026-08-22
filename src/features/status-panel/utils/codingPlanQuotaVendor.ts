/**
 * Quota-only vendor id for host-CLI engines (dsh / pi).
 *
 * Send-path bindings stay `__dsh_host_catalog__` / `__local_pi__`.
 * Coding-plan HTTP reuse needs the selected vendor (`deepseek-official`),
 * taken from the profile id or the first segment of `provider/model`.
 */

export function isCodingPlanHostCatalogSentinel(
  value: string | null | undefined,
): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.startsWith("__") && trimmed.endsWith("__") && trimmed.length > 4;
}

export function codingPlanVendorFromModelOrProfile(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || isCodingPlanHostCatalogSentinel(trimmed)) {
    return null;
  }
  const first = trimmed.split("/")[0]?.trim() ?? "";
  if (!first || isCodingPlanHostCatalogSentinel(first)) {
    return null;
  }
  return first;
}

/** Catalog ids are `provider/model`. A bare model name is not a vendor. */
export function codingPlanVendorFromSelectedModel(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.includes("/")) {
    return null;
  }
  return codingPlanVendorFromModelOrProfile(trimmed);
}

export function resolveCodingPlanQuotaVendorId(input: {
  engine?: string | null;
  providerProfileId?: string | null;
  selectedModel?: string | null;
}): string | null {
  const engine = input.engine?.trim().toLowerCase() ?? "";
  const profile = input.providerProfileId?.trim() || null;

  if (engine === "qoder") {
    // Native-only: no coding-plan vendor / HTTP quota route.
    return null;
  }

  if (engine !== "dsh" && engine !== "pi") {
    return profile;
  }

  return (
    codingPlanVendorFromModelOrProfile(profile) ??
    codingPlanVendorFromSelectedModel(input.selectedModel)
  );
}
