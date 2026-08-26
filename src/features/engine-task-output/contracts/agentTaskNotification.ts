export type AgentTaskNotificationTag =
  | "task-notification"
  | "background-task-notification";

export type AgentTaskNotification = {
  taskId: string | null;
  toolUseId: string | null;
  outputFile: string | null;
  status: string | null;
  summary: string | null;
  resultText: string;
  /** 外层标签形态：Claude `<task-notification>` vs pi `<background-task-notification>`。 */
  tag?: AgentTaskNotificationTag;
  /** pi 通知的 `<task-name>`（Claude 通知无此字段）。 */
  taskName?: string | null;
  /** pi 通知的 `<exit-code>`（Claude 通知无此字段）。 */
  exitCode?: string | null;
};

// 长标签在前：`background-task-notification` 包含 `task-notification` 子串，
// 交替顺序保证不错配；闭合 `\s*>` 边界延续 0.3.12 硬化口径（不允许属性）。
const TASK_NOTIFICATION_OPEN_TAG =
  /<\s*(background-task-notification|task-notification)\s*>/i;
const TASK_NOTIFICATION_CLOSE_TAG =
  /<\s*\/\s*(?:background-task-notification|task-notification)\s*>/i;
const RESULT_OPEN_TAG_REGEX = /<\s*result\s*>/i;
const RESULT_CLOSE_SUFFIX_REGEX =
  /\s*<\s*\/\s*result\s*>\s*(?:<\s*\/\s*(?:background-task-notification|task-notification)\s*>\s*)?$/i;
