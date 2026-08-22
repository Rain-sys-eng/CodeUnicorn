import { describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  createClaudeHistoryLoader,
  parseClaudeHistoryMessages,
} from "./claudeHistoryLoader";
import { writeClientStoreValue } from "../../../services/clientStorage";
import {
  appendLiveAssistantShadowDelta,
  buildLiveAssistantShadowTranscriptId,
  settleLiveAssistantShadowTranscript,
} from "../utils/liveAssistantShadowTranscript";

type AssistantMessageItem = Extract<ConversationItem, { kind: "message" }> & {
  role: "assistant";
};

function syntheticContinuationSummaryText() {
  return [
    "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
    "",
    "Summary:",
    "Primary Request and Intent:",
    "The user asked to analyze the current project.",
    "",
    "Current Work:",
    "Continue the conversation from where it left off without asking the user any further questions.",
  ].join("\n");
}

describe("parseClaudeHistoryMessages", () => {
  it("filters Codex control-plane messages from Claude history", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "control-init",
        role: "user",
        method: "initialize",
        params: {
          clientInfo: { name: "ccgui", title: "ccgui" },
          capabilities: { experimentalApi: true },
        },
        text: "",
      },
      {
        kind: "message",
        id: "control-instructions",
        role: "user",
        text: 'developer_instructions="follow workspace policy"',
      },
      {
        kind: "message",
        id: "control-codex-app-server",
        role: "user",
        text: "codex app-server",
      },
      {
        kind: "message",
        id: "real-user",
        role: "user",
        text: "Continue the real task",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "real-user",
      kind: "message",
      role: "user",
      text: "Continue the real task",
    });
  });

  it("filters leaked Claude stream-json stdin payloads from Claude history", () => {
    const leakedPayload = JSON.stringify({
      message: {
        content: [{ text: "你好", type: "text" }],
        role: "user",
      },
      type: "user",
    });
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "control-stream-json-payload",
        role: "user",
        text: leakedPayload,
      },
      {
        kind: "message",
        id: "real-user",
        role: "user",
        text: "真实问题",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "real-user",
      kind: "message",
      role: "user",
      text: "真实问题",
    });
  });

  it("quarantines assistant echo after leaked Claude stream-json stdin payload", () => {
    const leakedPayload = JSON.stringify({
      message: {
        content: [{ text: "你好", type: "text" }],
        role: "user",
      },
      type: "user",
    });
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "control-stream-json-payload",
        role: "user",
        text: leakedPayload,
      },
      {
        kind: "message",
        id: "polluted-assistant",
        role: "assistant",
        text: "用户发了一条“你好”的消息。",
      },
      {
        kind: "message",
        id: "real-user",
        role: "user",
        text: "第二次真实问题",
      },
      {
        kind: "message",
        id: "real-assistant",
        role: "assistant",
        text: "第二次真实回答",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "real-user",
          kind: "message",
          role: "user",
          text: "第二次真实问题",
        }),
        expect.objectContaining({
          id: "real-assistant",
          kind: "message",
          role: "assistant",
          text: "第二次真实回答",
        }),
      ]),
    );
    expect(items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "polluted-assistant" }),
      ]),
    );
  });

  it("does not stamp native runtime receipt from JSONL assistant model", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "user-1",
        role: "user",
        text: "hi",
      },
      {
        kind: "message",
        id: "assistant-1",
        role: "assistant",
        text: "hello",
        message: { model: "deepseek-v4-pro-0813[1m]" },
      },
    ]);
    const assistant = items.find((item) => item.id === "assistant-1");
    expect(assistant).toMatchObject({
      role: "assistant",
      text: "hello",
    });
    expect(assistant).not.toHaveProperty("executionTargetSnapshot");
    expect(assistant).not.toHaveProperty("runtimeReceipt");
  });

  it("hides a transcript that only contains leaked stream-json payload echo", () => {
    const leakedPayload = JSON.stringify({
      message: {
        content: [{ text: "你好", type: "text" }],
        role: "user",
      },
      type: "user",
    });
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "control-stream-json-payload",
        role: "user",
        text: leakedPayload,
      },
      {
        kind: "message",
        id: "polluted-assistant",
        role: "assistant",
        text: "你好！有什么可以帮你的？",
      },
    ]);

    expect(items).toEqual([]);
  });

  it("does not filter normal user text mentioning app-server", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "real-user-app-server",
        role: "user",
        text: "Please inspect why app-server appears in the logs.",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "real-user-app-server",
      kind: "message",
      role: "user",
    });
  });

  it("does not filter normal user text discussing JSON", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "real-user-json",
        role: "user",
        text: '{"message":"please explain this JSON"}',
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "real-user-json",
      kind: "message",
      role: "user",
    });
  });

  it("does not filter normal user text mentioning codex app-server", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "real-user-codex-app-server",
        role: "user",
        text: "Please inspect why codex app-server appears in logs.",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "real-user-codex-app-server",
      kind: "message",
      role: "user",
    });
  });

  it("filters synthetic continuation summaries without hiding normal summary discussion", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "synthetic-continuation",
        role: "user",
        text: syntheticContinuationSummaryText(),
        isVisibleInTranscriptOnly: true,
        isCompactSummary: true,
        cwd: "C:\\Users\\fay\\code\\vinci",
      },
      {
        kind: "message",
        id: "legacy-raw-continuation",
        isSynthetic: true,
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: syntheticContinuationSummaryText(),
            },
          ],
        },
        cwd: "/Users/fay/code/vinci",
      },
      {
        kind: "message",
        id: "real-user-question",
        role: "user",
        text: "Why did `This session is being continued from a previous conversation` appear in my chat?",
      },
      {
        kind: "message",
        id: "real-user-pasted-summary",
        role: "user",
        text: syntheticContinuationSummaryText(),
      },
      {
        kind: "message",
        id: "real-assistant",
        role: "assistant",
        text: "It is a synthetic continuation summary leaking from runtime history.",
      },
    ]);

    expect(items).toHaveLength(3);
    expect(items).toEqual([
      expect.objectContaining({
        id: "real-user-question",
        kind: "message",
        role: "user",
      }),
      expect.objectContaining({
        id: "real-user-pasted-summary",
        kind: "message",
        role: "user",
      }),
      expect.objectContaining({
        id: "real-assistant",
        kind: "message",
        role: "assistant",
      }),
    ]);
    expect(items[1]).toEqual(
      expect.objectContaining({
        text: syntheticContinuationSummaryText(),
      }),
    );
  });

  it("formats Claude local-control messages and hides internal rows", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "permission-mode",
        type: "permission-mode",
        role: "user",
        text: "default",
        cwd: "/Users/fay/code/vinci",
      },
      {
        kind: "message",
        id: "resume-command",
        role: "user",
        text: "<command-name>/resume</command-name>",
        cwd: "C:\\Users\\fay\\code\\vinci",
      },
      {
        kind: "message",
        id: "resume-failed",
        role: "user",
        text: "<local-command-stdout>Session \u001b[1m1778306483383\u001b[22m was not found.</local-command-stdout>",
        cwd: "C:\\Users\\fay\\code\\vinci",
      },
      {
        kind: "message",
        id: "model-changed",
        role: "user",
        text: "<local-command-stdout>Set model to \u001b[1mMiniMax-M2.7\u001b[22m</local-command-stdout>",
        cwd: "/Users/fay/code/vinci",
      },
      {
        kind: "message",
        id: "interrupted",
        role: "user",
        text: "[Request interrupted by user]",
      },
      {
        kind: "message",
        id: "synthetic-no-response",
        role: "assistant",
        model: "<synthetic>",
        text: "No response requested.",
      },
      {
        id: "local-command-system",
        kind: "message",
        role: "user",
        message: {
          type: "system",
          subtype: "local_command",
        },
        text: "local command metadata",
      },
      {
        kind: "message",
        id: "real-user",
        role: "user",
        text: "你好",
      },
    ]);

    expect(items).toHaveLength(4);
    const controlEvents = items.filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolType === "claudeControlEvent",
    );
    expect(controlEvents).toHaveLength(3);
    expect(controlEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "resume-failed",
          title: "恢复失败",
          output: "Session 1778306483383 was not found.",
          status: "failed",
        }),
        expect.objectContaining({
          id: "model-changed",
          title: "模型已切换",
          output: "Set model to MiniMax-M2.7",
          status: "completed",
        }),
        expect.objectContaining({
          id: "interrupted",
          title: "用户已中断",
          output: "[Request interrupted by user]",
        }),
      ]),
    );
    expect(JSON.stringify(items)).not.toContain("<local-command-stdout>");
    expect(JSON.stringify(items)).not.toContain("<command-name>");
    expect(JSON.stringify(items)).not.toContain("No response requested");
    expect(JSON.stringify(items)).not.toContain("local command metadata");
    expect(items[3]).toMatchObject({
      id: "real-user",
      kind: "message",
      role: "user",
      text: "你好",
    });
  });

  it("keeps slash-command user prompts with real args visible as user messages", () => {
    const skillQuestionText = [
      "<command-message>aimax:code-review</command-message>",
      "<command-name>/aimax:code-review</command-name>",
      "<command-args>审查PR802，并告诉我他解决了什么问题，我应不应该合并他</command-args>",
    ].join("\n");
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        id: "skill-question",
        role: "user",
        text: skillQuestionText,
      },
      {
        kind: "message",
        id: "resume-command",
        role: "user",
        text: "<command-name>/resume</command-name>",
      },
      {
        kind: "message",
        id: "empty-args-command",
        role: "user",
        text: "<command-message>clear</command-message>\n<command-name>/clear</command-name>\n<command-args></command-args>",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "skill-question",
      kind: "message",
      role: "user",
      text: skillQuestionText,
    });
  });

  it("preserves backend-formatted Claude control events as tool items", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "backend-resume-event",
        role: "system",
        toolType: "claudeControlEvent",
        title: "Resume failed",
        text: "Session 1778306483383 was not found.",
        status: "failed",
        tool_input: {
          eventType: "resumeFailed",
          source: "claude-history",
        },
        tool_output: {
          detail: "Session 1778306483383 was not found.",
        },
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        id: "backend-resume-event",
        kind: "tool",
        toolType: "claudeControlEvent",
        title: "恢复失败",
        output: "Session 1778306483383 was not found.",
        status: "failed",
      }),
    ]);
  });

  it("skips malformed history rows without failing restore", () => {
    const items = parseClaudeHistoryMessages([
      null,
      "corrupt row",
      ["nested array"],
      {
        kind: "message",
        id: "valid-user",
        role: "user",
        text: "still visible",
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        id: "valid-user",
        kind: "message",
        role: "user",
        text: "still visible",
      }),
    ]);
  });

  it("preserves transcript-style bash output and command metadata", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-1",
        tool_name: "bash",
        tool_input: {
          command: "git log --oneline -10",
          description: "查看最近的 git 提交历史",
        },
      },
      {
        kind: "tool",
        id: "tool-1-result",
        toolType: "result",
        text: "",
        tool_output: {
          output: "abc123 first commit\ndef456 second commit\n",
          exit: 0,
        },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "tool-1",
      kind: "tool",
      toolType: "bash",
      title: "bash",
      status: "completed",
      output: "abc123 first commit\ndef456 second commit\n",
    });
    if (items[0]?.kind === "tool") {
      expect(items[0].detail).toContain("git log --oneline -10");
      expect(items[0].detail).toContain("查看最近的 git 提交历史");
    }
  });

  it("preserves non-command tool input payload for read tools", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-read-1",
        tool_name: "read_file",
        tool_input: {
          file_path: "/workspace/README.md",
        },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "tool-read-1",
      kind: "tool",
      toolType: "read_file",
      title: "read_file",
    });
    if (items[0]?.kind === "tool") {
      expect(items[0].detail).toContain("file_path");
      expect(items[0].detail).toContain("/workspace/README.md");
    }
  });

  it("preserves full command tool_input payload so session activity can read cwd/argv", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-bash-1",
        tool_name: "bash",
        tool_input: {
          argv: ["zsh", "-lc", "pnpm vitest"],
          cwd: "/workspace/project",
          description: "run tests",
        },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "tool-bash-1",
      kind: "tool",
      toolType: "bash",
      title: "bash",
      status: "started",
    });
    if (items[0]?.kind === "tool") {
      expect(items[0].detail).toContain("argv");
      expect(items[0].detail).toContain("/workspace/project");
      expect(items[0].detail).toContain("run tests");
    }
  });

  it("maps AskUserQuestion user answer message into submitted history block", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-ask-1",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              id: "q-0",
              header: "技术偏好",
              question: "你关注哪些方面？",
              options: [
                { label: "代码质量", description: "可维护性" },
                { label: "性能优化", description: "响应速度" },
              ],
            },
          ],
        },
      },
      {
        kind: "message",
        role: "user",
        id: "msg-user-1",
        text: "The user answered the AskUserQuestion: 代码质量, 性能优化. Please continue based on this selection.",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "tool-ask-1",
      kind: "tool",
      toolType: "AskUserQuestion",
      status: "completed",
      output: "代码质量, 性能优化",
    });
    expect(items[1]).toMatchObject({
      id: "request-user-input-submitted-tool-ask-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
    });
    if (items[1]?.kind === "tool") {
      const parsed = JSON.parse(items[1].detail);
      expect(parsed.schema).toBe("requestUserInputSubmitted/v1");
      expect(parsed.questions[0].question).toBe("你关注哪些方面？");
      expect(parsed.questions[0].selectedOptions).toEqual([
        "代码质量",
        "性能优化",
      ]);
    }
  });

  it("maps skipped AskUserQuestion message into empty submitted history block", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-ask-skip-1",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              id: "q-0",
              header: "技术偏好",
              question: "你关注哪些方面？",
            },
          ],
        },
      },
      {
        kind: "message",
        role: "user",
        id: "msg-user-skip-1",
        text: "The user skipped this AskUserQuestion without selecting an option. Do not ask the same question again; continue the original task using the available context and reasonable assumptions.",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "tool-ask-skip-1",
      kind: "tool",
      toolType: "AskUserQuestion",
      status: "completed",
    });
    expect(items[1]).toMatchObject({
      id: "request-user-input-submitted-tool-ask-skip-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
    });
    if (items[1]?.kind === "tool") {
      const parsed = JSON.parse(items[1].detail);
      expect(parsed.questions[0].selectedOptions).toEqual([]);
      expect(parsed.questions[0].note).toBe("");
    }
  });

  it("maps partial AskUserQuestion answer with skipped remaining questions into submitted history block", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-ask-partial-skip-1",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              id: "q-0",
              header: "交互风格",
              question: "你希望我以什么风格和你协作？",
              options: [
                {
                  label: "直接给方案",
                  description: "少废话，直接上代码和结论",
                },
                {
                  label: "先讨论再动手",
                  description: "先聊清楚思路，确认后再写代码",
                },
              ],
            },
            {
              id: "q-1",
              header: "语言偏好",
              question: "你希望我用什么语言表达？",
              options: [
                { label: "中英混合", description: "中文解释，保留技术术语" },
                { label: "纯中文", description: "尽量全部中文表达" },
              ],
            },
            {
              id: "q-2",
              header: "关注点",
              question: "你最关注什么？",
            },
          ],
        },
      },
      {
        kind: "message",
        role: "user",
        id: "msg-user-partial-skip-1",
        text: "The user answered the AskUserQuestion: 直接给方案; 中英混合. The user skipped 1 remaining question(s) without selecting an option. Do not ask the skipped question(s) again; continue the original task using the available context and reasonable assumptions.",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "tool-ask-partial-skip-1",
      kind: "tool",
      toolType: "AskUserQuestion",
      status: "completed",
      output: "直接给方案; 中英混合",
    });
    expect(items[1]).toMatchObject({
      id: "request-user-input-submitted-tool-ask-partial-skip-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
      output: "直接给方案; 中英混合",
    });
    if (items[1]?.kind === "tool") {
      const parsed = JSON.parse(items[1].detail);
      expect(parsed.questions[0].selectedOptions).toEqual(["直接给方案"]);
      expect(parsed.questions[1].selectedOptions).toEqual(["中英混合"]);
      expect(parsed.questions[2].selectedOptions).toEqual([]);
    }
  });

  it("maps keyed partial AskUserQuestion answers to their original question ids", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-ask-keyed-partial-skip-1",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              id: "language",
              header: "语言偏好",
              question: "你平时主要用什么语言写后端？",
              options: [
                {
                  label: "Java",
                  description: "Spring Boot / Spring Cloud 生态",
                },
                { label: "Go", description: "Gin / gRPC / 云原生方向" },
              ],
            },
            {
              id: "style",
              header: "协作风格",
              question: "你希望我以什么风格和你协作？",
              options: [
                {
                  label: "直接给方案",
                  description: "少废话，直接上代码和结论",
                },
                {
                  label: "先讨论再动手",
                  description: "先聊清楚思路，确认后再写代码",
                },
              ],
            },
            {
              id: "focus",
              header: "关注点",
              question: "你最关注什么？",
            },
          ],
        },
      },
      {
        kind: "message",
        role: "user",
        id: "msg-user-keyed-partial-skip-1",
        text: "The user answered the AskUserQuestion: style=直接给方案. The user skipped 1 remaining question(s) without selecting an option. Do not ask the skipped question(s) again; continue the original task using the available context and reasonable assumptions.",
      },
    ]);

    expect(items).toHaveLength(2);
    if (items[1]?.kind !== "tool") {
      throw new Error("expected submitted AskUserQuestion history card");
    }
    const parsed = JSON.parse(items[1].detail);
    expect(parsed.questions[0].selectedOptions).toEqual([]);
    expect(parsed.questions[1].selectedOptions).toEqual(["直接给方案"]);
    expect(parsed.questions[2].selectedOptions).toEqual([]);
    expect(items[1].output).toBe("直接给方案");
  });

  it("keeps equals signs in free-text AskUserQuestion answers as normal text", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-ask-free-text-equals",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              id: "note",
              header: "备注",
              question: "补充说明？",
            },
          ],
        },
      },
      {
        kind: "message",
        role: "user",
        id: "msg-user-free-text-equals",
        text: "The user answered the AskUserQuestion: version=1.0. Please continue based on this selection.",
      },
    ]);

    if (items[1]?.kind !== "tool") {
      throw new Error("expected submitted AskUserQuestion history card");
    }
    const parsed = JSON.parse(items[1].detail);
    expect(parsed.questions[0].selectedOptions).toEqual(["version=1.0"]);
    expect(items[1].output).toBe("version=1.0");
  });

  it("prefers structured AskUserQuestion result markers over text splitting", () => {
    const marker =
      "eyJhbnN3ZXJzIjp7InN0eWxlIjpbIuebtOaOpee7meaWueahiDsga2V5PXZhbHVlIl0sImxhbmd1YWdlIjpbIkphdmEiXX0sInNraXBwZWRRdWVzdGlvbklkcyI6WyJmb2N1cyJdfQ==";
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-ask-structured-marker",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              id: "style",
              header: "协作风格",
              question: "你希望我以什么风格和你协作？",
              options: [{ label: "直接给方案; key=value", description: "" }],
            },
            {
              id: "language",
              header: "语言偏好",
              question: "你平时主要用什么语言写后端？",
              options: [{ label: "Java", description: "" }],
            },
            {
              id: "focus",
              header: "关注点",
              question: "你最关注什么？",
            },
          ],
        },
      },
      {
        kind: "message",
        role: "user",
        id: "msg-user-structured-marker",
        text: `The user answered the AskUserQuestion: style=直接给方案; key=value; language=Java. The user skipped 1 remaining question(s) without selecting an option. AskUserQuestionResultBase64:${marker}`,
      },
    ]);

    if (items[1]?.kind !== "tool") {
      throw new Error("expected submitted AskUserQuestion history card");
    }
    const parsed = JSON.parse(items[1].detail);
    expect(parsed.questions[0].selectedOptions).toEqual([
      "直接给方案; key=value",
    ]);
    expect(parsed.questions[1].selectedOptions).toEqual(["Java"]);
    expect(parsed.questions[2].selectedOptions).toEqual([]);
    expect(items[1].output).toBe("直接给方案; key=value; Java");
  });

  it("keeps user image attachments for message rows even when text is empty", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        role: "user",
        id: "msg-user-image-1",
        text: "",
        images: ["data:image/png;base64,AAAA"],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "msg-user-image-1",
      kind: "message",
      role: "user",
      images: ["data:image/png;base64,AAAA"],
    });
  });

  it("keeps deferred Claude image placeholders without base64 in message rows", () => {
    const items = parseClaudeHistoryMessages(
      [
        {
          kind: "message",
          role: "user",
          id: "msg-user-deferred-image-1",
          text: "",
          deferredImages: [
            {
              locator: {
                sessionId: "session-1",
                lineIndex: 2,
                blockIndex: 1,
                messageId: "msg-user-deferred-image-1",
                mediaType: "image/png",
              },
              mediaType: "image/png",
              estimatedByteSize: 700000,
              reason: "large-inline-image",
            },
          ],
        },
      ],
      "/tmp/workspace",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "msg-user-deferred-image-1",
      kind: "message",
      role: "user",
      deferredImages: [
        {
          mediaType: "image/png",
          estimatedByteSize: 700000,
          workspacePath: "/tmp/workspace",
          locator: {
            sessionId: "session-1",
            lineIndex: 2,
            blockIndex: 1,
          },
        },
      ],
    });
    expect(JSON.stringify(items)).not.toContain("data:image/");
  });

  it("drops malformed deferred Claude image locators with negative indexes", () => {
    const items = parseClaudeHistoryMessages(
      [
        {
          kind: "message",
          role: "user",
          id: "msg-user-deferred-image-invalid",
          text: "",
          deferredImages: [
            {
              locator: {
                sessionId: "session-1",
                lineIndex: -1,
                blockIndex: 0,
                mediaType: "image/png",
              },
              mediaType: "image/png",
              estimatedByteSize: 700000,
              reason: "large-inline-image",
            },
          ],
        },
      ],
      "/tmp/workspace",
    );

    expect(items).toHaveLength(0);
  });

  it("parses legacy single-question AskUserQuestion payloads and answer text variants", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "tool",
        id: "tool-ask-legacy-1",
        tool_name: "AskUserQuestion",
        tool_input: {
          header: "项目类型",
          question: "请选择一个项目类型",
          options: [
            { label: "Web应用", description: "浏览器端项目" },
            { label: "CLI工具", description: "命令行项目" },
          ],
        },
      },
      {
        kind: "message",
        role: "user",
        id: "msg-user-legacy-1",
        text: "The user answered the AskUserQuestion: Web应用 Please continue based on this selection.",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "tool-ask-legacy-1",
      kind: "tool",
      status: "completed",
      output: "Web应用",
    });
    expect(items[1]).toMatchObject({
      id: "request-user-input-submitted-tool-ask-legacy-1",
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      status: "completed",
    });
    if (items[1]?.kind === "tool") {
      const parsed = JSON.parse(items[1].detail);
      expect(parsed.questions[0].question).toBe("请选择一个项目类型");
      expect(parsed.questions[0].selectedOptions).toEqual(["Web应用"]);
    }
  });

  it("marks the last assistant message of each turn as final for history restore", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        role: "user",
        id: "user-1",
        text: "Q1",
      },
      {
        kind: "message",
        role: "assistant",
        id: "assistant-1a",
        text: "A1-part1",
      },
      {
        kind: "message",
        role: "assistant",
        id: "assistant-1b",
        text: "A1-part2",
      },
      {
        kind: "message",
        role: "user",
        id: "user-2",
        text: "Q2",
      },
      {
        kind: "message",
        role: "assistant",
        id: "assistant-2",
        text: "A2",
      },
    ]);

    const assistantItems = items.filter(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );

    expect(assistantItems).toHaveLength(3);
    expect(assistantItems[0]?.id).toBe("assistant-1a");
    expect(assistantItems[0]?.isFinal).not.toBe(true);
    expect(assistantItems[1]?.id).toBe("assistant-1b");
    expect(assistantItems[1]?.isFinal).toBe(true);
    expect(assistantItems[2]?.id).toBe("assistant-2");
    expect(assistantItems[2]?.isFinal).toBe(true);
  });

  it("respects explicit assistant final flags from Claude history rows", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        role: "user",
        id: "user-1",
        text: "Q1",
      },
      {
        kind: "message",
        role: "assistant",
        id: "assistant-explicit-1",
        text: "A1",
        metadata: { is_final: true },
      },
      {
        kind: "message",
        role: "assistant",
        id: "assistant-explicit-2",
        text: "A1 follow-up",
      },
    ]);

    const assistantItems = items.filter(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );

    expect(assistantItems).toHaveLength(2);
    expect(assistantItems[0]?.id).toBe("assistant-explicit-1");
    expect(assistantItems[0]?.isFinal).toBe(true);
    expect(assistantItems[1]?.id).toBe("assistant-explicit-2");
    expect(assistantItems[1]?.isFinal).not.toBe(true);
  });

  it("hydrates final completion time and duration from Claude message timestamps", () => {
    const startedAt = "2026-04-01T08:00:00.000Z";
    const completedAt = "2026-04-01T08:00:07.000Z";
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        role: "user",
        id: "user-timed-1",
        text: "Q1",
        timestamp: startedAt,
      },
      {
        kind: "message",
        role: "assistant",
        id: "assistant-timed-1",
        text: "A1",
        timestamp: completedAt,
      },
    ]);

    const assistant = items.find(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );

    expect(assistant).toBeTruthy();
    expect(assistant?.isFinal).toBe(true);
    expect(assistant?.finalCompletedAt).toBe(Date.parse(completedAt));
    expect(assistant?.finalDurationMs).toBe(7_000);
  });

  it("reconstructs synthetic approval resume assistant text into file change history items", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        role: "assistant",
        id: "assistant-approval-resume-1",
        text: [
          "Completed approved operations:",
          "- Approved and wrote ccc.txt",
          "- Approved and wrote bbb.txt",
          "- Approved and wrote aaa1.txt",
          "Please continue from the current workspace state and finish the original task.",
        ].join("\n"),
      },
    ]);

    expect(items).toHaveLength(3);
    expect(items).toEqual([
      expect.objectContaining({
        id: "assistant-approval-resume-1-approval-1",
        kind: "tool",
        toolType: "fileChange",
        status: "completed",
        output: "Approved and wrote ccc.txt",
        changes: [expect.objectContaining({ path: "ccc.txt", kind: "add" })],
      }),
      expect.objectContaining({
        id: "assistant-approval-resume-1-approval-2",
        kind: "tool",
        toolType: "fileChange",
        status: "completed",
        output: "Approved and wrote bbb.txt",
        changes: [expect.objectContaining({ path: "bbb.txt", kind: "add" })],
      }),
      expect.objectContaining({
        id: "assistant-approval-resume-1-approval-3",
        kind: "tool",
        toolType: "fileChange",
        status: "completed",
        output: "Approved and wrote aaa1.txt",
        changes: [expect.objectContaining({ path: "aaa1.txt", kind: "add" })],
      }),
    ]);
  });

  it("prefers structured approval resume marker over english summary parsing", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        role: "assistant",
        id: "assistant-approval-marker-1",
        text: [
          '<ccgui-approval-resume>[{"summary":"Approved and updated ccc.txt","path":"ccc.txt","kind":"modified","status":"completed"},{"summary":"Approved and wrote aaa1.txt","path":"aaa1.txt","kind":"add","status":"completed"}]</ccgui-approval-resume>',
          "Completed approved operations:",
          "- Approved and wrote wrong.txt",
          "Please continue from the current workspace state and finish the original task.",
        ].join("\n"),
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "assistant-approval-marker-1-approval-1",
        kind: "tool",
        toolType: "fileChange",
        output: "Approved and updated ccc.txt",
        changes: [
          expect.objectContaining({ path: "ccc.txt", kind: "modified" }),
        ],
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        id: "assistant-approval-marker-1-approval-2",
        kind: "tool",
        toolType: "fileChange",
        output: "Approved and wrote aaa1.txt",
        changes: [expect.objectContaining({ path: "aaa1.txt", kind: "add" })],
      }),
    );
  });

  it("skips synthetic approval resume prompts that were injected as user messages", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "message",
        role: "user",
        id: "user-real-1",
        text: "创建三个文件",
      },
      {
        kind: "message",
        role: "user",
        id: "user-internal-approval-resume",
        text: [
          '<ccgui-approval-resume>[{"summary":"Approved and wrote bbb.txt","path":"bbb.txt","kind":"add","status":"completed"}]</ccgui-approval-resume>',
          "Approved and wrote bbb.txt",
          "Please continue from the current workspace state and finish the original task.",
        ].join("\n"),
      },
      {
        kind: "message",
        role: "assistant",
        id: "assistant-final-1",
        text: "三个文件都创建好了。",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "user-real-1",
      kind: "message",
      role: "user",
      text: "创建三个文件",
    });
    expect(items[1]).toMatchObject({
      id: "assistant-final-1",
      kind: "message",
      role: "assistant",
      text: "三个文件都创建好了。",
    });
  });

  it("merges Claude tool result by tool_use_id and avoids duplicate tool rows", () => {
    const items = parseClaudeHistoryMessages([
      {
        id: "toolu_123",
        kind: "tool",
        tool_name: "read",
        text: '{"file_path":"README.md"}',
      },
      {
        id: "result_456",
        kind: "tool",
        toolType: "result",
        tool_use_id: "toolu_123",
        text: "ok",
      },
    ]);

    const toolItems = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "tool" }> =>
        item.kind === "tool",
    );
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toEqual(
      expect.objectContaining({
        id: "toolu_123",
        status: "completed",
        output: "ok",
      }),
    );
  });

  it("collapses repeated claude reasoning snapshots with different ids", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "reasoning",
        id: "reason-1",
        text: "先检查项目目录结构和入口模块，再确认核心路由",
      },
      {
        kind: "reasoning",
        id: "reason-2",
        text: "先检查项目目录结构和入口模块，再确认核心路由并定位状态来源",
      },
      {
        kind: "reasoning",
        id: "reason-3",
        text: "先检查项目目录结构和入口模块，再确认核心路由并定位状态来源",
      },
    ]);

    const reasoning = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "reasoning" }> =>
        item.kind === "reasoning",
    );
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]?.content).toBe(
      "先检查项目目录结构和入口模块，再确认核心路由并定位状态来源",
    );
  });
});

