import type { ConversationItem } from "../../../types";
import {
  buildDshGoalPresentationMetadata,
  isDshGoalInjection,
  isDshInjectedContextMessage,
  readDshMessageSourceKind,
} from "../../../utils/dshRuntimeContext";
import { isBashTool } from "../../../utils/toolSemantics";
import { asRecord, asString } from "./historyLoaderUtils";

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * DSH stores tool arguments as the raw model JSON string. Prefer a pretty
 * object string so Read/Edit path extractors can parse `file_path` without a
 * double-encoded payload.
 */
function stringifyToolInput(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Incomplete / non-JSON fragments stay raw.
    }
    return trimmed;
  }
  return stringifyValue(value);
}

function parseToolInputRecord(value: unknown): Record<string, unknown> | null {
  // historyLoaderUtils.asRecord returns {} for non-objects — do not treat that as a hit.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function firstStringField(
  source: Record<string, unknown> | null,
  keys: string[],
): string {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/**
 * Project DSH history tools into the same canvas shapes the live EngineEvent
 * path emits: bash → commandExecution with structured command detail; others
 * keep bare tool titles so Read/Edit/Search blocks still classify by name.
 */
function projectDshHistoryTool(
  itemId: string,
  rawToolName: string,
  input: unknown,
  output: string,
): Extract<ConversationItem, { kind: "tool" }> {
  const status = output ? "completed" : "in_progress";
  const args = parseToolInputRecord(input);
  const detail = stringifyToolInput(input).trim();

  if (isBashTool(rawToolName)) {
    const command =
      firstStringField(args, [
        "command",
        "cmd",
        "script",
        "shell_command",
        "bash",
      ]) || "";
    const description = firstStringField(args, [
      "description",
      "summary",
      "label",
      "title",
      "task",
    ]);
    const cwd = firstStringField(args, [
      "cwd",
      "workdir",
      "working_directory",
      "workingDirectory",
    ]);
    const titleText = description || command;
    const structuredDetail =
      command || description || cwd
        ? JSON.stringify({
            command: command || undefined,
            description: description || undefined,
            cwd: cwd || undefined,
          })
        : detail;
    return {
      id: itemId,
      kind: "tool",
      toolType: "commandExecution",
      title: titleText ? `Command: ${titleText}` : "Command",
      detail: structuredDetail,
      status,
      output: output || undefined,
    };
  }

  return {
    id: itemId,
    kind: "tool",
    // Bare tool name (read/edit/grep/…) so FE specialized blocks classify by name.
    toolType: rawToolName,
    title: rawToolName,
    detail,
    status,
    output: output || undefined,
  };
}

export function parseDshHistoryMessages(messagesData: unknown): ConversationItem[] {
  if (!Array.isArray(messagesData)) {
    return [];
  }

  const items: ConversationItem[] = [];
  const toolIndexById = new Map<string, number>();

  for (const entry of messagesData) {
    const message = asRecord(entry);
    if (Object.keys(message).length === 0) {
      continue;
    }

    const kind = asString(message.kind ?? "").trim().toLowerCase();
    const itemId =
      asString(message.id ?? "").trim() || `dsh-history-item-${items.length + 1}`;

    if (kind === "message") {
      const role = asString(message.role ?? "").trim().toLowerCase() === "user"
        ? "user"
        : "assistant";
      const text = asString(message.text ?? "");
      if (!text.trim()) {
        continue;
      }
      if (role === "user") {
        const sourceKind = readDshMessageSourceKind(message);
        if (isDshGoalInjection(sourceKind)) {
          items.push({
            id: itemId,
            kind: "message",
            role,
            text,
            presentationMetadata: buildDshGoalPresentationMetadata(text),
          });
          continue;
        }
        if (isDshInjectedContextMessage({ text, sourceKind })) {
          continue;
        }
      }
      items.push({
        id: itemId,
        kind: "message",
        role,
        text,
      });
      continue;
    }

    if (kind === "reasoning") {
      const text = asString(message.text ?? "").trim();
      if (!text) {
        continue;
      }
      const previous = items[items.length - 1];
      if (previous?.kind === "reasoning") {
        items[items.length - 1] = {
          ...previous,
          content: `${previous.content}\n\n${text}`,
        };
        continue;
      }
      items.push({
        id: itemId,
        kind: "reasoning",
        content: text,
        summary: text.split(/\r?\n/, 1)[0]?.slice(0, 100) ?? text,
      });
      continue;
    }

    if (kind !== "tool") {
      continue;
    }

    const rawToolName =
      asString(message.title ?? message.toolType ?? message.tool_type ?? "").trim() ||
      "Tool";
    const output = stringifyValue(
      message.toolOutput ?? message.tool_output ?? message.text ?? "",
    ).trim();
    const input = message.toolInput ?? message.tool_input ?? null;
    const projected = projectDshHistoryTool(itemId, rawToolName, input, output);
    const existingIndex = toolIndexById.get(itemId);
    if (typeof existingIndex === "number") {
      const existing = items[existingIndex];
      if (existing?.kind === "tool") {
        // Result-only rows often omit toolInput. Prefer the richer earlier title/
        // detail so "Command: <desc>" and structured command detail are not wiped.
        // Result-only follow-ups often omit toolInput; never replace a richer
        // Command title/detail with the bare "Command" fallback.
        const existingIsRicherCommandTitle =
          existing.title.startsWith("Command:") &&
          (projected.title === "Command" || !projected.title);
        const existingHasCommandDetail =
          existing.detail.includes('"command"') ||
          existing.detail.includes('"description"');
        const projectedHasCommandDetail =
          projected.detail.includes('"command"') ||
          projected.detail.includes('"description"');
        items[existingIndex] = {
          ...existing,
          detail:
            existingHasCommandDetail && !projectedHasCommandDetail
              ? existing.detail
              : projected.detail || existing.detail,
          title: existingIsRicherCommandTitle
            ? existing.title
            : projected.title || existing.title,
          toolType: projected.toolType || existing.toolType,
          output: output || existing.output,
          status: output ? "completed" : existing.status,
        };
      }
      continue;
    }
    toolIndexById.set(itemId, items.length);
    items.push(projected);
  }

  markDshAssistantFinalMessages(items);
  return items;
}

/**
 * DSH history assistant rows have no isFinal flag. Turn file-change aggregation
 * drops a segment on the next user message unless a final assistant is present,
 * so mark the last assistant of each turn — same contract as Grok/Kimi history.
 */
function markDshAssistantFinalMessages(items: ConversationItem[]) {
  let lastAssistantIndexInTurn = -1;
  const finalizeCurrentTurn = () => {
    if (lastAssistantIndexInTurn < 0) {
      return;
    }
    const lastAssistant = items[lastAssistantIndexInTurn];
    if (!lastAssistant || lastAssistant.kind !== "message" || lastAssistant.role !== "assistant") {
      return;
    }
    if (lastAssistant.isFinal === true) {
      return;
    }
    items[lastAssistantIndexInTurn] = {
      ...lastAssistant,
      isFinal: true,
    };
  };

  items.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      finalizeCurrentTurn();
      lastAssistantIndexInTurn = -1;
      return;
    }
    if (item.kind === "message" && item.role === "assistant") {
      lastAssistantIndexInTurn = index;
    }
  });
  finalizeCurrentTurn();
}
