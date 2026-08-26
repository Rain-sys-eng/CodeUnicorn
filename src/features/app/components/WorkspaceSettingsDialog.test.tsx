// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSettingsDialog } from "./WorkspaceSettingsDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        "sidebar.workspaceSettingsTitle": "Workspace settings",
        "sidebar.workspaceSettingsDescription":
          "These preferences apply to every project.",
        "sidebar.workspaceSettingsVisibleCountLabel":
          "Default visible sessions",
        "sidebar.workspaceSettingsVisibleCountHint":
          "Default {{defaultCount}}, range {{min}}-{{max}}.",
      };
      const template = translations[key] ?? key;
      if (!params) {
        return template;
      }
      return Object.entries(params).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

describe("WorkspaceSettingsDialog", () => {
  it("persists a clamped global default on blur", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkspaceSettingsDialog
        open
        defaultVisibleThreadRootCount={5}
        onOpenChange={vi.fn()}
        onSaveDefaultVisibleThreadRootCount={onSave}
      />,
    );

    const input = screen.getByTestId(
      "workspace-settings-visible-count-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "21" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(20);
    });
    expect(input.value).toBe("20");
  });

  it("does not persist when the draft is unchanged", async () => {
    const onSave = vi.fn();

    render(
      <WorkspaceSettingsDialog
        open
        defaultVisibleThreadRootCount={5}
        onOpenChange={vi.fn()}
        onSaveDefaultVisibleThreadRootCount={onSave}
      />,
    );

    fireEvent.blur(screen.getByTestId("workspace-settings-visible-count-input"));
    expect(onSave).not.toHaveBeenCalled();
  });
});