describe("createClaudeHistoryLoader shadow recovery", () => {
  it("recovers interrupted Claude assistant text when provider history lacks final body", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow",
      turnId: "turn-shadow",
      itemId: "assistant-shadow",
      delta: "第一章\n\n少年踏入山门。",
      timestamp: Date.now(),
    });
    const shadowId = buildLiveAssistantShadowTranscriptId({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow",
      turnId: "turn-shadow",
      itemId: "assistant-shadow",
    });
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow",
      workspacePath: "/tmp/ws-shadow",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-long",
            role: "user",
            text: "请输出一篇50000字的修仙小说",
          },
          {
            kind: "reasoning",
            id: "assistant-thinking",
            text: "我需要规划长篇小说。",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow");
    const recovered = snapshot.items.find(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(recovered).toMatchObject({
      id: "claude-shadow-recovered-assistant-shadow",
      text: "第一章\n\n少年踏入山门。",
      recoveredFromLiveShadow: true,
      recoveryStatus: "interrupted",
      recoverySourceId: shadowId,
      isFinal: false,
      engineSource: "claude",
    });
  });

  it("recovers a 50k CJK shadow transcript with paragraph breaks after simulated close", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    const paragraph = "太虚山下，云海翻涌，少年执剑向前。";
    const longShadowText = [
      paragraph.repeat(Math.ceil(25_000 / paragraph.length)),
      "第二段仍需保留，不能在恢复后挤成一团。",
      paragraph.repeat(Math.ceil(25_000 / paragraph.length)),
    ].join("\n\n");
    expect(longShadowText.length).toBeGreaterThan(50_000);
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow-50k",
      threadId: "claude:session-shadow-50k",
      turnId: "turn-shadow-50k",
      itemId: "assistant-shadow-50k",
      delta: longShadowText,
      timestamp: Date.now(),
    });

    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow-50k",
      workspacePath: "/tmp/ws-shadow-50k",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-long-50k",
            role: "user",
            text: "请输出一篇50000字的修仙小说",
            turnId: "turn-shadow-50k",
          },
          {
            kind: "reasoning",
            id: "assistant-thinking-50k",
            text: "我需要规划长篇小说。",
            turnId: "turn-shadow-50k",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow-50k");
    const recovered = snapshot.items.find(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );

    expect(recovered).toMatchObject({
      id: "claude-shadow-recovered-assistant-shadow-50k",
      text: longShadowText,
      recoveredFromLiveShadow: true,
      recoveryStatus: "interrupted",
      recoverySourceId: buildLiveAssistantShadowTranscriptId({
        engine: "claude",
        workspaceId: "ws-shadow-50k",
        threadId: "claude:session-shadow-50k",
        turnId: "turn-shadow-50k",
        itemId: "assistant-shadow-50k",
      }),
      isFinal: false,
      engineSource: "claude",
    });
    expect(recovered?.text).toContain("\n\n第二段仍需保留");
    expect(recovered?.text).not.toContain("...");
  });

  it("replaces a non-final assistant row with recovered live shadow when shadow extends it", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-prefix",
      turnId: "turn-shadow-prefix",
      itemId: "assistant-shadow-prefix",
      delta: "第一章\n\n少年踏入山门。\n\n第六百一十回，风起云涌。",
      timestamp: Date.now(),
    });
    const shadowId = buildLiveAssistantShadowTranscriptId({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-prefix",
      turnId: "turn-shadow-prefix",
      itemId: "assistant-shadow-prefix",
    });
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow",
      workspacePath: "/tmp/ws-shadow",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-long",
            role: "user",
            text: "继续续写一段",
            turnId: "turn-shadow-prefix",
          },
          {
            kind: "message",
            id: "assistant-prefix",
            role: "assistant",
            text: "第一章\n\n少年踏入山门。",
            turnId: "turn-shadow-prefix",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow-prefix");
    const assistant = snapshot.items.find(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistant).toMatchObject({
      id: "assistant-prefix",
      text: "第一章\n\n少年踏入山门。\n\n第六百一十回，风起云涌。",
      recoveredFromLiveShadow: true,
      recoveryStatus: "interrupted",
      recoverySourceId: shadowId,
      isFinal: false,
      engineSource: "claude",
    });
  });

  it("falls back to settled shadow when unsettled entries are all provider-final observed", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-settled",
      turnId: "turn-shadow",
      itemId: "assistant-shadow",
      delta: "长文本片段 01",
      timestamp: Date.now(),
    });
    settleLiveAssistantShadowTranscript({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-settled",
      itemId: "assistant-shadow",
      text: "长文本片段 01",
      turnId: "turn-shadow",
      providerFinalObserved: true,
      timestamp: Date.now(),
    });

    const shadowId = buildLiveAssistantShadowTranscriptId({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-settled",
      turnId: "turn-shadow",
      itemId: "assistant-shadow",
    });

    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow",
      workspacePath: "/tmp/ws-shadow",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-long",
            role: "user",
            text: "请输出一篇50000字的修仙小说",
            turnId: "turn-shadow",
          },
          {
            kind: "reasoning",
            id: "assistant-thinking",
            text: "我需要分段构建长篇章节。",
            turnId: "turn-shadow",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow-settled");
    const recovered = snapshot.items.find(
      (item): item is AssistantMessageItem =>
        item.kind === "message" &&
        item.role === "assistant" &&
        item.recoveredFromLiveShadow === true,
    );

    expect(recovered).toMatchObject({
      id: "claude-shadow-recovered-assistant-shadow",
      text: "长文本片段 01",
      recoveredFromLiveShadow: true,
      recoveryStatus: "interrupted",
      recoverySourceId: shadowId,
      isFinal: false,
      engineSource: "claude",
    });
  });

  it("matches shadow transcript by turn id derived from parsed conversation", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-turn",
      turnId: "turn-old",
      itemId: "assistant-old",
      delta: "旧内容",
      timestamp: Date.now(),
    });
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-turn",
      turnId: "turn-current",
      itemId: "assistant-current",
      delta: "当前正文",
      timestamp: Date.now() + 1,
    });
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow",
      workspacePath: "/tmp/ws-shadow",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-old",
            role: "user",
            text: "上一个问题",
            turnId: "turn-old",
          },
          {
            kind: "message",
            id: "assistant-old",
            role: "assistant",
            text: "上一个回复",
            turnId: "turn-old",
          },
          {
            kind: "message",
            id: "user-current",
            role: "user",
            text: "继续刚才内容",
            turnId: "turn-current",
          },
          {
            kind: "reasoning",
            id: "assistant-thinking",
            text: "我需要继续写作。",
            turnId: "turn-current",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow-turn");
    const recovered = snapshot.items.filter(
      (item): item is AssistantMessageItem =>
        item.kind === "message" &&
        item.role === "assistant" &&
        item.recoveredFromLiveShadow === true,
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: "claude-shadow-recovered-assistant-current",
      text: "当前正文",
      recoveredFromLiveShadow: true,
      engineSource: "claude",
      recoverySourceId: buildLiveAssistantShadowTranscriptId({
        engine: "claude",
        workspaceId: "ws-shadow",
        threadId: "claude:session-shadow-turn",
        turnId: "turn-current",
        itemId: "assistant-current",
      }),
    });
  });

  it("does not duplicate shadow text when provider history has assistant final body", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow",
      itemId: "assistant-shadow",
      delta: "shadow text",
      timestamp: Date.now(),
    });
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow",
      workspacePath: "/tmp/ws-shadow",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-long",
            role: "user",
            text: "继续",
          },
          {
            kind: "message",
            id: "assistant-final",
            role: "assistant",
            text: "provider final",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow");
    const assistantMessages = snapshot.items.filter(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toBe("provider final");
    expect(assistantMessages[0]?.recoveredFromLiveShadow).toBeUndefined();
  });

  it("does not append shadow after a CLI wakeup fold when the assistant already exists", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    const assistantText = "已丢到后台，任务 ID `b83ywvfpw`，跑完会通知。";
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow-wakeup",
      threadId: "claude:session-shadow-wakeup",
      turnId: "turn-wakeup",
      itemId: "assistant-wakeup",
      delta: assistantText,
      timestamp: Date.now(),
    });
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow-wakeup",
      workspacePath: "/tmp/ws-shadow-wakeup",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-prompt",
            role: "user",
            text: "后台跑 8 秒再回时间戳",
            turnId: "turn-wakeup",
          },
          {
            kind: "message",
            id: "assistant-wakeup",
            role: "assistant",
            text: assistantText,
            turnId: "turn-wakeup",
            isFinal: true,
          },
          {
            kind: "message",
            id: "user-wakeup-fold",
            role: "user",
            text: `<task-notification>
<task-id>b83ywvfpw</task-id>
<tool-use-id>tool_DKGIroC93JLmXOHPsnTRi0SU</tool-use-id>
<output-file>/tmp/claude-501/tasks/b83ywvfpw.output</output-file>
<status>completed</status>
<summary>Background command "Sleep 8s then echo timestamp" completed</summary>
</task-notification>`,
            turnId: "turn-wakeup",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow-wakeup");
    const assistantMessages = snapshot.items.filter(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: "assistant-wakeup",
      text: assistantText,
    });
    expect(assistantMessages[0]?.recoveredFromLiveShadow).toBeUndefined();
    expect(
      snapshot.items.some((item) => item.id.startsWith("claude-shadow-recovered-")),
    ).toBe(false);
  });

  it("does not override explicit final assistant body with longer shadow payload", async () => {
    writeClientStoreValue("threads", "liveAssistantShadowTranscripts", {});
    appendLiveAssistantShadowDelta({
      engine: "claude",
      workspaceId: "ws-shadow",
      threadId: "claude:session-shadow-explicit-final",
      turnId: "turn-shadow",
      itemId: "assistant-shadow",
      delta: "provider final 额外",
      timestamp: Date.now(),
    });

    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-shadow",
      workspacePath: "/tmp/ws-shadow",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-long",
            role: "user",
            text: "继续",
            turnId: "turn-shadow",
          },
          {
            kind: "message",
            id: "assistant-final",
            role: "assistant",
            text: "provider final",
            turnId: "turn-shadow",
            isFinal: true,
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-shadow-explicit-final");
    const assistantMessages = snapshot.items.filter(
      (item): item is AssistantMessageItem =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: "assistant-final",
      text: "provider final",
      isFinal: true,
    });
    expect(assistantMessages[0]?.recoveredFromLiveShadow).toBeUndefined();
  });
});

