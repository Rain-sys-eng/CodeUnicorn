import { describe, expect, it } from "vitest";
import {
  extractBackgroundCommandTitle,
  isBackgroundStyleAgentTaskNotification,
  isCliInjectedAgentTaskNotificationText,
  isPiBackgroundTaskNotification,
  isSubagentStyleAgentTaskNotification,
  parseAgentTaskNotification,
} from "./agentTaskNotification";

describe("isSubagentStyleAgentTaskNotification", () => {
  it("recognizes Agent quoted summary", () => {
    expect(
      isSubagentStyleAgentTaskNotification({
        taskId: "t1",
        toolUseId: "call-1",
        outputFile: null,
        status: "completed",
        summary: 'Agent "项目结构与架构扫描" finished',
        resultText: "ok",
      }),
    ).toBe(true);
  });

  it("rejects non-subagent summaries", () => {
    expect(
      isSubagentStyleAgentTaskNotification({
        taskId: "bg-1",
        toolUseId: null,
        outputFile: "/tmp/bg.output",
        status: "completed",
        summary: "Background shell task bg-1 completed",
        resultText: "done",
      }),
    ).toBe(false);
  });
});

describe("isBackgroundStyleAgentTaskNotification", () => {
  it("recognizes Background command quoted summary", () => {
    expect(
      isBackgroundStyleAgentTaskNotification({
        taskId: "b234djc13",
        toolUseId: "call_00_URJyFRY1ub2SYctPuO899944",
        outputFile: "C:\\\\Users\\\\demo\\\\AppData\\\\Local\\\\Temp\\\\claude\\\\b234djc13.output",
        status: "completed",
        summary: 'Background command "Rebuild Windows bundles with latest code" completed',
        resultText: "",
      }),
    ).toBe(true);
  });

  it("recognizes Background shell summaries", () => {
    expect(
      isBackgroundStyleAgentTaskNotification({
        taskId: "bg-1",
        toolUseId: null,
        outputFile: "/tmp/bg.output",
        status: "completed",
        summary: "Background shell task bg-1 completed",
        resultText: "done",
      }),
    ).toBe(true);
  });

  it("does not steal SubAgent summaries", () => {
    expect(
      isBackgroundStyleAgentTaskNotification({
        taskId: "t1",
        toolUseId: "call-1",
        outputFile: null,
        status: "completed",
        summary: 'Agent "项目结构与架构扫描" finished',
        resultText: "ok",
      }),
    ).toBe(false);
  });

  it("rejects generic non-background summaries", () => {
    expect(
      isBackgroundStyleAgentTaskNotification({
        taskId: "job-1",
        toolUseId: null,
        outputFile: null,
        status: "completed",
        summary: "Custom runner finished",
        resultText: "ok",
      }),
    ).toBe(false);
  });
});

describe("extractBackgroundCommandTitle", () => {
  it("extracts the quoted Background command name", () => {
    expect(
      extractBackgroundCommandTitle(
        'Background command "Rebuild Windows bundles with latest code" completed',
      ),
    ).toBe("Rebuild Windows bundles with latest code");
  });

  it("returns null when the summary has no quoted command", () => {
    expect(
      extractBackgroundCommandTitle("Background shell task bg-1 completed"),
    ).toBeNull();
  });
});

