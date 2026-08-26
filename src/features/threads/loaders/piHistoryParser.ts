import type { ConversationItem } from "../../../types";
import {
  buildConversationItem,
  buildConversationItemFromThreadItem,
} from "../../../utils/threadItems";
import { asRecord, asString } from "./historyLoaderUtils";

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

/**
 * 1.5 PI 后台任务历史回放：pi_history.rs 把 bg 工具的 call / result 与终态
 * 通知投影为三类条目——
 * - `backgroundTask` call（toolType + toolInput，receipt 前唯一信息源）
 * - `backgroundTask` result（toolOutput = receipt snapshot 对象，id = `<callId>-result`）
 * - `backgroundTaskNotification`（toolOutput = 终态 task 对象）
 * 三者按 taskId 合并为**单张折叠卡**（D1：通知不成行、不算用户提问），
 * 卡片锚定在 call 位置；call/result 不在窗口时在到达位置补发。
 */
type MergedBackgroundTask = {
  taskId: string;
  itemId: string;
  toolName: string | null;
  input: unknown;
  task: Record<string, unknown>;
};

/**
 * 历史重载后供 backgroundTaskStore hydrate 的合并任务列表（pill 数据源）。
 * 复用 parsePiHistoryMessages 同一合并逻辑，保证与时间线卡一致。
 */
export function collectPiHistoryBackgroundTasks(
  raw: unknown,
): MergedBackgroundTask[] {
  const rows = Array.isArray(raw) ? raw : [];
  const { mergedByTaskId } = collectBackgroundTasks(rows);
  return [...mergedByTaskId.values()];
}

function readBackgroundTaskSnapshot(
  message: Record<string, unknown>,
): Record<string, unknown> | null {
  const output = message.toolOutput;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const task = output as Record<string, unknown>;
  return asString(task.id) ? task : null;
}

function collectBackgroundTasks(rows: unknown[]): {
  taskIdByCallId: Map<string, string>;
  mergedByTaskId: Map<string, MergedBackgroundTask>;
} {
  const callsById = new Map<string, { toolName: string; input: unknown }>();
  const taskIdByCallId = new Map<string, string>();
  const mergedByTaskId = new Map<string, MergedBackgroundTask>();
  for (const entry of rows) {
    const message = asRecord(entry);
    if (!message) continue;
    const kind = (asString(message.kind) || "").toLowerCase();
    const id = asString(message.id) || "";
    if (kind === "backgroundtask") {
      const snapshot = readBackgroundTaskSnapshot(message);
      if (snapshot) {
        // result 条目：receipt 快照落表并回链 call（id = `<callId>-result`）。
        const taskId = asString(snapshot.id) || "";
        const callId = id.endsWith("-result")
          ? id.slice(0, -"-result".length)
          : id;
        const call = callsById.get(callId);
        const previous = mergedByTaskId.get(taskId);
        mergedByTaskId.set(taskId, {
          taskId,
          itemId: callId,
          toolName: call?.toolName ?? asString(message.toolType) ?? null,
          input: call?.input ?? null,
          task: { ...(previous?.task ?? {}), ...snapshot },
        });
        if (callId) {
          taskIdByCallId.set(callId, taskId);
        }
      } else if (id) {
        // call 条目：工具名 + 参数（receipt 到达前的唯一信息源）。
        callsById.set(id, {
          toolName: asString(message.toolType) || "background task",
          input: message.toolInput ?? null,
        });
      }
    } else if (kind === "backgroundtasknotification") {
      // 终态通知：合并进同 taskId 卡片（status/exitCode/endTime 覆盖 receipt）；
      // 通知本身永不成行（D1：不渲染 bubble、不作 turn 边界用户提问）。
      const task = readBackgroundTaskSnapshot(message);
      const taskId = task ? asString(task.id) || "" : "";
      if (taskId) {
        const previous = mergedByTaskId.get(taskId);
        mergedByTaskId.set(taskId, {
          taskId,
          itemId: previous?.itemId ?? `backgroundTask-${taskId}`,
          toolName: previous?.toolName ?? null,
          input: previous?.input ?? null,
          task: { ...(previous?.task ?? {}), ...task },
        });
      }
    }
  }
  return { taskIdByCallId, mergedByTaskId };
}

export function parsePiHistoryMessages(raw: unknown): ConversationItem[] {
  const rows = Array.isArray(raw) ? raw : [];
  const items: ConversationItem[] = [];
  const { taskIdByCallId, mergedByTaskId } = collectBackgroundTasks(rows);
  const emittedBackgroundTaskIds = new Set<string>();
  const emitBackgroundTaskCard = (merged: MergedBackgroundTask): void => {
    if (emittedBackgroundTaskIds.has(merged.taskId)) {
      return;
    }
    emittedBackgroundTaskIds.add(merged.taskId);
    const converted = buildConversationItem({
      id: merged.itemId,
      type: "backgroundTask",
      tool: merged.toolName ?? undefined,
      title: merged.toolName ?? undefined,
      input: merged.input ?? undefined,
      task: merged.task,
      status: asString(merged.task.status) || undefined,
    });
    if (converted) items.push(converted);
  };
  for (const entry of rows) {
    const message = asRecord(entry);
    if (!message) continue;
    const id = asString(message.id) || `pi-${items.length + 1}`;
    const role = (asString(message.role) || "assistant").toLowerCase();
    const kind = (asString(message.kind) || "message").toLowerCase();
    const text = asString(message.text) || "";
    const timestampMs = parseHistoryTimestampMs(message.timestamp);
    if (kind === "backgroundtask") {
      const snapshot = readBackgroundTaskSnapshot(message);
      if (snapshot) {
        // result 条目：call 位置已发卡则跳过；call 不在窗口则在此补发。
        const taskId = asString(snapshot.id) || "";
        const merged = taskId ? mergedByTaskId.get(taskId) : undefined;
        if (merged) {
          emitBackgroundTaskCard(merged);
        }
      } else {
        // call 条目：在调用位置发合并后的折叠卡（receipt / 通知已预扫描）。
        // 孤儿 call（无 receipt 无通知，会话在启动瞬间崩溃）不回放——
        // 历史里的「运行中」死卡会永远转圈，宁可降级不渲染。
        const taskId = taskIdByCallId.get(id) ?? "";
        const merged = taskId ? mergedByTaskId.get(taskId) : undefined;
        if (merged) {
          emitBackgroundTaskCard(merged);
        }
      }
      continue;
    }
    if (kind === "backgroundtasknotification") {
      // 通知不成行；call/result 都不在窗口时在通知位置补发终态折叠卡。
      const task = readBackgroundTaskSnapshot(message);
      const taskId = task ? asString(task.id) || "" : "";
      const merged = taskId ? mergedByTaskId.get(taskId) : undefined;
      if (merged) {
        emitBackgroundTaskCard(merged);
      }
      continue;
    }
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
      const toolName =
        asString(message.toolType) || asString(message.title) || "tool";
      const converted = buildConversationItemFromThreadItem({
        id,
        type: "commandExecution",
        title: toolName,
        command: toolName,
        status: "completed",
        timestampMs,
        input: message.toolInput ?? undefined,
        output: message.toolOutput ?? text,
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
        ? (message.images as unknown[]).filter(
            (v): v is string => typeof v === "string",
          )
        : undefined,
    });
    if (converted) items.push(converted);
  }
  return items;
}
