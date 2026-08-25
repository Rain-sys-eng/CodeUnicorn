// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeyedLoadState } from "./KeyedLoadState";

// OpenSpec change：extract-keyed-load-state-component。
describe("KeyedLoadState", () => {
  it("renders default title, error detail and retry with role=alert", () => {
    const onRetry = vi.fn();
    render(<KeyedLoadState error="boom: rpc dead" onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    // 默认标题必须经由 i18n 解析（common.loadFailed），不是裸 key。
    expect(alert.textContent).not.toContain("common.loadFailed");
    expect(alert.textContent).toContain("boom: rpc dead");

    const retryButton = screen.getByRole("button");
    expect(retryButton.textContent?.trim().length).toBeGreaterThan(0);
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("prefers custom title / retryLabel and passes class hooks through", () => {
    const { container } = render(
      <KeyedLoadState
        error="detail"
        onRetry={() => undefined}
        title="会话树加载失败"
        className="pi-fs-empty pi-fs-load-error"
        detailClassName="pi-fs-load-error-detail"
        retryClassName="pi-fs-load-error-retry"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("pi-fs-empty pi-fs-load-error");
    expect(alert.textContent).toContain("会话树加载失败");
    expect(
      container.querySelector(".pi-fs-load-error-detail")?.textContent,
    ).toBe("detail");
    expect(
      container.querySelector("button.pi-fs-load-error-retry"),
    ).not.toBeNull();
  });
});
