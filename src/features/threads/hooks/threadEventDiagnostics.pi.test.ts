import { describe, expect, it } from "vitest";
import { inferThreadEngine, inferRawItemEngine } from "./threadEventDiagnostics";

describe("inferThreadEngine pi routing", () => {
  it("maps pi pending and finalized prefixes to pi, not kimi/codex", () => {
    expect(inferThreadEngine("pi-pending-123-abc")).toBe("pi");
    expect(inferThreadEngine("pi:019fe705-27fd-712e-a1be")).toBe("pi");
    expect(inferThreadEngine("qoder-pending-123-abc")).toBe("qoder");
    expect(inferThreadEngine("qoder:019fe705-27fd-712e-a1be")).toBe("qoder");
    expect(inferThreadEngine("kimi-pending-123")).toBe("kimi");
    expect(inferThreadEngine("codex-pending-123")).toBe("codex");
  });

  it("reads explicit engineSource pi from items", () => {
    expect(
      inferRawItemEngine("pi-pending-1", { engineSource: "pi" }),
    ).toBe("pi");
    expect(
      inferRawItemEngine("qoder-pending-1", { engineSource: "qoder" }),
    ).toBe("qoder");
  });
});
