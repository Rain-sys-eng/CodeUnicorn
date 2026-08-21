// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  qoderAuthDeletePat,
  qoderAuthSetPat,
  qoderAuthStatus,
  type QoderAuthStatus,
} from "../../../services/tauri/qoderAuth";
import { QoderAuthSection } from "./QoderAuthSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("../../../services/tauri/qoderAuth", () => ({
  qoderAuthStatus: vi.fn(),
  qoderAuthSetPat: vi.fn(),
  qoderAuthDeletePat: vi.fn(),
}));

vi.mock("./cliEngineNav", () => ({
  CliIcon: () => <span data-testid="qoder-cli-icon" />,
}));

const mockStatus = vi.mocked(qoderAuthStatus);
const mockSet = vi.mocked(qoderAuthSetPat);
const mockDelete = vi.mocked(qoderAuthDeletePat);

function snapshot(state: QoderAuthStatus["state"]): QoderAuthStatus {
  return {
    authFile: { path: "/home/u/.ccgui/qoder-auth.json", exists: state === "configured" },
    state,
    envVar: "QODER_PERSONAL_ACCESS_TOKEN",
    maskedKey: state === "configured" ? "qoder_········0xyz" : undefined,
  };
}

beforeEach(() => {
  mockStatus.mockResolvedValue(snapshot("none"));
  mockSet.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderSection(qoderBin?: string | null) {
  const view = render(<QoderAuthSection qoderBin={qoderBin} />);
  await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(1));
  return view;
}

describe("QoderAuthSection", () => {
  it("splits login and setKey like PI", async () => {
    await renderSection();
    expect(screen.getByText("登录")).toBeTruthy();
    expect(screen.getByText("设置 Key")).toBeTruthy();
    expect(screen.getByText("QODER_PERSONAL_ACCESS_TOKEN")).toBeTruthy();
  });

  it("requests terminal qodercli login", async () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    document.addEventListener("mossx:terminal-command-request", listener);
    try {
      await renderSection();
      fireEvent.click(screen.getByText("登录"));
      expect(events).toHaveLength(1);
      expect(events[0].detail).toEqual({
        terminalId: "qoder-login",
        title: "qodercli login",
        command: "qodercli login",
      });
    } finally {
      document.removeEventListener("mossx:terminal-command-request", listener);
    }
  });

  it("quotes a custom qoder bin containing spaces", async () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    document.addEventListener("mossx:terminal-command-request", listener);
    try {
      render(<QoderAuthSection qoderBin="/opt/my tools/qodercli" />);
      await waitFor(() => expect(mockStatus).toHaveBeenCalled());
      fireEvent.click(screen.getByText("登录"));
      expect(events[0].detail.command).toBe('"/opt/my tools/qodercli" login');
    } finally {
      document.removeEventListener("mossx:terminal-command-request", listener);
    }
  });

  it("opens inline editor, cancels on empty save, persists on value save", async () => {
    await renderSection();
    fireEvent.click(screen.getByText("设置 Key"));
    const editor = await screen.findByTestId("qoder-auth-editor");
    expect(editor).toBeTruthy();

    fireEvent.click(screen.getByText("保存"));
    expect(mockSet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("qoder-auth-editor")).toBeNull();

    fireEvent.click(screen.getByText("设置 Key"));
    fireEvent.change(screen.getByLabelText("Personal Access Token"), {
      target: { value: "qoder_pat_abcdef1234567890xyz" },
    });
    mockStatus.mockResolvedValueOnce(snapshot("configured"));
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("qoder_pat_abcdef1234567890xyz"),
    );
  });

  it("shows configured mask and deletes after confirm", async () => {
    mockStatus.mockResolvedValue(snapshot("configured"));
    await renderSection();
    expect(screen.getByText("qoder_········0xyz")).toBeTruthy();
    expect(screen.getByText("编辑")).toBeTruthy();
    fireEvent.click(screen.getByText("删除"));
    fireEvent.click(screen.getByText("settings.vendor.deleteConfirm.confirm"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
  });
});
