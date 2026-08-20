import { describe, expect, it } from "vitest";
import type { ConversationItem, TurnPlan } from "../../../types";
import type {
  ConversationState,
  NormalizedHistorySnapshot,
  NormalizedThreadEvent,
} from "./conversationCurtainContracts";
import {
  appendEvent,
  findConversationStateDiffs,
  hydrateHistory,
  mergeHistoryProjectionItems,
} from "./conversationAssembler";

function createState(): ConversationState {
  return {
    items: [],
    plan: null,
    userInputQueue: [],
    meta: {
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
      activeTurnId: null,
      isThinking: false,
      heartbeatPulse: null,
      historyRestoredAtMs: null,
    },
  };
}

function createEvent(partial: Partial<NormalizedThreadEvent>): NormalizedThreadEvent {
  return {
    engine: "codex",
    workspaceId: "ws-1",
    threadId: "thread-1",
    eventId: "evt-1",
    itemKind: "message",
    timestampMs: 1,
    item: {
      id: "item-1",
      kind: "message",
      role: "assistant",
      text: "",
    },
    operation: "itemUpdated",
    sourceMethod: "item/updated",
    ...partial,
  };
}

describe("conversationAssembler", () => {
  it("filters hidden control-plane facts during history hydrate", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude",
      workspaceId: "ws-1",
      threadId: "thread-1",
      items: [
        {
          id: "control-plane-approval",
          kind: "message",
          role: "assistant",
          text: '<ccgui-approval-resume>[{"path":"a.ts"}]</ccgui-approval-resume>',
        },
        {
          id: "assistant-visible",
          kind: "message",
          role: "assistant",
          text: "visible answer",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-1",
        engine: "claude",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.id).toBe("assistant-visible");
  });

  it("keeps compact control events as diagnostic tool rows instead of assistant prose", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "codex",
      workspaceId: "ws-1",
      threadId: "thread-1",
      items: [
        {
          id: "mode-blocked-1",
          kind: "tool",
          toolType: "mode_blocked",
          title: "",
          detail: "",
          status: undefined,
          output: "",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-1",
        engine: "codex",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    const controlRow = state.items[0];

    expect(state.items).toHaveLength(1);
    expect(controlRow?.kind).toBe("tool");
    if (controlRow?.kind === "tool") {
      expect(controlRow.toolType).toBe("modeBlocked");
      expect(controlRow.title).toBe("Tool: mode policy");
      expect(controlRow.output).toBe("Mode policy blocked this action.");
    }
  });

  it("keeps tool ordering stable and converges status across started/delta/completed", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemStarted",
        item: {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "npm run test",
          status: "started",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "appendToolOutputDelta",
        item: {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "",
          output: "",
          status: "started",
        },
        delta: "running...",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemCompleted",
        item: {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "npm run test",
          output: "running...",
          status: "completed",
        },
      }),
    );

    expect(state.items).toHaveLength(1);
    const onlyItem = state.items[0];
    expect(onlyItem?.kind).toBe("tool");
    if (onlyItem?.kind === "tool") {
      expect(onlyItem.status).toBe("completed");
      expect(onlyItem.output).toContain("running...");
    }
  });

  it("preserves command output when tool snapshots omit output fields", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemStarted",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "ls -la",
          status: "started",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "appendToolOutputDelta",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "",
          output: "",
          status: "started",
        },
        delta: "line 1\n",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemUpdated",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "ls -la",
          output: "",
          status: "running",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemCompleted",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "ls -la",
          output: "",
          status: "completed",
        },
      }),
    );

    const tool = state.items.find(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.id === "tool-output-1",
    );
    expect(tool?.status).toBe("completed");
    expect(tool?.output).toBe("line 1\n");
  });

  it("appends message/reasoning deltas and updates active turn id", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-1-delta-1",
        operation: "appendAgentMessageDelta",
        turnId: "turn-1",
        item: {
          id: "msg-1",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "Hello ",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-1-delta-2",
        operation: "appendAgentMessageDelta",
        turnId: "turn-1",
        item: {
          id: "msg-1",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "world",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-1-summary",
        operation: "appendReasoningSummaryDelta",
        itemKind: "reasoning",
        item: {
          id: "reasoning-1",
          kind: "reasoning",
          summary: "",
          content: "",
        },
        delta: "Analyzing",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-1-content",
        operation: "appendReasoningContentDelta",
        itemKind: "reasoning",
        item: {
          id: "reasoning-1",
          kind: "reasoning",
          summary: "",
          content: "",
        },
        delta: " detailed context",
      }),
    );

    const message = state.items.find((item) => item.id === "msg-1");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "Hello world",
      }),
    );
    const reasoning = state.items.find((item) => item.id === "reasoning-1");
    expect(reasoning).toEqual(
      expect.objectContaining({
        kind: "reasoning",
        summary: "Analyzing",
        content: "detailed context",
      }),
    );
    expect(state.meta.activeTurnId).toBe("turn-1");
  });

  it("keeps the first immutable target snapshot across later message deltas", () => {
    let state = appendEvent(
      createState(),
      createEvent({
        eventId: "shared-message-delta-1",
        operation: "appendAgentMessageDelta",
        turnId: "attempt-a",
        item: {
          id: "shared-message",
          kind: "message",
          role: "assistant",
          text: "",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: "provider-a",
            providerProfileNameSnapshot: "Provider A",
            model: "gpt-a",
          },
        },
        delta: "first",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "shared-message-delta-2",
        operation: "appendAgentMessageDelta",
        turnId: "attempt-a",
        item: {
          id: "shared-message",
          kind: "message",
          role: "assistant",
          text: "",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileId: "provider-b",
            providerProfileNameSnapshot: "Provider B",
            model: "sonnet-b",
          },
        },
        delta: " second",
      }),
    );

    expect(state.items[0]).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "first second",
      turnId: "attempt-a",
      engineSource: "codex",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileId: "provider-a",
        providerProfileNameSnapshot: "Provider A",
        model: "gpt-a",
      },
    });
  });

  it("hydrates a late attempt target onto an unchanged assistant snapshot", () => {
    let state = appendEvent(
      createState(),
      createEvent({
        eventId: "shared-message-snapshot-1",
        operation: "itemUpdated",
        turnId: "attempt-a",
        item: {
          id: "shared-message",
          kind: "message",
          role: "assistant",
          text: "same answer",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "shared-message-snapshot-2",
        operation: "itemUpdated",
        turnId: "attempt-a",
        item: {
          id: "shared-message",
          kind: "message",
          role: "assistant",
          text: "same answer",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: "provider-a",
            providerProfileNameSnapshot: "Provider A",
            model: "gpt-a",
          },
        },
      }),
    );

    expect(state.items[0]).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "same answer",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileId: "provider-a",
        providerProfileNameSnapshot: "Provider A",
        model: "gpt-a",
      },
    });
  });

  it("keeps the first immutable target snapshot across later item snapshots", () => {
    let state = appendEvent(
      createState(),
      createEvent({
        eventId: "shared-message-snapshot-1",
        operation: "itemUpdated",
        turnId: "attempt-a",
        item: {
          id: "shared-message",
          kind: "message",
          role: "assistant",
          text: "first",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: "provider-a",
            providerProfileNameSnapshot: "Provider A",
            model: "gpt-a",
          },
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "shared-message-snapshot-2",
        operation: "itemUpdated",
        turnId: "attempt-a",
        item: {
          id: "shared-message",
          kind: "message",
          role: "assistant",
          text: "first second",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileId: "provider-b",
            providerProfileNameSnapshot: "Provider B",
            model: "sonnet-b",
          },
        },
      }),
    );

    expect(state.items[0]).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "first second",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileId: "provider-a",
        providerProfileNameSnapshot: "Provider A",
        model: "gpt-a",
      },
    });
  });

  it("keeps claude reasoning snapshots append-only instead of replacing previous content", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-append-only",
        eventId: "reasoning-snapshot-1",
        operation: "itemUpdated",
        itemKind: "reasoning",
        item: {
          id: "reasoning-append-only-1",
          kind: "reasoning",
          summary: "先读取项目结构",
          content: "先读取 README 和 docs 目录",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-append-only",
        eventId: "reasoning-snapshot-2",
        operation: "itemUpdated",
        itemKind: "reasoning",
        item: {
          id: "reasoning-append-only-1",
          kind: "reasoning",
          summary: "再检查关键配置",
          content: "再检查 package.json 和脚本入口",
        },
      }),
    );

    const reasoning = state.items.find((item) => item.id === "reasoning-append-only-1");
    expect(reasoning?.kind).toBe("reasoning");
    if (reasoning?.kind === "reasoning") {
      expect(reasoning.summary).toContain("先读取项目结构");
      expect(reasoning.summary).toContain("再检查关键配置");
      expect(reasoning.content).toContain("先读取 README 和 docs 目录");
      expect(reasoning.content).toContain("再检查 package.json 和脚本入口");
      expect(reasoning.content).not.toBe("再检查 package.json 和脚本入口");
    }
  });

  it("merges assistant delta snapshots without duplicate concatenation", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-dup-delta-1",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "你好，我在。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-dup-delta-2",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "你好，我在。 要我先帮你做哪件事？",
      }),
    );

    const message = state.items.find((item) => item.id === "msg-dup");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "你好，我在。 要我先帮你做哪件事？",
      }),
    );
  });

  it("normalizes assistant snapshots with duplicated paragraph blocks before rendering", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-intro",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-dup",
          kind: "message",
          role: "assistant",
          text: "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-dup",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-dup",
          kind: "message",
          role: "assistant",
          text: [
            "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
            "",
            "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
            "",
            "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
          ].join("\n"),
        },
      }),
    );

    const message = state.items.find((item) => item.id === "assistant-snapshot-dup");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: [
          "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
          "",
          "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
        ].join("\n"),
      }),
    );
  });

  it("normalizes duplicated assistant snapshots with CRLF line endings", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-crlf",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-crlf",
          kind: "message",
          role: "assistant",
          text: [
            "先确认项目规范入口。",
            "",
            "然后整理当前任务边界。",
            "",
            "然后整理当前任务边界。",
          ].join("\r\n"),
        },
      }),
    );

    const message = state.items.find((item) => item.id === "assistant-snapshot-crlf");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "先确认项目规范入口。\n\n然后整理当前任务边界。",
      }),
    );
  });

  it("keeps assistant snapshot state stable when the incoming snapshot is equivalent", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-stable-1",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终总结已经成型。",
        },
      }),
    );

    const next = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-stable-2",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终总结已经成型。",
        },
      }),
    );

    expect(next.items).toBe(state.items);
  });

  it("keeps completed assistant text stable when the final payload matches the snapshot", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-complete-stable-1",
        operation: "itemUpdated",
        item: {
          id: "assistant-complete-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终结论已经完整。",
        },
      }),
    );

    const next = appendEvent(
      state,
      createEvent({
        eventId: "assistant-complete-stable-2",
        operation: "completeAgentMessage",
        sourceMethod: "item/completed",
        item: {
          id: "assistant-complete-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终结论已经完整。",
        },
      }),
    );

    expect(next.items).toBe(state.items);
  });

  it("collapses duplicated inline-code delta chunks before appending to prior content", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-inline-prefix-1",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-inline-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "我先按 Trellis 流程把上下文收紧。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-inline-prefix-2",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-inline-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta:
          "`wf-thinking` 这个 skill 路径不在项目内，我改去全局技能目录读。`wf-thinking` 这个 skill 路径不在项目内，我改去全局技能目录读。",
      }),
    );

    const message = state.items.find((item) => item.id === "msg-inline-dup");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text:
          "我先按 Trellis 流程把上下文收紧。`wf-thinking` 这个 skill 路径不在项目内，我改去全局技能目录读。",
      }),
    );
  });

  it("dedupes repeated completed assistant text", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-complete-delta-1",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-complete",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "你好，我在。要我先帮你做哪件事？",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-complete-final",
        operation: "completeAgentMessage",
        item: {
          id: "msg-complete",
          kind: "message",
          role: "assistant",
          text: "你好，我在。要我先帮你做哪件事？ 你好，我在。要我先帮你做哪件事？",
        },
      }),
    );

    const message = state.items.find((item) => item.id === "msg-complete");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "你好，我在。要我先帮你做哪件事？",
      }),
    );
  });

  it("keeps Claude reasoning and assistant items separate when they share the same item id", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-shared-id",
        eventId: "shared-id-reasoning",
        operation: "appendReasoningContentDelta",
        itemKind: "reasoning",
        item: {
          id: "claude-item-shared",
          kind: "reasoning",
          summary: "",
          content: "",
        },
        delta: "我先检查后端结构。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-shared-id",
        eventId: "shared-id-agent",
        operation: "appendAgentMessageDelta",
        itemKind: "message",
        item: {
          id: "claude-item-shared",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "# 分析报告\n\n后端主要使用 FastAPI。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-shared-id",
        eventId: "shared-id-agent-complete",
        operation: "completeAgentMessage",
        itemKind: "message",
        item: {
          id: "claude-item-shared",
          kind: "message",
          role: "assistant",
          text: "# 分析报告\n\n后端主要使用 FastAPI。数据库是 PostgreSQL。",
        },
      }),
    );

    expect(state.items).toHaveLength(2);
    expect(
      state.items.find(
        (item): item is Extract<ConversationItem, { kind: "reasoning" }> =>
          item.kind === "reasoning" && item.id === "claude-item-shared",
      ),
    ).toEqual(
      expect.objectContaining({
        content: "我先检查后端结构。",
      }),
    );
    expect(
      state.items.find(
        (item): item is Extract<ConversationItem, { kind: "message"; role: "assistant" }> =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.id === "claude-item-shared",
      ),
    ).toEqual(
      expect.objectContaining({
        text: "# 分析报告\n\n后端主要使用 FastAPI。数据库是 PostgreSQL。",
      }),
    );
  });

  it("hydrates history with dedupe and keeps plan/userInput/meta", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude" as const,
      workspaceId: "ws-2",
      threadId: "claude:session-1",
      items: [
        { id: "msg-1", kind: "message", role: "assistant", text: "old" } as const,
        { id: "msg-1", kind: "message", role: "assistant", text: "new" } as const,
      ],
      plan: {
        turnId: "turn-2",
        explanation: "Plan",
        steps: [{ step: "Inspect", status: "inProgress" as const }],
      },
      userInputQueue: [
        {
          workspace_id: "ws-2",
          request_id: 1,
          params: {
            thread_id: "claude:session-1",
            turn_id: "turn-2",
            item_id: "item-2",
            questions: [],
          },
        },
      ],
      meta: {
        workspaceId: "ws-2",
        threadId: "claude:session-1",
        engine: "claude" as const,
        activeTurnId: "turn-2",
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 10,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(
      expect.objectContaining({
        id: "msg-1",
        text: "new",
      }),
    );
    expect(state.plan?.turnId).toBe("turn-2");
    expect(state.userInputQueue).toHaveLength(1);
    expect(state.meta.threadId).toBe("claude:session-1");
  });

  it("hydrates thousands of unique history items in source order", () => {
    const itemCount = 3000;
    const items = Array.from({ length: itemCount }, (_, index) =>
      index % 2 === 0
        ? {
            id: `user-${index}`,
            kind: "message" as const,
            role: "user" as const,
            text: `unique user prompt ${index}`,
          }
        : {
            id: `assistant-${index}`,
            kind: "message" as const,
            role: "assistant" as const,
            text: `unique assistant reply ${index}`,
          },
    );
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude",
      workspaceId: "ws-large",
      threadId: "claude:session-large",
      items,
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-large",
        threadId: "claude:session-large",
        engine: "claude",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);

    expect(state.items).toHaveLength(itemCount);
    expect(state.items[0]?.id).toBe("user-0");
    expect(state.items[itemCount - 1]?.id).toBe(`assistant-${itemCount - 1}`);
    expect(state.items.map((item) => item.id)).toEqual(
      items.map((item) => item.id),
    );
  });

  it("keeps live upsert immutable and separate from batch hydrate", () => {
    const previous = createState();
    const next = appendEvent(
      previous,
      createEvent({
        operation: "itemCompleted",
        item: {
          id: "live-1",
          kind: "message",
          role: "assistant",
          text: "live reply",
        },
      }),
    );

    expect(next.items).not.toBe(previous.items);
    expect(previous.items).toHaveLength(0);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toEqual(
      expect.objectContaining({ id: "live-1", text: "live reply" }),
    );
  });

  it("hydrates history without collapsing same-id items across different kinds", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude" as const,
      workspaceId: "ws-2",
      threadId: "claude:session-1",
      items: [
        {
          id: "shared-1",
          kind: "reasoning",
          summary: "先探索目录",
          content: "先看 README。",
        },
        {
          id: "shared-1",
          kind: "message",
          role: "assistant",
          text: "# 报告\n\n项目结构如下。",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-2",
        threadId: "claude:session-1",
        engine: "claude" as const,
        activeTurnId: "turn-2",
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 10,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items).toHaveLength(2);
    expect(
      state.items.find((item) => item.kind === "reasoning" && item.id === "shared-1"),
    ).toBeTruthy();
    expect(
      state.items.find(
        (item) => item.kind === "message" && item.role === "assistant" && item.id === "shared-1",
      ),
    ).toBeTruthy();
  });

  it("hydrates history by collapsing equivalent assistant snapshots with different ids", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "codex" as const,
      workspaceId: "ws-assistant-hydrate",
      threadId: "thread-assistant-hydrate",
      items: [
        {
          id: "assistant-history-alias-1",
          kind: "message",
          role: "assistant",
          text: "我先检查仓库结构。",
        },
        {
          id: "assistant-history-canonical-1",
          kind: "message",
          role: "assistant",
          text: "我先检查仓库结构。 我先检查仓库结构。",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-assistant-hydrate",
        threadId: "thread-assistant-hydrate",
        engine: "codex" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 11,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(
      expect.objectContaining({
        id: "assistant-history-canonical-1",
        kind: "message",
        role: "assistant",
        text: "我先检查仓库结构。",
      }),
    );
  });

  it("does not append a second assistant after a CLI wakeup fold when texts are equivalent", () => {
    let state = createState();
    const assistantText = "已丢到后台，任务 ID `b83ywvfpw`，跑完会通知。";
    state = {
      ...state,
      items: [
        {
          id: "assistant-wakeup",
          kind: "message",
          role: "assistant",
          text: assistantText,
          isFinal: true,
        },
        {
          id: "user-wakeup-fold",
          kind: "message",
          role: "user",
          text: `<task-notification>
<task-id>b83ywvfpw</task-id>
<status>completed</status>
<summary>Background command "Sleep 8s then echo timestamp" completed</summary>
</task-notification>`,
        },
      ],
    };

    state = appendEvent(
      state,
      createEvent({
        eventId: "evt-wakeup-complete",
        item: {
          id: "assistant-wakeup-replay",
          kind: "message",
          role: "assistant",
          text: assistantText,
        },
        operation: "itemCompleted",
      }),
    );

    const assistantMessages = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toBe(assistantText);
    expect(state.items.filter((item) => item.kind === "message")).toHaveLength(2);
  });

  it("hydrates history by collapsing equivalent reasoning snapshots with different ids", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "codex" as const,
      workspaceId: "ws-reasoning-hydrate",
      threadId: "thread-reasoning-hydrate",
      items: [
        {
          id: "reasoning-history-alias-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录",
        },
        {
          id: "reasoning-history-canonical-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录\n再检查入口文件",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-reasoning-hydrate",
        threadId: "thread-reasoning-hydrate",
        engine: "codex" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 12,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(
      expect.objectContaining({
        id: "reasoning-history-canonical-1",
        kind: "reasoning",
        summary: "先读取目录",
        content: "先读取目录\n再检查入口文件",
      }),
    );
  });

  it("hydrates Claude long Markdown replay into one stable assistant row", () => {
    const finalMarkdown = [
      "# 重构方案",
      "",
      "## 目标",
      "",
      "- 收口 normalized observation",
      "- 复用 ConversationAssembler",
      "",
      "```ts",
      "const boundary = \"assembler\";",
      "```",
    ].join("\n");
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude" as const,
      workspaceId: "ws-claude-markdown",
      threadId: "claude:session-markdown",
      items: [
        {
          id: "assistant-stream-1",
          kind: "message",
          role: "assistant",
          text: finalMarkdown,
        },
        {
          id: "assistant-completed-1",
          kind: "message",
          role: "assistant",
          text: finalMarkdown,
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-claude-markdown",
        threadId: "claude:session-markdown",
        engine: "claude" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 20,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    const assistantRows = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0]?.text).toBe(finalMarkdown);
  });

  it("hydrates Claude ExitPlanMode and approval replay without duplicate plan or approval rows", () => {
    const planText = "PLAN\n\n- inspect\n- implement";
    const plan: TurnPlan = {
      turnId: "turn-plan-1",
      explanation: planText,
      steps: [
        { step: "inspect", status: "completed" },
        { step: "implement", status: "inProgress" },
      ],
    };
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude" as const,
      workspaceId: "ws-claude-plan",
      threadId: "claude:session-plan",
      items: [
        {
          id: "exit-plan-1",
          kind: "tool",
          toolType: "ExitPlanMode",
          title: "Claude / ExitPlanMode",
          detail: planText,
          output: planText,
          status: "completed",
        },
        {
          id: "exit-plan-1",
          kind: "tool",
          toolType: "ExitPlanMode",
          title: "Claude / ExitPlanMode",
          detail: planText,
          output: planText,
          status: "completed",
        },
        {
          id: "approval-1",
          kind: "tool",
          toolType: "fileChange",
          title: "Approved file change",
          detail: "Approved and wrote a.ts",
          output: "Approved and wrote a.ts",
          status: "completed",
          changes: [{ path: "a.ts", kind: "add" }],
        },
        {
          id: "approval-1",
          kind: "tool",
          toolType: "fileChange",
          title: "Approved file change",
          detail: "Approved and wrote a.ts",
          output: "Approved and wrote a.ts",
          status: "completed",
          changes: [{ path: "a.ts", kind: "add" }],
        },
      ],
      plan,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-claude-plan",
        threadId: "claude:session-plan",
        engine: "claude" as const,
        activeTurnId: "turn-plan-1",
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 22,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    const exitPlanRows = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && /exitplanmode/i.test(`${item.toolType} ${item.title}`),
    );
    const approvalRows = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolType === "fileChange",
    );

    expect(state.plan).toEqual(plan);
    expect(exitPlanRows).toHaveLength(1);
    expect(approvalRows).toHaveLength(1);
    expect(approvalRows[0]?.changes?.[0]?.path).toBe("a.ts");
  });

  it("hydrates Gemini assistant/reasoning/tool replay with stable cardinality", () => {
    const snapshot = {
      engine: "gemini" as const,
      workspaceId: "ws-gemini-cardinality",
      threadId: "gemini:session-cardinality",
      items: [
        {
          id: "assistant-alias-1",
          kind: "message",
          role: "assistant",
          text: "检查完成。",
        } as const,
        {
          id: "assistant-final-1",
          kind: "message",
          role: "assistant",
          text: "检查完成。",
        } as const,
        {
          id: "reasoning-alias-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录",
        } as const,
        {
          id: "reasoning-final-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录\n再检查测试",
        } as const,
        {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "pnpm vitest",
          output: "running...\n",
          status: "started",
        } as const,
        {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "pnpm vitest",
          output: "running...\nok",
          status: "completed",
        } as const,
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-gemini-cardinality",
        threadId: "gemini:session-cardinality",
        engine: "gemini" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 21,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items.filter((item) => item.kind === "message")).toHaveLength(1);
    expect(state.items.filter((item) => item.kind === "reasoning")).toHaveLength(1);
    expect(state.items.filter((item) => item.kind === "tool")).toHaveLength(1);
    const tool = state.items.find(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool",
    );
    expect(tool?.status).toBe("completed");
    expect(tool?.output).toBe("running...\nok");
  });

  it("does not merge assistant replies across a reasoning boundary", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-before",
        operation: "completeAgentMessage",
        item: {
          id: "assistant-before",
          kind: "message",
          role: "assistant",
          text: "先给结论。",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-between",
        itemKind: "reasoning",
        operation: "itemUpdated",
        item: {
          id: "reasoning-between",
          kind: "reasoning",
          summary: "分析中",
          content: "展开推理过程",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-after",
        operation: "completeAgentMessage",
        item: {
          id: "assistant-after",
          kind: "message",
          role: "assistant",
          text: "再给一次简短结论。",
        },
      }),
    );

    const assistantTexts = state.items
      .filter(
        (item): item is Extract<ConversationItem, { kind: "message" }> =>
          item.kind === "message",
      )
      .filter((item) => item.role === "assistant")
      .map((item) => item.text);
    expect(assistantTexts).toEqual([
      "先给结论。",
      "再给一次简短结论。",
    ]);
  });

  it("keeps picker snapshot and upgrades runtime receipt across first delta, live, and complete", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "delta-1",
        operation: "appendAgentMessageDelta",
        delta: "hello",
        item: {
          id: "assistant-receipt-1",
          kind: "message",
          role: "assistant",
          text: "hello",
          executionTargetSnapshot: { engine: "claude", model: "k3" },
          runtimeReceipt: {
            model: "k3",
            modelSource: "send.request",
          },
        },
      }),
    );
    const afterDelta = state.items[0];
    expect(afterDelta).toMatchObject({
      executionTargetSnapshot: { model: "k3" },
      runtimeReceipt: { model: "k3", modelSource: "send.request" },
    });

    state = appendEvent(
      state,
      createEvent({
        eventId: "live-1",
        operation: "itemUpdated",
        item: {
          id: "assistant-receipt-1",
          kind: "message",
          role: "assistant",
          text: "hello world",
          executionTargetSnapshot: { engine: "claude", model: "k3" },
          runtimeReceipt: {
            model: "deepseek-v4-flash",
            modelSource: "system.init.model",
            contextWindowTokens: 1_000_000,
            contextWindowSource: "live",
          },
        },
      }),
    );
    expect(state.items[0]).toMatchObject({
      executionTargetSnapshot: { model: "k3" },
      runtimeReceipt: {
        model: "deepseek-v4-flash",
        modelSource: "system.init.model",
        contextWindowTokens: 1_000_000,
      },
    });

    const afterLive = state;
    state = appendEvent(
      state,
      createEvent({
        eventId: "complete-1",
        operation: "completeAgentMessage",
        sourceMethod: "item/completed",
        item: {
          id: "assistant-receipt-1",
          kind: "message",
          role: "assistant",
          text: "hello world",
        },
      }),
    );
    expect(state.items[0]).toMatchObject({
      text: "hello world",
      executionTargetSnapshot: { model: "k3" },
      runtimeReceipt: {
        model: "deepseek-v4-flash",
        modelSource: "system.init.model",
        contextWindowTokens: 1_000_000,
      },
    });
    expect(state.items).toBe(afterLive.items);
  });

  it("keeps short distinct reasoning snapshots separate when one is only a loose substring", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-short-a",
        itemKind: "reasoning",
        operation: "itemUpdated",
        item: {
          id: "reasoning-short-a",
          kind: "reasoning",
          summary: "",
          content: "检查目录",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-short-b",
        itemKind: "reasoning",
        operation: "itemUpdated",
        item: {
          id: "reasoning-short-b",
          kind: "reasoning",
          summary: "",
          content: "先检查目录再跑测试",
        },
      }),
    );

    const reasoningItems = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "reasoning" }> =>
        item.kind === "reasoning",
    );
    expect(reasoningItems).toHaveLength(2);
    expect(reasoningItems.map((item) => item.id)).toEqual([
      "reasoning-short-a",
      "reasoning-short-b",
    ]);
  });

  it("retargets generated image anchors when normalized realtime replaces an optimistic user id", () => {
    let state = createState();
    state = {
      ...state,
      items: [
        {
          id: "optimistic-user-1",
          kind: "message",
          role: "user",
          text: "生成一张图，要美女",
        },
        {
          id: "optimistic-generated-image:thread-1:optimistic-user-1",
          kind: "generatedImage",
          status: "processing",
          sourceToolName: "image_generation_call",
          promptText: "生成一张图，要美女",
          anchorUserMessageId: "optimistic-user-1",
          images: [],
        },
      ],
    };

    state = appendEvent(
      state,
      createEvent({
        eventId: "evt-user-real-1",
        item: {
          id: "real-user-1",
          kind: "message",
          role: "user",
          text: "生成一张图，要美女",
        },
        operation: "itemCompleted",
      }),
    );

    expect(state.items).toEqual([
      {
        id: "real-user-1",
        kind: "message",
        role: "user",
        text: "生成一张图，要美女",
        presentationMetadata: {
          displayText: "生成一张图，要美女",
          stickyCandidateText: "生成一张图，要美女",
          contexts: [],
        },
      },
      {
        id: "optimistic-generated-image:thread-1:optimistic-user-1",
        kind: "generatedImage",
        status: "processing",
        sourceToolName: "image_generation_call",
        promptText: "生成一张图，要美女",
        anchorUserMessageId: "real-user-1",
        images: [],
      },
    ]);
  });

  it("uses whitelist to ignore acceptable realtime/history meta differences", () => {
    const base = createState();
    const realtime: ConversationState = {
      ...base,
      meta: {
        ...base.meta,
        heartbeatPulse: 1,
        historyRestoredAtMs: 100,
      },
    };
    const history: ConversationState = {
      ...base,
      meta: {
        ...base.meta,
        heartbeatPulse: 3,
        historyRestoredAtMs: 200,
      },
    };
    expect(findConversationStateDiffs(realtime, history)).toEqual([]);

    const withPlanMismatch: ConversationState = {
      ...history,
      plan: {
        turnId: "turn-1",
        explanation: "Different plan",
        steps: [{ step: "Only history", status: "inProgress" }],
      },
    };
    expect(findConversationStateDiffs(realtime, withPlanMismatch)).toEqual([
      "plan",
    ]);
  });

  it("merges projection identity into each matching history turn without duplication", () => {
    const baseItems: ConversationItem[] = [
      { id: "legacy-u1", kind: "message", role: "user", text: "first" },
      { id: "legacy-r1", kind: "reasoning", summary: "think one", content: "think one" },
      { id: "legacy-a1", kind: "message", role: "assistant", text: "answer one" },
      { id: "legacy-u2", kind: "message", role: "user", text: "second" },
      { id: "legacy-r2", kind: "reasoning", summary: "think two", content: "think two" },
      { id: "legacy-a2", kind: "message", role: "assistant", text: "answer two" },
    ];
    const overlayItems: ConversationItem[] = [
      { id: "canonical-u1", kind: "message", role: "user", text: "first" },
      {
        id: "canonical-a1",
        kind: "message",
        role: "assistant",
        text: "answer one",
        executionTargetSnapshot: {
          engine: "claude",
          providerProfileNameSnapshot: "Official",
          model: "sonnet",
        },
      },
      { id: "canonical-u2", kind: "message", role: "user", text: "second" },
      {
        id: "canonical-a2",
        kind: "message",
        role: "assistant",
        text: "answer two",
        executionTargetSnapshot: {
          engine: "codex",
          providerProfileNameSnapshot: "MiniMax",
          model: "MiniMax-M3",
        },
      },
    ];

    const merged = mergeHistoryProjectionItems(baseItems, overlayItems, {
      workspaceId: "ws-1",
      threadId: "shared:thread-1",
      engine: "codex",
    });

    expect(merged).toHaveLength(6);
    expect(merged.filter((item) => item.kind === "reasoning")).toHaveLength(2);
    expect(
      merged
        .filter(
          (item): item is Extract<ConversationItem, { kind: "message" }> =>
            item.kind === "message" && item.role === "assistant",
        )
        .map((item) => item.executionTargetSnapshot?.providerProfileNameSnapshot),
    ).toEqual(["Official", "MiniMax"]);
  });

  it("matches repeated user prompts by Turn order instead of collapsing them", () => {
    const merged = mergeHistoryProjectionItems(
      [
        { id: "legacy-u1", kind: "message", role: "user", text: "你好" },
        { id: "legacy-a1", kind: "message", role: "assistant", text: "Claude answer" },
        { id: "legacy-u2", kind: "message", role: "user", text: "你好" },
        { id: "legacy-a2", kind: "message", role: "assistant", text: "Codex answer" },
      ],
      [
        { id: "canonical-u1", kind: "message", role: "user", text: "你好" },
        {
          id: "canonical-a1",
          kind: "message",
          role: "assistant",
          text: "Claude answer",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileNameSnapshot: "Claude Provider",
          },
        },
        { id: "canonical-u2", kind: "message", role: "user", text: "你好" },
        {
          id: "canonical-a2",
          kind: "message",
          role: "assistant",
          text: "Codex answer",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileNameSnapshot: "Codex Provider",
          },
        },
      ],
      {
        workspaceId: "ws-1",
        threadId: "shared:repeated-prompts",
        engine: "codex",
      },
    );

    expect(merged).toHaveLength(4);
    expect(
      merged
        .filter(
          (item): item is Extract<ConversationItem, { kind: "message" }> =>
            item.kind === "message" && item.role === "assistant",
        )
        .map((item) => item.executionTargetSnapshot?.providerProfileNameSnapshot),
    ).toEqual(["Claude Provider", "Codex Provider"]);
  });

  it("keeps a complete Legacy assistant body when canonical text is a short prefix", () => {
    const merged = mergeHistoryProjectionItems(
      [
        { id: "legacy-user", kind: "message", role: "user", text: "model?" },
        {
          id: "legacy-assistant",
          kind: "message",
          role: "assistant",
          text: "Claude，Anthropic 出品。这里是完整回答。",
        },
      ],
      [
        { id: "canonical-user", kind: "message", role: "user", text: "model?" },
        {
          id: "canonical-assistant",
          kind: "message",
          role: "assistant",
          text: "Cl",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileNameSnapshot: "Official",
            model: "settings-main",
          },
        },
      ],
      {
        workspaceId: "ws-1",
        threadId: "shared:thread-prefix",
        engine: "claude",
      },
    );

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      id: "canonical-assistant",
      text: "Claude，Anthropic 出品。这里是完整回答。",
      executionTargetSnapshot: {
        engine: "claude",
        providerProfileNameSnapshot: "Official",
        model: "settings-main",
      },
    });
  });

  it("lets a resolved canonical Attempt Target replace a more verbose stale Legacy label", () => {
    const merged = mergeHistoryProjectionItems(
      [
        { id: "legacy-user", kind: "message", role: "user", text: "model?" },
        {
          id: "legacy-assistant",
          kind: "message",
          role: "assistant",
          text: "answer",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileId: "stale-provider",
            providerProfileNameSnapshot: "Stale Provider",
            providerProfileSource: "managed",
            modelCatalogEntryId: "stale-catalog-model",
            model: "stale-runtime-model",
            reasoning: { effort: "high" },
            runtimeCapabilityFingerprint: "stale-capability",
          },
        },
      ],
      [
        { id: "canonical-user", kind: "message", role: "user", text: "model?" },
        {
          id: "canonical-assistant",
          kind: "message",
          role: "assistant",
          text: "answer",
          executionTargetSnapshot: {
            engine: "codex",
            providerProfileId: "provider-kimi",
            providerProfileNameSnapshot: "Kimi Coding",
            providerProfileSource: "managed",
            modelCatalogEntryId: "kimi-catalog-model",
            model: "kimi-for-coding",
          },
        },
      ],
      {
        workspaceId: "ws-1",
        threadId: "shared:canonical-target-authority",
        engine: "codex",
      },
    );

    expect(merged[1]).toMatchObject({
      id: "canonical-assistant",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileId: "provider-kimi",
        providerProfileNameSnapshot: "Kimi Coding",
        providerProfileSource: "managed",
        modelCatalogEntryId: "kimi-catalog-model",
        model: "kimi-for-coding",
      },
    });
  });

  it("upgrades a Legacy prefix from canonical final without collapsing unrelated text", () => {
    const upgraded = mergeHistoryProjectionItems(
      [
        { id: "legacy-user", kind: "message", role: "user", text: "model?" },
        { id: "legacy-assistant", kind: "message", role: "assistant", text: "Cl" },
      ],
      [
        { id: "canonical-user", kind: "message", role: "user", text: "model?" },
        {
          id: "canonical-assistant",
          kind: "message",
          role: "assistant",
          text: "Claude，Anthropic 出品。这里是完整回答。",
        },
      ],
      {
        workspaceId: "ws-1",
        threadId: "shared:thread-upgrade",
        engine: "claude",
      },
    );
    const unrelated = mergeHistoryProjectionItems(
      [
        { id: "legacy-user", kind: "message", role: "user", text: "model?" },
        { id: "legacy-assistant", kind: "message", role: "assistant", text: "旧回答" },
      ],
      [
        { id: "canonical-user", kind: "message", role: "user", text: "model?" },
        {
          id: "canonical-assistant",
          kind: "message",
          role: "assistant",
          text: "完全不同的新回答",
        },
      ],
      {
        workspaceId: "ws-1",
        threadId: "shared:thread-unrelated",
        engine: "claude",
      },
    );

    expect(upgraded).toHaveLength(2);
    expect(upgraded[1]).toMatchObject({
      id: "canonical-assistant",
      text: "Claude，Anthropic 出品。这里是完整回答。",
    });
    expect(unrelated).toHaveLength(3);
    expect(
      unrelated
        .filter(
          (item): item is Extract<ConversationItem, { kind: "message" }> =>
            item.kind === "message" && item.role === "assistant",
        )
        .map((item) => item.text),
    ).toEqual(["旧回答", "完全不同的新回答"]);
  });

  it("preserves user attachment images when projection and legacy disagree on images", () => {
    const fromLegacyRicher = mergeHistoryProjectionItems(
      [
        {
          id: "legacy-user",
          kind: "message",
          role: "user",
          text: "看这张图",
          images: ["/tmp/shot.png"],
        },
      ],
      [
        {
          id: "1:user",
          kind: "message",
          role: "user",
          text: "看这张图",
          turnId: "turn-1",
        },
      ],
      {
        workspaceId: "ws-1",
        threadId: "shared:thread-user-images",
        engine: "grok",
      },
    );
    const fromProjectionRicher = mergeHistoryProjectionItems(
      [
        {
          id: "legacy-user",
          kind: "message",
          role: "user",
          text: "看这张图",
        },
      ],
      [
        {
          id: "1:user",
          kind: "message",
          role: "user",
          text: "看这张图",
          turnId: "turn-1",
          images: ["/tmp/shot.png"],
        },
      ],
      {
        workspaceId: "ws-1",
        threadId: "shared:thread-user-images-2",
        engine: "grok",
      },
    );

    const legacyUsers = fromLegacyRicher.filter(
      (item) => item.kind === "message" && item.role === "user",
    );
    const projectionUsers = fromProjectionRicher.filter(
      (item) => item.kind === "message" && item.role === "user",
    );
    expect(legacyUsers).toHaveLength(1);
    expect(legacyUsers[0]).toMatchObject({
      text: "看这张图",
      images: ["/tmp/shot.png"],
    });
    expect(projectionUsers).toHaveLength(1);
    expect(projectionUsers[0]).toMatchObject({
      text: "看这张图",
      images: ["/tmp/shot.png"],
    });
  });
});
