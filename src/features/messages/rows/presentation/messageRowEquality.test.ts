import { describe, expect, it } from "vitest";
import type {
  BrowserContextSendAttachment,
  ConversationItem,
  IntentCanvasContextSendAttachment,
} from "../../../../types";
import { areMessageItemsEqual } from "./messageRowEquality";

type MessageItem = Extract<ConversationItem, { kind: "message" }>;

const browserAttachment: BrowserContextSendAttachment = {
  kind: "browser_snapshot",
  attachmentId: "browser-1",
  browserSessionId: "session-1",
  snapshotId: "snapshot-1",
  workspaceId: "workspace-1",
  title: "Docs",
  url: "https://example.com/docs",
  capturedAt: 1,
  stale: false,
  summary: "Browser summary",
  privacy: {
    redactionApplied: false,
    redactedKinds: [],
    omittedKinds: [],
  },
};

const intentAttachment: IntentCanvasContextSendAttachment = {
  kind: "intent_canvas_context",
  attachmentId: "intent-1",
  canvasId: "canvas-1",
  title: "Intent",
  mode: "focused",
  compressionMode: "none",
  truncated: false,
  payloadCharacters: 10,
  rawPayload: "{}",
  semanticNodes: { total: 1, sent: 1, omitted: 0 },
  semanticEdges: { total: 1, sent: 1, omitted: 0 },
  evidence: { total: 1, sent: 1, omitted: 0 },
  visualTextBlocks: { total: 1, sent: 1, omitted: 0 },
};

const baseItem: MessageItem = {
  id: "message-1",
  kind: "message",
  role: "assistant",
  text: "response",
  engineSource: "claude",
  isFinal: true,
  finalCompletedAt: 10,
  finalDurationMs: 20,
  selectedAgentName: "Reviewer",
  selectedAgentIcon: "codicon-eye",
  images: ["data:image/png;base64,AAAA"],
  deferredImages: [{
    workspacePath: "/workspace-a",
    mediaType: "image/png",
    estimatedByteSize: 700_000,
    reason: "large-inline-image",
    locator: {
      sessionId: "session-1",
      lineIndex: 1,
      blockIndex: 2,
      messageId: "message-1",
      mediaType: "image/png",
    },
  }],
  browserContextAttachment: browserAttachment,
  intentCanvasContextAttachments: [intentAttachment],
};

describe("areMessageItemsEqual", () => {
  it("reuses an equivalent completed item clone", () => {
    expect(areMessageItemsEqual(baseItem, { ...baseItem })).toBe(true);
  });

  it.each([
    ["text", { text: "changed" }],
    ["engine", { engineSource: "codex" as const }],
    ["final flag", { isFinal: false }],
    ["final timestamp", { finalCompletedAt: 11 }],
    ["final duration", { finalDurationMs: 21 }],
    ["final input tokens", { finalInputTokens: 100 }],
    ["final output tokens", { finalOutputTokens: 50 }],
    ["agent name", { selectedAgentName: "Builder" }],
    ["agent icon", { selectedAgentIcon: "codicon-tools" }],
    ["origin kind", { originKind: "shared-provider-retry" as const }],
    ["images", { images: ["data:image/png;base64,BBBB"] }],
    ["browser context", { browserContextAttachment: { ...browserAttachment } }],
    ["intent context", { intentCanvasContextAttachments: [{ ...intentAttachment }] }],
  ])("detects a changed %s", (_label, patch) => {
    expect(areMessageItemsEqual(baseItem, { ...baseItem, ...patch })).toBe(false);
  });

  it("detects deferred image workspace and locator changes", () => {
    const image = baseItem.deferredImages?.[0];
    expect(image).toBeTruthy();
    expect(areMessageItemsEqual(baseItem, {
      ...baseItem,
      deferredImages: [{ ...image!, workspacePath: "/workspace-b" }],
    })).toBe(false);
    expect(areMessageItemsEqual(baseItem, {
      ...baseItem,
      deferredImages: [{
        ...image!,
        locator: { ...image!.locator, blockIndex: 3 },
      }],
    })).toBe(false);
  });
});
