// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import { SidebarVersionTag } from "./SidebarVersionTag";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));

const getVersionMock = vi.mocked(getVersion);

describe("SidebarVersionTag", () => {
  beforeEach(() => {
    getVersionMock.mockResolvedValue("0.9.2");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a borderless caption instead of an outline chip", async () => {
    await act(async () => {
      render(
        <SidebarVersionTag t={(key) => key} onOpenReleaseNotes={vi.fn()} />,
      );
    });

    const button = await screen.findByRole("button", { name: "sidebar.releaseNotes" });
    expect(button.className).toContain("sidebar-version-tag");
    expect(button.textContent).toBe("v0.9.2");
    expect(button.getAttribute("data-slot")).toBeNull();
  });

  it("opens release notes when clicked", async () => {
    const onOpenReleaseNotes = vi.fn();
    await act(async () => {
      render(
        <SidebarVersionTag t={(key) => key} onOpenReleaseNotes={onOpenReleaseNotes} />,
      );
    });

    const button = await screen.findByRole("button", { name: "sidebar.releaseNotes" });
    fireEvent.click(button);
    expect(onOpenReleaseNotes).toHaveBeenCalledTimes(1);
  });

  it("stays hidden when the app version is unavailable", async () => {
    getVersionMock.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => {
      render(
        <SidebarVersionTag t={(key) => key} onOpenReleaseNotes={vi.fn()} />,
      );
    });

    await waitFor(() => {
      expect(getVersionMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
