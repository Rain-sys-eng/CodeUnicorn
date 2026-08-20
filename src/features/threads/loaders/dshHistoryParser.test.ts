import { describe, expect, it } from "vitest";
import { buildTurnFileChangesByBoundaryId } from "../../messages/utils/turnFileChanges";
import { parseDshHistoryMessages } from "./dshHistoryParser";

describe("parseDshHistoryMessages", () => {
  it("returns empty items for non-array payloads", () => {
    expect(parseDshHistoryMessages(null)).toEqual([]);
    expect(parseDshHistoryMessages({ messages: [] })).toEqual([]);
  });

  it("maps user and assistant messages to conversation items", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-user-1",
        kind: "message",
        role: "user",
        text: "hello",
      },
      {
        id: "dsh-assistant-1",
        kind: "message",
        role: "assistant",
        text: "hi",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "dsh-user-1",
        kind: "message",
        role: "user",
        text: "hello",
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        id: "dsh-assistant-1",
        kind: "message",
        role: "assistant",
        text: "hi",
        isFinal: true,
      }),
    );
  });

  it("maps reasoning rows and merges adjacent reasoning text", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-user-1",
        kind: "message",
        role: "user",
        text: "question",
      },
      {
        id: "dsh-reasoning-1",
        kind: "reasoning",
        text: "first thought",
      },
      {
        id: "dsh-reasoning-2",
        kind: "reasoning",
        text: "second thought",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[1]).toEqual(
      expect.objectContaining({
        kind: "reasoning",
        content: "first thought\n\nsecond thought",
      }),
    );
  });

  it("marks tools without output as in progress", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-tool-open",
        kind: "tool",
        title: "Read",
        toolInput: { path: "a.ts" },
      },
    ]);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: "tool",
        status: "in_progress",
      }),
    );
  });

  it("preserves DSH read file_path in tool detail for display", () => {
    const items = parseDshHistoryMessages([
      {
        id: "call-read-1",
        kind: "tool",
        title: "read",
        toolInput: {
          file_path: "src-tauri/src/engine/dsh/history.rs",
        },
        toolOutput: "1\tuse super::host;",
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: "tool",
        title: "read",
        status: "completed",
      }),
    );
    if (items[0]?.kind === "tool") {
      const parsed = JSON.parse(items[0].detail) as Record<string, string>;
      expect(parsed.file_path).toBe("src-tauri/src/engine/dsh/history.rs");
    }
  });

  it("accepts raw JSON string toolInput from DSH wire format", () => {
    const items = parseDshHistoryMessages([
      {
        id: "call-read-2",
        kind: "tool",
        title: "read",
        toolInput: '{"file_path":"docs/research/mossx-dsh-capability-spike.md"}',
      },
    ]);
    expect(items).toHaveLength(1);
    if (items[0]?.kind === "tool") {
      // History loader may leave the string as-is; UI parseToolArgs must still work.
      const detail = items[0].detail;
      expect(detail).toContain("file_path");
      expect(detail).toContain("mossx-dsh-capability-spike.md");
    }
  });

  it("attaches later tool output to the matching tool call", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-tool-1",
        kind: "tool",
        title: "Grep",
        toolInput: { pattern: "foo" },
      },
      {
        id: "dsh-tool-1",
        kind: "tool",
        title: "Grep",
        toolOutput: "3 matches",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: "tool",
        title: "Grep",
        status: "completed",
        output: "3 matches",
      }),
    );
  });

  it("projects bash history tools as commandExecution terminal cards", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-bash-1",
        kind: "tool",
        title: "bash",
        toolInput: JSON.stringify({
          command: "pwd",
          description: "Print working directory",
        }),
      },
      {
        id: "dsh-bash-1",
        kind: "tool",
        title: "bash",
        toolOutput: "/repo\n",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: Print working directory",
        status: "completed",
        output: "/repo",
      }),
    );
    if (items[0]?.kind === "tool") {
      const parsed = JSON.parse(items[0].detail) as Record<string, string>;
      expect(parsed.command).toBe("pwd");
      expect(parsed.description).toBe("Print working directory");
    }
  });

  it("skips blank messages and unknown kinds", () => {
    const items = parseDshHistoryMessages([
      { id: "blank", kind: "message", role: "assistant", text: "   " },
      { id: "unknown", kind: "usage", text: "ignored" },
    ]);
    expect(items).toEqual([]);
  });

  it("skips DSH injected instruction, snapshot, and skill catalog messages", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-user-1",
        kind: "message",
        role: "user",
        text: "你好",
        source: { kind: "user" },
      },
      {
        id: "dsh-instructions",
        kind: "message",
        role: "user",
        text: "<system-reminder>\nInstructions from: AGENTS.md\n</system-reminder>",
        source: { kind: "agent-instructions", form: "instructions" },
      },
      {
        id: "dsh-snapshot",
        kind: "message",
        role: "user",
        text: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: workspace-write.",
        source: { kind: "plugin", plugin: "dsh-system-prompt", form: "snapshot" },
      },
      {
        id: "dsh-skills",
        kind: "message",
        role: "user",
        text: "<system-reminder>\n<available_skills>\n- deploy-to-vercel\n</available_skills>\n</system-reminder>",
        source: { kind: "plugin", plugin: "dsh-tool-skill", form: "catalog" },
      },
      {
        id: "dsh-assistant-1",
        kind: "message",
        role: "assistant",
        text: "你好，需要我做什么？",
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(["dsh-user-1", "dsh-assistant-1"]);
  });

  it("skips sourceless runtime-context text and camelCase sourceKind from fold", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-user-1",
        kind: "message",
        role: "user",
        text: "你好",
        sourceKind: "user",
      },
      {
        id: "dsh-snapshot",
        kind: "message",
        role: "user",
        text: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.",
      },
      {
        id: "dsh-plugin",
        kind: "message",
        role: "user",
        text: "skill catalog leftover",
        sourceKind: "plugin",
      },
    ]);
    expect(items.map((item) => item.id)).toEqual(["dsh-user-1"]);
  });

  it("keeps Goal injections as empty-bubble presentation cards", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-user-1",
        kind: "message",
        role: "user",
        text: "写一个待办",
        sourceKind: "user",
      },
      {
        id: "dsh-goal-1",
        kind: "message",
        role: "user",
        text: "<goal_round>\nContinue the active goal.\n</goal_round>",
        sourceKind: "goal",
      },
      {
        id: "dsh-plugin",
        kind: "message",
        role: "user",
        text: "skill catalog leftover",
        sourceKind: "plugin",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "dsh-user-1",
        role: "user",
        text: "写一个待办",
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        id: "dsh-goal-1",
        kind: "message",
        role: "user",
        text: "<goal_round>\nContinue the active goal.\n</goal_round>",
        presentationMetadata: {
          displayText: "",
          stickyCandidateText: "",
          contexts: [
            {
              kind: "dsh-goal",
              title: "Context injection",
              sourceLabel: "goal",
              body: "<goal_round>\nContinue the active goal.\n</goal_round>",
            },
          ],
        },
      }),
    );
  });

  it("keeps a real user prompt that mentions system-reminder", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-user-ask",
        kind: "message",
        role: "user",
        text: "what is a <system-reminder>?",
        source: { kind: "user" },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "dsh-user-ask",
        role: "user",
      }),
    );
  });

  it("marks the last assistant of each turn as final so file edits survive the next user", () => {
    const items = parseDshHistoryMessages([
      {
        id: "dsh-user-1",
        kind: "message",
        role: "user",
        text: "create kiwi crud",
      },
      {
        id: "dsh-write-1",
        kind: "tool",
        title: "write",
        toolInput: {
          file_path: "src/KiwiController.java",
          content: "class KiwiController {}\n",
        },
        toolOutput: "Created file",
      },
      {
        id: "dsh-assistant-1",
        kind: "message",
        role: "assistant",
        text: "created controller",
      },
      {
        id: "dsh-user-2",
        kind: "message",
        role: "user",
        text: "also add a service",
      },
      {
        id: "dsh-write-2",
        kind: "tool",
        title: "write",
        toolInput: {
          file_path: "src/KiwiService.java",
          content: "class KiwiService {}\n",
        },
        toolOutput: "Created file",
      },
      {
        id: "dsh-assistant-2",
        kind: "message",
        role: "assistant",
        text: "created service",
      },
    ]);

    const assistant1 = items.find((item) => item.id === "dsh-assistant-1");
    const assistant2 = items.find((item) => item.id === "dsh-assistant-2");
    expect(assistant1).toEqual(expect.objectContaining({ isFinal: true }));
    expect(assistant2).toEqual(expect.objectContaining({ isFinal: true }));

    const summaries = buildTurnFileChangesByBoundaryId(items);
    expect(summaries.get("dsh-assistant-1")?.files.map((file) => file.path)).toEqual([
      "src/KiwiController.java",
    ]);
    expect(summaries.get("dsh-assistant-2")?.files.map((file) => file.path)).toEqual([
      "src/KiwiService.java",
    ]);
  });
});
