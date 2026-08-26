// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceAliasPrompt } from "./WorkspaceAliasPrompt";

vi.mock("react-i18next", () => ({
  Trans: ({ values }: { values?: Record<string, string> }) => (
    <span>{`Original project name: ${values?.name ?? ""}`}</span>
  ),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        "sidebar.workspaceAliasDialogTitle": "Set workspace alias",
        "sidebar.workspaceAliasDialogSubtitle": `Original project name: ${params?.name ?? ""}`,
        "sidebar.workspaceAliasLabel": "Sidebar display name",
        "sidebar.workspaceAliasPlaceholder": "Example: Billing backend",
        "sidebar.workspaceAliasEmptyHint": "Save empty to clear alias.",
        "common.cancel": "Cancel",
        "common.save": "Save",
        "common.loading": "Saving...",
      };
      return translations[key] ?? key;
    },
  }),
}));

describe("WorkspaceAliasPrompt", () => {
  it("edits and confirms the sidebar alias", () => {
    const onChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <WorkspaceAliasPrompt
        workspaceName="service"
        alias="Billing"
        error={null}
        isBusy={false}
        onChange={onChange}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Set workspace alias" })).toBeTruthy();
    expect(screen.getByText("Original project name: service")).toBeTruthy();

    const input = screen.getByLabelText("Sidebar display name");
    fireEvent.change(input, { target: { value: "Billing backend" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("Billing backend");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("allows saving an empty alias to clear the label", () => {
    const onConfirm = vi.fn();

    render(
      <WorkspaceAliasPrompt
        workspaceName="service"
        alias=""
        error={null}
        isBusy={false}
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
