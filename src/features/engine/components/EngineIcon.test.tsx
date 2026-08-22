import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngineIcon } from "./EngineIcon";

describe("EngineIcon", () => {
  it("renders the Codex icon as a monochrome svg glyph", () => {
    const markup = renderToStaticMarkup(<EngineIcon engine="codex" size={16} />);

    expect(markup).toContain("<svg");
    expect(markup).toContain("fill=\"currentColor\"");
    expect(markup).not.toContain("<img");
  });

  it("keeps Claude as an image asset", () => {
    const markup = renderToStaticMarkup(<EngineIcon engine="claude" size={16} />);

    expect(markup).toContain("<img");
  });

  it("renders the OpenCode icon as a monochrome svg glyph", () => {
    const markup = renderToStaticMarkup(<EngineIcon engine="opencode" size={16} />);

    expect(markup).toContain("<svg");
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain("M16 6H8v12h8V6zm4 16H4V2h16v20z");
    expect(markup).not.toContain("<img");
  });

  it.each(["kimi", "grok", "pi"] as const)(
    "renders the %s icon as a theme-aware monochrome svg glyph",
    (engine) => {
      const markup = renderToStaticMarkup(<EngineIcon engine={engine} size={16} />);

      expect(markup).toContain("<svg");
      expect(markup).toContain('fill="currentColor"');
      expect(markup).not.toContain("<img");
    },
  );

  it("keeps the official Pi block mark as evenodd currentColor paths", () => {
    const markup = renderToStaticMarkup(<EngineIcon engine="pi" size={16} />);

    expect(markup).toContain("M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z");
    expect(markup).toContain("M17.5 12H23v11h-5.5V12z");
    expect(markup).toContain('fill-rule="evenodd"');
  });

  it("renders DeepSeek Harness with the official whale icon", () => {
    const markup = renderToStaticMarkup(<EngineIcon engine="dsh" size={16} />);

    expect(markup).toContain("<img");
    expect(markup).toContain("alt=\"DeepSeek Harness\"");
    expect(markup).toMatch(/deepseek/i);
    expect(markup).not.toContain("<svg");
  });

  it("renders Qoder CLI with the two-color brand glyph", () => {
    const markup = renderToStaticMarkup(<EngineIcon engine="qoder" size={16} />);

    // Inline 双色 glyph：品牌绿固定，细节随主题 currentColor（深色主题呈白绿）。
    // <img> 加载的 SVG 拿不到页面 currentColor，深色下会落成黑块（回归守卫）。
    expect(markup).toContain("<svg");
    expect(markup).toContain('fill="#2ADB5C"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toContain("<img");
  });
});
