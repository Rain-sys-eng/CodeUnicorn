/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyBackgroundTaskUpdate,
  hydrateBackgroundTasksFromHistory,
  listBackgroundTasks,
  resetBackgroundTaskStoreForTests,
} from "./backgroundTaskStore";
import { collectPiHistoryBackgroundTasks } from "../../threads/loaders/piHistoryParser";

const WS = "ws-1";
const THREAD = "pi:s1";

const HISTORY_ROWS = [
  { id: "m1", kind: "message", role: "user", text: "go" },
  {
    id: "tool_bg1",
    kind: "backgroundTask",
    role: "assistant",
    toolType: "bg_run",
    toolInput: { name: "spike", command: "sleep 3" },
  },
  {
    id: "tool_bg1-result",
    kind: "backgroundTask",
    role: "tool",
    toolOutput: {
      id: "t-1",
      name: "spike",
      status: "running",
      outputPath: ".pi/tasks/session-1-1/t-1.output",
      pid: 100,
    },
  },
  {
    id: "m5",
    kind: "backgroundTaskNotification",
    toolOutput: { id: "t-1", status: "completed", exitCode: 0 },
  },
];

describe("hydrateBackgroundTasksFromHistory", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("seeds the store from parsed history so the pill reappears on reopen", () => {
    hydrateBackgroundTasksFromHistory(
      WS,
      THREAD,
      collectPiHistoryBackgroundTasks(HISTORY_ROWS),
    );
    const tasks = listBackgroundTasks(WS, THREAD);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.taskId).toBe("t-1");
    expect(tasks[0]?.task.status).toBe("completed");
    expect(tasks[0]?.toolName).toBe("bg_run");
  });

  it("is idempotent and never overwrites live records (只补缺)", () => {
    // live 侧已有 registry 写入的最新终态。
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool_bg1",
      task: { id: "t-1", status: "failed", exitCode: 137 },
      source: "registry",
    });
    hydrateBackgroundTasksFromHistory(
      WS,
      THREAD,
      collectPiHistoryBackgroundTasks(HISTORY_ROWS),
    );
    hydrateBackgroundTasksFromHistory(
      WS,
      THREAD,
      collectPiHistoryBackgroundTasks(HISTORY_ROWS),
    );
    const tasks = listBackgroundTasks(WS, THREAD);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task.status).toBe("failed"); // live 终态不被 history 覆盖
  });

  it("no-ops for empty merged lists", () => {
    hydrateBackgroundTasksFromHistory(WS, THREAD, []);
    expect(listBackgroundTasks(WS, THREAD)).toHaveLength(0);
  });
});