const BACKGROUND_COMMAND_TITLE_REGEX =
  /Background\s+command\s+["“]([^"”]+)["”]/i;
const BACKGROUND_COMMAND_TITLE_ZH_REGEX =
  /后台(?:命令|任务)\s*["“]([^"”]+)["”]/;

function decodeNotificationEntities(text: string): string {
  let decoded = text;
  for (let index = 0; index < 3; index += 1) {
    const next = decoded
      .replace(/&lt;|&#60;|&#x3c;/gi, "<")
      .replace(/&gt;|&#62;|&#x3e;/gi, ">")
      .replace(/&amp;|&#38;|&#x26;/gi, "&");
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return decoded;
}

function extractTagValue(block: string, tagName: string): string | null {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<\\s*${escapedTagName}\\s*>\\s*([\\s\\S]*?)\\s*<\\s*\\/\\s*${escapedTagName}\\s*>`,
    "i",
  ).exec(block);
  const value = match?.[1]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function normalizeResultText(text: string): string {
  return text.replace(RESULT_CLOSE_SUFFIX_REGEX, "").trim();
}

/**
 * SubAgent 完成通知（Claude Agent/Task）形态，与 background shell 等非 SubAgent
 * task-notification 区分：仅此类应退役 legacy Agent session 卡，迁入 S10 表面。
 */
export function isSubagentStyleAgentTaskNotification(
  notification: AgentTaskNotification | null | undefined,
): boolean {
  if (!notification) {
    return false;
  }
  const summary = (notification.summary ?? "").trim();
  if (!summary) {
    return false;
  }
  // Agent "描述" … / Agent “描述” …
  if (/Agent\s+["“][^"”]+["”]/i.test(summary)) {
    return true;
  }
  // 智能体 "描述"
  if (/智能体\s*["“][^"”]+["”]/.test(summary)) {
    return true;
  }
  // Agent … completed|finished（无引号的宽松终态）
  if (
    /^Agent\b/i.test(summary) &&
    /(completed|finished|done|success|succeed|failed|error)/i.test(summary)
  ) {
    return true;
  }
  return false;
}

/**
 * Claude CLI 后台 Bash / shell wakeup 形态。与 SubAgent 完成通知互斥：
 * SubAgent 继续退役；此类默认走幕布折叠条，不得进用户蓝气泡。
 */
export function isBackgroundStyleAgentTaskNotification(
  notification: AgentTaskNotification | null | undefined,
): boolean {
  if (!notification || isSubagentStyleAgentTaskNotification(notification)) {
    return false;
  }
  const summary = (notification.summary ?? "").trim();
  if (!summary) {
    return false;
  }
  if (BACKGROUND_COMMAND_TITLE_REGEX.test(summary)) {
    return true;
  }
  if (BACKGROUND_COMMAND_TITLE_ZH_REGEX.test(summary)) {
    return true;
  }
  if (/Background\s+shell\b/i.test(summary)) {
    return true;
  }
  if (
    /^Background\b/i.test(summary) &&
    /(completed|finished|done|success|succeed|failed|error)/i.test(summary)
  ) {
    return true;
  }
  if (/后台(命令|任务|进程)/.test(summary)) {
    return true;
  }
  return false;
}

export function extractBackgroundCommandTitle(
  summary: string | null | undefined,
): string | null {
  const normalized = (summary ?? "").trim();
  if (!normalized) {
    return null;
  }
  const quoted =
    BACKGROUND_COMMAND_TITLE_REGEX.exec(normalized)?.[1]?.trim()
    ?? BACKGROUND_COMMAND_TITLE_ZH_REGEX.exec(normalized)?.[1]?.trim();
  return quoted && quoted.length > 0 ? quoted : null;
}

function extractEnvelopeHeader(block: string) {
  return {
    taskId: extractTagValue(block, "task-id"),
    toolUseId: extractTagValue(block, "tool-use-id"),
    outputFile: extractTagValue(block, "output-file"),
    status: extractTagValue(block, "status"),
    summary: extractTagValue(block, "summary"),
    taskName: extractTagValue(block, "task-name"),
    exitCode: extractTagValue(block, "exit-code"),
  };
}

function hasIdentifiableNotificationFields(
  header: ReturnType<typeof extractEnvelopeHeader>,
): boolean {
  return Boolean(
    header.taskId
    || header.toolUseId
    || header.outputFile
    || header.status
    || header.summary,
  );
}

export function parseAgentTaskNotification(
  text: string,
): AgentTaskNotification | null {
  const trimmedRawText = text.trimStart();
  const firstChar = trimmedRawText.charAt(0);
  if (!firstChar || (firstChar !== "<" && firstChar !== "&")) {
    return null;
  }
  const trimmedText = firstChar === "<"
    ? trimmedRawText
    : decodeNotificationEntities(trimmedRawText).trimStart();
  const taskNotificationMatch = TASK_NOTIFICATION_OPEN_TAG.exec(trimmedText);
  if (!taskNotificationMatch || typeof taskNotificationMatch.index !== "number") {
    return null;
  }
  if (taskNotificationMatch.index !== 0) {
    return null;
  }
  const tag = (taskNotificationMatch[1] ?? "task-notification").toLowerCase() as AgentTaskNotificationTag;
  const normalizedText = trimmedText.slice(taskNotificationMatch.index);
  const resultOpenMatch = RESULT_OPEN_TAG_REGEX.exec(normalizedText);
  if (resultOpenMatch && typeof resultOpenMatch.index === "number") {
    const headerBlock = normalizedText.slice(0, resultOpenMatch.index);
    const resultText = normalizeResultText(
      normalizedText.slice(resultOpenMatch.index + resultOpenMatch[0].length),
    );
    const header = extractEnvelopeHeader(headerBlock);
    return {
      ...header,
      tag,
      resultText,
    };
  }
  const closeMatch = TASK_NOTIFICATION_CLOSE_TAG.exec(normalizedText);
  const headerBlock = closeMatch && typeof closeMatch.index === "number"
    ? normalizedText.slice(0, closeMatch.index)
    : normalizedText;
  const header = extractEnvelopeHeader(headerBlock);
  if (!hasIdentifiableNotificationFields(header)) {
    return null;
  }
  return {
    ...header,
    tag,
    resultText: "",
  };
}

/** pi 扩展的 `<background-task-notification>` 终态唤醒（与 Claude `<task-notification>` 区分）。 */
export function isPiBackgroundTaskNotification(
  notification: AgentTaskNotification | null | undefined,
): boolean {
  return notification?.tag === "background-task-notification";
}

/** CLI 注入的 task-notification（后台 wakeup / SubAgent 退役）不是真实用户提问。 */
export function isCliInjectedAgentTaskNotificationText(text: string): boolean {
  return parseAgentTaskNotification(text) != null;
}
