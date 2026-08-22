// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedProviderRetryHint } from "./SharedProviderRetryHint";
import {
  resetSharedProviderRetryControllerStoreForTests,
  setSharedProviderRetryState,
} from "./providerRetryControllerStore";

const fireRetry = vi.fn();
const cancelRetry = vi.fn();
const startManual = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const values = Object.values(params ?? {});
      return values.length ? `${key}:${values.join(":")}` : key;
    },
  }),
}));

vi.mock("./noteSharedProviderRetryTurn", () => ({
  fireSharedProviderRetry: (...args: unknown[]) => fireRetry(...args),
  cancelSharedProviderRetry: (...args: unknown[]) => cancelRetry(...args),
  startSharedProviderRetryManually: (...args: unknown[]) => startManual(...args),
}));

describe("SharedProviderRetryHint", () => {
  beforeEach(() => {
    resetSharedProviderRetryControllerStoreForTests();
    fireRetry.mockReset();
    cancelRetry.mockReset();
    startManual.mockReset();
  });

  afterEach(() => {
    cleanup();
    resetSharedProviderRetryControllerStoreForTests();
  });

  it("renders a one-line wait hint with compact actions", () => {
    setSharedProviderRetryState("ws", "shared:a", {
      series: null,
      overlay: {
        phase: "wait",
        attempt: 1,
        maxAttempts: 3,
        seconds: 6,
        kind: "pool",
        engine: "claude",
        seriesId: "s1",
        lastAttemptId: "att-1",
        lastMessage: "403",
        providerProfileId: "p1",
        model: "sonnet",
        seriesStartedAtMs: 1,
        batchStartedAtMs: 1,
      },
    });
    render(<SharedProviderRetryHint workspaceId="ws" threadId="shared:a" />);
    expect(screen.getByTestId("shared-provider-retry-hint").textContent).toContain(
      "sharedSend.providerRetryWait",
    );
    fireEvent.click(screen.getByText("sharedSend.providerRetryNow"));
    expect(fireRetry).toHaveBeenCalledWith("ws", "shared:a");
    fireEvent.click(screen.getByText("sharedSend.providerRetryStop"));
    expect(cancelRetry).toHaveBeenCalledWith("ws", "shared:a");
  });

  it("offers 再试 after the series is exhausted", () => {
    setSharedProviderRetryState("ws", "shared:a", {
      series: null,
      overlay: {
        phase: "exhausted",
        attempt: 3,
        maxAttempts: 3,
        seconds: 0,
        kind: "timeout",
        engine: "codex",
        seriesId: "s1",
        lastAttemptId: "att-3",
        lastMessage: "timeout",
        providerProfileId: null,
        model: "gpt-5",
        seriesStartedAtMs: 1,
        batchStartedAtMs: 1,
      },
    });
    render(<SharedProviderRetryHint workspaceId="ws" threadId="shared:a" />);
    fireEvent.click(screen.getByText("sharedSend.providerRetryAgain"));
    expect(startManual).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws",
        threadId: "shared:a",
        engine: "codex",
        message: "timeout",
      }),
    );
  });
});
