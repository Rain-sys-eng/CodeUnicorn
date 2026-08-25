import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-policy guard for OpenSpec change fix-sidebar-reload-force-index-sync.
 *
 * 用户显式「重新加载」会话列表必须携带 forceSessionIndexSync: true——
 * first-paint 默认温读只翻 SQLite 快照，新会话进索引靠后端 importer 90s
 * 轮询，窗口内（或被 omit/导入失败时）点多少次重载都刷不出来
 * （0.9.3 测试版用户反馈「最近一条历史数据点重新加载也无法加载出来」）。
 */

const source = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "useAppShellLayoutNodesSection.tsx",
  ),
  "utf8",
);

function extractHandler(name: string, endMarker: string): string {
  const start = source.indexOf(`const ${name} = useEventCallback`);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`${name} was not found`);
  }
  return source.slice(start, end);
}

describe("reload workspace threads force index sync policy", () => {
  it("declares a shared user-reload options constant forcing session index sync", () => {
    expect(source).toContain("const USER_RELOAD_THREAD_LIST_OPTIONS = {");
    expect(source).toContain("forceSessionIndexSync: true,");
  });

  it("quick reload passes the force-sync options to the tracked loader", () => {
    const handler = extractHandler(
      "handleQuickReloadWorkspaceThreads",
      "const handleReloadWorkspaceThreads",
    );
    expect(handler).toContain("listThreadsForWorkspaceTracked(");
    expect(handler).toContain("USER_RELOAD_THREAD_LIST_OPTIONS");
  });

  it("confirmed reload passes the force-sync options to the tracked loader", () => {
    const handler = extractHandler(
      "handleReloadWorkspaceThreads",
      "const handleToggleLiveEditPreview",
    );
    expect(handler).toContain("listThreadsForWorkspaceTracked(");
    expect(handler).toContain("USER_RELOAD_THREAD_LIST_OPTIONS");
  });
});
