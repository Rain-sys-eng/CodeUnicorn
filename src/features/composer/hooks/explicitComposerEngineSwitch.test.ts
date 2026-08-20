import { afterEach, describe, expect, it } from "vitest";
import type { EngineType } from "../../../types";
import {
  consumeExplicitComposerEngineSwitch,
  markExplicitComposerEngineSwitch,
  peekExplicitComposerEngineSwitch,
  resetExplicitComposerEngineSwitchForTests,
  shouldSpawnNativeThreadForEngineMismatch,
} from "./explicitComposerEngineSwitch";

const NATIVE_ENGINES: EngineType[] = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "kimi",
  "opencode",
  "pi",
  "dsh",
];

afterEach(() => {
  resetExplicitComposerEngineSwitchForTests();
});

describe("explicitComposerEngineSwitch", () => {
  it("consumes a marked engine once", () => {
    markExplicitComposerEngineSwitch("grok");
    expect(peekExplicitComposerEngineSwitch()).toBe("grok");
    expect(consumeExplicitComposerEngineSwitch()).toBe("grok");
    expect(consumeExplicitComposerEngineSwitch()).toBeNull();
  });
});

describe("shouldSpawnNativeThreadForEngineMismatch", () => {
  it("does not spawn when the thread already matches the current engine", () => {
    expect(
      shouldSpawnNativeThreadForEngineMismatch({
        threadEngine: "dsh",
        currentEngine: "dsh",
        threadIdCompatible: true,
        explicitEngine: null,
      }),
    ).toBe(false);
  });

  it.each(NATIVE_ENGINES.filter((engine) => engine !== "dsh"))(
    "stays on a DSH thread when activeEngine drifted to %s without an explicit switch",
    (currentEngine) => {
      expect(
        shouldSpawnNativeThreadForEngineMismatch({
          threadEngine: "dsh",
          currentEngine,
          threadIdCompatible: false,
          explicitEngine: null,
        }),
      ).toBe(false);
    },
  );

  it.each(NATIVE_ENGINES.filter((engine) => engine !== "dsh"))(
    "spawns %s when the user explicitly switched to that engine group",
    (currentEngine) => {
      expect(
        shouldSpawnNativeThreadForEngineMismatch({
          threadEngine: "dsh",
          currentEngine,
          threadIdCompatible: false,
          explicitEngine: currentEngine,
        }),
      ).toBe(true);
    },
  );

  it("does not spawn when returning to a DSH thread after visiting Codex", () => {
    expect(
      shouldSpawnNativeThreadForEngineMismatch({
        threadEngine: "dsh",
        currentEngine: "dsh",
        threadIdCompatible: true,
        explicitEngine: "codex",
      }),
    ).toBe(false);
  });

  it("does not spawn when the consumed mark is for a different engine", () => {
    expect(
      shouldSpawnNativeThreadForEngineMismatch({
        threadEngine: "dsh",
        currentEngine: "grok",
        threadIdCompatible: false,
        explicitEngine: "claude",
      }),
    ).toBe(false);
  });
});