describe("parseAgentTaskNotification", () => {
  it("extracts structured metadata and result text from task notification envelopes", () => {
    const parsed = parseAgentTaskNotification(`
<task-notification>
<task-id>task-42</task-id>
<tool-use-id>call-9</tool-use-id>
<output-file>/private/tmp/tasks/task-42.output</output-file>
<status>completed</status>
<summary>Agent "架构治理评估" completed</summary>
<result>第一段结果

第二段结果</result>
</task-notification>
    `);

    expect(parsed).toEqual({
      taskId: "task-42",
      toolUseId: "call-9",
      outputFile: "/private/tmp/tasks/task-42.output",
      status: "completed",
      summary: 'Agent "架构治理评估" completed',
      resultText: "第一段结果\n\n第二段结果",
      tag: "task-notification",
      taskName: null,
      exitCode: null,
    });
  });

  it("returns null for ordinary assistant text", () => {
    expect(parseAgentTaskNotification("普通 assistant 回复")).toBeNull();
  });

  it("returns null for long ordinary prose without decoding the whole body as XML", () => {
    const longOrdinaryText = `${"这是正常的长文输出。".repeat(2_000)}\n最后只是普通总结。`;

    expect(parseAgentTaskNotification(longOrdinaryText)).toBeNull();
  });

  it("parses entity-escaped task notification payloads", () => {
    const parsed = parseAgentTaskNotification(`
&lt;task-notification&gt;
  &lt;task-id&gt;task-99&lt;/task-id&gt;
  &lt;status&gt;completed&lt;/status&gt;
  &lt;summary&gt;Agent "Bug诊断与性能安全审查" completed&lt;/summary&gt;
  &lt;result&gt;读取关键文件后，继续进行全面审查。`);

    expect(parsed).toEqual({
      taskId: "task-99",
      toolUseId: null,
      outputFile: null,
      status: "completed",
      summary: 'Agent "Bug诊断与性能安全审查" completed',
      resultText: "读取关键文件后，继续进行全面审查。",
      tag: "task-notification",
      taskName: null,
      exitCode: null,
    });
  });

  it("keeps matching envelopes with empty results so the agent card can still render", () => {
    const parsed = parseAgentTaskNotification(`
<task-notification>
<task-id>task-empty</task-id>
<status>completed</status>
<summary>Agent "空结果任务" completed</summary>
<result></result>
</task-notification>
    `);

    expect(parsed).toEqual({
      taskId: "task-empty",
      toolUseId: null,
      outputFile: null,
      status: "completed",
      summary: 'Agent "空结果任务" completed',
      resultText: "",
      tag: "task-notification",
      taskName: null,
      exitCode: null,
    });
  });

  it("does not misclassify ordinary prose that merely mentions task-notification markup", () => {
    expect(
      parseAgentTaskNotification(
        '这里演示 XML：<task-notification><result>not a real agent payload</result></task-notification>',
      ),
    ).toBeNull();
  });

  it("parses double-escaped task notifications", () => {
    const parsed = parseAgentTaskNotification(`
&amp;lt;task-notification&amp;gt;
&amp;lt;task-id&amp;gt;task-double&amp;lt;/task-id&amp;gt;
&amp;lt;result&amp;gt;双重转义结果&amp;lt;/result&amp;gt;
    `);

    expect(parsed).toEqual({
      taskId: "task-double",
      toolUseId: null,
      outputFile: null,
      status: null,
      summary: null,
      resultText: "双重转义结果",
      tag: "task-notification",
      taskName: null,
      exitCode: null,
    });
  });

  it("parses background wakeup envelopes that omit result", () => {
    const parsed = parseAgentTaskNotification(`<task-notification>
<task-id>b234djc13</task-id>
<tool-use-id>call_00_URJyFRY1ub2SYctPuO899944</tool-use-id>
<output-file>C:\\\\Users\\\\demo\\\\AppData\\\\Local\\\\Temp\\\\claude\\\\b234djc13.output</output-file>
<status>completed</status>
<summary>Background command "Rebuild Windows bundles with latest code" completed</summary>
</task-notification>`);

    expect(parsed).toEqual({
      taskId: "b234djc13",
      toolUseId: "call_00_URJyFRY1ub2SYctPuO899944",
      outputFile: "C:\\\\Users\\\\demo\\\\AppData\\\\Local\\\\Temp\\\\claude\\\\b234djc13.output",
      status: "completed",
      summary: 'Background command "Rebuild Windows bundles with latest code" completed',
      resultText: "",
      tag: "task-notification",
      taskName: null,
      exitCode: null,
    });
  });

  it("parses entity-escaped envelopes that omit result", () => {
    const parsed = parseAgentTaskNotification(`
&lt;task-notification&gt;
  &lt;task-id&gt;task-no-result&lt;/task-id&gt;
  &lt;status&gt;completed&lt;/status&gt;
  &lt;summary&gt;Background command "bundle" completed&lt;/summary&gt;
&lt;/task-notification&gt;`);

    expect(parsed).toEqual({
      taskId: "task-no-result",
      toolUseId: null,
      outputFile: null,
      status: "completed",
      summary: 'Background command "bundle" completed',
      resultText: "",
      tag: "task-notification",
      taskName: null,
      exitCode: null,
    });
  });

  it("returns null for an empty task-notification envelope", () => {
    expect(parseAgentTaskNotification("<task-notification></task-notification>")).toBeNull();
  });
});

