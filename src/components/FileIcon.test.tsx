// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileIcon } from "./FileIcon";

describe("FileIcon", () => {
  it("supports the shared filePath contract", () => {
    const { container } = render(
      <FileIcon
        {...({
          filePath: "src/components/FileIcon.tsx",
          className: "tree-file-icon",
        } as const)}
      />,
    );

    const icon = container.firstElementChild as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon?.className).toContain("tree-file-icon");
    expect(icon?.style.width).toBe("16px");
    expect(icon?.style.height).toBe("16px");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("supports the legacy messages fileName and size contract through the shared owner", () => {
    const { container } = render(
      <FileIcon
        {...({
          fileName: "src/components/FileIcon.tsx",
          size: 14,
          className: "status-file-icon",
        } as Record<string, unknown>)}
      />,
    );

    const icon = container.firstElementChild as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon?.className).toContain("file-icon");
    expect(icon?.className).toContain("status-file-icon");
    expect(icon?.style.width).toBe("14px");
    expect(icon?.style.height).toBe("14px");
  });
});
