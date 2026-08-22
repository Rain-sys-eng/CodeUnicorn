import { describe, expect, it } from "vitest";
import {
  findDshCatalogModel,
  resolveDshAtomicCatalogIdForSend,
  resolveDshNativeRuntimeModel,
  resolveDshPickerTargetEngine,
} from "./dshNativeModelSelection";

const dshOfficialKimi = {
  id: "kimi-coding/k3",
  model: "k3",
};
const dshOfficialMinimax = {
  id: "minimax-cn/MiniMax-M2.7",
  model: "MiniMax-M2.7",
};
const dshCustomGrok = {
  id: "gork-zhu/grok-4.6",
  model: "grok-4.6",
};

describe("findDshCatalogModel", () => {
  it("matches official host catalog ids and short runtime names", () => {
    const models = [dshOfficialKimi, dshOfficialMinimax, dshCustomGrok];
    expect(findDshCatalogModel(models, "kimi-coding/k3")).toEqual(
      dshOfficialKimi,
    );
    expect(findDshCatalogModel(models, "k3")).toEqual(dshOfficialKimi);
    expect(findDshCatalogModel(models, "MiniMax-M2.7")).toEqual(
      dshOfficialMinimax,
    );
  });

  it("returns null for a foreign CLI leftover", () => {
    expect(
      findDshCatalogModel([dshCustomGrok], "ccgui/grok-4.5"),
    ).toBeNull();
  });
});

describe("resolveDshPickerTargetEngine", () => {
  it("keeps a DSH-thread official kimi pick on dsh even if PI owns the same id", () => {
    expect(
      resolveDshPickerTargetEngine({
        requestedId: "kimi-coding/k3",
        threadEngine: "dsh",
        activeEngine: "dsh",
        dshModels: [dshOfficialKimi],
        foreignEngine: "pi",
      }),
    ).toBe("dsh");
  });

  it("keeps later official host routes on dsh without an allowlist", () => {
    expect(
      resolveDshPickerTargetEngine({
        requestedId: "openai/gpt-5",
        threadEngine: "dsh",
        activeEngine: "dsh",
        dshModels: [{ id: "openai/gpt-5", model: "gpt-5" }],
        foreignEngine: "pi",
      }),
    ).toBe("dsh");
    expect(
      resolveDshPickerTargetEngine({
        requestedId: "anthropic/claude-sonnet-4-6",
        threadEngine: "dsh",
        activeEngine: "dsh",
        dshModels: [],
        foreignEngine: "claude",
      }),
    ).toBe("dsh");
  });

  it("keeps a trusted official id on dsh when the host catalog is still empty", () => {
    expect(
      resolveDshPickerTargetEngine({
        requestedId: "minimax-cn/MiniMax-M2.7",
        threadEngine: "dsh",
        activeEngine: "dsh",
        dshModels: [],
        foreignEngine: "pi",
      }),
    ).toBe("dsh");
  });

  it("still treats a true foreign catalog as foreign on a DSH thread", () => {
    expect(
      resolveDshPickerTargetEngine({
        requestedId: "ccgui/grok-4.5",
        threadEngine: "dsh",
        activeEngine: "dsh",
        dshModels: [dshCustomGrok],
        foreignEngine: "grok",
      }),
    ).toBe("grok");
  });
});

describe("resolveDshNativeRuntimeModel", () => {
  it("keeps official short ids instead of stripping k3 / kimi leftovers", () => {
    expect(
      resolveDshNativeRuntimeModel({
        catalogEntryId: "kimi-coding/k3",
        catalogRuntime: "k3",
        overlayRuntime: "k3",
      }),
    ).toBe("k3");
    expect(
      resolveDshNativeRuntimeModel({
        catalogEntryId: "kimi-coding/kimi-for-coding",
        overlayRuntime: null,
      }),
    ).toBe("kimi-for-coding");
  });

  it("prefers the current catalog runtime over overlay leftovers", () => {
    expect(
      resolveDshNativeRuntimeModel({
        catalogEntryId: "minimax-cn/MiniMax-M2.7",
        catalogRuntime: "MiniMax-M2.7",
        overlayRuntime: "k3",
      }),
    ).toBe("MiniMax-M2.7");
  });
});

describe("resolveDshAtomicCatalogIdForSend", () => {
  it("sends the official provider/model catalog id", () => {
    expect(
      resolveDshAtomicCatalogIdForSend({
        engine: "dsh",
        modelCatalogEntryId: "kimi-coding/k3",
        model: "k3",
      }),
    ).toBe("kimi-coding/k3");
    expect(
      resolveDshAtomicCatalogIdForSend({
        engine: "dsh",
        modelCatalogEntryId: "openai/gpt-5",
        model: "gpt-5",
      }),
    ).toBe("openai/gpt-5");
  });

  it("ignores other engines", () => {
    expect(
      resolveDshAtomicCatalogIdForSend({
        engine: "claude",
        modelCatalogEntryId: "kimi-coding/k3",
        model: "k3",
      }),
    ).toBeNull();
  });
});