describe("pi <background-task-notification>", () => {
  const PI_NOTIFICATION = `<background-task-notification>
  <task-id>b2e2f48ad</task-id>
  <task-name>spike-task</task-name>
  <status>completed</status>

  <exit-code>0</exit-code>
  <output-file>.pi/tasks/session-24118-24118/b2e2f48ad.output</output-file>
  <summary>Background task "spike-task" completed</summary>
  <guidance>Terminal state and output metadata are durable.</guidance>
</background-task-notification>`;

  it("parses the pi terminal wakeup envelope with tag discriminator", () => {
    expect(parseAgentTaskNotification(PI_NOTIFICATION)).toEqual({
      taskId: "b2e2f48ad",
      toolUseId: null,
      outputFile: ".pi/tasks/session-24118-24118/b2e2f48ad.output",
      status: "completed",
      summary: 'Background task "spike-task" completed',
      resultText: "",
      tag: "background-task-notification",
      taskName: "spike-task",
      exitCode: "0",
    });
  });

  it("parses failed notifications with non-zero exit code", () => {
    const parsed = parseAgentTaskNotification(`<background-task-notification>
  <task-id>b_fail1</task-id>
  <task-name>failing-task</task-name>
  <status>failed</status>
  <exit-code>137</exit-code>
</background-task-notification>`);

    expect(parsed?.tag).toBe("background-task-notification");
    expect(parsed?.status).toBe("failed");
    expect(parsed?.exitCode).toBe("137");
  });

  it("is recognized by isPiBackgroundTaskNotification and not for Claude envelopes", () => {
    const pi = parseAgentTaskNotification(PI_NOTIFICATION);
    const claude = parseAgentTaskNotification(`<task-notification>
<task-id>b234djc13</task-id>
<status>completed</status>
</task-notification>`);

    expect(isPiBackgroundTaskNotification(pi)).toBe(true);
    expect(isPiBackgroundTaskNotification(claude)).toBe(false);
    expect(claude?.tag).toBe("task-notification");
  });

  it("is covered by isCliInjectedAgentTaskNotificationText", () => {
    expect(isCliInjectedAgentTaskNotificationText(PI_NOTIFICATION)).toBe(true);
  });

  it("parses entity-escaped pi notifications", () => {
    const parsed = parseAgentTaskNotification(`
&lt;background-task-notification&gt;
  &lt;task-id&gt;b_escaped&lt;/task-id&gt;
  &lt;status&gt;completed&lt;/status&gt;
&lt;/background-task-notification&gt;`);

    expect(parsed?.tag).toBe("background-task-notification");
    expect(parsed?.taskId).toBe("b_escaped");
  });

  it("returns null for an empty pi envelope", () => {
    expect(
      parseAgentTaskNotification(
        "<background-task-notification></background-task-notification>",
      ),
    ).toBeNull();
  });

  it("does not swallow ordinary prose mentioning the tag mid-text", () => {
    expect(
      parseAgentTaskNotification(
        "前文散文 <background-task-notification><task-id>x</task-id></background-task-notification>",
      ),
    ).toBeNull();
  });

  it("rejects envelopes with attributes on the open tag (0.3.12 boundary)", () => {
    expect(
      parseAgentTaskNotification(
        '<background-task-notification data-x="1"><task-id>x</task-id></background-task-notification>',
      ),
    ).toBeNull();
  });
});

describe("isCliInjectedAgentTaskNotificationText", () => {
  it("treats a background wakeup envelope as CLI-injected", () => {
    expect(
      isCliInjectedAgentTaskNotificationText(`<task-notification>
<task-id>b83ywvfpw</task-id>
<status>completed</status>
<summary>Background command "Sleep 8s then echo timestamp" completed</summary>
</task-notification>`),
    ).toBe(true);
  });

  it("does not treat ordinary user questions as CLI-injected", () => {
    expect(isCliInjectedAgentTaskNotificationText("把这个命令丢到后台跑")).toBe(false);
  });
});
