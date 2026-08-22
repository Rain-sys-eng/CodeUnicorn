import type { ConversationItem } from "../../../types";
import { buildConversationItemFromThreadItem } from "../../../utils/threadItems";
import { asRecord, asString } from "./historyLoaderUtils";

const COMMAND_TOOL_RE = /bash|shell|exec|terminal|command|stdin/;
const FILE_CHANGE_TOOL_RE = /write|edit|apply|patch|delete_file|remove_file/;

function stringifyHistoryToolOutput(output: unknown, fallbackText: string): string {
  if (typeof output === "string") {
    return output;
  }
  if (output && typeof output === "object") {
    try {
      return JSON.stringify(output);
    } catch {
      return fallbackText;
    }
  }
  return fallbackText;
}

function parseHistoryTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseQoderHistoryMessages(raw: unknown): ConversationItem[] {
  const rows = Array.isArray(raw) ? raw : [];
  const items: ConversationItem[] = [];
  for (const entry of rows) {
    const message = asRecord(entry);
    if (!message) continue;
    const id = asString(message.id) || `qoder-${items.length + 1}`;
    const role = (asString(message.role) || "assistant").toLowerCase();
    const kind = (asString(message.kind) || "message").toLowerCase();
    const text = asString(message.text) || "";
    const timestampMs = parseHistoryTimestampMs(message.timestamp);
    if (kind === "reasoning" || kind === "thinking") {
      const converted = buildConversationItemFromThreadItem({
        id,
        type: "reasoning",
        text,
        status: "completed",
        timestampMs,
      });
      if (converted) items.push(converted);
      continue;
    }
    if (kind === "tool") {
      const toolName = asString(message.toolType) || asString(message.title) || "tool";
      const normalizedName = toolName.toLowerCase();
      const itemType = COMMAND_TOOL_RE.test(normalizedName)
        ? "commandExecution"
        : FILE_CHANGE_TOOL_RE.test(normalizedName)
          ? "fileChange"
          : "mcpToolCall";
      const outputText = stringifyHistoryToolOutput(message.toolOutput, text);
      const converted = buildConversationItemFromThreadItem({
        id,
        type: itemType,
        title: toolName,
        tool: toolName,
        command: itemType === "commandExecution" ? toolName : undefined,
        server: itemType === "mcpToolCall" ? "agent" : undefined,
        status: "completed",
        timestampMs,
        input: message.toolInput ?? undefined,
        arguments: message.toolInput ?? undefined,
        output: outputText,
        result: outputText,
      });
      if (converted) items.push(converted);
      continue;
    }
    const converted = buildConversationItemFromThreadItem({
      id,
      type: role === "user" ? "userMessage" : "agentMessage",
      text,
      status: "completed",
      timestampMs,
      images: Array.isArray(message.images)
        ? (message.images as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined,
    });
    if (converted) items.push(converted);
  }
  return items;
}
