import { describe, expect, it } from "vitest";
import {
  extractRuntimeModelFromPayload,
  getRuntimeReceipt,
  mergeRuntimeReceipt,
  rememberRuntimeReceipt,
  renameRuntimeReceipt,
  resetRuntimeReceiptsForTests,
} from "./runtimeModelReceipt";

describe("runtimeModelReceipt", () => {
  it("ignores synthetic models and remembers live window later", () => {
    resetRuntimeReceiptsForTests();
    expect(extractRuntimeModelFromPayload({ model: "<synthetic>" })).toBeNull();
    expect(
      extractRuntimeModelFromPayload({
        message: { model: "deepseek-v4-pro-0813[1m]" },
      }),
    ).toBe("deepseek-v4-pro-0813[1m]");

    expect(
      rememberRuntimeReceipt("ws", "claude:1", {
        contextWindowTokens: 1_000_000,
        contextWindowSource: "live",
      }),
    ).toBeNull();
    const first = rememberRuntimeReceipt("ws", "claude:1", {
      model: "deepseek-v4-pro-0813[1m]",
      modelSource: "assistant.message.model",
    });
    expect(first).toMatchObject({
      model: "deepseek-v4-pro-0813[1m]",
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live",
    });
    const withWindow = rememberRuntimeReceipt("ws", "claude:1", {
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live",
    });
    expect(withWindow).toMatchObject({
      model: "deepseek-v4-pro-0813[1m]",
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live",
    });
    renameRuntimeReceipt("ws", "claude:1", "claude:session");
    expect(getRuntimeReceipt("ws", "claude:session")?.model).toBe(
      "deepseek-v4-pro-0813[1m]",
    );
  });

  it("replaces the previous turn when a new send.request arrives", () => {
    resetRuntimeReceiptsForTests();
    rememberRuntimeReceipt("ws", "claude:1", {
      model: "deepseek-v4-pro-0813[1m]",
      modelSource: "assistant.message.model",
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live",
    });
    expect(
      rememberRuntimeReceipt("ws", "claude:1", {
        model: "k3",
        modelSource: "send.request",
      }),
    ).toMatchObject({
      model: "k3",
      modelSource: "send.request",
      contextWindowTokens: null,
    });
  });

  it("keeps send.request visible until a stronger runtime source arrives", () => {
    resetRuntimeReceiptsForTests();
    expect(
      rememberRuntimeReceipt("ws", "codex:1", {
        model: "k3",
        modelSource: "send.request",
      })?.modelSource,
    ).toBe("send.request");
    expect(
      rememberRuntimeReceipt("ws", "codex:1", {
        model: "k3",
        modelSource: "turn.completed",
      }),
    ).toMatchObject({
      model: "k3",
      modelSource: "turn.completed",
    });
    expect(
      extractRuntimeModelFromPayload({
        result: { model: "gpt-5-codex" },
      }),
    ).toBe("gpt-5-codex");
    expect(extractRuntimeModelFromPayload({ model: "<synthetic>" })).toBeNull();
  });

  it("does not let a weaker source overwrite a stronger runtime model", () => {
    const existing = {
      model: "deepseek-v4-pro-0813[1m]",
      modelSource: "assistant.message.model" as const,
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live" as const,
    };
    expect(
      mergeRuntimeReceipt(existing, {
        model: "sonnet",
        modelSource: "send.request",
      }),
    ).toMatchObject(existing);
    expect(
      mergeRuntimeReceipt(existing, {
        contextWindowTokens: 200_000,
        contextWindowSource: "unknown",
      }),
    ).toMatchObject({
      model: "deepseek-v4-pro-0813[1m]",
      modelSource: "assistant.message.model",
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live",
    });
  });

  it("does not let init overwrite a live window, and send.request still resets the turn", () => {
    const live = {
      model: "deepseek-v4-flash",
      modelSource: "assistant.message.model" as const,
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live" as const,
    };
    expect(
      mergeRuntimeReceipt(live, {
        model: "deepseek-v4-flash",
        modelSource: "system.init.model",
        contextWindowTokens: 200_000,
        contextWindowSource: "init",
      }),
    ).toMatchObject({
      model: "deepseek-v4-flash",
      modelSource: "assistant.message.model",
      contextWindowTokens: 1_000_000,
      contextWindowSource: "live",
    });
    resetRuntimeReceiptsForTests();
    rememberRuntimeReceipt("ws", "shared:1", live);
    expect(
      rememberRuntimeReceipt("ws", "shared:1", {
        model: "k3",
        modelSource: "send.request",
      }),
    ).toMatchObject({
      model: "k3",
      modelSource: "send.request",
      contextWindowTokens: null,
      contextWindowSource: null,
    });
  });
});
