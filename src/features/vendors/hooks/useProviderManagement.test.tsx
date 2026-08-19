// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addClaudeProvider,
  deleteClaudeProvider,
  getClaudeProviders,
  getCurrentClaudeConfig,
  reorderClaudeProviders,
  switchClaudeProvider,
  updateClaudeProvider,
} from "../../../services/tauri";
import type { ProviderConfig } from "../types";
import { DISABLED_PROVIDER_ID, LOCAL_SETTINGS_PROVIDER_ID } from "../types";
import { CLAUDE_LOCAL_PROVIDER_PROFILE_ID } from "../../threads/constants/codexProviderProfiles";
import {
  readLastProviderProfileId,
  writeLastProviderProfileId,
} from "../lastProviderProfileMemory";
import { useProviderManagement } from "./useProviderManagement";

vi.mock("../../../services/tauri", () => ({
  getClaudeProviders: vi.fn(),
  getCurrentClaudeConfig: vi.fn(),
  addClaudeProvider: vi.fn(),
  updateClaudeProvider: vi.fn(),
  deleteClaudeProvider: vi.fn(),
  reorderClaudeProviders: vi.fn(),
  switchClaudeProvider: vi.fn(),
}));

function provider(
  id: string,
  options: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id,
    name: `Provider ${id.toUpperCase()}`,
    ...options,
  };
}

const localProvider = provider(LOCAL_SETTINGS_PROVIDER_ID, {
  isLocalProvider: true,
});

const initialProviders = [
  localProvider,
  provider("a"),
  provider("b", { isActive: true }),
  provider("c"),
];

describe("useProviderManagement reorder", () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so a leftover mockResolvedValueOnce in
    // one test cannot leak into the next via the un-drained once-queue.
    vi.resetAllMocks();
    vi.mocked(getCurrentClaudeConfig).mockResolvedValue({
      apiKey: "",
      baseUrl: "",
      authType: "none",
    });
  });

  it("persists reordered provider ids and keeps the optimistic order without refetching", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    vi.mocked(reorderClaudeProviders).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => {
      expect(result.current.providers.map((entry) => entry.id)).toEqual([
        LOCAL_SETTINGS_PROVIDER_ID,
        "a",
        "b",
        "c",
      ]);
    });

    const loadsAfterMount = vi.mocked(getClaudeProviders).mock.calls.length;

    await act(async () => {
      await result.current.handleReorderProviders(["c", "b", "a"]);
    });

    expect(reorderClaudeProviders).toHaveBeenCalledWith(["c", "b", "a"]);
    // No refetch on success: avoids the loading-flag toggle + object-identity
    // churn that caused the drag flicker.
    expect(vi.mocked(getClaudeProviders).mock.calls.length).toEqual(
      loadsAfterMount,
    );
    expect(result.current.providers.map((entry) => entry.id)).toEqual([
      LOCAL_SETTINGS_PROVIDER_ID,
      "c",
      "b",
      "a",
    ]);
  });

  it("reloads providers when reorder persistence fails", async () => {
    vi.mocked(getClaudeProviders)
      .mockResolvedValueOnce(initialProviders)
      .mockResolvedValueOnce(initialProviders);
    vi.mocked(reorderClaudeProviders).mockRejectedValueOnce(
      new Error("write failed"),
    );

    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => {
      expect(result.current.providers.map((entry) => entry.id)).toEqual([
        LOCAL_SETTINGS_PROVIDER_ID,
        "a",
        "b",
        "c",
      ]);
    });

    await act(async () => {
      await result.current.handleReorderProviders(["c", "b", "a"]);
    });

    expect(reorderClaudeProviders).toHaveBeenCalledWith(["c", "b", "a"]);
    expect(result.current.providers.map((entry) => entry.id)).toEqual([
      LOCAL_SETTINGS_PROVIDER_ID,
      "a",
      "b",
      "c",
    ]);
    expect(result.current.providerError).toMatchObject({
      action: "reorder",
      message: expect.stringContaining("write failed"),
    });
  });

  it("propagates typed save errors", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    vi.mocked(addClaudeProvider).mockRejectedValueOnce(new Error("save failed"));
    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSaveProvider({
        providerName: "Broken",
        remark: "",
        apiKey: "",
        apiUrl: "",
        jsonConfig: "{}",
      });
    });

    expect(result.current.providerError).toMatchObject({
      action: "save",
      message: expect.stringContaining("save failed"),
    });
  });

  it("updates a managed provider without changing the global Claude provider", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    vi.mocked(updateClaudeProvider).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.handleEditProvider(initialProviders[2]!));
    await act(async () => {
      await result.current.handleSaveProvider({
        providerName: "DeepSeek",
        remark: "isolated",
        apiKey: "",
        apiUrl: "",
        jsonConfig: JSON.stringify({
          env: { ANTHROPIC_MODEL: "deepseek-v4-pro" },
        }),
      });
    });

    expect(updateClaudeProvider).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({
        name: "DeepSeek",
        settingsConfig: {
          env: { ANTHROPIC_MODEL: "deepseek-v4-pro" },
        },
      }),
    );
  });

  it("propagates delete failure and never reports success", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    vi.mocked(deleteClaudeProvider).mockRejectedValueOnce(
      new Error("delete failed"),
    );
    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.handleDeleteProvider(initialProviders[1]!));
    let outcome: Awaited<
      ReturnType<typeof result.current.confirmDeleteProvider>
    >;
    await act(async () => {
      outcome = await result.current.confirmDeleteProvider();
    });

    expect(outcome!).toMatchObject({ ok: false });
    expect(result.current.providerError).toMatchObject({
      action: "delete",
      message: expect.stringContaining("delete failed"),
    });
  });

  it("falls back the remembered create-menu provider after a successful delete", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    vi.mocked(deleteClaudeProvider).mockResolvedValueOnce(undefined);
    writeLastProviderProfileId("claude", "b");
    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.handleDeleteProvider(initialProviders[2]!));
    await act(async () => {
      await result.current.confirmDeleteProvider();
    });

    expect(deleteClaudeProvider).toHaveBeenCalledWith("b");
    expect(readLastProviderProfileId("claude")).toBe(
      CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
    );
  });
});