describe("createClaudeHistoryLoader", () => {
  it("keeps issue-shaped real rows while hiding synthetic continuation rows", () => {
    const items = parseClaudeHistoryMessages([
      {
        type: "user",
        isMeta: true,
        message: {
          role: "user",
          content: [
            { type: "text", text: "Continue from where you left off." },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text: "No response requested." }],
        },
      },
      {
        kind: "message",
        id: "user-real-1",
        role: "user",
        text: "修改应用标题为：测试APP",
      },
      {
        kind: "tool",
        id: "tool-edit-1",
        toolType: "Edit",
        title: "Edit",
        text: '{"file_path":"Y:\\\\04_lab\\\\testccgui\\\\main.go"}',
      },
      {
        kind: "message",
        id: "assistant-real-1",
        role: "assistant",
        text: "已完成修改",
      },
    ]);

    expect(items).toHaveLength(3);
    expect(
      items.some(
        (item) =>
          item.kind === "message" && item.text.includes("Continue from"),
      ),
    ).toBe(false);
    expect(
      items.some(
        (item) =>
          item.kind === "message" &&
          item.text.includes("No response requested"),
      ),
    ).toBe(false);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          role: "user",
          text: "修改应用标题为：测试APP",
        }),
        expect.objectContaining({
          kind: "message",
          role: "assistant",
          text: "已完成修改",
        }),
      ]),
    );
  });

  it("loads claude jsonl messages and merges tool result into tool call", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-2",
      workspacePath: "/tmp/ws-2",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-1",
            role: "user",
            text: "run test",
            images: ["/tmp/claude-shot.png"],
          },
          {
            kind: "tool",
            id: "tool-1",
            toolType: "commandExecution",
            title: "Command",
            text: "npm run test",
          },
          {
            kind: "tool",
            id: "tool-1-result",
            toolType: "result",
            title: "Command",
            text: "ok",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-1");
    expect(snapshot.engine).toBe("claude");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "user",
        images: ["/tmp/claude-shot.png"],
      }),
    );
    const tool = snapshot.items[1];
    expect(tool?.kind).toBe("tool");
    if (tool?.kind === "tool") {
      expect(tool.status).toBe("completed");
      expect(tool.output).toBe("ok");
    }
  });

  it("does not rehydrate trailing incomplete askuserquestion into interactive userInputQueue", async () => {
    // Hang/skip without tool_result leaves Ask as last item. History reopen must not
    // invent a zombie card (request_id cannot match a live waiter after reload).
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-claude-ask",
      workspacePath: "/tmp/ws-claude-ask",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "tool",
            id: "tool-ask-pending-1",
            tool_name: "AskUserQuestion",
            tool_input: {
              questions: [
                {
                  id: "project-type",
                  header: "项目类型",
                  question: "请选择项目类型",
                  multiSelect: false,
                  options: [
                    { label: "Web应用", description: "前端应用" },
                    { label: "服务端", description: "后端服务" },
                  ],
                },
              ],
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-ask-pending");
    expect(snapshot.engine).toBe("claude");
    expect(snapshot.userInputQueue).toEqual([]);
    const askItem = snapshot.items.find(
      (item) => item.kind === "tool" && item.id === "tool-ask-pending-1",
    );
    expect(askItem).toMatchObject({
      kind: "tool",
      status: "failed",
    });
  });

  it("does not rehydrate mcp__ccgui__AskUserQuestion into interactive userInputQueue", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-claude-mcp-ask",
      workspacePath: "/tmp/ws-claude-mcp-ask",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "tool",
            id: "toolu-mcp-1",
            tool_name: "mcp__ccgui__AskUserQuestion",
            tool_input: {
              questions: [
                {
                  id: "q-0",
                  header: "可选偏好",
                  question: "是否启用实验功能 X？",
                  multiSelect: false,
                  options: [
                    { label: "启用", description: "打开 X" },
                    { label: "不启用", description: "保持默认" },
                  ],
                },
              ],
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-mcp-ask");
    expect(snapshot.userInputQueue).toEqual([]);
  });

  it("emits fallback warnings when workspace path is unavailable", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-3",
      workspacePath: null,
      loadClaudeSession: vi.fn(),
    });

    const snapshot = await loader.load("claude:session-missing");
    expect(snapshot.items).toEqual([]);
    expect(snapshot.fallbackWarnings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "missing_items",
        "missing_plan",
        "missing_user_input_queue",
      ]),
    );
  });

  it("preserves transcript-heavy claude history when assistant text is sparse", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-claude-transcript",
      workspacePath: "/tmp/ws-claude-transcript",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "reasoning",
            id: "reason-1",
            text: "先理解模块结构",
          },
          {
            kind: "tool",
            id: "tool-1",
            tool_name: "Bash",
            tool_input: {
              command: "ls -la",
            },
          },
          {
            kind: "tool",
            id: "tool-1-result",
            toolType: "result",
            text: "",
            tool_output: {
              output: "README.md\nsrc\n",
            },
          },
          {
            kind: "tool",
            id: "tool-2",
            tool_name: "Bash",
            tool_input: {
              command: "find src -maxdepth 2",
            },
          },
          {
            kind: "tool",
            id: "tool-2-result",
            toolType: "result",
            text: "",
            tool_output: {
              output: "src/index.ts\nsrc/app.tsx\n",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-transcript-heavy");
    expect(snapshot.items.some((item) => item.kind === "reasoning")).toBe(true);
    expect(snapshot.items.filter((item) => item.kind === "tool")).toHaveLength(
      2,
    );
  });
});

