import { describe, expect, it } from "vitest";
import type { EngineType } from "../../../types";
import {
  acceptImagesWithinEngineLimit,
  DSH_IMAGE_INPUT_MAX_BYTES,
  engineSupportsImageInput,
  estimateImageAttachmentBytes,
  findOversizedImageAttachment,
  formatEngineImageInputUnsupportedMessage,
  formatEngineImageTooLargeMessage,
  getEngineImageInputMaxBytes,
  GROK_IMAGE_INPUT_MAX_BYTES,
  sanitizeImageAttachmentPaths,
} from "./engineImageInput";

function makePngDataUrl(decodedBytes: number): string {
  const encodedLength = Math.ceil(decodedBytes / 3) * 4;
  return `data:image/png;base64,${"A".repeat(encodedLength)}`;
}

describe("engineImageInput", () => {
  it.each([
    ["claude", true],
    ["codex", true],
    ["gemini", true],
    ["grok", true],
    ["kimi", true],
    ["opencode", true],
    ["pi", true],
    ["qoder", true],
  ] as const)("engineSupportsImageInput(%s) => %s", (engine, expected) => {
    expect(engineSupportsImageInput(engine)).toBe(expected);
  });

  it("treats missing engine as supported (fail-open at client)", () => {
    expect(engineSupportsImageInput(null)).toBe(true);
    expect(engineSupportsImageInput(undefined)).toBe(true);
  });

  it("formats unsupported message with engine display label", () => {
    // Helper remains available for future engines; all current engines support images.
    expect(formatEngineImageInputUnsupportedMessage("kimi")).toContain(
      "does not support image input",
    );
  });

  it("uses i18n when provided", () => {
    const translate = (key: string, options?: Record<string, unknown>) =>
      `${key}:${String(options?.engine ?? "")}`;
    expect(formatEngineImageInputUnsupportedMessage("kimi", translate)).toBe(
      "messages.imageInputUnsupported:Kimi CLI",
    );
  });

  it("sanitizes image paths with trim/filter/dedupe", () => {
    expect(
      sanitizeImageAttachmentPaths([
        " /tmp/a.png ",
        "",
        "  ",
        "/tmp/a.png",
        "/tmp/b.png",
        "\n",
      ]),
    ).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  });

  it("exposes per-engine decoded-image caps only where backend fail-fasts", () => {
    expect(getEngineImageInputMaxBytes("grok")).toBe(GROK_IMAGE_INPUT_MAX_BYTES);
    expect(getEngineImageInputMaxBytes("dsh")).toBe(DSH_IMAGE_INPUT_MAX_BYTES);
    expect(getEngineImageInputMaxBytes("claude")).toBeNull();
    expect(getEngineImageInputMaxBytes(null)).toBeNull();
  });

  it("estimates data-URL decoded size and ignores filesystem paths", () => {
    expect(estimateImageAttachmentBytes("/tmp/radar.png")).toBeNull();
    expect(
      estimateImageAttachmentBytes(
        "data:image/png;base64,AQIDBAUGBwgJCgsMDQ4PEA==",
      ),
    ).toBe(16);
  });

  it("finds the largest data URL that exceeds the Grok cap", () => {
    const oversized = makePngDataUrl(GROK_IMAGE_INPUT_MAX_BYTES + 1);
    expect(
      findOversizedImageAttachment(
        [makePngDataUrl(64), oversized, "/tmp/ok.png"],
        "grok",
      ),
    ).toEqual({
      bytes: expect.any(Number),
      maxBytes: GROK_IMAGE_INPUT_MAX_BYTES,
    });
    expect(
      findOversizedImageAttachment([makePngDataUrl(64), "/tmp/ok.png"], "grok"),
    ).toBeNull();
    expect(findOversizedImageAttachment([oversized], "claude")).toBeNull();
  });

  it("keeps in-limit images when one pasted screenshot is over the cap", () => {
    const oversized = makePngDataUrl(GROK_IMAGE_INPUT_MAX_BYTES + 1024);
    const kept = "data:image/png;base64,AAAA";
    expect(acceptImagesWithinEngineLimit([kept, oversized], "grok")).toEqual({
      accepted: [kept],
      rejected: {
        bytes: expect.any(Number),
        maxBytes: GROK_IMAGE_INPUT_MAX_BYTES,
      },
    });
  });

  it("formats oversized-image copy with size labels", () => {
    expect(
      formatEngineImageTooLargeMessage("grok", 3_200_000, 2 * 1024 * 1024),
    ).toContain("Grok CLI");
    const translate = (key: string, options?: Record<string, unknown>) =>
      `${key}:${String(options?.engine ?? "")}:${String(options?.maxSize ?? "")}`;
    expect(
      formatEngineImageTooLargeMessage(
        "grok",
        3_200_000,
        2 * 1024 * 1024,
        translate,
      ),
    ).toMatch(/^messages\.imageInputTooLarge:Grok CLI:/);
  });

  it("marks every current engine as image-capable in the matrix projection", () => {
    const supported: EngineType[] = [
      "claude",
      "codex",
      "gemini",
      "grok",
      "kimi",
      "opencode",
      "pi",
    ];
    for (const engine of supported) {
      expect(engineSupportsImageInput(engine)).toBe(true);
    }
  });
});