describe("useProviderManagement switch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getCurrentClaudeConfig).mockResolvedValue({
      apiKey: "",
      baseUrl: "",
      authType: "none",
    });
    vi.mocked(switchClaudeProvider).mockResolvedValue(undefined);
  });

  it("optimistically activates the target without toggling list loading", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const loadsAfterMount = vi.mocked(getClaudeProviders).mock.calls.length;

    await act(async () => {
      await result.current.handleSwitchProvider("a");
    });

    expect(switchClaudeProvider).toHaveBeenCalledWith("a");
    // No full list refetch on success: avoids loading-flag flicker.
    expect(vi.mocked(getClaudeProviders).mock.calls.length).toEqual(
      loadsAfterMount,
    );
    expect(result.current.loading).toBe(false);
    expect(
      result.current.providers.map((entry) => [entry.id, Boolean(entry.isActive)]),
    ).toEqual([
      [LOCAL_SETTINGS_PROVIDER_ID, false],
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });

  it("rolls back isActive when switch persistence fails", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    vi.mocked(switchClaudeProvider).mockRejectedValueOnce(
      new Error("switch failed"),
    );
    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSwitchProvider("a");
    });

    expect(
      result.current.providers.map((entry) => [entry.id, Boolean(entry.isActive)]),
    ).toEqual([
      [LOCAL_SETTINGS_PROVIDER_ID, false],
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
    expect(result.current.providerError).toMatchObject({
      action: "switch",
      message: expect.stringContaining("switch failed"),
    });
  });

  it("clears all actives when switching to DISABLED_PROVIDER_ID", async () => {
    vi.mocked(getClaudeProviders).mockResolvedValue(initialProviders);
    const { result } = renderHook(() => useProviderManagement());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSwitchProvider(DISABLED_PROVIDER_ID);
    });

    expect(switchClaudeProvider).toHaveBeenCalledWith(DISABLED_PROVIDER_ID);
    expect(result.current.providers.every((entry) => !entry.isActive)).toBe(
      true,
    );
  });
});
