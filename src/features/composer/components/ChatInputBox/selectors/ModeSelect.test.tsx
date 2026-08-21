// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModeSelect } from "./ModeSelect";
import {
  MODE_SELECT_FLASH_DURATION_MS,
  MODE_SELECT_FLASH_EVENT,
} from "./modeSelectFlash";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

// Radix DropdownMenu portals its content to document.body, so options are not
// inside the render container. Query the whole document instead.
const queryOption = (modeId: string): HTMLElement | null =>
  document.body.querySelector(`[data-mode-id="${modeId}"]`);

const isDisabled = (el: HTMLElement | null) =>
  el?.hasAttribute("data-disabled") ?? false;

// The menu opens asynchronously; wait until at least one option is mounted.
const waitForMenu = () =>
  waitFor(() => {
    expect(document.body.querySelector("[data-mode-id]")).toBeTruthy();
  });

describe("ModeSelect", () => {
  it("allows selecting plan mode for gemini provider", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const { container } = render(
      <ModeSelect value="default" onChange={onChange} provider="gemini" />,
    );

    const trigger = container.querySelector(".selector-button");
    expect(trigger).toBeTruthy();
    await user.click(trigger as HTMLElement);
    await waitForMenu();

    const planOption = queryOption("plan");
    expect(planOption).toBeTruthy();
    expect(isDisabled(planOption)).toBe(false);

    await user.click(planOption as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("plan");
  });

  it("allows default and auto modes for dsh provider but keeps plan and acceptEdits disabled", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const { container } = render(
      <ModeSelect value="default" onChange={onChange} provider="dsh" />,
    );

    const trigger = container.querySelector(".selector-button");
    expect(trigger).toBeTruthy();
    await user.click(trigger as HTMLElement);
    await waitForMenu();

    expect(isDisabled(queryOption("default"))).toBe(false);
    expect(isDisabled(queryOption("bypassPermissions"))).toBe(false);
    expect(isDisabled(queryOption("plan"))).toBe(true);
    expect(isDisabled(queryOption("acceptEdits"))).toBe(true);

    await user.click(queryOption("bypassPermissions") as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("bypassPermissions");
  });

  it("disables all access modes for qoder provider", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const { container } = render(
      <ModeSelect value="bypassPermissions" onChange={onChange} provider="qoder" />,
    );

    const trigger = container.querySelector(".selector-button");
    expect(trigger).toBeTruthy();
    await user.click(trigger as HTMLElement);
    await waitForMenu();

    expect(isDisabled(queryOption("default"))).toBe(true);
    expect(isDisabled(queryOption("bypassPermissions"))).toBe(true);
    expect(isDisabled(queryOption("plan"))).toBe(true);
    expect(isDisabled(queryOption("acceptEdits"))).toBe(true);

    await user.click(queryOption("bypassPermissions") as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("allows default and plan modes for claude provider but keeps acceptEdits disabled", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const { container } = render(
      <ModeSelect value="bypassPermissions" onChange={onChange} provider="claude" />,
    );

    const trigger = container.querySelector(".selector-button");
    expect(trigger).toBeTruthy();
    await user.click(trigger as HTMLElement);
    await waitForMenu();

    expect(isDisabled(queryOption("plan"))).toBe(false);
    expect(isDisabled(queryOption("default"))).toBe(false);
    expect(isDisabled(queryOption("acceptEdits"))).toBe(true);

    await user.click(queryOption("plan") as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("plan");

    await user.click(trigger as HTMLElement);
    await waitForMenu();
    await user.click(queryOption("default") as HTMLElement);
    expect(onChange).toHaveBeenNthCalledWith(2, "default");

    await user.click(trigger as HTMLElement);
    await waitForMenu();
    // acceptEdits is disabled, so clicking it must not fire another change.
    await user.click(queryOption("acceptEdits") as HTMLElement);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("shows only plan and full-auto entries for codex provider", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const onSelectCollaborationMode = vi.fn();
    const { container } = render(
      <ModeSelect
        value="bypassPermissions"
        onChange={onChange}
        provider="codex"
        selectedCollaborationModeId="code"
        onSelectCollaborationMode={onSelectCollaborationMode}
      />,
    );

    const trigger = container.querySelector(".selector-button");
    expect(trigger).toBeTruthy();
    await user.click(trigger as HTMLElement);
    await waitForMenu();

    expect(queryOption("plan")).toBeTruthy();
    expect(queryOption("bypassPermissions")).toBeTruthy();
    expect(queryOption("default")).toBeNull();
    expect(queryOption("acceptEdits")).toBeNull();

    await user.click(queryOption("plan") as HTMLElement);
    expect(onSelectCollaborationMode).toHaveBeenCalledWith("plan");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("links codex mode menu selection to the plan-mode switch state", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const onSelectCollaborationMode = vi.fn();
    const { container, rerender } = render(
      <ModeSelect
        value="bypassPermissions"
        onChange={onChange}
        provider="codex"
        selectedCollaborationModeId="plan"
        onSelectCollaborationMode={onSelectCollaborationMode}
      />,
    );

    const trigger = container.querySelector(".selector-button");
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain("modes.plan.label");
    await user.click(trigger as HTMLElement);
    await waitForMenu();

    expect(queryOption("plan")?.getAttribute("data-selected")).toBe("true");

    rerender(
      <ModeSelect
        value="bypassPermissions"
        onChange={onChange}
        provider="codex"
        selectedCollaborationModeId="code"
        onSelectCollaborationMode={onSelectCollaborationMode}
      />,
    );

    expect(trigger?.textContent).toContain("modes.bypassPermissions.label");
    const fullAutoOption = queryOption("bypassPermissions");
    expect(fullAutoOption).toBeTruthy();
    await user.click(fullAutoOption as HTMLElement);

    expect(onSelectCollaborationMode).toHaveBeenCalledWith("code");
    expect(onChange).toHaveBeenCalledWith("bypassPermissions");
  });

  it("shows full-auto for codex when plan switch is off even if legacy permission value is stale", () => {
    const { container } = render(
      <ModeSelect
        value="default"
        onChange={vi.fn()}
        provider="codex"
        selectedCollaborationModeId="code"
        onSelectCollaborationMode={vi.fn()}
      />,
    );

    const trigger = container.querySelector(".selector-button");
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain("modes.bypassPermissions.label");
  });

  it("flashes the selector chevron when exit-plan mode requests a mode-sync hint", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = render(
      <ModeSelect value="default" onChange={onChange} provider="claude" />,
    );

    const trigger = container.querySelector(
      ".selector-button-mode-trigger",
    ) as HTMLElement | null;
    const chevron = container.querySelector(
      ".selector-button-mode-chevron",
    ) as HTMLElement | null;
    expect(trigger).toBeTruthy();
    expect(chevron).toBeTruthy();
    expect(trigger?.classList.contains("is-flashing")).toBe(false);
    expect(chevron?.classList.contains("is-flashing")).toBe(false);

    act(() => {
      window.dispatchEvent(new Event(MODE_SELECT_FLASH_EVENT));
    });

    expect(trigger?.classList.contains("is-flashing")).toBe(true);
    expect(chevron?.classList.contains("is-flashing")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(MODE_SELECT_FLASH_DURATION_MS);
    });
    expect(trigger?.classList.contains("is-flashing")).toBe(false);
    expect(chevron?.classList.contains("is-flashing")).toBe(false);
    vi.useRealTimers();
  });

  it("restarts the flash window when a second sync hint arrives before the first one ends", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ModeSelect value="default" onChange={vi.fn()} provider="claude" />,
    );

    const trigger = container.querySelector(
      ".selector-button-mode-trigger",
    ) as HTMLElement | null;
    expect(trigger).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event(MODE_SELECT_FLASH_EVENT));
      vi.advanceTimersByTime(MODE_SELECT_FLASH_DURATION_MS - 500);
      window.dispatchEvent(new Event(MODE_SELECT_FLASH_EVENT));
      vi.advanceTimersByTime(700);
    });

    expect(trigger?.classList.contains("is-flashing")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(MODE_SELECT_FLASH_DURATION_MS);
    });

    expect(trigger?.classList.contains("is-flashing")).toBe(false);
    vi.useRealTimers();
  });
});
