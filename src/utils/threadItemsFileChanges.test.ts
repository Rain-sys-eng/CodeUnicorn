import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import {
  inferFileChangesFromCommandExecutionArtifacts,
  inferFileChangesFromPayload,
  inferMutatingFileChangesFromCommand,
  mergeToolChanges,
  normalizeFileChangeKind,
} from "./threadItemsFileChanges";

type ToolChanges = NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>;

describe("threadItemsFileChanges.mergeToolChanges", () => {
  it("prefers local specific kind when remote kind is modified", () => {
    const remote: ToolChanges = [
      { path: "src/App.tsx", kind: "modified" },
    ];
    const local: ToolChanges = [
      { path: "src/App.tsx", kind: "add" },
    ];

    const merged = mergeToolChanges(remote, local);

    expect(merged?.[0]?.kind).toBe("add");
  });

  it("keeps remote add/delete/rename kinds when already specific", () => {
    const remote: ToolChanges = [
      { path: "src/App.tsx", kind: "delete" },
    ];
    const local: ToolChanges = [
      { path: "src/App.tsx", kind: "modified" },
    ];

    const merged = mergeToolChanges(remote, local);

    expect(merged?.[0]?.kind).toBe("delete");
  });

  it("falls back to local normalized kind when remote kind is unknown", () => {
    const remote: ToolChanges = [
      { path: "src/App.tsx", kind: "unknown-kind" },
    ];
    const local: ToolChanges = [
      { path: "src/App.tsx", kind: "D" },
    ];

    const merged = mergeToolChanges(remote, local);

    expect(merged?.[0]?.kind).toBe("delete");
  });

  it("normalizes U to modified", () => {
    expect(normalizeFileChangeKind("U")).toBe("modified");
  });

  it("parses concise status lines from string payload", () => {
    const inferred = inferFileChangesFromPayload(
      [
        "(A) src/new-file.ts",
        "(U) src/existing-file.ts",
        "(D) src/removed-file.ts",
      ].join("\n"),
    );

    expect(inferred).toEqual([
      { path: "src/new-file.ts", kind: "add", diff: undefined },
      { path: "src/existing-file.ts", kind: "modified", diff: undefined },
      { path: "src/removed-file.ts", kind: "delete", diff: undefined },
    ]);
  });

  it("parses git porcelain two-letter statuses from command output", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "git status --short",
      [
        "MM src/App.tsx",
        "?? src/new-file.ts",
        "R  src/old-name.ts -> src/new-name.ts",
      ].join("\n"),
    );

    expect(inferred).toEqual([
      { path: "src/App.tsx", kind: "modified", diff: undefined },
      { path: "src/new-file.ts", kind: "add", diff: undefined },
      {
        path: "src/new-name.ts",
        kind: "rename",
        diff: [
          "*** Begin Patch",
          "*** Update File: src/old-name.ts",
          "*** Move to: src/new-name.ts",
          "*** End Patch",
        ].join("\n"),
      },
    ]);
  });

  it("infers deleted file paths from rm-style command execution", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      '删除文件 · rm "/Users/demo/repo/SPEC_KIT_实战指南.md" && echo done',
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/SPEC_KIT_实战指南.md",
        kind: "delete",
        diff: undefined,
      },
    ]);
  });

  it("infers added file paths from shell redirection command execution", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "printf '100' > /Users/demo/repo/abc.txt",
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/abc.txt",
        kind: "add",
        diff: undefined,
      },
    ]);
  });

  it("infers added file paths from no-space redirection command execution", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "echo 100>/Users/demo/repo/abc-no-space.txt",
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/abc-no-space.txt",
        kind: "add",
        diff: undefined,
      },
    ]);
  });

  it("treats append redirection as modified to avoid destructive false add", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "echo 100 >> /Users/demo/repo/existing.txt",
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/existing.txt",
        kind: "modified",
        diff: undefined,
      },
    ]);
  });

  it("does not infer file changes from command output capture redirection", () => {
    expect(
      inferMutatingFileChangesFromCommand(
        "claude --help > claude_help.txt 2>&1; grep -E \"--append-system-prompt-file\" claude_help.txt",
      ),
    ).toEqual([]);
    expect(
      inferMutatingFileChangesFromCommand(
        'rg -n "useAppSettings" src --include="*.rs" 2>&1 | head -10',
      ),
    ).toEqual([]);
  });

  it("does not treat structured codex tool field paths as file changes", () => {
    const inferred = inferFileChangesFromPayload([
      {
        path: "toolInput.questions",
        kind: "modified",
      },
      {
        path: "presentationProfile.showReasoningLiveDot",
        kind: "modified",
      },
      {
        path: "fallbackStats.additions",
        kind: "modified",
      },
    ]);

    expect(inferred).toEqual([]);
  });

  it("does not treat status-prefixed code fragments as file changes", () => {
    const inferred = inferFileChangesFromPayload(
      [
        "(A) ... }",
        "(A) { engine::gemini_history::delete_gemini_session }",
        '(A) { engine::commands::opencode_delete_session }',
        '(A) "Gemini CLI".to_string',
        "(A) { ... }",
        "(A) detect_gemini_status(None).await.inspect",
        "(A) detect_opencode_status(None).await.inspect",
        '(A) entry.type === "opencode"',
      ].join("\n"),
    );

    expect(inferred).toEqual([]);
  });

  it("keeps actual file paths when payload also contains dotted field names", () => {
    const inferred = inferFileChangesFromPayload([
      {
        path: "toolInput.questions",
        kind: "modified",
      },
      {
        path: "src/App.tsx",
        kind: "modified",
      },
    ]);

    expect(inferred).toEqual([
      {
        path: "src/App.tsx",
        kind: "modified",
        diff: undefined,
      },
    ]);
  });

  it("keeps root-level real file names instead of treating them as structured fields", () => {
    const inferred = inferFileChangesFromPayload([
      {
        path: "package.json",
        kind: "modified",
      },
      {
        path: "CLAUDE.md",
        kind: "modified",
      },
    ]);

    expect(inferred).toEqual([
      {
        path: "package.json",
        kind: "modified",
        diff: undefined,
      },
      {
        path: "CLAUDE.md",
        kind: "modified",
        diff: undefined,
      },
    ]);
  });

  it("parses DSH live write arguments stored as a raw JSON string", () => {
    const inferred = inferFileChangesFromPayload(
      JSON.stringify({
        file_path: "src/main/java/com/example/demo/security/SecurityConfig.java",
        content: "package com.example.demo.security;\n",
      }),
    );

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.path).toBe(
      "src/main/java/com/example/demo/security/SecurityConfig.java",
    );
    expect(inferred[0]?.diff).toContain("+package com.example.demo.security;");
  });

  it("parses DSH live edit arguments stored as a raw JSON string", () => {
    const inferred = inferFileChangesFromPayload(
      JSON.stringify({
        file_path: "CLAUDE.md",
        old_string: "apple",
        new_string: "kiwi",
      }),
    );

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.path).toBe("CLAUDE.md");
    expect(inferred[0]?.diff).toContain("-apple");
    expect(inferred[0]?.diff).toContain("+kiwi");
  });

  it("does not treat a JSON todos payload as file changes", () => {
    expect(
      inferFileChangesFromPayload(
        JSON.stringify({
          todos: [{ content: "write KiwiController", status: "in_progress" }],
        }),
      ),
    ).toEqual([]);
  });

  it("still parses apply_patch text that is not a JSON object", () => {
    const inferred = inferFileChangesFromPayload(
      [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    );
    expect(inferred.some((entry) => entry.path === "src/a.ts")).toBe(true);
  });
});
