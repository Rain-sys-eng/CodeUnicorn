// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EngineType } from "../../types";
import { useProviderModelCatalogSync } from "./useProviderModelCatalogSync";

const activateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../features/vendors/activateEngineProviderProfile", () => ({
  activateEngineProviderProfileAndNotify: activateMock,
  isActivatableProviderEngine: (engine: string) =>
    ["claude", "codex", "kimi", "grok", "opencode"].includes(engine),
}));

describe("useProviderModelCatalogSync", () => {
  beforeEach(() => {
    activateMock.mockClear();
    activateMock.mockResolvedValue(undefined);
  });

  it("does not fetch catalogs or activate L1 when switching threads", () => {
    const addDebugEntry = vi.fn();
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(
      ({ providerProfileId }) =>
        useProviderModelCatalogSync({
          activeEngine: "claude",
          activeThreadEngineSource: "claude",
          activeThreadId: "claude-pending-1",
          activeWorkspaceId: "ws-1",
          providerProfileId,
          addDebugEntry,
          refreshEngineModels,
        }),
      { initialProps: { providerProfileId: "provider-a" } },
    );

    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(activateMock).not.toHaveBeenCalled();

    view.rerender({ providerProfileId: "provider-b" });
    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(activateMock).not.toHaveBeenCalled();
  });

  it("does not fetch catalogs when switching among provider-scoped engines", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    const addDebugEntry = vi.fn();
    type HookProps = {
      activeEngine: "codex" | "grok" | "kimi" | "gemini" | "pi";
    };
    const view = renderHook(
      ({ activeEngine }: HookProps) =>
        useProviderModelCatalogSync({
          activeEngine,
          activeThreadEngineSource: activeEngine,
          activeThreadId: "thread-1",
          activeWorkspaceId: "ws-1",
          providerProfileId: "provider-a",
          addDebugEntry,
          refreshEngineModels,
        }),
      {
        initialProps: {
          activeEngine: "codex",
        },
      },
    );

    view.rerender({ activeEngine: "grok" });
    view.rerender({ activeEngine: "kimi" });
    view.rerender({ activeEngine: "gemini" });
    view.rerender({ activeEngine: "pi" });
    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(activateMock).not.toHaveBeenCalled();
  });

  it("uses the active thread engine only for skip bookkeeping", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    const addDebugEntry = vi.fn();
    type HookProps = {
      activeEngine: EngineType;
    };
    const view = renderHook(
      ({ activeEngine }: HookProps) =>
        useProviderModelCatalogSync({
          activeEngine,
          activeThreadEngineSource: "codex",
          activeThreadId: "codex-thread-1",
          activeWorkspaceId: "ws-1",
          providerProfileId: "__disk__",
          addDebugEntry,
          refreshEngineModels,
        }),
      { initialProps: { activeEngine: "claude" } },
    );

    view.rerender({ activeEngine: "codex" });
    expect(refreshEngineModels).not.toHaveBeenCalled();
  });

  it("keeps the last-good catalog when a provider-bound thread has no engine scope", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useProviderModelCatalogSync({
        activeEngine: "claude",
        activeThreadEngineSource: null,
        activeThreadId: "legacy-thread-1",
        activeWorkspaceId: "ws-1",
        providerProfileId: "provider-a",
        addDebugEntry: vi.fn(),
        refreshEngineModels,
      }),
    );

    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(activateMock).not.toHaveBeenCalled();
  });

  it("does not fetch catalogs when returning from Codex to a DSH thread", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    const addDebugEntry = vi.fn();
    type HookProps = {
      activeEngine: EngineType;
      activeThreadEngineSource: EngineType;
      activeThreadId: string;
    };
    const view = renderHook(
      ({ activeEngine, activeThreadEngineSource, activeThreadId }: HookProps) =>
        useProviderModelCatalogSync({
          activeEngine,
          activeThreadEngineSource,
          activeThreadId,
          activeWorkspaceId: "ws-1",
          providerProfileId: null,
          addDebugEntry,
          refreshEngineModels,
        }),
      {
        initialProps: {
          activeEngine: "codex",
          activeThreadEngineSource: "codex",
          activeThreadId: "codex:session-1",
        },
      },
    );

    view.rerender({
      activeEngine: "dsh",
      activeThreadEngineSource: "dsh",
      activeThreadId: "dsh:session-1",
    });
    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(activateMock).not.toHaveBeenCalled();
  });
});