describe("createClaudeHistoryLoader token usage restore", () => {
  it("carries last-assistant usage from history payload into the snapshot", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-usage",
      workspacePath: "/tmp/ws-usage",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          { kind: "message", id: "u-1", role: "user", text: "你好" },
          { kind: "message", id: "a-1", role: "assistant", text: "好的" },
        ],
        usage: {
          inputTokens: 15_493,
          outputTokens: 198,
          cacheCreationInputTokens: 33_848,
          cacheReadInputTokens: 15_012,
        },
      }),
    });

    const snapshot = await loader.load("claude:session-usage");
    expect(snapshot.tokenUsage).toMatchObject({
      last: {
        inputTokens: 15_493,
        outputTokens: 198,
        cachedInputTokens: 48_860,
        totalTokens: 15_691,
      },
      modelContextWindow: null,
      contextUsageSource: "claude_history",
      contextUsageFreshness: "estimated",
    });
  });

  it("returns null token usage when history payload has no usage", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-usage",
      workspacePath: "/tmp/ws-usage",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [{ kind: "message", id: "u-1", role: "user", text: "你好" }],
      }),
    });

    const snapshot = await loader.load("claude:session-no-usage");
    expect(snapshot.tokenUsage).toBeNull();
  });
});

describe("createClaudeHistoryLoader disk window", () => {
  it("forwards load_claude_session hasMore/nextCursor onto snapshot meta", async () => {
    const loadClaudeSession = vi.fn().mockResolvedValue({
      messages: [{ kind: "message", id: "u-1", role: "user", text: "你好" }],
      hasMore: true,
      nextCursor: "120",
    });
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-window",
      workspacePath: "/tmp/ws-window",
      loadClaudeSession,
    });

    const snapshot = await loader.load("claude:session-window");
    expect(loadClaudeSession).toHaveBeenCalledWith(
      "/tmp/ws-window",
      "session-window",
      { limit: 80 },
    );
    expect(snapshot.meta.historyHasMore).toBe(true);
    expect(snapshot.meta.historyNextCursor).toBe("120");
  });
});
