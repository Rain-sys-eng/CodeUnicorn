/**
 * 协作 Context Fan-in：skill 正文注入首段 model text。
 *
 * 普通对话依赖引擎 slash skill 解析；协作 prompt 会包一层「规划/实现」指令，
 * `/skill-name` 埋在中间时常失效。因此首段改为读 SKILL.md 正文塞进 prompt。
 */

import { truncateChars } from "@/utils/text";

export const SKILL_CONTEXT_PREFIX = "【技能上下文】";
const MAX_SKILL_BODY_CHARS = 12_000;
const MAX_TOTAL_SKILL_CHARS = 24_000;

export type CollabSkillRef = {
  /** 无 `/` 前缀的归一化名 */
  name: string;
  /** SKILL.md 或 skill 目录绝对路径 */
  path?: string | null;
};

export type SkillContextInjectionResult = {
  finalText: string;
  injectedCount: number;
  injectedChars: number;
  /** 成功注入正文的 skill 名（用于剥离 slash token） */
  injectedNames: string[];
};

const clampChars = truncateChars;

function normalizeSkillName(name: string): string {
  return name.trim().replace(/^\/+/, "").replace(/\s+/g, "-");
}

/** 从 skill path 解析可读的 SKILL.md 文件路径。 */
export function resolveSkillMarkdownPath(path: string | null | undefined): string | null {
  const raw = path?.trim() ?? "";
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, "/");
  if (normalized.toLowerCase().endsWith("skill.md")) {
    return normalized;
  }
  // 目录 → 拼 SKILL.md
  return `${normalized.replace(/\/+$/, "")}/SKILL.md`;
}

/** 去掉 frontmatter 外壳，保留正文（失败则原样返回）。 */
export function stripSkillFrontmatter(markdown: string): string {
  const text = markdown.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return text.trim();
  const end = text.indexOf("\n---", 3);
  if (end < 0) return text.trim();
  return text.slice(end + 4).trim();
}

export function buildSkillBlock(input: {
  name: string;
  body: string;
}): string {
  const name = normalizeSkillName(input.name) || "skill";
  const body = clampChars(stripSkillFrontmatter(input.body), MAX_SKILL_BODY_CHARS);
  return [
    `<skill name="${name.replace(/"/g, "'")}">`,
    body || `（技能 ${name} 正文为空）`,
    `</skill>`,
  ].join("\n");
}

/**
 * 剥离文首由 assembleSinglePrompt 拼上的 `/skill` token，避免与正文注入重复。
 */
export function stripLeadingSkillSlashTokens(
  text: string,
  skillNames: string[],
): string {
  const tokens = new Set(
    skillNames.map(normalizeSkillName).filter(Boolean).map((n) => n.toLowerCase()),
  );
  if (tokens.size === 0) return text;
  const parts = text.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < parts.length) {
    const part = parts[index] ?? "";
    if (!part.startsWith("/")) break;
    const name = normalizeSkillName(part).toLowerCase();
    if (!tokens.has(name)) break;
    index += 1;
  }
  return parts.slice(index).join(" ").trim();
}

/**
 * 将已读到的 skill 正文注入 model text（不负责 IO）。
 */
export function injectSkillBodiesContext(input: {
  userText: string;
  skills: Array<{ name: string; body: string }>;
}): SkillContextInjectionResult {
  if (input.skills.length === 0) {
    return {
      finalText: input.userText,
      injectedCount: 0,
      injectedChars: 0,
      injectedNames: [],
    };
  }

  const blocks: string[] = [];
  const injectedNames: string[] = [];
  let totalChars = 0;
  for (const skill of input.skills) {
    if (totalChars >= MAX_TOTAL_SKILL_CHARS) break;
    const name = normalizeSkillName(skill.name);
    if (!name || !skill.body.trim()) continue;
    const remaining = MAX_TOTAL_SKILL_CHARS - totalChars;
    let block = buildSkillBlock({ name, body: skill.body });
    if (block.length > remaining) {
      block = clampChars(block, remaining);
    }
    if (!block.trim()) continue;
    blocks.push(block);
    injectedNames.push(name);
    totalChars += block.length;
  }

  if (blocks.length === 0) {
    return {
      finalText: input.userText,
      injectedCount: 0,
      injectedChars: 0,
      injectedNames: [],
    };
  }

  const skillBlock = `${SKILL_CONTEXT_PREFIX}\n<skill-context>\n${blocks.join("\n\n")}\n</skill-context>`;
  const userPart = stripLeadingSkillSlashTokens(input.userText, injectedNames);
  const finalText = userPart
    ? `${skillBlock}\n\n${userPart}`
    : skillBlock;

  return {
    finalText,
    injectedCount: blocks.length,
    injectedChars: skillBlock.length,
    injectedNames,
  };
}

/**
 * 协作首段：按 path 读 skill 正文并注入。readFile 失败则跳过该 skill（保留 slash 回退）。
 */
export async function injectCollabSkillContext(input: {
  workspaceId: string;
  userText: string;
  skills: CollabSkillRef[];
  readFile: (
    workspaceId: string,
    path: string,
  ) => Promise<{ content: string; truncated?: boolean } | string | null>;
}): Promise<SkillContextInjectionResult> {
  if (input.skills.length === 0) {
    return {
      finalText: input.userText,
      injectedCount: 0,
      injectedChars: 0,
      injectedNames: [],
    };
  }

  const loaded: Array<{ name: string; body: string }> = [];
  for (const skill of input.skills) {
    const name = normalizeSkillName(skill.name);
    const mdPath = resolveSkillMarkdownPath(skill.path);
    if (!name || !mdPath) continue;
    try {
      const result = await input.readFile(input.workspaceId, mdPath);
      if (result == null) continue;
      const content =
        typeof result === "string" ? result : (result.content ?? "");
      if (!content.trim()) continue;
      loaded.push({ name, body: content });
    } catch {
      // 读失败：保留原文 slash token，由引擎尽力解析
    }
  }

  return injectSkillBodiesContext({
    userText: input.userText,
    skills: loaded,
  });
}
