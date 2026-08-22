// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ButtonArea } from "./ButtonArea";

function openToolDock() {
  const toggle = screen.getByRole("button", {
    name: "Expand or collapse input tools",
    hidden: true,
  });
  fireEvent.pointerDown(toggle, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(toggle, { button: 0 });
  return toggle;
}

vi.mock("./selectors", () => ({
  ConfigSelect: () => <div data-testid="config-select" />,
  ModeSelect: () => <div data-testid="mode-select" />,
  ReasoningSelect: () => <div data-testid="reasoning-select" />,
}));

const refreshCodingPlan = vi.fn(async () => {});
const codingPlanState = vi.hoisted(() => ({
  snapshot: null as null | {
    source: string;
    success: boolean;
    error?: string | null;
    planLabel?: string | null;
    windows: Array<{
      id: string;
      usedPercent: number;
      remainingPercent: number;
      resetsAt?: string | null;
    }>;
    balance?: {
      isAvailable: boolean;
      items: Array<{ currency: string; totalBalance: string }>;
    } | null;
    queriedAt: number;
  },
  loading: false,
}));

vi.mock("../../../status-panel/hooks/useCodingPlanQuota", () => ({
  useCodingPlanQuota: () => ({
    snapshot: codingPlanState.snapshot,
    loading: codingPlanState.loading,
    error: null,
    refresh: refreshCodingPlan,
  }),
}));

describe("ButtonArea Session Control HUD quota", () => {
  it("opens dual-pane HUD with quota pane visible by default", async () => {
    const onRefresh = vi.fn();
    codingPlanState.snapshot = {
      source: "official_cli",
      success: true,
      windows: [],
      queriedAt: Date.now(),
    };
    render(
      <div className="chat-input-box" style={{ width: 640 }}>
        <ButtonArea
          currentProvider="codex"
          accountRateLimits={{
            primary: {
              usedPercent: 42,
              windowDurationMins: 300,
              resetsAt: null,
            },
          }}
          onRefreshAccountRateLimits={onRefresh}
          onSubmit={() => {}}
        />
      </div>,
    );

    openToolDock();

    const hud = screen.getByTestId("composer-session-control-hud");
    expect(hud).toBeTruthy();
    expect(screen.getByTestId("composer-session-quota-pane")).toBeTruthy();
    // DropdownMenuContent defaults to overflow-x-hidden overflow-y-auto, which
    // would clip the top-row CSS tooltips. The HUD must win on both axes.
    expect(hud.className).toContain("overflow-visible");
    expect(hud.className).toContain("overflow-x-visible");
    expect(hud.className).toContain("overflow-y-visible");
    expect(hud.className).not.toContain("overflow-x-hidden");
    expect(hud.className).not.toMatch(/(?:^|\s)overflow-y-auto(?:\s|$)/);
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("shows coding-plan balance for deepseek via overview merge", async () => {
    codingPlanState.snapshot = {
      source: "deepseek",
      success: true,
      windows: [],
      balance: {
        isAvailable: true,
        items: [{ currency: "CNY", totalBalance: "110.00" }],
      },
      queriedAt: Date.now(),
    };

    render(
      <div className="chat-input-box" style={{ width: 640 }}>
        <ButtonArea
          currentProvider="codex"
          currentProviderProfileId="provider-deepseek"
          onSubmit={() => {}}
        />
      </div>,
    );

    openToolDock();

    await waitFor(() => {
      const pane = screen.getByTestId("composer-session-quota-pane");
      expect(pane.textContent).toContain("CNY 110.00");
    });
  });

  it("shows coding-plan windows for minimax", async () => {
    codingPlanState.snapshot = {
      source: "minimax",
      success: true,
      windows: [
        {
          id: "five_hour",
          usedPercent: 30,
          remainingPercent: 70,
          resetsAt: null,
        },
      ],
      queriedAt: Date.now(),
    };

    render(
      <div className="chat-input-box" style={{ width: 640 }}>
        <ButtonArea
          currentProvider="claude"
          currentProviderProfileId="provider-minimax"
          onSubmit={() => {}}
        />
      </div>,
    );

    openToolDock();

    await waitFor(() => {
      const pane = screen.getByTestId("composer-session-quota-pane");
      expect(pane.textContent).toMatch(/30%/);
    });
  });
});
