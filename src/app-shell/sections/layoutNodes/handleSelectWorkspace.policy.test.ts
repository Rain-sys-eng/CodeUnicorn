import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "useAppShellLayoutNodesSection.tsx",
  ),
  "utf8",
);

function extractHandleSelectWorkspace(): string {
  const start = source.indexOf(
    "const handleSelectWorkspace = useEventCallback",
  );
  const end = source.indexOf("const handleClearActiveThread", start);
  if (start < 0 || end < 0) {
    throw new Error("handleSelectWorkspace was not found");
  }
  return source.slice(start, end);
}

function extractHandleClearActiveThread(): string {
  const start = source.indexOf(
    "const handleClearActiveThread = useEventCallback",
  );
  const end = source.indexOf("const handleConnectWorkspace", start);
  if (start < 0 || end < 0) {
    throw new Error("handleClearActiveThread was not found");
  }
  return source.slice(start, end);
}

describe("handleSelectWorkspace policy", () => {
  it("does not wipe last thread or hydrate the list on the click frame", () => {
    const handler = extractHandleSelectWorkspace();
    expect(handler).toContain("selectWorkspace(workspaceId)");
    expect(handler).toContain("planWorkspaceNavigationThread");
    expect(handler).toContain("peekWorkspaceLastThreadId");
    expect(handler).not.toMatch(/setActiveThreadId\(\s*null/);
    expect(handler).not.toContain("ensureWorkspaceThreadListLoaded");
  });

  it("handleClearActiveThread wipes the selection without restoring the last thread", () => {
    const handler = extractHandleClearActiveThread();
    // 关闭最后一个 topbar 页签的落点：清空选择 + 落到 workspace home，
    // 禁止恢复 last thread（幽灵内容）
    expect(handler).toContain("setActiveThreadId(null, workspaceId)");
    expect(handler).toContain("setWorkspaceHomeWorkspaceId(workspaceId)");
    expect(handler).toContain("setHomeOpen(false)");
    expect(handler).not.toContain("planWorkspaceNavigationThread");
    expect(handler).not.toContain("peekWorkspaceLastThreadId");
    expect(handler).not.toContain("selectWorkspace(");
    // 切会话红线：点击/关闭路径零 catalog IPC
    expect(handler).not.toContain("refreshEngineModels");
    expect(handler).not.toContain("get_engine_models");
  });
});
